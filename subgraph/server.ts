// Galvanic — Graph risk-signal service
// ────────────────────────────────────
//
// Serves the live, standardized-schema risk signals that the Chainlink CRE
// confidential policy consumes. There is no mock mode: if no Subgraph Studio API
// key is configured the service fails loudly, because a policy decision made on
// invented market data would be worthless.
//
//   GET /firewall-margin/exposure?account=0x...   the signals the enclave reads
//   GET /firewall-margin/exposure/status          which deployments are registered

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'
import express from 'express'
import { LENDING_SUBGRAPHS, getGraphRiskSignals } from './exposure'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '.env') })

const app = express()
const PORT = Number(process.env.SUBGRAPH_EXPOSURE_PORT ?? 8790)

const rawKey = process.env.GRAPH_API_KEY?.trim()
const HAS_REAL_KEY = Boolean(rawKey && rawKey !== 'xxxx')

// Short cache: the enclave, the dashboard and the status route all ask for the
// same account within a second of each other during a demo, and the underlying
// data moves on a daily-snapshot cadence.
const CACHE_TTL_MS = 15_000
let cache: { key: string; at: number; value: unknown } | null = null

app.get('/firewall-margin/exposure', async (req, res) => {
	if (!HAS_REAL_KEY) {
		res.status(503).json({
			error:
				'GRAPH_API_KEY is not set. Galvanic queries live Messari Standardized Lending ' +
				'subgraphs through the Graph gateway and has no mock mode — get a free key at ' +
				'https://thegraph.com/studio/apikeys/ and put it in the repo-root .env.',
		})
		return
	}

	const account = typeof req.query.account === 'string' ? req.query.account : undefined
	if (!account) {
		res.status(400).json({ error: 'missing required ?account=0x... query param' })
		return
	}

	if (cache && cache.key === account.toLowerCase() && Date.now() - cache.at < CACHE_TTL_MS) {
		res.json(cache.value)
		return
	}

	try {
		const signals = await getGraphRiskSignals(account, rawKey!, LENDING_SUBGRAPHS)

		const body = {
			source: 'live' as const,
			degraded: signals.degraded,
			account: signals.account,
			queried_at: signals.queriedAt,
			protocols_answered: signals.protocolsAnswered,

			// Signals the confidential policy reads. snake_case because the CRE
			// workflow parses this payload directly inside the enclave.
			cross_protocol_borrow_exposure_usd: Math.round(signals.crossProtocolBorrowExposureUsd),
			market_stress_bps: signals.marketStressBps,
			collateral_asset_symbol: signals.collateralAssetSymbol,
			collateral_price_usd: signals.collateralPriceUsd,
			collateral_utilization_pct: Number(signals.collateralUtilizationPct.toFixed(2)),
			liquidation_intensity_bps: Number(signals.liquidationIntensityBps.toFixed(2)),

			// The composition evidence: the same query, every protocol, visible in the
			// response itself rather than only in the code.
			per_protocol: signals.perProtocol.map((r) => ({
				name: r.target.name,
				network: r.target.network,
				schema_version: r.target.schemaVersion,
				subgraph_id: r.target.subgraphId,
				ok: r.ok,
				error: r.error,
				account_borrow_exposure_usd: Math.round(r.borrowExposureUsd),
				position_count: r.positionCount,
				protocol_total_borrow_usd: Math.round(r.totalBorrowUsd),
				liquidated_7d_usd: Math.round(r.liquidated7dUsd),
				eth_market_count: r.ethMarketCount,
				eth_borrow_usd: Math.round(r.ethBorrowUsd),
				eth_deposit_usd: Math.round(r.ethDepositUsd),
				eth_price_usd: r.ethPriceUsd,
			})),
		}

		cache = { key: account.toLowerCase(), at: Date.now(), value: body }
		res.json(body)
	} catch (err) {
		res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
	}
})

app.get('/firewall-margin/exposure/status', (_req, res) => {
	res.json({
		mode: HAS_REAL_KEY ? 'live' : 'unconfigured',
		registeredProtocols: LENDING_SUBGRAPHS.map((t) => ({
			name: t.name,
			network: t.network,
			schemaVersion: t.schemaVersion,
			subgraphId: t.subgraphId,
		})),
	})
})

app.listen(PORT, () => {
	console.log(`Galvanic Graph risk service on http://127.0.0.1:${PORT}`)
	console.log(
		HAS_REAL_KEY
			? `Mode: LIVE — one standardized query across ${LENDING_SUBGRAPHS.length} Messari Lending deployments`
			: 'Mode: UNCONFIGURED — set GRAPH_API_KEY; there is no mock fallback',
	)
})
