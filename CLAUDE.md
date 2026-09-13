# CLAUDE.md

## Mission

Build a **working ETHGlobal-quality testnet demo**, not a speculative protocol or a large codebase.

Working concept: **Firewall Margin — cross-margin without cross-contamination.**

The core idea is risk-partitioned collateral. Crypto collateral can absorb normal liquidation pressure without automatically forcing liquidation of protected RWA collateral. The system should demonstrate that this is a real, functioning primitive rather than a slide-deck concept.

You have freedom to refine the architecture and implementation after inspecting the current sponsor docs, SDKs, testnets, and APIs. **Do not preserve this document's assumptions if the official docs reveal a better, simpler way to make the core demo actually work.**

## Prize scope

Target these three Start Fresh / open tracks:

- **Hedera — Tokenization of Anything:** $6,000 pool; max single-team award **$2,000**.
  - Use Hedera Asset Tokenization Studio (ATS).
  - Actually issue/manage a tokenized asset on Hedera testnet.
  - Demonstrate a real lifecycle operation (transfer/compliance/distribution/etc.).
- **The Graph — Best Use of Composable or Standardized Graph Products:** $5,000 pool; max **$2,500**.
  - Use live Graph data.
  - Must either compose 2+ Graph products or meaningfully use a standardized schema.
  - A single raw subgraph query is not enough.
  - Graph data must materially affect the product's risk decision.
- **Chainlink — Best Confidential Workflow:** $2,000 pool; max **$1,000**.
  - Use a real CRE Confidential Workflow.
  - Confidential logic must be load-bearing, using the confidential handler/TEE path.
  - Prefer a real testnet deployment/execution. CLI simulation is only a fallback for debugging or if deployment is genuinely impractical.

Potential extra:
- **Chainlink Automated Liquidation Protection Challenge:** $500. Only attempt this after the core product works. Never let it distort the main architecture.

Do not build for Continuity-only prizes. Do not assume a sponsor's headline pool is the amount one team wins.

## Product

The demo should make one thing obvious:

> **A bad/volatile mark or liquidation event in one collateral class should not contaminate the risk treatment of another collateral class.**

Example:

1. Account has protected RWA collateral + liquid crypto collateral.
2. Account is initially healthy.
3. Crypto collateral enters controlled stress / becomes eligible for liquidation.
4. The risk engine isolates the crypto side and acts on it.
5. Protected RWA collateral remains intact and subject to its own rules/compliance.
6. Graph-derived cross-protocol exposure is part of the risk calculation.
7. Chainlink confidential policy determines the protected action without exposing sensitive policy inputs.
8. Hedera proves the RWA is a real tokenized asset with lifecycle/compliance behavior.

The exact mechanism is yours to choose after technical investigation. **Do not fake a sophisticated mechanism if a simpler mechanism is more reliable and demonstrable.**

## Architecture principles

- First resolve the chain boundary between Hedera ATS assets and the EVM/Graph side.
- Do not add a bridge merely to make the architecture look complete.
- If a literal single-chain vault is impractical, change the product claim to a cross-venue/cross-account risk primitive rather than building a bridge.
- Keep the critical path on real testnets and real sponsor infrastructure.
- Avoid mocks in the final demo.
- No AI in the critical risk path. AI is unnecessary unless it provides a clearly useful non-critical explanation.
- No unnecessary DAO/governance, agents, x402, order book, AMM, secondary market, bridge, oracle network, complex frontend, or multi-chain abstraction.
- Prefer one excellent risk primitive over many features.
- Use existing standards and sponsor primitives rather than inventing infrastructure.

## Build strategy

### 1. Kill-test the idea first

Before building a large system, verify the smallest end-to-end path:

- Can ATS issue the required RWA on Hedera testnet?
- Can we perform and demonstrate a meaningful lifecycle/compliance action?
- Can Graph provide the live standardized/composed data needed for the risk calculation?
- Can CRE Confidential Workflow execute the private policy and produce a useful result/callback on a supported testnet?
- Can the chain boundary be represented cleanly without a bridge?

If any answer is no, **adapt the product immediately**. Do not spend hours building around an assumption.

### 2. Build the core risk primitive

Implement the minimum contracts/services needed for:

- collateral/account state,
- collateral classes,
- health/risk calculation,
- protected-vs-liquid collateral treatment,
- controlled stress/liquidation action,
- Chainlink confidential policy decision,
- Graph exposure input,
- Hedera ATS asset integration.

Keep contracts small and auditable. Avoid framework-heavy architecture.

### 3. Make the demo deterministic and repeatable

The demo must have a clear starting state and a controlled trigger.

The important thing is not a huge UI. It is that judges can see:

**real assets → real data → real confidential decision → real state change → protected collateral remains protected.**

Use a tiny UI or scripts where that makes the flow more reliable. A polished dashboard is secondary.

## Demo target

Aim for a **2–4 minute ETHGlobal submission/demo** with a strong live path:

1. Show the account and real RWA + crypto collateral.
2. Show the relevant live Graph exposure data.
3. Show the healthy state.
4. Trigger a controlled crypto stress/liquidation condition.
5. Execute the real CRE confidential workflow.
6. Show the resulting onchain/state transition.
7. Show that crypto collateral was handled while protected RWA collateral was not improperly liquidated.
8. Show the Hedera token/lifecycle/compliance evidence.
9. Briefly explain the risk-partitioning insight.

If a live dependency is flaky, build a robust fallback, but **the primary demo should be live testnet execution**.

## Engineering standard

Act like a strong hackathon founder/engineer:

- Build from the demo backwards.
- Validate sponsor requirements against their current official docs before implementation.
- Prefer boring, reliable infrastructure around a genuinely interesting core mechanism.
- Keep the code understandable enough that a judge can inspect it quickly.
- Test every critical transaction on testnet before polishing.
- Record transaction hashes, contract addresses, workflow IDs, and other evidence needed for judging.
- Keep README/demo instructions reproducible.
- Never claim functionality that is not actually working.
- Never optimize for architecture diagrams or code volume.

## Cut rule

If a feature does not materially improve the core demonstration or a targeted prize qualification, **cut it**.

When choosing between:
- more features vs. a reliable core → choose reliable core;
- a clever abstraction vs. a simple working implementation → choose simple;
- simulated infrastructure vs. real testnet infrastructure → choose real;
- polished UI vs. stronger mechanism → choose mechanism.

## Definition of done

The project is done when a fresh evaluator can run the documented flow and observe a convincing working testnet demonstration of:

**Hedera-tokenized protected collateral + live Graph-derived risk/exposure data + confidential Chainlink risk decision + selective liquidation/risk action, with no cross-contamination of the protected collateral.**

Everything else is optional.
