import {
	bytesToBase64,
	bytesToHex,
	cre,
	getNetwork,
	hexToBase64,
	TxStatus,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { type Address, encodeAbiParameters, encodeFunctionData, parseAbiParameters } from 'viem'
import { z } from 'zod'
import { FirewallMarginExecutor } from '../contracts/evm/ts/generated/FirewallMarginExecutor'

// ─── Config Schema ──────────────────────────────────────────
// Everything here is NON-sensitive: endpoints, public addresses, and secret IDs
// (never secret values). The Graph API key and every policy threshold arrive
// through the Vault DON, inside the enclave.
export const configSchema = z.object({
	schedule: z.string(),

	/** Sepolia margin-account state (collateral, debt, health). */
	positionApiUrl: z.string(),

	/** The Graph gateway + the standardized Lending deployments to fan out across. */
	graph: z.object({
		gatewayBaseUrl: z.string(),
		subgraphIds: z.array(z.string()),
	}),

	/** Hedera mirror node + the ATS security token whose balance backs the account. */
	hedera: z.object({
		mirrorNodeUrl: z.string(),
		bondAddress: z.string(),
		noteHolder: z.string(),
		noteDecimals: z.number(),
		/** Marked USD price per whole unit of the note. */
		unitPriceUsd: z.number(),
	}),

	secretsIds: z.object({
		minHealthFactorId: z.string(),
		liquidationLtvThresholdId: z.string(),
		maxCrossProtocolExposureUsdId: z.string(),
		maxLiquidationPctId: z.string(),
		maxMarketStressBpsId: z.string(),
		graphApiKeyId: z.string(),
	}),

	onchain: z.object({
		enabled: z.boolean(),
		chainSelectorName: z.string(),
		executorAddress: z.string(),
		account: z.string(),
	}),
})
type Config = z.infer<typeof configSchema>

// ─── Confidential inputs ─────────────────────────────────────
type PolicyThresholds = {
	minHealthFactor: number
	liquidationLtvThresholdPct: number
	maxCrossProtocolExposureUsd: number
	maxLiquidationPct: number
	maxMarketStressBps: number
}

type CryptoPosition = {
	collateralAssetSymbol: string
	/** USD value of the liquid crypto bucket — the only bucket a seizure may reach. */
	cryptoValueUsd: number
	/** USD value of the recognised Hedera note, as the vault currently sees it. */
	protectedValueUsd: number
	debtUsd: number
	healthFactor: number
	loanToValuePct: number
	liquidationThresholdPct: number
}

/** What the enclave read from the Hedera mirror node. */
type ProtectedAsset = {
	token: Address
	units: bigint
	valueUsd: number
}

/** What the enclave derived from the standardized Graph query. */
type MarketSignals = {
	crossProtocolBorrowExposureUsd: number
	marketStressBps: number
	collateralPriceUsd: number
	protocolsAnswered: number
}

export type LiquidationVerdict = {
	liquidate: boolean
	action: 'hold' | 'restrict_borrowing' | 'liquidate'
	account: Address
	amountUsd: number
	riskScore: number
	reason: string
	/** Published so the UI can show what the market demanded — never the thresholds. */
	requiredHealthFactor: number
	marketStressBps: number
	protectedUnits: string
	protectedValueUsd: number
}

const actionCode = (action: LiquidationVerdict['action']): number =>
	action === 'restrict_borrowing' ? 1 : action === 'liquidate' ? 2 : 0

// ─── The ONE standardized Messari Lending query ──────────────
// Identical document sent to every registered deployment. Only common-schema
// entities are used, which is the only reason a single query can span Aave v3,
// Compound v3 and Spark Lend at once.
const PROTOCOL_RISK_QUERY = `
  query GalvanicProtocolRisk($account: ID!) {
    account(id: $account) {
      positions(where: { side: BORROWER, hashClosed: null }, first: 1000) {
        balance
        asset { symbol decimals lastPriceUSD }
      }
    }
    financialsDailySnapshots(first: 7, orderBy: timestamp, orderDirection: desc) {
      dailyLiquidateUSD
      totalBorrowBalanceUSD
    }
    markets(first: 200, where: { isActive: true }) {
      totalBorrowBalanceUSD
      totalDepositBalanceUSD
      inputToken { symbol lastPriceUSD }
    }
  }
`.trim()

const ETH_SYMBOLS = ['WETH', 'ETH', 'wstETH', 'weETH', 'rETH', 'cbETH', 'ETHx', 'osETH']

// ─── Pure decision logic (deterministic, unit-testable) ──────

/**
 * Market stress in basis points of extra health-factor buffer, derived only from
 * live standardized-schema fields aggregated across every protocol that answered.
 */
export const computeMarketStressBps = (
	liquidationIntensityBps: number,
	utilizationPct: number,
): number => {
	const utilizationPressure = Math.max(0, utilizationPct - 70) * 20
	return Math.round(Math.min(liquidationIntensityBps * 10 + utilizationPressure, 5_000))
}

/**
 * The health factor the policy actually requires right now. The private floor is a
 * secret; the buffer on top of it comes from live Graph market data. This is the
 * single place where Graph data changes where the liquidation line sits.
 */
export const requiredHealthFactor = (policy: PolicyThresholds, marketStressBps: number): number =>
	policy.minHealthFactor * (1 + marketStressBps / 10_000)

export const computeRiskScore = (
	position: CryptoPosition,
	market: MarketSignals,
	policy: PolicyThresholds,
): number => {
	const required = requiredHealthFactor(policy, market.marketStressBps)
	const healthDeficit = Math.max(0, required - position.healthFactor) * 100
	const ltvBuffer = Math.max(0, position.loanToValuePct - (position.liquidationThresholdPct - 5)) * 2
	const exposureOverage =
		Math.max(0, market.crossProtocolBorrowExposureUsd - policy.maxCrossProtocolExposureUsd) / 100
	const stressOverage = Math.max(0, market.marketStressBps - policy.maxMarketStressBps) / 10
	return healthDeficit + ltvBuffer + exposureOverage + stressOverage
}

export const decideVerdict = (
	account: Address,
	position: CryptoPosition,
	market: MarketSignals,
	protectedAsset: ProtectedAsset,
	policy: PolicyThresholds,
): LiquidationVerdict => {
	const riskScore = computeRiskScore(position, market, policy)
	const required = requiredHealthFactor(policy, market.marketStressBps)

	const base = {
		account,
		riskScore,
		requiredHealthFactor: required,
		marketStressBps: market.marketStressBps,
		protectedUnits: protectedAsset.units.toString(),
		protectedValueUsd: protectedAsset.valueUsd,
	}

	// Only a breach on the crypto leg's own terms can authorise a seizure, because
	// the crypto bucket is the only collateral a seizure is permitted to reach. The
	// protected note is never an input to this test and never a source of recovery.
	const breachesHealth = position.healthFactor < required
	const breachesLtv = position.loanToValuePct >= policy.liquidationLtvThresholdPct

	if (breachesHealth || breachesLtv) {
		// How much DEBT the policy is willing to close in one action — a private close
		// factor. Note what this number deliberately is not: a claim on any particular
		// collateral. The policy decides how much debt to retire; the vault decides
		// which bucket may pay for it, and under the firewall that is only ever the
		// crypto bucket. Keeping those two decisions in separate places is the whole
		// safety property — a policy that could name the collateral could name the note.
		const cappedAmount = Math.round(
			Math.min(position.debtUsd * (policy.maxLiquidationPct / 100), position.debtUsd),
		)
		return {
			...base,
			liquidate: true,
			action: 'liquidate',
			amountUsd: cappedAmount,
			reason: breachesHealth
				? `health factor ${position.healthFactor.toFixed(2)} is below the ${required.toFixed(2)} the policy requires at current market stress`
				: 'LTV at or above the private liquidation threshold',
		}
	}

	// Risk the account carries elsewhere, or a market too stressed to absorb a
	// liquidation, restricts new borrowing. Neither is a breach of this leg's own
	// terms, so neither may seize anything.
	const breachesExposure =
		market.crossProtocolBorrowExposureUsd > policy.maxCrossProtocolExposureUsd
	const breachesStress = market.marketStressBps > policy.maxMarketStressBps

	if (breachesExposure || breachesStress) {
		return {
			...base,
			liquidate: false,
			action: 'restrict_borrowing',
			amountUsd: 0,
			reason: breachesExposure
				? `cross-protocol borrow exposure of $${Math.round(market.crossProtocolBorrowExposureUsd).toLocaleString()} across ${market.protocolsAnswered} lending protocols exceeds the private cap — the crypto leg is healthy, so new borrowing is restricted rather than collateral seized`
				: 'lending-market stress exceeds the private cap — borrowing restricted while the market is unable to absorb a liquidation cleanly',
		}
	}

	return {
		...base,
		liquidate: false,
		action: 'hold',
		amountUsd: 0,
		reason: 'crypto leg within policy at current market stress; no action',
	}
}

// ─── Enclave I/O ─────────────────────────────────────────────
// Every request below is issued from inside the TEE. Raw responses — the account's
// position, the Graph payloads, the Hedera balance — are never returned to the DON.

const decodeBody = (raw: Uint8Array): string => new TextDecoder().decode(raw)

/**
 * Every outbound request the policy makes goes through here, and every one of them
 * is issued from inside the enclave — the handler is registered with
 * `cre.handlerInTee`, so the URL (which carries the Graph credential), the request
 * body and the raw response all live and die inside the TEE. Only the verdict
 * crosses back out.
 */
const enclaveRequest = (
	runtime: TeeRuntime<Config>,
	request: { url: string; method: string; bodyString?: string; headers?: Record<string, string> },
): string => {
	const multiHeaders: Record<string, { values: string[] }> = {}
	for (const [key, value] of Object.entries(request.headers ?? {})) {
		multiHeaders[key] = { values: [value] }
	}

	// The proto's `body` field is `bytes`, so its JSON encoding is base64 — and the
	// key must be absent entirely, not undefined, on a request that carries no body.
	const payload: Record<string, unknown> = {
		url: request.url,
		method: request.method,
		multiHeaders,
	}
	if (request.bodyString !== undefined) {
		payload.body = bytesToBase64(new TextEncoder().encode(request.bodyString))
	}

	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, payload as never)
		.result()

	if (response.statusCode >= 400) {
		throw new Error(`request failed with status ${response.statusCode}`)
	}
	return decodeBody(response.body)
}

const getJson = (runtime: TeeRuntime<Config>, url: string): Record<string, unknown> =>
	JSON.parse(enclaveRequest(runtime, { url, method: 'GET' }))

const postJson = (
	runtime: TeeRuntime<Config>,
	url: string,
	body: unknown,
): Record<string, unknown> =>
	JSON.parse(
		enclaveRequest(runtime, {
			url,
			method: 'POST',
			bodyString: JSON.stringify(body),
			headers: { 'Content-Type': 'application/json' },
		}),
	)

const asNumber = (value: unknown, fallback = 0): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback

const asString = (value: unknown, fallback = ''): string =>
	typeof value === 'string' ? value : fallback

const toNumber = (value: unknown): number => {
	const parsed = Number(value ?? 0)
	return Number.isFinite(parsed) ? parsed : 0
}

const parsePosition = (payload: Record<string, unknown>): CryptoPosition => ({
	collateralAssetSymbol: asString(payload.collateral_asset_symbol, 'ETH'),
	cryptoValueUsd: asNumber(payload.crypto_value_usd),
	protectedValueUsd: asNumber(payload.protected_value_usd),
	debtUsd: asNumber(payload.debt_usd),
	healthFactor: asNumber(payload.health_factor),
	loanToValuePct: asNumber(payload.loan_to_value_pct),
	liquidationThresholdPct: asNumber(payload.liquidation_threshold_pct),
})

const parseSecretNumber = (value: string, id: string): number => {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) throw new Error(`secret ${id} must be a finite number`)
	return parsed
}

/**
 * Reads the account's ATS security-token balance straight off the Hedera mirror
 * node, from inside the enclave. This is what lets a Hedera asset carry margin on
 * Sepolia with no bridge: the enclave observes the balance and the DON signs for
 * what it saw. Nothing is wrapped, locked or minted.
 */
const readHederaNote = (runtime: TeeRuntime<Config>): ProtectedAsset => {
	const { mirrorNodeUrl, bondAddress, noteHolder, noteDecimals, unitPriceUsd } =
		runtime.config.hedera

	const data = encodeFunctionData({
		abi: [
			{
				type: 'function',
				name: 'balanceOf',
				stateMutability: 'view',
				inputs: [{ name: 'account', type: 'address' }],
				outputs: [{ type: 'uint256' }],
			},
		],
		functionName: 'balanceOf',
		args: [noteHolder as Address],
	})

	const payload = postJson(runtime, `${mirrorNodeUrl}/contracts/call`, {
		block: 'latest',
		data,
		to: bondAddress,
	})

	const raw = asString(payload.result, '0x0')
	const units = BigInt(raw === '0x' ? '0x0' : raw)
	const whole = Number(units) / 10 ** noteDecimals

	return { token: bondAddress as Address, units, valueUsd: whole * unitPriceUsd }
}

/**
 * Fans the one standardized query across every registered Messari Lending
 * deployment, using a Graph API key that exists only inside the enclave. The key is
 * never in config, never in a log line, and never crosses back to the DON — only
 * the three derived numbers do.
 */
const readGraphSignals = (
	runtime: TeeRuntime<Config>,
	account: string,
	apiKey: string,
): MarketSignals => {
	const { gatewayBaseUrl, subgraphIds } = runtime.config.graph

	let exposureUsd = 0
	let totalBorrowUsd = 0
	let liquidated7dUsd = 0
	let ethBorrowUsd = 0
	let ethDepositUsd = 0
	const ethPrices: number[] = []
	let answered = 0

	for (const subgraphId of subgraphIds) {
		let payload: Record<string, unknown>
		try {
			payload = postJson(runtime, `${gatewayBaseUrl}/${apiKey}/subgraphs/id/${subgraphId}`, {
				query: PROTOCOL_RISK_QUERY,
				variables: { account: account.toLowerCase() },
			})
		} catch {
			// One deprecated or unallocated deployment must not take down the aggregate.
			continue
		}
		if (payload.errors) continue

		const data = (payload.data ?? {}) as Record<string, any>
		answered += 1

		for (const position of data.account?.positions ?? []) {
			const decimals = toNumber(position.asset?.decimals) || 18
			exposureUsd +=
				(toNumber(position.balance) / 10 ** decimals) * toNumber(position.asset?.lastPriceUSD)
		}

		const snapshots = data.financialsDailySnapshots ?? []
		if (snapshots.length > 0) totalBorrowUsd += toNumber(snapshots[0].totalBorrowBalanceUSD)
		for (const snapshot of snapshots) liquidated7dUsd += toNumber(snapshot.dailyLiquidateUSD)

		for (const market of data.markets ?? []) {
			if (!ETH_SYMBOLS.includes(market.inputToken?.symbol)) continue
			ethBorrowUsd += toNumber(market.totalBorrowBalanceUSD)
			ethDepositUsd += toNumber(market.totalDepositBalanceUSD)
			const price = toNumber(market.inputToken?.lastPriceUSD)
			if (price > 0) ethPrices.push(price)
		}
	}

	const liquidationIntensityBps = totalBorrowUsd > 0 ? (liquidated7dUsd / totalBorrowUsd) * 10_000 : 0
	const utilizationPct = ethDepositUsd > 0 ? (ethBorrowUsd / ethDepositUsd) * 100 : 0
	ethPrices.sort((a, b) => a - b)

	return {
		crossProtocolBorrowExposureUsd: exposureUsd,
		marketStressBps: computeMarketStressBps(liquidationIntensityBps, utilizationPct),
		collateralPriceUsd: ethPrices.length > 0 ? ethPrices[Math.floor(ethPrices.length / 2)] : 0,
		protocolsAnswered: answered,
	}
}

// ─── TEE handler ─────────────────────────────────────────────
// Everything from here to `usingTheDons()` runs inside the enclave.
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const { positionApiUrl, secretsIds, onchain } = runtime.config
	const account = onchain.account as Address

	// (a) Private policy thresholds + the Graph credential, released by the Vault DON
	// only into the attested enclave.
	const secrets = runtime
		.getSecrets([
			{ id: secretsIds.minHealthFactorId },
			{ id: secretsIds.liquidationLtvThresholdId },
			{ id: secretsIds.maxCrossProtocolExposureUsdId },
			{ id: secretsIds.maxLiquidationPctId },
			{ id: secretsIds.maxMarketStressBpsId },
			{ id: secretsIds.graphApiKeyId },
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
		maxMarketStressBps: parseSecretNumber(
			secrets[secretsIds.maxMarketStressBpsId].value,
			secretsIds.maxMarketStressBpsId,
		),
	}
	const graphApiKey = secrets[secretsIds.graphApiKeyId].value

	// (b) The protected asset, read from Hedera inside the enclave.
	const protectedAsset = readHederaNote(runtime)

	// (c) Live market context, read from The Graph inside the enclave with a key
	// that never leaves it.
	const market = readGraphSignals(runtime, account, graphApiKey)

	// (d) The Sepolia margin account.
	const position = parsePosition(getJson(runtime, positionApiUrl))

	const verdict = decideVerdict(account, position, market, protectedAsset, policy)

	// Simulation aid. Carries no threshold and no raw payload — only what the report
	// itself already publishes.
	runtime.log(
		`Galvanic verdict: ${verdict.action} amountUsd=${verdict.amountUsd} ` +
			`requiredHF=${verdict.requiredHealthFactor.toFixed(3)} stress=${verdict.marketStressBps}bps ` +
			`protected=${verdict.protectedValueUsd} reason="${verdict.reason}"`,
	)

	// ── Cross back to the DON: only the verdict and the attestation leave ──
	const donRuntime = runtime.usingTheDons()

	const encodedPayload = encodeAbiParameters(
		parseAbiParameters(
			'uint8 action, address account, uint256 amountUsd, uint256 protectedUnits, uint256 protectedValueUsd, address hederaToken',
		),
		[
			actionCode(verdict.action),
			verdict.account,
			BigInt(verdict.amountUsd),
			protectedAsset.units,
			BigInt(Math.round(protectedAsset.valueUsd * 1e18)),
			protectedAsset.token,
		],
	)

	const report = donRuntime
		.report({
			encodedPayload: hexToBase64(encodedPayload),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

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
		runtime.log(`Delivered onchain. TX: ${bytesToHex(writeResult.txHash || new Uint8Array(32))}`)
	}

	// The report bytes are published so the product can relay the exact payload the
	// enclave produced, and a judge can decode it independently.
	return JSON.stringify({ ...verdict, reportPayload: encodedPayload })
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
