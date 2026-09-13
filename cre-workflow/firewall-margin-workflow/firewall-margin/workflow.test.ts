import { describe, expect, it } from 'bun:test'
import type { Address } from 'viem'
import { computeMarketStressBps, decideVerdict, requiredHealthFactor } from './workflow'

// The handler's I/O is exercised end to end by `cre workflow simulate` against live
// Hedera, Graph and Sepolia. What is worth unit-testing is the part a judge has to
// trust without running anything: the decision itself, and specifically the two
// properties the product's safety claim rests on.

const ACCOUNT = '0x4A30478Fd4F84Abc7A2686D67Ce38D9264260602' as Address

const POLICY = {
	minHealthFactor: 1.15,
	liquidationLtvThresholdPct: 78,
	maxCrossProtocolExposureUsd: 250_000,
	maxLiquidationPct: 50,
	maxMarketStressBps: 250,
}

const NOTE = { token: '0x0b85d6db3D300B695a40C463B8669C3e76Bd982b' as Address, units: 300_000n, valueUsd: 30_000 }

/** The demo account: healthy overall, insolvent on crypto alone. */
const position = (over: Partial<Parameters<typeof decideVerdict>[1]> = {}) => ({
	collateralAssetSymbol: 'fmETH',
	cryptoValueUsd: 27_177,
	protectedValueUsd: 28_500,
	debtUsd: 35_000,
	healthFactor: 1.27,
	loanToValuePct: 62.9,
	liquidationThresholdPct: 80,
	...over,
})

const market = (over: Partial<Parameters<typeof decideVerdict>[2]> = {}) => ({
	crossProtocolBorrowExposureUsd: 0,
	marketStressBps: 11,
	collateralPriceUsd: 2717,
	protocolsAnswered: 3,
	...over,
})

describe('market stress from The Graph', () => {
	it('adds no buffer in a calm, liquid market', () => {
		expect(computeMarketStressBps(0, 10)).toBe(0)
	})

	it('raises the required health factor above the private floor', () => {
		const calm = requiredHealthFactor(POLICY, 0)
		const stressed = requiredHealthFactor(POLICY, computeMarketStressBps(40, 92))
		expect(calm).toBe(1.15)
		expect(stressed).toBeGreaterThan(calm)
	})

	it('caps the buffer so live data can never run away with the policy', () => {
		expect(computeMarketStressBps(1e9, 100)).toBe(5_000)
	})
})

describe('decideVerdict', () => {
	it('holds a position that is within policy', () => {
		const verdict = decideVerdict(ACCOUNT, position(), market(), NOTE, POLICY)
		expect(verdict.action).toBe('hold')
		expect(verdict.amountUsd).toBe(0)
	})

	it('liquidates when the health factor falls below what the market demands', () => {
		const verdict = decideVerdict(ACCOUNT, position({ healthFactor: 0.7 }), market(), NOTE, POLICY)
		expect(verdict.action).toBe('liquidate')
		expect(verdict.reason).toContain('1.15')
	})

	// The safety property, stated as a test: the size of a liquidation is a fraction
	// of DEBT. It is never a function of the protected note's value, because a policy
	// that sized against the note would already have crossed the firewall.
	it('sizes the liquidation against debt, never against the protected note', () => {
		const base = position({ healthFactor: 0.7 })
		const small = decideVerdict(ACCOUNT, base, market(), NOTE, POLICY)
		const huge = decideVerdict(ACCOUNT, base, market(), { ...NOTE, valueUsd: 10_000_000 }, POLICY)

		expect(small.amountUsd).toBe(17_500) // 50% of $35,000 of debt
		expect(huge.amountUsd).toBe(small.amountUsd)
	})

	it('never liquidates on external exposure alone — it restricts borrowing', () => {
		const verdict = decideVerdict(
			ACCOUNT,
			position(),
			market({ crossProtocolBorrowExposureUsd: 12_000_000 }),
			NOTE,
			POLICY,
		)
		expect(verdict.action).toBe('restrict_borrowing')
		expect(verdict.liquidate).toBe(false)
		expect(verdict.amountUsd).toBe(0)
	})

	it('restricts borrowing when the market is too stressed to absorb a liquidation', () => {
		const verdict = decideVerdict(ACCOUNT, position(), market({ marketStressBps: 900 }), NOTE, POLICY)
		expect(verdict.action).toBe('restrict_borrowing')
	})

	it('a crypto-side breach outranks an exposure breach, and still only liquidates', () => {
		const verdict = decideVerdict(
			ACCOUNT,
			position({ healthFactor: 0.7 }),
			market({ crossProtocolBorrowExposureUsd: 12_000_000 }),
			NOTE,
			POLICY,
		)
		expect(verdict.action).toBe('liquidate')
	})

	it('publishes the attestation and the market buffer, but never a threshold', () => {
		const verdict = decideVerdict(ACCOUNT, position(), market(), NOTE, POLICY)
		const serialised = JSON.stringify(verdict)

		expect(verdict.protectedUnits).toBe('300000')
		expect(verdict.protectedValueUsd).toBe(30_000)
		expect(verdict.marketStressBps).toBe(11)

		// The close factor and the exposure cap must not be recoverable from the report.
		expect(serialised).not.toContain('250000')
		expect(serialised).not.toContain(String(POLICY.maxLiquidationPct))
	})
})
