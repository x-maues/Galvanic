import express from 'express'

const app = express()
const PORT = Number(process.env.MOCK_PORT ?? 8788)

// ── (c) Live crypto collateral health / LTV ──
// Stands in for a real lending-market position read. Mutate these values (or
// point positionApiUrl elsewhere) to drive the demo: push health_factor down
// / loan_to_value_pct up to cross the policy thresholds and trigger
// liquidate=true.
const position = {
	collateral_asset_symbol: 'ETH',
	collateral_balance_usd: 45000,
	health_factor: 1.14,
	loan_to_value_pct: 71,
	liquidation_threshold_pct: 78,
}

// ── (b) Cross-protocol exposure ──
// Stands in for a Messari Standardized Subgraph query on The Graph (e.g. the
// account's existing borrow exposure on Aave). Swap this endpoint for a real
// subgraph query once wired up; the workflow only cares that the response has
// `cross_protocol_borrow_exposure_usd`.
const exposure = {
	cross_protocol_borrow_exposure_usd: 15000,
}

app.get('/firewall-margin/position', (_req, res) => {
	res.json(position)
})

app.get('/firewall-margin/exposure', (_req, res) => {
	res.json(exposure)
})

// Convenience routes so the demo can flip the account into a stressed state
// without restarting the server: `curl -X POST http://127.0.0.1:8788/firewall-margin/stress`
app.post('/firewall-margin/stress', (_req, res) => {
	position.health_factor = 1.02
	position.loan_to_value_pct = 79
	res.json({ ok: true, position })
})

app.post('/firewall-margin/heal', (_req, res) => {
	position.health_factor = 1.14
	position.loan_to_value_pct = 71
	res.json({ ok: true, position })
})

app.listen(PORT, () => {
	console.log(`Firewall Margin mock server running at http://127.0.0.1:${PORT}`)
})
