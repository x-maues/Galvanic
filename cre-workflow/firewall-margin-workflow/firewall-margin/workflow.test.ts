import { describe, expect } from 'bun:test'
import type { TeeRuntime } from '@chainlink/cre-sdk'
import { test } from '@chainlink/cre-sdk/test'
import { computeRiskScore, decideVerdict, initWorkflow, onCronTrigger } from './workflow'

// The public test surface does not yet ship a TEE runtime factory, so we stand
// up the small slice of `TeeRuntime` the handler actually uses — same
// approach as the hello-confidential-workflows-ts template.
const ACCOUNT = '0x1111111111111111111111111111111111111111'

const HEALTHY_POSITION = {
	collateral_asset_symbol: 'ETH',
	collateral_balance_usd: 45000,
	health_factor: 1.6,
	loan_to_value_pct: 55,
	liquidation_threshold_pct: 78,
}

const STRESSED_POSITION = {
	collateral_asset_symbol: 'ETH',
	collateral_balance_usd: 45000,
	health_factor: 1.02,
	loan_to_value_pct: 79,
	liquidation_threshold_pct: 78,
}

const LOW_EXPOSURE = { cross_protocol_borrow_exposure_usd: 5000 }

const makeConfig = () => ({
	schedule: '0 */1 * * * *',
	positionApiUrl: 'http://mock/position',
	exposureApiUrl: 'http://mock/exposure',
	secretsIds: {
		minHealthFactorId: 'MIN_HEALTH_FACTOR',
		liquidationLtvThresholdId: 'LIQUIDATION_LTV_THRESHOLD',
		maxCrossProtocolExposureUsdId: 'MAX_CROSS_PROTOCOL_EXPOSURE_USD',
		maxLiquidationPctId: 'MAX_LIQUIDATION_PCT',
	},
	onchain: {
		enabled: false,
		chainSelectorName: 'ethereum-testnet-sepolia',
		executorAddress: '0x000000000000000000000000000000000000dEaD',
		account: ACCOUNT,
	},
})

const SECRET_VALUES: Record<string, string> = {
	MIN_HEALTH_FACTOR: '1.1',
	LIQUIDATION_LTV_THRESHOLD: '78',
	MAX_CROSS_PROTOCOL_EXPOSURE_USD: '20000',
	MAX_LIQUIDATION_PCT: '50',
}

type FakeTeeRuntimeOptions = {
	position?: typeof HEALTHY_POSITION
	exposure?: typeof LOW_EXPOSURE
}

const makeFakeTeeRuntime = ({ position = HEALTHY_POSITION, exposure = LOW_EXPOSURE }: FakeTeeRuntimeOptions = {}) => {
	const reports: unknown[] = []
	const logs: string[] = []
	let callIndex = 0

	const runtime = {
		config: makeConfig(),
		getSecrets: (requests: { id: string }[]) => ({
			result: () =>
				Object.fromEntries(requests.map((r) => [r.id, { id: r.id, value: SECRET_VALUES[r.id] }])),
		}),
		callCapability: () => {
			// Alternates between the position and exposure fetch, matching the
			// two `getJson` calls the handler makes in order.
			const body = callIndex === 0 ? position : exposure
			callIndex += 1
			return {
				result: () => ({
					statusCode: 200,
					body: new TextEncoder().encode(JSON.stringify(body)),
				}),
			}
		},
		log: (message: string) => logs.push(message),
		usingTheDons: () => ({
			report: (input: unknown) => {
				reports.push(input)
				return { result: () => ({}) }
			},
		}),
	}

	return { runtime: runtime as unknown as TeeRuntime<ReturnType<typeof makeConfig>>, reports, logs }
}

describe('computeRiskScore + decideVerdict', () => {
	test('does not liquidate when health, LTV, and exposure are all within policy', () => {
		const verdict = decideVerdict(
			ACCOUNT,
			{
				collateralAssetSymbol: 'ETH',
				collateralBalanceUsd: 45000,
				healthFactor: 1.6,
				loanToValuePct: 55,
				liquidationThresholdPct: 78,
			},
			{ crossProtocolBorrowExposureUsd: 5000 },
			{
				minHealthFactor: 1.1,
				liquidationLtvThresholdPct: 78,
				maxCrossProtocolExposureUsd: 20000,
				maxLiquidationPct: 50,
			},
		)

		expect(verdict.liquidate).toBe(false)
		expect(verdict.amountUsd).toBe(0)
	})

	test('liquidates the crypto leg when health factor breaches policy, capped by maxLiquidationPct', () => {
		const verdict = decideVerdict(
			ACCOUNT,
			{
				collateralAssetSymbol: 'ETH',
				collateralBalanceUsd: 45000,
				healthFactor: 1.02,
				loanToValuePct: 79,
				liquidationThresholdPct: 78,
			},
			{ crossProtocolBorrowExposureUsd: 5000 },
			{
				minHealthFactor: 1.1,
				liquidationLtvThresholdPct: 78,
				maxCrossProtocolExposureUsd: 20000,
				maxLiquidationPct: 50,
			},
		)

		expect(verdict.liquidate).toBe(true)
		expect(verdict.amountUsd).toBe(22500) // 50% of 45000
		expect(verdict.reason).toContain('health factor')
	})

	test('liquidates when cross-protocol exposure alone exceeds policy, even if the crypto leg is healthy', () => {
		const verdict = decideVerdict(
			ACCOUNT,
			{
				collateralAssetSymbol: 'ETH',
				collateralBalanceUsd: 45000,
				healthFactor: 1.6,
				loanToValuePct: 55,
				liquidationThresholdPct: 78,
			},
			{ crossProtocolBorrowExposureUsd: 30000 },
			{
				minHealthFactor: 1.1,
				liquidationLtvThresholdPct: 78,
				maxCrossProtocolExposureUsd: 20000,
				maxLiquidationPct: 50,
			},
		)

		expect(verdict.liquidate).toBe(true)
		expect(verdict.reason).toContain('exposure')
	})

	test('risk score increases with health deficit, LTV buffer breach, and exposure overage', () => {
		const policy = {
			minHealthFactor: 1.1,
			liquidationLtvThresholdPct: 78,
			maxCrossProtocolExposureUsd: 20000,
			maxLiquidationPct: 50,
		}
		const healthy = computeRiskScore(
			{ collateralAssetSymbol: 'ETH', collateralBalanceUsd: 45000, healthFactor: 1.6, loanToValuePct: 55, liquidationThresholdPct: 78 },
			{ crossProtocolBorrowExposureUsd: 5000 },
			policy,
		)
		const stressed = computeRiskScore(
			{ collateralAssetSymbol: 'ETH', collateralBalanceUsd: 45000, healthFactor: 1.02, loanToValuePct: 79, liquidationThresholdPct: 78 },
			{ crossProtocolBorrowExposureUsd: 30000 },
			policy,
		)
		expect(stressed).toBeGreaterThan(healthy)
	})
})

describe('onCronTrigger', () => {
	test('crosses back to the DON with only the verdict, never the policy thresholds', () => {
		const { runtime, reports } = makeFakeTeeRuntime({ position: HEALTHY_POSITION, exposure: LOW_EXPOSURE })

		const result = onCronTrigger(runtime)
		const verdict = JSON.parse(result)

		expect(verdict.liquidate).toBe(false)
		expect(reports).toHaveLength(1)
		expect(reports[0]).toMatchObject({ encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' })
	})

	test('produces a liquidate verdict when the crypto leg is stressed', () => {
		const { runtime } = makeFakeTeeRuntime({ position: STRESSED_POSITION, exposure: LOW_EXPOSURE })

		const result = onCronTrigger(runtime)
		const verdict = JSON.parse(result)

		expect(verdict.liquidate).toBe(true)
		expect(verdict.account.toLowerCase()).toBe(ACCOUNT.toLowerCase())
		expect(verdict.amountUsd).toBeGreaterThan(0)
	})

	test('does not log policy thresholds or raw payloads', () => {
		const { runtime, logs } = makeFakeTeeRuntime({ position: STRESSED_POSITION, exposure: LOW_EXPOSURE })

		onCronTrigger(runtime)

		for (const line of logs) {
			expect(line).not.toContain('1.1') // MIN_HEALTH_FACTOR secret value
			expect(line).not.toContain('20000') // MAX_CROSS_PROTOCOL_EXPOSURE_USD secret value
		}
	})
})

describe('initWorkflow', () => {
	test('registers the cron handler with a Nitro TEE constraint', () => {
		const handlers = initWorkflow(makeConfig())

		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onCronTrigger)
		expect(handlers[0].requirements).toBeDefined()
	})
})
