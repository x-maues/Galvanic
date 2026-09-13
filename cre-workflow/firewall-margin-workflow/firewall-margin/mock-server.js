import express from 'express'
import { createPublicClient, http, formatUnits } from 'viem'

const app = express()
const PORT = Number(process.env.MOCK_PORT ?? 8788)

// ── (c) Live crypto collateral health / LTV ──
// Static fixture used until the vault is deployed. Mutate these values (or
// point positionApiUrl elsewhere) to drive the demo locally: push
// health_factor down / loan_to_value_pct up to cross the policy thresholds
// and trigger liquidate=true.
const position = {
	collateral_asset_symbol: 'ETH',
	collateral_balance_usd: 45000,
	health_factor: 1.14,
	loan_to_value_pct: 71,
	liquidation_threshold_pct: 78,
}

// Once the real CryptoMarginVault is deployed on Sepolia, set SEPOLIA_RPC_URL +
// SEPOLIA_VAULT + DEMO_ACCOUNT in env and this endpoint reads the ACTUAL
// on-chain health factor instead of the static fixture above — so the "Trigger
// Stress" button in the frontend (which calls vault.setPrice on the real
// contract) is reflected here for real, not simulated twice.
const VAULT_ABI = [
	{
		type: 'function', name: 'healthFactor', stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }],
	},
	{
		type: 'function', name: 'positions', stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: 'collateral', type: 'uint256' }, { name: 'debt', type: 'uint256' }],
	},
	{ type: 'function', name: 'price', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{
		type: 'function', name: 'liquidationThresholdBps', stateMutability: 'view',
		inputs: [], outputs: [{ type: 'uint256' }],
	},
]

async function readLivePosition() {
	const { SEPOLIA_RPC_URL, SEPOLIA_VAULT, DEMO_ACCOUNT } = process.env
	if (!SEPOLIA_RPC_URL || !SEPOLIA_VAULT || !DEMO_ACCOUNT) return null

	const client = createPublicClient({ transport: http(SEPOLIA_RPC_URL) })
	const contract = { address: SEPOLIA_VAULT, abi: VAULT_ABI }

	const [hf, pos, price, liqThresholdBps] = await Promise.all([
		client.readContract({ ...contract, functionName: 'healthFactor', args: [DEMO_ACCOUNT] }),
		client.readContract({ ...contract, functionName: 'positions', args: [DEMO_ACCOUNT] }),
		client.readContract({ ...contract, functionName: 'price' }),
		client.readContract({ ...contract, functionName: 'liquidationThresholdBps' }),
	])

	const collateralUsd = Number(formatUnits((pos[0] * price) / 10n ** 18n, 18))
	const debtUsd = Number(formatUnits(pos[1], 18))
	const ltvPct = debtUsd > 0 ? (debtUsd / collateralUsd) * 100 : 0

	return {
		collateral_asset_symbol: 'fmETH',
		collateral_balance_usd: collateralUsd,
		health_factor: Number(formatUnits(hf, 18)),
		loan_to_value_pct: ltvPct,
		liquidation_threshold_pct: Number(liqThresholdBps) / 100,
	}
}

// ── (b) Cross-protocol exposure ──
// Stands in for a Messari Standardized Subgraph query on The Graph (e.g. the
// account's existing borrow exposure on Aave). Swap this endpoint for a real
// subgraph query once wired up; the workflow only cares that the response has
// `cross_protocol_borrow_exposure_usd`.
const exposure = {
	cross_protocol_borrow_exposure_usd: 15000,
}

app.get('/firewall-margin/position', async (_req, res) => {
	try {
		const live = await readLivePosition()
		res.json(live ?? position)
	} catch (err) {
		console.error('live position read failed, falling back to fixture:', err)
		res.json(position)
	}
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
