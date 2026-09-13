// Galvanic — Sepolia margin-account bridge
// ────────────────────────────────────────
//
// Serves the account's real on-chain margin state to the CRE enclave:
//
//   GET /firewall-margin/position?account=0x...
//
// Everything here is read straight from the deployed CryptoMarginVault and
// ProtectedCollateralRegistry. There is no fixture and no mock mode — a policy
// decision made on invented position data would be worthless.
//
// This exists only because a TEE cannot hold an RPC credential for a node
// provider in a local demo; it is a read-only view over public contract state,
// and every number it returns can be checked on Etherscan.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'
import express from 'express'
import { createPublicClient, http, formatUnits } from 'viem'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
dotenv.config({ path: path.resolve(__dirname, '.env') })

const app = express()
const PORT = Number(process.env.POSITION_BRIDGE_PORT ?? process.env.MOCK_PORT ?? 8788)

const VAULT_ABI = [
	{ type: 'function', name: 'healthFactor', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'cryptoHealthFactor', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'cryptoValue', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'protectedValue', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'totalCollateralValue', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'collateral', type: 'uint256' }, { name: 'debt', type: 'uint256' }] },
	{ type: 'function', name: 'price', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'liquidationThresholdBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'marginMode', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint8' }] },
	{ type: 'function', name: 'borrowingRestricted', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
	{ type: 'function', name: 'protectedRecognitionRevoked', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
]

const { SEPOLIA_RPC_URL, SEPOLIA_VAULT, DEMO_ACCOUNT } = process.env
if (!SEPOLIA_RPC_URL || !SEPOLIA_VAULT) {
	console.error('Set SEPOLIA_RPC_URL and SEPOLIA_VAULT in the repo-root .env')
	process.exit(1)
}

const client = createPublicClient({ transport: http(SEPOLIA_RPC_URL) })
const contract = { address: SEPOLIA_VAULT, abi: VAULT_ABI }
const usd = (value) => Number(formatUnits(value, 18))

async function readPosition(account) {
	const call = (functionName, args) => client.readContract({ ...contract, functionName, args })

	const [hf, cryptoHf, cryptoVal, protectedVal, pos, price, liqBps, mode, restricted, revoked] =
		await Promise.all([
			call('healthFactor', [account]),
			call('cryptoHealthFactor', [account]),
			call('cryptoValue', [account]),
			call('protectedValue', [account]),
			call('positions', [account]),
			call('price', []),
			call('liquidationThresholdBps', []),
			call('marginMode', [account]),
			call('borrowingRestricted', [account]),
			call('protectedRecognitionRevoked', [account]),
		])

	const debtUsd = usd(pos[1])
	const totalUsd = usd(cryptoVal) + usd(protectedVal)
	const MAX = 2n ** 256n - 1n

	return {
		account,
		collateral_asset_symbol: 'fmETH',
		crypto_value_usd: usd(cryptoVal),
		protected_value_usd: usd(protectedVal),
		total_collateral_usd: totalUsd,
		debt_usd: debtUsd,
		health_factor: hf === MAX ? 999 : usd(hf),
		crypto_health_factor: cryptoHf === MAX ? 999 : usd(cryptoHf),
		loan_to_value_pct: totalUsd > 0 ? (debtUsd / totalUsd) * 100 : 0,
		liquidation_threshold_pct: Number(liqBps) / 100,
		mark_price_usd: usd(price),
		margin_mode: Number(mode) === 1 ? 'pooled' : 'firewall',
		borrowing_restricted: restricted,
		protected_recognition_revoked: revoked,
		vault: SEPOLIA_VAULT,
		source: 'sepolia',
	}
}

app.get('/firewall-margin/position', async (req, res) => {
	const account = typeof req.query.account === 'string' ? req.query.account : DEMO_ACCOUNT
	if (!account) {
		res.status(400).json({ error: 'missing ?account=0x... and no DEMO_ACCOUNT configured' })
		return
	}
	try {
		res.json(await readPosition(account))
	} catch (err) {
		res.status(502).json({ error: String(err) })
	}
})

app.listen(PORT, () => {
	console.log(`Galvanic position bridge on http://127.0.0.1:${PORT}`)
	console.log(`Reading CryptoMarginVault ${SEPOLIA_VAULT} on Sepolia`)
})
