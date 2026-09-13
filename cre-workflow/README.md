# Firewall Margin — Chainlink CRE Confidential Workflow

Status: **local toolchain installed and working, adapted confidential
workflow simulating successfully end-to-end on this machine.** Onchain
delivery to Sepolia is wired but disabled (no deployed contract yet, no CRE
deploy access yet) — see "What's real vs. placeholder" below.

## What's here

```
cre-workflow/
├── cre-templates/                     # upstream clone: smartcontractkit/cre-templates
│   └── starter-templates/
│       ├── hello-confidential-workflows/      # studied + simulated as-is (proof of toolchain)
│       ├── confidential-workflows/
│       │   └── automated-liquidation-protection/  # studied in detail (adapted from)
│       └── keeper-bot/                        # studied for the onchain writeReport pattern
└── firewall-margin-workflow/           # our adapted workflow
    ├── project.yaml                    # CRE project settings (Sepolia RPC)
    ├── secrets.yaml                    # maps workflow secret IDs -> env vars
    ├── .env.example                    # copy to .env; all placeholder values
    ├── firewall-margin/                # the workflow itself
    │   ├── workflow.ts                 # TEE handler + decision logic (the core)
    │   ├── workflow.test.ts            # bun:test unit tests (8 tests, all pass)
    │   ├── main.ts, workflow.yaml, config.{staging,production}.json
    │   └── mock-server.js              # local placeholder position/exposure APIs
    └── contracts/
        ├── evm/src/FirewallMarginExecutor.sol   # pluggable onchain receiver (not deployed)
        └── evm/ts/generated/FirewallMarginExecutor.ts  # hand-written client wrapper
```

## 1. Install steps (exact commands used, reproducible)

```bash
# CRE CLI (installs to ~/.cre, adds to PATH)
curl -sSL https://app.chain.link/cre/install.sh | bash
# -> installed v1.33.0

# Bun (required for TypeScript CRE workflows)
curl -fsSL https://bun.sh/install | bash
# -> installed v1.4.2

# Templates repo
git clone --depth 1 https://github.com/smartcontractkit/cre-templates.git cre-workflow/cre-templates
```

No account, login, or API key was needed for any of this, and none was needed
to run `cre workflow simulate` (see below). `cre version` confirms the
install:

```
$ cre version
CRE CLI version v1.33.0
```

## 2. Proof the toolchain works: `hello-confidential-workflows-ts`

```bash
cd cre-workflow/cre-templates/starter-templates/hello-confidential-workflows/hello-confidential-workflows-ts
cp .env.example .env   # set SECRET_API_TOKEN to any non-empty value
cd my-workflow && bun install && cd ..
cre workflow simulate my-workflow --target staging-settings --non-interactive --trigger-index 0
```

Actual output (unedited):

```
Initializing...
Loading settings...
Checking RPC connectivity...
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  ...
2026-09-13T12:01:34Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
╭────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Trigger requested TEE Execution your trigger will run in one of the following Tees:                │
│     - AWS Nitro in us-west-2                                                                       │
│ The simulator is not a real TEE, and is meant to debug.                                            │
╰────────────────────────────────────────────────────────────────────────────────────────────────────╯

2026-09-13T12:01:35Z [USER LOG] Enclave computation complete. verdict=REJECT

✓ Workflow Simulation Result:
"REJECT (score: 172, secret reached API: true)"

2026-09-13T12:01:35Z [SIMULATION] Execution finished signal received
```

**Key finding: local simulation of a Confidential Workflow (`cre.handlerInTee`,
`runtime.getSecret`, `usingTheDons()`) requires no Chainlink account, no CRE
API key, and no private-beta enrollment.** The private beta gate (per
`docs.chain.link/cre/account/confidential-workflows-access`) only applies to
**deploying** a confidential workflow to real DON infrastructure — the CLI
prints this explicitly at the end of every simulate run:

```
╭──────────────────────────────────────────────────────╮
│ Simulation complete! Ready to deploy your workflow?  │
│ Run cre account access to request deployment access. │
╰──────────────────────────────────────────────────────╯
```

## 3. What the `automated-liquidation-protection` template actually does

Studied in full at
`cre-templates/starter-templates/confidential-workflows/automated-liquidation-protection/automated-liquidation-protection-ts/main.ts`.

- TEE handler (`cre.handlerInTee`, cron-triggered) fetches **10 secrets** in
  one `runtime.getSecrets([...])` call: an exchange API key, an OpenAI API
  key, and 8 numeric/string policy parameters (min/target health factor,
  reserve deployment caps, collateral/debt limits, preferred venues).
- Fetches live position data (`GET /risk-state`) from inside the enclave.
- Computes a composite risk score:
  `proximityRisk + ltvBufferRisk + healthRisk + volatilityRisk` (see
  `computeRiskScore` in that file).
- Calls an LLM (OpenAI-compatible endpoint, also from inside the enclave) to
  decide a defense plan (`shouldDefend`, `reasoning`, `actions[]`), then
  **enforces the policy caps in code** (`enforcePolicy`) regardless of what
  the LLM says — amounts are clamped, reserve floors are checked, actions are
  sequenced by preference.
- **Important finding: this template does NOT write onchain.** It POSTs the
  approved action plan to a mock **exchange** API (`/execute-defense`) — the
  "execution" venue is an offchain exchange, not a smart contract. There is no
  `usingTheDons()`, no `report()`, no `EVMClient` anywhere in this file.
- The onchain write pattern (DON-signed report → CRE Forwarder →
  `onReport()` → contract logic) only appears in the **Keeper Bot** and
  **Event Reactor** templates, which the ALP README and the hello template's
  README both point to for "the full write path." We read
  `keeper-bot-ts/my-workflow/workflow.ts` and
  `contracts/evm/src/KeeperConsumer.sol` to get that pattern exactly right
  (see below) — the ALP template alone would not have shown us how the
  onchain call actually gets wired up.

## 4/5. Adapted workflow: `firewall-margin-workflow/firewall-margin`

`workflow.ts` combines, inside a single `cre.handlerInTee` cron handler:

- **(a) Private liquidation policy thresholds** — fetched via
  `runtime.getSecrets([...])` inside the enclave: `MIN_HEALTH_FACTOR`,
  `LIQUIDATION_LTV_THRESHOLD`, `MAX_CROSS_PROTOCOL_EXPOSURE_USD`,
  `MAX_LIQUIDATION_PCT`. Mapped in `secrets.yaml` to mock env vars in `.env`
  (not real secrets — see below).
- **(b) Cross-protocol exposure** — fetched via `HTTPClient.sendRequest`
  from inside the enclave, from a local mock endpoint
  (`GET /firewall-margin/exposure`) returning
  `{ cross_protocol_borrow_exposure_usd }`. This stands in for a **Messari
  Standardized Subgraph** query on The Graph (e.g. the account's existing
  Aave borrow exposure) — swapping the URL for a real subgraph query is the
  only change needed later.
- **(c) Live crypto collateral health/LTV** — fetched the same way from
  `GET /firewall-margin/position`, standing in for a real lending-market
  position read.
- All three combine into `computeRiskScore()` and `decideVerdict()` (pure,
  unit-tested functions) to produce **one verdict object**:
  `{ liquidate: bool, account: address, amountUsd: number, riskScore, reason }`.
- The verdict — never the thresholds, never the raw payloads — crosses back
  via `runtime.usingTheDons()` and is packaged into a DON-signed report
  (`donRuntime.report({ encodedPayload, encoderName: 'evm', ... })`), ABI-encoded
  as `(bool liquidate, address account, uint256 amountUsd)`.
- **Pluggable onchain write**: if `config.onchain.enabled` is `true`, the
  workflow builds an `EVMClient` for `ethereum-testnet-sepolia`, wraps a
  `FirewallMarginExecutor` contract at `config.onchain.executorAddress`, and
  delivers the same signed report via `executor.deliver(donRuntime, report)`
  → CRE Forwarder → `onReport()` → `executeLiquidation(account, amountUsd)`.
  It is **disabled by default** in both `config.staging.json` and
  `config.production.json` because no Firewall Margin vault/executor is
  deployed yet — flipping the flag and setting a real `executorAddress` is
  the only change needed once it is.

### Contracts (reference wiring, not deployed)

`contracts/evm/src/FirewallMarginExecutor.sol` extends the same
`ReceiverTemplate` base used by the Keeper Bot template (copied verbatim from
`cre-templates/starter-templates/keeper-bot/.../contracts/evm/src/`). Its
`_processReport` decodes `(bool liquidate, address account, uint256
amountUsd)` and calls `executeLiquidation(account, amountUsd)`, which today
just emits `LiquidationExecuted` — swap that body for a real call into the
Firewall Margin vault once it exists.

`contracts/evm/ts/generated/FirewallMarginExecutor.ts` is a **hand-written**
client wrapper (there is no Foundry project or codegen wired up in this
pass) modeled exactly on the auto-generated `KeeperConsumer.ts` from the
Keeper Bot template — same `EVMClient` + `writeReport` pattern.

### Running it (proof, exact commands)

```bash
export PATH="$HOME/.cre/bin:$HOME/.bun/bin:$PATH"
cd cre-workflow/firewall-margin-workflow
cp .env.example .env   # all placeholder values, safe to use as-is for simulation
cd firewall-margin && bun install && cd ..

# unit tests (pure decision logic + handler wiring, no CRE CLI needed)
cd firewall-margin && bun run typecheck && bun test && cd ..
# -> 8 pass, 0 fail

# start the placeholder position/exposure APIs
cd firewall-margin && bun mock-server.js &
cd ..

# simulate — healthy state
cre workflow simulate firewall-margin --target staging-settings --non-interactive --trigger-index 0
```

Actual output, healthy state:

```
2026-09-13T12:09:46Z [USER LOG] Firewall Margin verdict: liquidate=false amountUsd=0 score=0.00 reason="crypto leg within policy; no action"

✓ Workflow Simulation Result:
"{\"liquidate\":false,\"account\":\"0x1111111111111111111111111111111111111111\",\"amountUsd\":0,\"riskScore\":0,\"reason\":\"crypto leg within policy; no action\"}"
```

Then trigger controlled stress and re-run:

```bash
curl -X POST http://127.0.0.1:8788/firewall-margin/stress
cre workflow simulate firewall-margin --target staging-settings --non-interactive --trigger-index 0
```

Actual output, stressed state:

```
2026-09-13T12:10:00Z [USER LOG] Firewall Margin verdict: liquidate=true amountUsd=22500 score=20.00 reason="health factor below policy minimum"

✓ Workflow Simulation Result:
"{\"liquidate\":true,\"account\":\"0x1111111111111111111111111111111111111111\",\"amountUsd\":22500,\"riskScore\":20.000000000000007,\"reason\":\"health factor below policy minimum\"}"
```

(`curl -X POST http://127.0.0.1:8788/firewall-margin/heal` reverts to the
healthy fixture.)

This is the full demo loop the CLAUDE.md mission asks for, at the CRE layer:
healthy state → controlled crypto-side stress → confidential decision inside
a TEE combining private policy + cross-protocol exposure + live LTV → a
single verdict crossing the boundary → (pluggable) onchain delivery — with
protected RWA collateral never entering this computation at all.

## What's real vs. placeholder right now

| Piece | Status |
|---|---|
| CRE CLI installed, `cre workflow simulate` running locally | **Real** — v1.33.0, no account needed |
| TEE handler registration, `getSecrets`, `usingTheDons()`, `report()` | **Real** — actual CRE SDK APIs, actually exercised by the simulator |
| Policy thresholds (min health factor, LTV threshold, max exposure, max liquidation %) | **Placeholder** — mock values via `.env`, structurally identical to how real secrets would be supplied |
| Cross-protocol exposure input | **Placeholder** — local mock HTTP endpoint; needs to become a Messari Standardized Subgraph query on The Graph |
| Crypto collateral health/LTV input | **Placeholder** — local mock HTTP endpoint; needs to become a real lending-market/oracle read |
| Onchain delivery (`executeLiquidation`) | **Wired but disabled** (`onchain.enabled: false`) — no deployed contract, no funded Sepolia key |
| `FirewallMarginExecutor.sol` | **Written, not compiled or deployed** — no Foundry project/OpenZeppelin dep installed in this pass |
| `FirewallMarginExecutor.ts` client wrapper | **Hand-written**, not code-generated (no Foundry+codegen pipeline set up) |
| Confidential Workflows deploy access | **Not obtained** — private beta, see below |

## Update: the executor + vault side is now real, not placeholder

`contracts-sepolia/` (sibling directory) now has a working, fully-tested Hardhat
project with the actual Firewall Margin vault this workflow delivers to:

- `CryptoMarginVault.sol` — the crypto leg: deposit/borrow/withdraw/repay, a
  demo-operator-settable price (deterministic stress trigger), and
  `executeLiquidation(account, debtToCover)` gated to a single `creExecutor` address.
- `FirewallMarginExecutor.sol` — copied the `ReceiverTemplate`/`IReceiver`/`IERC165`
  files verbatim from this directory, rewired `_processReport` to decode the same
  `(bool liquidate, address account, uint256 amountUsd)` payload and call
  `vault.executeLiquidation(account, amountUsd * 1e18)` for real (no more
  "just emits an event" placeholder).
- A full integration test (`test/FirewallMarginExecutor.test.ts`) proves, locally,
  with real contract calls: a non-forwarder sender is rejected
  (`InvalidSender`), a `liquidate:false` report changes nothing, and a
  `liquidate:true` report drives an actual gated liquidation on the vault —
  the exact report shape this workflow's `encodeAbiParameters` produces,
  decoded and acted on by the real receiver contract. 7/7 tests passing
  (4 vault + 3 executor).

This means the only things left before `onchain.enabled: true` actually works end to
end are external: a funded Sepolia key, and the vault/executor pair deployed
(`contracts-sepolia/scripts/deploy.ts` now deploys and wires both automatically,
defaulting to the confirmed production KeystoneForwarder address for Sepolia,
`0xF8344CFd5c43616a4366C34E3EEE75af79a74482` — sourced from Chainlink's own
Forwarder Directory, docs.chain.link/cre/guides/workflow/using-evm-client/
forwarder-directory-ts), and CRE deploy access. The contract-side logic and its
ABI-compatibility with this workflow's report encoding are no longer assumptions.

Note: that same directory also lists a separate `MockKeystoneForwarder`
(`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`) for use when `onchain.enabled` is
exercised under local `cre workflow simulate` rather than a real DON — use that
address instead if wiring up onchain delivery for local simulation testing.

## What's needed to go from simulation to live testnet deployment

1. **Confidential Workflows private beta access.** Per
   `docs.chain.link/cre/account/confidential-workflows-access`, this requires
   enrollment through a Chainlink account team. Action for the user: create a
   CRE account at `app.chain.link/cre/discover`, run `cre login`, then follow
   that enrollment process (or ask a Chainlink DevRel/hackathon contact for
   fast-track hackathon access — common at ETHGlobal events).
2. **CRE deploy access more generally.** Even for a non-confidential
   workflow, `cre account access` needs to be run and granted before
   `cre workflow deploy` will work (the simulator prints this prompt after
   every successful simulate).
3. **A funded Sepolia key** for `CRE_ETH_PRIVATE_KEY` in `.env` — needed once
   `onchain.enabled: true`, so the workflow can pay gas to deliver the report
   via the CRE Forwarder.
4. **A deployed `FirewallMarginExecutor` (or the real vault) on Sepolia** —
   compile `contracts/evm/src/FirewallMarginExecutor.sol` (needs a Foundry
   project + OpenZeppelin `Ownable`, neither set up in this pass) and deploy
   it with the CRE KeystoneForwarder address for Sepolia as the constructor
   arg (same forwarder Keeper Bot documents:
   `0x15fc6ae953e024d975e77382eeec56a9101f9f88` — confirm current address at
   deploy time). Then set `config.staging.json`'s `onchain.executorAddress`
   to the deployed address and flip `onchain.enabled: true`.
5. **A real Messari Standardized Subgraph endpoint + Graph API key** to
   replace `exposureApiUrl` — this is the piece that makes the cross-protocol
   exposure input live rather than mocked, and is being handled by the
   Graph-track side of this project.
6. Optional: **CRE API key** (`CRE_API_KEY` placeholder in the repo's root
   `.env.example`) — not consumed anywhere in this pass; only needed if a
   specific CRE product surface requires it at deploy time (not yet
   determined — the CLI itself only asked for `cre login` / `cre account
   access`, not a separate API key, for everything exercised so far).

## No blockers hit

Both install attempts (`curl | bash` for the CRE CLI, `curl | bash` for Bun)
succeeded on the first try in this sandboxed Linux environment — no
workarounds were needed. The one non-obvious pitfall found and fixed: pinning
`@chainlink/cre-sdk` to the **exact** version `1.18.0` (as the hello and ALP
templates do) rather than a caret range (`^1.6.0`, as Keeper Bot's
`package.json` does) — a caret range resolved a version whose published
`package.json` leaks an internal `workspace:*` dependency on
`@chainlink/cre-sdk-javy-plugin`, which breaks `bun install` outside
Chainlink's own monorepo. Pinning the exact version avoids this entirely.
