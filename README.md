<img src="logo.png" alt="Galvanic" width="72" />

# Galvanic (ETHOnline 2026)

### Cross-margin, without cross-contamination.

Tokenized treasuries are being posted as collateral. The moment they are, they
inherit a problem nobody has solved: **in a cross-margin account, a crash in the
volatile leg can force the sale of the safe one.** That is how a bond that was
never in trouble gets liquidated at 3am because ETH moved.

Galvanic is a margin account where that cannot happen — and, more importantly, where
you can *watch* it not happen, against the alternative, on the same account, in the
same minute.

---

## The one thing to look at

The demo account is backed by two collateral classes:

| | |
|---|---|
| Crypto collateral | ~$27,000 of fmETH, marked at the live ETH price The Graph reports across Aave, Compound and Spark |
| Protected collateral | $30,000 of a Hedera ATS bond — a real, KYC-gated ERC-1400 security token with a real coupon |
| Debt | $35,000 |
| **Portfolio health** | **1.27 — healthy** |
| **Crypto-only health** | **0.62 — the note is carrying this position** |

That last row is what makes the rest meaningful. The note is not decoration; it is
doing real work, and there is genuinely something to lose.

Then the crypto mark falls 92%. The vault computes both outcomes itself:

```
                        from crypto      from the Hedera note
  Pooled margin          $2,174               $16,201     <- contaminated
  Firewall               $2,174                    $0     <- loss stops here
```

Under the firewall the account is not let off: its borrowing power collapses, new
borrowing is restricted, and the protocol carries the shortfall. What it does *not*
do is reach across a compliance boundary to make itself whole.

Run `npm run demo:prove` in `contracts-sepolia/` and both rows execute for real on
Sepolia, driven by the enclave's own signed report. Transaction hashes land in
`prove-firewall.json`.

---

## How the three sponsors each do a job nothing else could

This is one mechanism, not three integrations sitting next to each other. Remove any
one and the product stops working.

### Hedera — the collateral that must not be touched

`contracts-hedera/issue-asset.ts` issues a bond through the **Asset Tokenization
Studio** Factory and Business Logic Resolver on Hedera testnet, then runs its
lifecycle:

- `issue` 100,000 notes, `grantKyc`, and a KYC-gated `transferByPartition` of 3,000
  notes to the holder;
- a **coupon corporate action** through the ATS Coupon facet — scheduled at 2.5%,
  the record date reached on-chain, and the holder's payable amount read back from
  the snapshot the contract took;
- compliance exercised rather than merely configured: KYC revoked, a transfer
  preflight confirmed to revert, KYC restored.

Every hash is in [`contracts-hedera/issued-asset.json`](contracts-hedera/issued-asset.json).

The holder address is deliberately the *same address* as the Sepolia margin account.
That identity is what lets the note back a position on another chain with no bridge.

### The Graph — the market context that moves the line

`subgraph/exposure.ts` sends **one** query, written once against Messari's
standardized Lending schema (v3.1.0), unmodified, to live Aave v3, Compound v3 and
Spark Lend deployments through the gateway. One document, three protocols, three
different risk questions:

1. **the collateral mark** — median `Token.lastPriceUSD` across protocols, which is
   what the vault marks fmETH at, so Graph data sets the health factor directly;
2. **market stress** — `dailyLiquidateUSD` against total borrows, plus ETH-market
   utilization, folded into `marketStressBps`, which *raises the health factor the
   policy requires*. The liquidation line moves with the market;
3. **this account's external borrows** — `Account -> Position`, which restricts new
   borrowing above a private cap.

Without a shared schema this is three bespoke integrations with three entity
vocabularies and three price derivations. With it, adding a fourth protocol is one
row in `LENDING_SUBGRAPHS` and nothing else in the file changes. There is no mock
mode: no key, no service.

**Test it yourself** — the dashboard's *Network data* page takes any address. Paste a
real Aave borrower and watch the exposure cap flip the verdict to *restrict
borrowing* on live mainnet data.

### Chainlink CRE — the decision that must stay private, and the bridge that isn't one

`cre-workflow/.../workflow.ts` runs under **`cre.handlerInTee`** on AWS Nitro. Inside
the enclave, and only inside it:

- the risk policy loads as CRE secrets — the health floor, the close factor, the
  exposure cap. Publish these and an adversary knows exactly where to push the
  account;
- the **Graph API key** loads as a secret and is used for the gateway calls, so the
  credential never appears in config, in a log, or in the report;
- the **Hedera mirror node is read directly** for the note's balance.

That last point is the architectural answer to the chain-boundary problem. The
enclave *observes* the Hedera balance and the DON *signs for what it saw*. Nothing is
wrapped, locked, or minted. `ProtectedCollateralRegistry` on Sepolia recognises the
attestation — and a later attestation showing the units still with the account
clears any claim against them, because Hedera is the record of ownership and this is
only a recognition of it.

What crosses back out is one report:

```solidity
(uint8 action, address account, uint256 amountUsd,
 uint256 protectedUnits, uint256 protectedValueUsd, address hederaToken)
```

Note what the policy is not allowed to say: *which collateral pays*. It sets how much
debt to close; the vault decides which bucket may fund it. Keeping those two
decisions in different contracts is the safety property — a policy that could name
the collateral could name the note.

---

## Architecture

```
  Hedera testnet                      Ethereum Sepolia
  ┌───────────────────────┐           ┌──────────────────────────────┐
  │ ATS bond (ERC-1400)   │           │ ProtectedCollateralRegistry  │
  │ KYC · coupon · supply │           │  recognises, never custodies │
  └───────────┬───────────┘           └──────────────┬───────────────┘
              │ balanceOf, read by the enclave       │ attested by
              │                                      │
         ┌────▼──────────────────────────────────────▼────┐
         │  Chainlink CRE — cre.handlerInTee (Nitro TEE)  │
         │  secrets: risk policy + Graph key              │
         └────┬──────────────────────────────────────┬────┘
              │ one standardized query                │ signed report
      ┌───────▼────────┐                     ┌────────▼─────────────┐
      │ The Graph      │                     │ FirewallMarginExecutor│
      │ Aave/Comp/Spark│                     │   ↓                   │
      │ Messari v3.1.0 │                     │ CryptoMarginVault     │
      └────────────────┘                     │ firewall │ pooled     │
                                             └───────────────────────┘
```

There is no bridge, no wrapper token, and no path by which any contract here can move
a unit on Hedera.

---

## Run it

Four terminals. Everything talks to real testnets; nothing is mocked.

```bash
cp .env.example .env      # fill in Hedera + Sepolia keys and a free GRAPH_API_KEY

# 1 — The Graph risk service
cd subgraph && bun install && bun server.ts

# 2 — Sepolia position bridge (read-only view of the vault)
cd cre-workflow/firewall-margin-workflow/firewall-margin && bun install && bun position-bridge.js

# 3 — contracts + demo account
cd contracts-sepolia && npm install
npm test                  # 13 tests, including the counterfactual
npm run deploy:sepolia    # prints the addresses to put in .env
npm run demo:setup        # marks collateral from The Graph, attests the Hedera note, opens the position

# 4 — the product
cd app && npm install && npm run dev
```

Then `http://localhost:3000/dashboard`.

To issue a fresh Hedera asset: `cd contracts-hedera && npm install && npm run issue-asset`.

To prove the whole claim non-interactively: `cd contracts-sepolia && npm run demo:prove`.

---

## What is real, and the one thing that is not

Stated plainly, because a judge should not have to guess.

| | |
|---|---|
| Hedera ATS bond, KYC, transfer, coupon | **Real**, Hedera testnet, hashes in `issued-asset.json` |
| Sepolia vault, registry, executor, liquidations | **Real**, deployed, every state change is a transaction |
| The Graph market data | **Real**, live gateway queries, no mock path exists |
| CRE confidential handler, secrets, enclave reads | **Real**, `cre.handlerInTee`, runs under `cre workflow simulate` |
| The 92% crypto crash | **Scripted.** It is the event being demonstrated, not evidence |
| DON delivery of the report | **Not yet.** See below |

The confidential workflow runs, produces the report, and that exact byte string is
what settles on Sepolia. What is missing is the last hop: Chainlink Confidential
Workflow **deployment access** is a permission we do not have, so the executor
currently accepts the report from the operator key rather than from Chainlink's CRE
Forwarder. `scripts/use-don-forwarder.ts` switches that with one owner call.
`_processReport` — the part that decides anything — is byte-identical either way.

We would rather say this than let a screen imply a DON wrote it.

---

## Repository

```
contracts-sepolia/   cross-margin vault, protected-collateral registry, CRE executor
contracts-hedera/    ATS issuance, KYC lifecycle, coupon corporate action
cre-workflow/        the confidential policy — secrets, Hedera read, Graph fan-out
subgraph/            one standardized query across three lending protocols
app/                 the operator product
docs/                architecture and the demo script
```
