# Galvanic — architecture

## The problem this shape solves

A cross-margin account is useful precisely because collateral is fungible: post a
bond, borrow against it plus your ETH, get more capacity than either leg alone.
The moment you do that, you have also agreed that a crash in the ETH leg can be
paid for by selling the bond.

For a tokenized treasury that is not a rounding error. It is a compliance-managed
security with a KYC-gated register, and forcing its sale to cover an unrelated
crypto default is the single thing an institution posting it will not accept.

So the design goal is narrow: **keep the capacity, drop the contamination.**

## Where each decision lives

The safety property is not a rule inside one contract. It is a separation of powers
across three of them.

```
who decides                        what they may decide

Chainlink CRE (in a Nitro TEE)     how much DEBT to close, and nothing else
  ↓ signed report
FirewallMarginExecutor             apply that verdict; write the Hedera attestation
  ↓
CryptoMarginVault                  which COLLATERAL may fund it
  ↓ (pooled only)
ProtectedCollateralRegistry        record a claim — never move a unit
```

A policy that could name the collateral could name the note. It cannot, because the
report has no field for it. That is the whole mechanism, and it is why the report ABI
is worth reading:

```solidity
(uint8 action, address account, uint256 amountUsd,
 uint256 protectedUnits, uint256 protectedValueUsd, address hederaToken)
```

## Components

### contracts-hedera — the protected asset

`issue-asset.ts` deploys a bond through the ATS Factory and Business Logic Resolver,
registers a trusted KYC issuer, issues supply, performs a KYC-gated
`transferByPartition`, schedules a coupon through the Coupon facet and reads the
holder's payable amount back from the on-chain record-date snapshot, then revokes
KYC, confirms a transfer preflight reverts, and restores it.

The holder is the same EVM address as the Sepolia margin account. Nothing else links
the two chains.

### cre-workflow — the private policy and the attestation

One handler, registered with `cre.handlerInTee` on AWS Nitro. Inside the enclave:

- CRE secrets supply the risk policy and the Graph gateway credential;
- the Hedera mirror node is read for the note's balance;
- the standardized Graph query is fanned across three lending protocols;
- the Sepolia position is read through a local read-only bridge.

Out comes one report. The thresholds, the raw Graph payloads and the raw balances
never cross back.

The Hedera read is the answer to the chain-boundary problem. The enclave observes a
balance; the DON signs for what it saw. There is no bridge, no wrapper, no lock.

### subgraph — the market context

One query against Messari's common Lending schema v3.1.0, sent unmodified to Aave v3,
Compound v3 and Spark Lend, producing three signals: the collateral mark (median
`Token.lastPriceUSD`), market stress (`dailyLiquidateUSD` over total borrows, plus ETH
utilization), and the account's external borrows.

The mark sets the health factor. The stress raises the health factor the policy
requires. The exposure restricts new borrowing. All three are live; none has a mock
path.

### contracts-sepolia — the margin account

`ProtectedCollateralRegistry` records the attested Hedera holding and who holds the
margin claim over it. It cannot move anything on Hedera, and it knows it: a fresh
attestation showing the units still with the account clears any prior claim, because
a seizure here is a claim, not a settlement.

`CryptoMarginVault` values both legs, and carries a per-account margin mode:

| | crypto bucket | protected note |
|---|---|---|
| Pooled | drained | claim seized once the bucket runs out |
| Firewall | drained | untouched; recognition revoked, borrowing restricted |

`previewLiquidation` returns both outcomes without executing either, which is what
makes the counterfactual showable rather than assertable.

## Deliberate omissions

No bridge, no wrapper token, no oracle network, no DAO, no order book, no secondary
market, no AI in the risk path. Each would widen the diagram and weaken the one claim
a judge has to be able to check.

## The honest boundary

Confidential Workflow deployment access is a Chainlink permission we do not have.
The workflow runs and produces the report; the executor currently accepts that report
from the operator key rather than the CRE Forwarder. `scripts/use-don-forwarder.ts`
switches it with one owner call and `_processReport` is unchanged either way.
