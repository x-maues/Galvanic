import { describe, expect, test } from 'bun:test'
import {
	ACCOUNT_BORROW_POSITIONS_QUERY,
	getCrossProtocolBorrowExposure,
	LENDING_SUBGRAPHS,
	queryProtocolBorrowExposure,
	type LendingSubgraphTarget,
} from './exposure'

const ACCOUNT = '0xabc0000000000000000000000000000000000d'

const AAVE: LendingSubgraphTarget = {
	name: 'Aave v3 (Ethereum)',
	slug: 'aave-v3-ethereum',
	network: 'ethereum',
	schemaVersion: '3.1.0',
	subgraphId: 'JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk',
}

const COMPOUND: LendingSubgraphTarget = {
	name: 'Compound v3 (Ethereum)',
	slug: 'compound-v3-ethereum',
	network: 'ethereum',
	schemaVersion: '3.1.0',
	subgraphId: 'AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9',
}

// Builds a fake `fetch` that answers the standardized query with a fixed
// borrow position, keyed by subgraph URL so each protocol can return
// different (or no) data without any protocol-specific query logic.
const fakeFetch = (bySubgraphId: Record<string, { balance: string; decimals: number; priceUsd: string } | null>) =>
	(async (url: string | URL, init?: RequestInit) => {
		const urlStr = url.toString()
		const matchedId = Object.keys(bySubgraphId).find((id) => urlStr.includes(id))
		const body = JSON.parse(String(init?.body))

		expect(body.query).toBe(ACCOUNT_BORROW_POSITIONS_QUERY)
		expect(body.variables.account).toBe(ACCOUNT.toLowerCase())

		if (!matchedId) {
			return new Response(JSON.stringify({ errors: [{ message: 'unknown subgraph id in test' }] }), {
				status: 200,
			})
		}

		const fixture = bySubgraphId[matchedId]
		if (fixture === null) {
			return new Response(JSON.stringify({ data: { account: null } }), { status: 200 })
		}

		return new Response(
			JSON.stringify({
				data: {
					account: {
						id: ACCOUNT,
						positions: [
							{
								id: `${ACCOUNT}-${matchedId}-0`,
								balance: fixture.balance,
								market: { id: '0xmarket', name: 'test market' },
								asset: { symbol: 'USDC', decimals: fixture.decimals, lastPriceUSD: fixture.priceUsd },
							},
						],
					},
				},
			}),
			{ status: 200 },
		)
	}) as typeof fetch

describe('queryProtocolBorrowExposure', () => {
	test('computes USD exposure as balance / 10^decimals * lastPriceUSD', async () => {
		const fetchImpl = fakeFetch({
			[AAVE.subgraphId]: { balance: '5000000000', decimals: 6, priceUsd: '1.0' }, // 5,000 USDC
		})

		const result = await queryProtocolBorrowExposure(AAVE, ACCOUNT, 'test-key', fetchImpl)

		expect(result.ok).toBe(true)
		expect(result.borrowExposureUsd).toBeCloseTo(5000, 6)
		expect(result.positionCount).toBe(1)
	})

	test('normalizes a GraphQL error into ok:false instead of throwing', async () => {
		const fetchImpl = fakeFetch({}) // no fixture registered -> "unknown subgraph id" error path

		const result = await queryProtocolBorrowExposure(AAVE, ACCOUNT, 'test-key', fetchImpl)

		expect(result.ok).toBe(false)
		expect(result.borrowExposureUsd).toBe(0)
		expect(result.error).toBeDefined()
	})

	test('treats an account with no open borrow positions as zero exposure', async () => {
		const fetchImpl = fakeFetch({ [AAVE.subgraphId]: null })

		const result = await queryProtocolBorrowExposure(AAVE, ACCOUNT, 'test-key', fetchImpl)

		expect(result.ok).toBe(true)
		expect(result.borrowExposureUsd).toBe(0)
		expect(result.positionCount).toBe(0)
	})

	test('never throws on a network-level failure', async () => {
		const throwingFetch = (async () => {
			throw new Error('ECONNREFUSED')
		}) as typeof fetch

		const result = await queryProtocolBorrowExposure(AAVE, ACCOUNT, 'test-key', throwingFetch)

		expect(result.ok).toBe(false)
		expect(result.error).toContain('ECONNREFUSED')
	})
})

describe('getCrossProtocolBorrowExposure (the composition step)', () => {
	test('sends the SAME query to every registered protocol and sums only the successful ones', async () => {
		const fetchImpl = fakeFetch({
			[AAVE.subgraphId]: { balance: '10000000000', decimals: 6, priceUsd: '1.0' }, // 10,000 USDC
			[COMPOUND.subgraphId]: { balance: '2000000000000000000', decimals: 18, priceUsd: '2500' }, // 2 ETH @ $2500
			// Spark Lend deliberately left unregistered in the fixture -> exercises
			// the "one protocol fails, the rest still aggregate" path.
		})

		const result = await getCrossProtocolBorrowExposure(ACCOUNT, 'test-key', LENDING_SUBGRAPHS, fetchImpl)

		expect(result.perProtocol).toHaveLength(LENDING_SUBGRAPHS.length)

		const aave = result.perProtocol.find((r) => r.target.subgraphId === AAVE.subgraphId)
		const compound = result.perProtocol.find((r) => r.target.subgraphId === COMPOUND.subgraphId)
		expect(aave?.ok).toBe(true)
		expect(aave?.borrowExposureUsd).toBeCloseTo(10000, 6)
		expect(compound?.ok).toBe(true)
		expect(compound?.borrowExposureUsd).toBeCloseTo(5000, 6)

		// 10,000 (Aave) + 5,000 (Compound) = 15,000; the unregistered protocols
		// error out (ok:false) and are excluded from the sum, not zero-filled
		// silently into a wrong number.
		expect(result.totalBorrowExposureUsd).toBeCloseTo(15000, 6)
		expect(result.perProtocol.some((r) => r.ok === false)).toBe(true)
	})

	test('registry contains 2+ distinct real protocols on the standardized v3.1.0 schema', () => {
		const protocolNames = new Set(LENDING_SUBGRAPHS.map((t) => t.name.split(' (')[0]))
		expect(protocolNames.size).toBeGreaterThanOrEqual(2)
		for (const target of LENDING_SUBGRAPHS) {
			expect(target.schemaVersion).toBe('3.1.0')
			expect(target.subgraphId.length).toBeGreaterThan(20)
		}
	})
})
