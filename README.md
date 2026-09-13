# Firewall Margin

Cross-margin without cross-contamination. See [`docs/architecture.md`](docs/architecture.md)
for the full design and [`CLAUDE.md`](CLAUDE.md) for the mission/scope this project is
built against.

## Status

| Piece | Status |
|---|---|
| Crypto margin leg (Sepolia, `contracts-sepolia/`) | **Done locally.** `CryptoMarginVault.sol` + `FirewallMarginExecutor.sol` compile, 7/7 tests passing — proves the CRE report → onchain liquidation path end to end, including the "cannot touch the RWA leg" isolation-by-construction check. Not yet deployed to testnet — needs `SEPOLIA_RPC_URL` + `SEPOLIA_DEPLOYER_KEY`, and a confirmed current CRE KeystoneForwarder address for Sepolia. |
| Confidential risk brain (Chainlink CRE, `cre-workflow/`) | **Simulating successfully end to end.** Real `handlerInTee`/`getSecrets`/`usingTheDons()` — verdict flips `liquidate=false → true` on a controlled stress trigger, 8/8 unit tests passing. Onchain delivery wired and ABI-verified against the real vault/executor (above), disabled until deployed. |
| Protected RWA leg (Hedera ATS, `contracts-hedera/`) | **Script ready, type-checked, verified against live testnet reads** (real Factory/BLR bytecode + config version confirmed on-chain). Issues a real Bond via ATS, then a KYC-gated compliant transfer. Not yet run for real — needs a funded Hedera testnet ECDSA account (`HEDERA_OPERATOR_ID`/`HEDERA_OPERATOR_KEY`). |
| Cross-protocol exposure input (The Graph, `subgraph/`) | Not started — needs a Subgraph Studio API key and a live Messari standardized Lending/CDP subgraph deployment id. The CRE workflow already has a named slot (`exposureApiUrl`) waiting for this. |
| Frontend (`app/`) | Not started — Next.js, minimal/bold/high-contrast per your direction. |

## What you need to hand over next

Drop these into a `.env` at the repo root (copy `.env.example` — this file is gitignored,
never paste secrets into chat):

- `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` — a funded Hedera testnet account.
- `SEPOLIA_RPC_URL` / `SEPOLIA_DEPLOYER_KEY` — an RPC endpoint (Infura/Alchemy) and a
  funded Sepolia deployer key.
- `GRAPH_API_KEY` — from Subgraph Studio, for querying a standardized subgraph.
- CRE access, if/when we go beyond local simulation — see `cre-workflow/README.md` once
  written for exactly what's needed.

## Repo layout

```
contracts-hedera/    Hedera ATS integration — protected RWA leg
contracts-sepolia/   Crypto margin vault — liquid, liquidatable leg
cre-workflow/         Chainlink CRE Confidential Workflow — the risk brain
subgraph/             Graph queries against a Messari standardized subgraph
app/                  Next.js demo frontend
docs/                 Architecture notes, demo script, evidence log
```
