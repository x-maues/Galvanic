import {
	bytesToHex,
	cre,
	getNetwork,
	hexToBase64,
	TxStatus,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { type Address, encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'
import { FirewallMarginExecutor } from '../contracts/evm/ts/generated/FirewallMarginExecutor'

// ─── Config Schema ──────────────────────────────────────────
// Everything here is NON-sensitive: URLs, secret IDs (not secret values), and
// the onchain wiring for the (not-yet-deployed) Firewall Margin vault.
export const configSchema = z.object({
	schedule: z.string(),

	// Placeholder today; will be the account's live crypto-collateral health
	// endpoint (e.g. a lending-market position read) once wired to a real venue.
	positionApiUrl: z.string(),

	// Placeholder today; will be replaced by a Messari Standardized Subgraph
	// query on The Graph (e.g. the account's existing borrow exposure on Aave)
	// so the confidential risk decision is informed by live cross-protocol data.
	exposureApiUrl: z.string(),

	secretsIds: z.object({
		minHealthFactorId: z.string(),
		liquidationLtvThresholdId: z.string(),
		maxCrossProtocolExposureUsdId: z.string(),
		maxLiquidationPctId: z.string(),
	}),

	onchain: z.object({
		// Kept false until the Firewall Margin vault/executor is actually deployed
		// on Sepolia. Flipping it to true is the only change needed to go from
		// "verdict computed + logged" to "verdict delivered onchain via writeReport".
		enabled: z.boolean(),
		chainSelectorName: z.string(),
		executorAddress: z.string(),
		account: z.string(),
	}),
})
type Config = z.infer<typeof configSchema>

// ─── Types for the confidential inputs ───────────────────────
type PolicyThresholds = {
	minHealthFactor: number
	liquidationLtvThresholdPct: number
	maxCrossProtocolExposureUsd: number
	maxLiquidationPct: number
}

type CryptoPosition = {
	collateralAssetSymbol: string
	collateralBalanceUsd: number
	healthFactor: number
	loanToValuePct: number
	liquidationThresholdPct: number
}

type CrossProtocolExposure = {
	// Stands in for a Messari Standardized Subgraph query result: the account's
	// existing borrow exposure on another protocol (e.g. Aave), which must be
	// weighed before liquidating crypto collateral that also backs that exposure.
	crossProtocolBorrowExposureUsd: number
}

export type LiquidationVerdict = {
	liquidate: boolean
	account: Address
	amountUsd: number
	riskScore: number
	reason: string
}

// ─── Pure decision logic (unit-testable, deterministic) ──────
// This is the "confidential logic" the task asks for: combining private policy
// thresholds with position + exposure data to produce ONE verdict. It never
// crosses the TEE boundary itself — only the returned verdict does.
export const computeRiskScore = (
	position: CryptoPosition,
	exposure: CrossProtocolExposure,
	policy: PolicyThresholds,
): number => {
	const healthDeficit = Math.max(0, policy.minHealthFactor - position.healthFactor) * 100
	const ltvBuffer = Math.max(0, position.loanToValuePct - (position.liquidationThresholdPct - 5)) * 2
	const exposureOverage = Math.max(
		0,
		exposure.crossProtocolBorrowExposureUsd - policy.maxCrossProtocolExposureUsd,
	) / 100

	return healthDeficit + ltvBuffer + exposureOverage
}

export const decideVerdict = (
	account: Address,
	position: CryptoPosition,
	exposure: CrossProtocolExposure,
	policy: PolicyThresholds,
): LiquidationVerdict => {
	const riskScore = computeRiskScore(position, exposure, policy)

	// The crypto leg is only isolated and acted on when its own health/LTV
	// breaches policy, OR when cross-protocol exposure has grown too large
	// relative to what the account can safely carry. Either signal alone can
	// trigger a defensive action — this is the "risk-partitioned" decision:
	// only the crypto leg is ever a candidate here, protected RWA collateral
	// is never part of this computation.
	const breachesHealth = position.healthFactor < policy.minHealthFactor
	const breachesLtv = position.loanToValuePct >= policy.liquidationLtvThresholdPct
	const breachesExposure = exposure.crossProtocolBorrowExposureUsd > policy.maxCrossProtocolExposureUsd

	const liquidate = breachesHealth || breachesLtv || breachesExposure

	if (!liquidate) {
		return {
			liquidate: false,
			account,
			amountUsd: 0,
			riskScore,
			reason: 'crypto leg within policy; no action',
		}
	}

	const cappedAmount = Math.round(
		Math.min(position.collateralBalanceUsd * (policy.maxLiquidationPct / 100), position.collateralBalanceUsd),
	)

	const reason = breachesHealth
		? 'health factor below policy minimum'
		: breachesLtv
			? 'LTV at/above liquidation threshold'
			: 'cross-protocol exposure exceeds policy cap'

	return {
		liquidate: true,
		account,
		amountUsd: cappedAmount,
		riskScore,
		reason,
	}
}

// ─── HTTP helpers (run inside the enclave via TeeRuntime) ────
const decodeBody = (raw: Uint8Array): string => new TextDecoder().decode(raw)

const getJson = (runtime: TeeRuntime<Config>, url: string): Record<string, unknown> => {
	const response = new cre.capabilities.HTTPClient().sendRequest(runtime, { url, method: 'GET' }).result()

	if (response.statusCode >= 400) {
		throw new Error(`request to ${url} failed with status ${response.statusCode}`)
	}
	return JSON.parse(decodeBody(response.body))
}

const asNumber = (value: unknown, fallback = 0): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback

const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

const parsePosition = (payload: Record<string, unknown>): CryptoPosition => ({
	collateralAssetSymbol: asString(payload.collateral_asset_symbol, 'ETH'),
	collateralBalanceUsd: asNumber(payload.collateral_balance_usd),
	healthFactor: asNumber(payload.health_factor),
	loanToValuePct: asNumber(payload.loan_to_value_pct),
	liquidationThresholdPct: asNumber(payload.liquidation_threshold_pct),
})

const parseExposure = (payload: Record<string, unknown>): CrossProtocolExposure => ({
	crossProtocolBorrowExposureUsd: asNumber(payload.cross_protocol_borrow_exposure_usd),
})

const parseSecretNumber = (value: string, id: string): number => {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) throw new Error(`secret ${id} must be a finite number`)
	return parsed
}

// ─── TEE Cron Callback ────────────────────────────────────────
// Everything from here to `usingTheDons()` runs inside the enclave. Only the
// final verdict — never the policy thresholds, never the raw position/exposure
// payloads — crosses back out to the Workflow DON.
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const { positionApiUrl, exposureApiUrl, secretsIds, onchain } = runtime.config

	// ── (a) Private liquidation policy thresholds ──
	// Released by the Vault DON only into the attested enclave. In production
	// these are the operator's real confidential risk limits; here they are
	// mocked via secrets.yaml -> .env for local simulation.
	const secrets = runtime
		.getSecrets([
			{ id: secretsIds.minHealthFactorId },
			{ id: secretsIds.liquidationLtvThresholdId },
			{ id: secretsIds.maxCrossProtocolExposureUsdId },
			{ id: secretsIds.maxLiquidationPctId },
		])
		.result()

	const policy: PolicyThresholds = {
		minHealthFactor: parseSecretNumber(
			secrets[secretsIds.minHealthFactorId].value,
			secretsIds.minHealthFactorId,
		),
		liquidationLtvThresholdPct: parseSecretNumber(
			secrets[secretsIds.liquidationLtvThresholdId].value,
			secretsIds.liquidationLtvThresholdId,
		),
		maxCrossProtocolExposureUsd: parseSecretNumber(
			secrets[secretsIds.maxCrossProtocolExposureUsdId].value,
			secretsIds.maxCrossProtocolExposureUsdId,
		),
		maxLiquidationPct: parseSecretNumber(
			secrets[secretsIds.maxLiquidationPctId].value,
			secretsIds.maxLiquidationPctId,
		),
	}

	// ── (c) Live crypto collateral health / LTV ──
	// Fetched from inside the enclave so the raw payload never leaves it.
	// Placeholder local mock endpoint today; a real lending-market position
	// read (or oracle) later.
	const position = parsePosition(getJson(runtime, positionApiUrl))

	// ── (b) Cross-protocol exposure ──
	// Placeholder local mock endpoint standing in for a Messari Standardized
	// Subgraph query on The Graph (e.g. borrow exposure on Aave). Fetched
	// inside the enclave for consistency, even though this particular number
	// is not itself secret — the point is that it becomes part of the
	// confidential computation alongside the private thresholds.
	const exposure = parseExposure(getJson(runtime, exposureApiUrl))

	const verdict = decideVerdict(onchain.account as Address, position, exposure, policy)

	// ⚠️ Simulation-only. Remove before production: logs never leave a real TEE,
	// but should still never carry policy thresholds or raw payloads.
	runtime.log(
		`Firewall Margin verdict: liquidate=${verdict.liquidate} amountUsd=${verdict.amountUsd} score=${verdict.riskScore.toFixed(2)} reason="${verdict.reason}"`,
	)

	// ── Cross back to the DON: only the verdict leaves the enclave ──
	const donRuntime = runtime.usingTheDons()

	const encodedPayload = encodeAbiParameters(parseAbiParameters('bool liquidate, address account, uint256 amountUsd'), [
		verdict.liquidate,
		verdict.account,
		BigInt(verdict.amountUsd),
	])

	const report = donRuntime
		.report({
			encodedPayload: hexToBase64(encodedPayload),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	// ── Pluggable onchain write ──
	// The Firewall Margin vault is not deployed yet, so this path is disabled
	// by default (`onchain.enabled: false` in config.*.json). Flip it on and
	// point `executorAddress` at a deployed `FirewallMarginExecutor` (or the
	// vault directly) to deliver the same DON-signed report via the CRE
	// Forwarder -> `executeLiquidation(account, amountUsd)`. See
	// contracts/evm/src/FirewallMarginExecutor.sol.
	if (onchain.enabled) {
		const network = getNetwork({
			chainFamily: 'evm',
			chainSelectorName: onchain.chainSelectorName,
			isTestnet: true,
		})
		if (!network) throw new Error(`Network not found: ${onchain.chainSelectorName}`)

		const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
		const executor = new FirewallMarginExecutor(evmClient, onchain.executorAddress as Address)

		const writeResult = executor.deliver(donRuntime, report)

		if (writeResult.txStatus !== TxStatus.SUCCESS) {
			throw new Error(`onchain delivery failed: ${writeResult.txStatus}`)
		}

		const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))
		runtime.log(`Delivered onchain. TX: ${txHash}`)
	}

	return JSON.stringify(verdict)
}

// ─── Workflow Init ──────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
