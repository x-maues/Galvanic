// Firewall Margin — exposure HTTP server
// ────────────────────────────────────────
//
// Serves `GET /firewall-margin/exposure?account=0x...` with the exact shape
// the CRE workflow already expects: `{ cross_protocol_borrow_exposure_usd }`
// (see cre-workflow/firewall-margin-workflow/firewall-margin/workflow.ts,
// `parseExposure`). Behind that one field:
//
//   - If GRAPH_API_KEY is set (a real Subgraph Studio key): runs the real,
//     composed multi-protocol Messari Lending query from exposure.ts against
//     The Graph's decentralized network gateway and returns the live sum.
//   - If GRAPH_API_KEY is missing/placeholder: returns a clearly-labeled mock
//     value (same number the existing mock-server.js already used) so the
//     CRE workflow's local `cre workflow simulate` keeps working unchanged.
//
// This intentionally runs as its own small service rather than editing
// mock-server.js in place, so the already-tested workflow simulation path is
// never put at risk by this addition.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'
import express from 'express'
import { LENDING_SUBGRAPHS, getCrossProtocolBorrowExposure } from './exposure'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Root .env first (repo convention — see contracts-hedera/issue-asset.ts),
// then an optional local override.
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '.env') })

const app = express()
const PORT = Number(process.env.SUBGRAPH_EXPOSURE_PORT ?? 8790)

// Same placeholder unlocked-mock value cre-workflow's mock-server.js already
// serves for /firewall-margin/exposure — kept identical so switching the
// workflow's `exposureApiUrl` to this server is a no-op for the local
// simulation demo until a real GRAPH_API_KEY is added.
const MOCK_EXPOSURE_USD = 15000

const rawKey = process.env.GRAPH_API_KEY?.trim()
const HAS_REAL_KEY = Boolean(rawKey && rawKey !== 'xxxx')

app.get('/firewall-margin/exposure', async (req, res) => {
	const account = typeof req.query.account === 'string' ? req.query.account : undefined

	if (!HAS_REAL_KEY) {
		res.json({
			cross_protocol_borrow_exposure_usd: MOCK_EXPOSURE_USD,
			source: 'mock',
			note:
				'GRAPH_API_KEY not set (or still the .env.example placeholder "xxxx") -- returning a ' +
				'labeled mock value so the CRE workflow simulation keeps working. Set a real Subgraph ' +
				'Studio API key to query live Messari Lending subgraphs (see subgraph/README.md).',
		})
		return
	}

	if (!account) {
		res.status(400).json({
			error: 'missing required ?account=0x... query param',
		})
		return
	}

	try {
		const result = await getCrossProtocolBorrowExposure(account, rawKey!, LENDING_SUBGRAPHS)

		res.json({
			cross_protocol_borrow_exposure_usd: Math.round(result.totalBorrowExposureUsd),
			source: 'live',
			account: result.account,
			queried_at: result.queriedAt,
			// The composition evidence: same query, N protocols, per-protocol
			// breakdown so the "one query, many protocols" leverage is visible in
			// the response itself, not just in the code.
			per_protocol: result.perProtocol.map((r) => ({
				name: r.target.name,
				network: r.target.network,
				schema_version: r.target.schemaVersion,
				subgraph_id: r.target.subgraphId,
				ok: r.ok,
				borrow_exposure_usd: Math.round(r.borrowExposureUsd),
				position_count: r.positionCount,
				error: r.error,
			})),
		})
	} catch (err) {
		res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
	}
})

// Convenience: report which mode is active without needing to trigger a
// query (useful for the demo script / judges' quick sanity check).
app.get('/firewall-margin/exposure/status', (_req, res) => {
	res.json({
		mode: HAS_REAL_KEY ? 'live' : 'mock',
		registeredProtocols: LENDING_SUBGRAPHS.map((t) => ({
			name: t.name,
			network: t.network,
			schemaVersion: t.schemaVersion,
			subgraphId: t.subgraphId,
		})),
	})
})

app.listen(PORT, () => {
	console.log(`Firewall Margin exposure server running at http://127.0.0.1:${PORT}`)
	console.log(
		HAS_REAL_KEY
			? `Mode: LIVE — querying ${LENDING_SUBGRAPHS.length} real Messari Lending subgraphs via The Graph gateway`
			: 'Mode: MOCK — GRAPH_API_KEY not set; returning a labeled placeholder value',
	)
})
