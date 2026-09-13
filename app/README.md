# Firewall Margin — demo frontend

Next.js (App Router) + Tailwind. Minimal, bold, high-contrast — no gradients-as-decoration,
no emoji, one accent color (signal orange) reserved for "stress/liquidation" state.

Reads shared config from the repo-root `.env` (not `app/.env`) — see `lib/env.ts`.

## Run it

```bash
cd app
npm install
npm run dev
```

Visit http://localhost:3000.

## What's real vs. graceful-empty

- **Protected RWA leg panel** — reads `contracts-hedera/issued-asset.json`, written by
  `contracts-hedera/issue-asset.ts` after a real run. Shows a "not deployed yet" empty
  state until that file exists.
- **Liquid crypto leg panel** — reads live from the deployed `CryptoMarginVault` on Sepolia
  (`SEPOLIA_VAULT` + `DEMO_ACCOUNT` env vars). "Trigger stress" / "Heal" call
  `vault.setPrice(...)` for real via `SEPOLIA_DEPLOYER_KEY`.
- **Confidential decision panel** — always real: `POST /api/verdict` shells out to the actual
  `cre workflow simulate` CLI against `cre-workflow/firewall-margin-workflow/`, parses its
  JSON verdict, and renders it. Requires the workflow's mock/live position+exposure server
  running (`bun mock-server.js` in `cre-workflow/firewall-margin-workflow/firewall-margin/`,
  or the equivalent from `subgraph/server.ts` once wired) and the CRE CLI + Bun on `PATH`.

## API routes

- `GET /api/status` — reads Sepolia vault state + Hedera issuance evidence.
- `POST /api/trigger-stress` — `{ action: "stress" | "heal" }`, crashes/restores the vault's
  demo price.
- `POST /api/verdict` — runs the real CRE workflow simulation, returns the parsed verdict.
