# Galvanic

Cross-margin without cross-contamination.

Most margin accounts treat all collateral as one pool. That works fine until one asset in
that pool gets volatile — a crypto position crashes, a stablecoin depegs — and whatever
logic reacts to it doesn't distinguish between "this needs to be liquidated" and "this is a
regulated, compliance-gated asset that has nothing to do with the thing that just moved."
Once collateral is pooled, a bad event anywhere in the pool can end up touching all of it.

Galvanic keeps those risks structurally apart instead of relying on policy to keep them
apart. Volatile collateral sits in its own vault, on its own chain. Protected collateral —
in this build, a tokenized bond — sits on Hedera, under its own compliance rules, in a
contract that the liquidation path has no function call into. A confidential risk engine
watches both sides and decides whether the volatile leg needs to be acted on. It can't
reach the protected leg even if it wanted to — there's no bridge, no shared owner, no
shared custody. Isolation by construction, not by permission.

## How it's built

- **Hedera / Asset Tokenization Studio** — the protected leg. A real security token with
  real compliance controls: KYC-gated holders, controlled transfers, issuer-managed
  lifecycle. Not a flag that says "compliant," an actual enforced gate.
- **Ethereum (Sepolia) vault** — the liquid leg. Deposit, borrow, get liquidated if your
  position breaks policy. The liquidation function has exactly one caller: the risk
  engine's on-chain identity. Nothing else can invoke it.
- **Chainlink CRE, confidential compute** — the decision itself, run inside a TEE. It
  combines private risk thresholds with live position data and the account's exposure
  elsewhere, and returns one verdict. The thresholds and raw inputs never leave the
  enclave — only the decision does.
- **The Graph** — where "exposure elsewhere" comes from. One query, written once against
  a standardized lending schema, run against several real lending protocols at once, so
  the risk engine knows what the account is already carrying before it decides anything.

## Repo layout

```
contracts-hedera/    Hedera ATS integration — the protected leg
contracts-sepolia/   Margin vault + liquidation executor — the liquid leg
cre-workflow/         The confidential risk engine (Chainlink CRE)
subgraph/             Cross-protocol exposure queries (The Graph)
app/                  Frontend
```

## Running it

Each directory is a standalone package. Broadly:

```bash
# contracts (Hardhat)
cd contracts-sepolia && npm install && npx hardhat test

# Hedera issuance script
cd contracts-hedera && npm install && npm run issue-asset

# confidential workflow (Bun + Chainlink CRE CLI)
cd cre-workflow/firewall-margin-workflow/firewall-margin && bun install && bun test

# exposure service
cd subgraph && bun install && bun run server.ts

# frontend
cd app && npm install && npm run dev
```

You'll need your own testnet keys and API keys — see `.env.example` at the repo root.
