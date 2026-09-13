# Firewall Margin

Cross-margin without cross-contamination. See [`docs/architecture.md`](docs/architecture.md)
for the full design, [`docs/demo-script.md`](docs/demo-script.md) for the submission demo
flow, and [`CLAUDE.md`](CLAUDE.md) for the mission/scope this project is built against.

## Status — live on testnet

| Piece | Status |
|---|---|
| Protected RWA leg (Hedera ATS) | **Live on Hedera testnet.** Real Bond ("Firewall Margin Short-Term Note", FWM-NOTE) issued via the live ATS Factory/BLR, plus a real KYC-gated compliant transfer. Contract: [`0x96c21F5900f7587549A4207B12232cA752072c25`](https://hashscan.io/testnet/contract/0x96c21F5900f7587549A4207B12232cA752072c25). Evidence + all tx hashes in `contracts-hedera/issued-asset.json`. |
| Liquid crypto leg (Sepolia) | **Live on Sepolia.** `CryptoMarginVault` + `FirewallMarginExecutor` deployed and wired to the confirmed production CRE KeystoneForwarder. Vault: [`0xDB2bE1A08CD5730307AA9178A5B3c499d4d57bb0`](https://sepolia.etherscan.io/address/0xDB2bE1A08CD5730307AA9178A5B3c499d4d57bb0). Demo account has a real funded position (HF 1.33). 7/7 contract tests passing. |
| Confidential risk brain (Chainlink CRE) | **Simulating live end to end against the real deployed contracts.** Verified full cycle: healthy verdict → real on-chain stress tx → `liquidate:true` verdict with correct amount/reason → healed back. Real `handlerInTee`/`getSecrets`/`usingTheDons()`, 8/8 unit tests. Onchain delivery wired and ABI-matched to the real vault/executor, disabled pending CRE deploy access (simulation evidence satisfies the track requirement). |
| Cross-protocol exposure (The Graph) | **Fully live.** `subgraph/exposure.ts` runs one Messari Lending/CDP (schema 3.1.0) query, unmodified, against 4 real subgraph deployments (Aave v3 Ethereum + Base, Compound v3, Spark Lend) via the real Subgraph Studio gateway. 3/4 return live results now (`ok: true`); Aave v3 Base currently reports `subgraph not found: no allocations` — no indexer is presently serving that specific deployment on the network, a real Graph Network condition, not a bug — and is isolated per-protocol exactly as designed rather than failing the whole aggregate. Wired into the CRE workflow's `exposureApiUrl` and confirmed working end to end with live data. |
| Frontend (`app/`) | **Live, verified end to end against real deployed contracts and real HTTP requests** — not mocked. Screenshotted in both the healthy and stressed/liquidatable states. |

## Running the live demo

```bash
# 1. exposure server (Graph)
cd subgraph && bun run server.ts &

# 2. position server (reads the real Sepolia vault + serves exposure passthrough)
cd cre-workflow/firewall-margin-workflow/firewall-margin && bun mock-server.js &

# 3. frontend
cd app && npm run dev
```

Then open http://localhost:3000 — both panels show real deployed contract state. Use
"Trigger stress" / "Heal" to move the crypto leg, and "Run confidential decision" to
invoke the real CRE workflow simulation.

## Repo layout

```
contracts-hedera/    Hedera ATS integration — protected RWA leg (live)
contracts-sepolia/   Crypto margin vault — liquid, liquidatable leg (live)
cre-workflow/         Chainlink CRE Confidential Workflow — the risk brain
subgraph/             Graph queries against a Messari standardized subgraph
app/                  Next.js demo frontend
docs/                 Architecture notes, demo script, evidence log
```
