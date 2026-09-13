<img src="logo.png" alt="Galvanic" width="72" />

# Galvanic

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

## Architecture: three systems, one mechanism

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

## System diagram

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

Stated plainly, so you don't have to guess.

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

## Deployed contracts and proof

Everything below is a live testnet address or a mined transaction — click any of
them.

**Sepolia**

| | |
|---|---|
| Demo account | [`0x4A30…0602`](https://sepolia.etherscan.io/address/0x4A30478Fd4F84Abc7A2686D67Ce38D9264260602) |
| `CryptoMarginVault` | [`0x3b3a…0c711`](https://sepolia.etherscan.io/address/0x3b3aFFcA57b32109d1C772bbA24D1c5d6D80c711) |
| `ProtectedCollateralRegistry` | [`0xEf29…41728`](https://sepolia.etherscan.io/address/0xEf29220ea72702aa4d02414F2C894dff0fD41728) |
| `FirewallMarginExecutor` | [`0x1fd4…e473b`](https://sepolia.etherscan.io/address/0x1fd4DCAecEC3964C99836F5969F441f2c67e473b) |

**The same crash, settled two ways** — same account, same debt, same enclave
verdict, only the margin mode differs:

| | crash tx | settle tx | outcome |
|---|---|---|---|
| Pooled margin | [mark](https://sepolia.etherscan.io/tx/0x164c82a40a28eb777101d39910b02315ccaf2dfb6ae953ef014d547f1034a380) | [settle](https://sepolia.etherscan.io/tx/0x66729f8b32676843f2432796edf0c030bbc23b727ce52051dcfd2c26418dee77) | $16,201 seized from the note — contaminated |
| Firewall | [mark](https://sepolia.etherscan.io/tx/0xf56de253a8e81070eec79bbf0e913331123a21c36a058e12572bd2d01fe984f2) | [settle](https://sepolia.etherscan.io/tx/0x4c09580ec7b7d7987660400c031f18897fee564e976aef91c75dc087516c667b) | $0 from the note — preserved |

Full run, including the enclave's own verdict, in
[`contracts-sepolia/prove-firewall.json`](contracts-sepolia/prove-firewall.json).

**Hedera testnet**

| | |
|---|---|
| Bond ([`FWM-NOTE`](https://hashscan.io/testnet/contract/0x0b85d6db3D300B695a40C463B8669C3e76Bd982b), ERC-1400) | [`0x0b85…d982b`](https://hashscan.io/testnet/contract/0x0b85d6db3D300B695a40C463B8669C3e76Bd982b) |
| Issued | [tx](https://hashscan.io/testnet/transaction/0xba2517b5c46700e6f651bd1209410592dabd1dc81b1b536e46924126cd0abef3) |
| Transferred to holder (KYC-gated) | [tx](https://hashscan.io/testnet/transaction/0x0de904634b2bd0b49fd3e454b354dca533910c8ad7dfd09a49d68a3295ffd032) |
| Coupon scheduled (2.5%) | [tx](https://hashscan.io/testnet/transaction/0xf1771e89c73733fa923f4a992ae3eff4d57c332eda6464fd247c88bc579f9cd2) |
| KYC revoked (compliance test) | [tx](https://hashscan.io/testnet/transaction/0xa5a64bff723abc63103404b935eb8938c88a02a9a14c80b1ce76eddc6854a05f) |
| KYC restored | [tx](https://hashscan.io/testnet/transaction/0xf677bdc212e394c549fd00ee104cab2e4f108c61361dcaeb4afb3da6b58ce284) |

All nine lifecycle transactions in
[`contracts-hedera/issued-asset.json`](contracts-hedera/issued-asset.json).

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
