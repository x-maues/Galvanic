// Galvanic — risk inputs from The Graph, via Messari Standardized Subgraphs
// ─────────────────────────────────────────────────────────────────────────
//
// The leverage this module is built on: Messari's common Lending schema (v3.1.0)
// defines the SAME entities — Account, Position, Market, Token, FinancialsDaily-
// Snapshot — for every lending protocol that implements it. So one query,
// written once, answers three different risk questions across Aave v3,
// Compound v3 and Spark Lend simultaneously:
//
//   1. what does this account already owe elsewhere?      (Account -> Position)
//   2. how hard is the lending market liquidating today?  (FinancialsDailySnapshot)
//   3. what is the collateral asset actually worth, and
//      how stretched are the markets that hold it?        (Market -> Token)
//
// Without a shared schema this would be three bespoke integrations per protocol —
// nine in total, each with its own entity names, price derivation and pagination.
// Here it is one GraphQL document and a `for` loop. Adding a fourth protocol is
// one row in LENDING_SUBGRAPHS; nothing else in this file changes.
//
// Every subgraph ID below is a real, currently-indexed deployment on The Graph's
// decentralized network, queried through the gateway with a Subgraph Studio API
// key. Sourced from messari/subgraphs `deployment/deployment.json`
// (services.decentralized-network.query-id). No ID here is invented, and each one
// is health-checked by `bun run verify` (see README.md).

export interface LendingSubgraphTarget {
	name: string
	slug: string
	network: string
	/** Messari Lending/CDP schema version this deployment implements. */
	schemaVersion: string
	subgraphId: string
}

export const LENDING_SUBGRAPHS: LendingSubgraphTarget[] = [
	{
		name: 'Aave v3 (Ethereum)',
		slug: 'aave-v3-ethereum',
		network: 'ethereum',
		schemaVersion: '3.1.0',
		subgraphId: 'JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk',
	},
	{
		name: 'Compound v3 (Ethereum)',
		slug: 'compound-v3-ethereum',
		network: 'ethereum',
		schemaVersion: '3.1.0',
		subgraphId: 'AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9',
	},
	{
		name: 'Spark Lend (Ethereum)',
		slug: 'spark-lend-ethereum',
		network: 'ethereum',
		schemaVersion: '3.1.0',
		subgraphId: 'GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si',
	},
]

// ─── The ONE standardized query, sent unmodified to every deployment above ───
//
// Uses only entities and fields defined by Messari's common `schema-lending.graphql`
// (v3.1.0). No protocol-specific branch exists anywhere in this file.
//
// Position carries `balance: BigInt!` and `asset: Token!` but no USD amount, so
// value is derived the standard Messari way — balance / 10^decimals *
// asset.lastPriceUSD — which works identically on every protocol precisely because
// Token.lastPriceUSD is part of the shared schema.
export const PROTOCOL_RISK_QUERY = `
  query GalvanicProtocolRisk($account: ID!) {
    account(id: $account) {
      id
      positions(where: { side: BORROWER, hashClosed: null }, first: 1000) {
        id
        balance
        market { id name }
        asset { symbol decimals lastPriceUSD }
      }
    }
    financialsDailySnapshots(first: 7, orderBy: timestamp, orderDirection: desc) {
      timestamp
      dailyLiquidateUSD
      totalBorrowBalanceUSD
      totalDepositBalanceUSD
    }
    markets(first: 200, where: { isActive: true }) {
      id
      name
      totalBorrowBalanceUSD
      totalDepositBalanceUSD
      liquidationThreshold
      inputToken { symbol decimals lastPriceUSD }
    }
  }
`.trim()

/** Symbols treated as the account's collateral asset class (ETH) across protocols. */
const ETH_SYMBOLS = new Set(['WETH', 'ETH', 'wstETH', 'weETH', 'rETH', 'cbETH', 'ETHx', 'osETH'])

interface GraphQLResponse<T> {
	data?: T
	errors?: { message: string }[]
}

interface RawPosition {
	id: string
	balance: string
	market: { id: string; name: string | null }
	asset: { symbol: string; decimals: number; lastPriceUSD: string | null }
}

interface RawSnapshot {
	timestamp: string
	dailyLiquidateUSD: string | null
	totalBorrowBalanceUSD: string | null
	totalDepositBalanceUSD: string | null
}

interface RawMarket {
	id: string
	name: string | null
	totalBorrowBalanceUSD: string | null
	totalDepositBalanceUSD: string | null
	liquidationThreshold: string | null
	inputToken: { symbol: string; decimals: number; lastPriceUSD: string | null }
}

interface ProtocolRiskResult {
	account: { id: string; positions: RawPosition[] } | null
	financialsDailySnapshots: RawSnapshot[]
	markets: RawMarket[]
}

export interface ProtocolRisk {
	target: LendingSubgraphTarget
	ok: boolean
	error?: string
	/** This account's open borrow value on this protocol. */
	borrowExposureUsd: number
	positionCount: number
	/** Protocol-wide borrows, and value liquidated over the snapshot window. */
	totalBorrowUsd: number
	liquidated7dUsd: number
	/** The account's collateral asset class, as seen by this protocol. */
	ethBorrowUsd: number
	ethDepositUsd: number
	ethPriceUsd: number | null
	ethMarketCount: number
}

export interface GraphRiskSignals {
	account: string
	queriedAt: string
	/** True when every protocol failed — the caller must not treat the numbers as real. */
	degraded: boolean
	protocolsAnswered: number

	/** (1) What the account already owes on other venues. */
	crossProtocolBorrowExposureUsd: number

	/** (2)+(3) Live market conditions for the collateral asset class. */
	collateralAssetSymbol: string
	collateralPriceUsd: number | null
	collateralUtilizationPct: number
	liquidationIntensityBps: number
	/**
	 * One number the confidential policy consumes: how much extra health-factor
	 * buffer the market is demanding right now, in basis points. Derived only from
	 * live standardized-schema fields, never from anything local.
	 */
	marketStressBps: number

	perProtocol: ProtocolRisk[]
}

export const gatewayUrl = (subgraphId: string, apiKey: string): string =>
	`https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`

const num = (value: string | null | undefined): number => {
	const parsed = Number(value ?? 0)
	return Number.isFinite(parsed) ? parsed : 0
}

const positionUsd = (position: RawPosition): number => {
	const balance = Number(position.balance)
	const price = num(position.asset.lastPriceUSD)
	const decimals = Number.isFinite(position.asset.decimals) ? position.asset.decimals : 18
	if (!Number.isFinite(balance)) return 0
	return (balance / 10 ** decimals) * price
}

const median = (values: number[]): number | null => {
	const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
	if (sorted.length === 0) return null
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Runs `PROTOCOL_RISK_QUERY` against a single Messari Lending deployment. Never
 * throws: network errors, GraphQL errors and missing accounts all normalize into
 * `{ ok: false, error }`, so one deprecated or unallocated protocol can never take
 * down the aggregate.
 */
export async function queryProtocolRisk(
	target: LendingSubgraphTarget,
	account: string,
	apiKey: string,
	fetchImpl: typeof fetch = fetch,
): Promise<ProtocolRisk> {
	const empty: ProtocolRisk = {
		target,
		ok: false,
		borrowExposureUsd: 0,
		positionCount: 0,
		totalBorrowUsd: 0,
		liquidated7dUsd: 0,
		ethBorrowUsd: 0,
		ethDepositUsd: 0,
		ethPriceUsd: null,
		ethMarketCount: 0,
	}

	try {
		const response = await fetchImpl(gatewayUrl(target.subgraphId, apiKey), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: PROTOCOL_RISK_QUERY,
				variables: { account: account.toLowerCase() },
			}),
		})

		const json = (await response.json()) as GraphQLResponse<ProtocolRiskResult>
		if (!response.ok || (json.errors && json.errors.length > 0)) {
			const message = json.errors?.map((e) => e.message).join('; ') ?? `HTTP ${response.status}`
			return { ...empty, error: message }
		}

		const data = json.data
		const positions = data?.account?.positions ?? []
		const snapshots = data?.financialsDailySnapshots ?? []
		const markets = data?.markets ?? []
		const ethMarkets = markets.filter((m) => ETH_SYMBOLS.has(m.inputToken?.symbol ?? ''))

		return {
			target,
			ok: true,
			borrowExposureUsd: positions.reduce((sum, p) => sum + positionUsd(p), 0),
			positionCount: positions.length,
			totalBorrowUsd: num(snapshots[0]?.totalBorrowBalanceUSD),
			liquidated7dUsd: snapshots.reduce((sum, s) => sum + num(s.dailyLiquidateUSD), 0),
			ethBorrowUsd: ethMarkets.reduce((sum, m) => sum + num(m.totalBorrowBalanceUSD), 0),
			ethDepositUsd: ethMarkets.reduce((sum, m) => sum + num(m.totalDepositBalanceUSD), 0),
			ethPriceUsd: median(ethMarkets.map((m) => num(m.inputToken.lastPriceUSD))),
			ethMarketCount: ethMarkets.length,
		}
	} catch (err) {
		return { ...empty, error: err instanceof Error ? err.message : String(err) }
	}
}

/**
 * Market stress, in basis points of extra health-factor buffer demanded.
 *
 * Two live, standardized inputs, both aggregated across every protocol that
 * answered:
 *   - liquidation intensity: value liquidated in the snapshot window relative to
 *     total borrows. A market that is actively liquidating is a market where a
 *     falling collateral price turns into forced selling.
 *   - collateral utilization: borrowed / supplied for the ETH markets. A highly
 *     utilized market cannot absorb a large liquidation without slippage.
 *
 * Both are dimensionless ratios, which is the only reason they can be summed
 * across protocols at all — that comparability is what the standardized schema buys.
 */
export function computeMarketStressBps(
	liquidationIntensityBps: number,
	utilizationPct: number,
): number {
	// Utilization contributes only above 70%: below that the market is liquid enough
	// that a liquidation is unremarkable.
	const utilizationPressure = Math.max(0, utilizationPct - 70) * 20
	const stress = liquidationIntensityBps * 10 + utilizationPressure
	return Math.round(Math.min(stress, 5_000)) // cap the buffer at +50%
}

/**
 * Fans `PROTOCOL_RISK_QUERY` out across every registered protocol in parallel and
 * folds the answers into the signals the confidential policy consumes.
 */
export async function getGraphRiskSignals(
	account: string,
	apiKey: string,
	targets: LendingSubgraphTarget[] = LENDING_SUBGRAPHS,
	fetchImpl: typeof fetch = fetch,
): Promise<GraphRiskSignals> {
	const perProtocol = await Promise.all(
		targets.map((target) => queryProtocolRisk(target, account, apiKey, fetchImpl)),
	)
	const answered = perProtocol.filter((r) => r.ok)

	const sum = (pick: (r: ProtocolRisk) => number) => answered.reduce((a, r) => a + pick(r), 0)

	const totalBorrowUsd = sum((r) => r.totalBorrowUsd)
	const liquidated7dUsd = sum((r) => r.liquidated7dUsd)
	const ethBorrowUsd = sum((r) => r.ethBorrowUsd)
	const ethDepositUsd = sum((r) => r.ethDepositUsd)

	const liquidationIntensityBps =
		totalBorrowUsd > 0 ? (liquidated7dUsd / totalBorrowUsd) * 10_000 : 0
	const collateralUtilizationPct = ethDepositUsd > 0 ? (ethBorrowUsd / ethDepositUsd) * 100 : 0

	return {
		account,
		queriedAt: new Date().toISOString(),
		degraded: answered.length === 0,
		protocolsAnswered: answered.length,

		crossProtocolBorrowExposureUsd: sum((r) => r.borrowExposureUsd),

		collateralAssetSymbol: 'ETH',
		collateralPriceUsd: median(
			answered.map((r) => r.ethPriceUsd ?? 0).filter((p): p is number => p > 0),
		),
		collateralUtilizationPct,
		liquidationIntensityBps,
		marketStressBps: computeMarketStressBps(liquidationIntensityBps, collateralUtilizationPct),

		perProtocol,
	}
}
