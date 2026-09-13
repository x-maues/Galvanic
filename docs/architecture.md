# Firewall Margin — architecture

## One-line pitch
Cross-margin without cross-contamination: a confidential risk brain that can liquidate
stressed crypto collateral without ever being able to touch protected, compliance-gated
RWA collateral — because they live in different custody domains entirely, not just
different ledger entries.

## Why cross-venue, not one shared vault
A single vault holding both RWA and crypto collateral only proves the code *chose* not to
liquidate the RWA leg. Splitting by venue proves it *cannot* — the liquidation call is a
different contract, on a different chain, with no shared custody. Stronger claim, less
bridge risk, matches CLAUDE.md's explicit fallback guidance.

## Components

1. **Hedera testnet — protected RWA leg**
   - Real security token issued via Hedera Asset Tokenization Studio (ATS), ERC-1400
     (+ partial ERC-3643), EVM-based (Solidity, diamond proxy), deployed via Hardhat +
     Hiero JSON-RPC relay.
   - Demonstrates a real lifecycle op: KYC control-list grant + a compliant transfer (or
     a coupon distribution — pick whichever is faster to get working end to end).
   - State read via the public Hedera Mirror Node REST API (non-sensitive signal: "is the
     RWA leg in good standing").

2. **Ethereum Sepolia — liquid crypto margin leg**
   - **Correction (verified on Etherscan):** the challenge's `TokenvETH`/`TokenvUSD`
     (`SEPOLIA_VIRTUAL_ETH`/`SEPOLIA_VIRTUAL_USD`) have an admin-only `mint()` (Chainlink's
     deployer address holds `ADMIN_ROLE`) — we cannot freely fund our own test accounts
     with them. `ChallengeLending` (`SEPOLIA_CHALLENGE_CONTRACT`, has `join()`,
     `userPosition{collateral,debt,hf,...}`, `Liquidated`/`PriceUpdate` events) is built for
     Chainlink's own externally-run price/liquidation scenarios post-deadline, not for a
     demo we can trigger on demand.
   - So: **core demo uses our own small mock ERC20 pair + `CryptoMarginVault.sol`**, fully
     under our control so the stress trigger is deterministic and repeatable on camera.
   - Vault mirrors `ChallengeLending`'s shape (collateral, debt, health factor) so the CRE
     workflow logic is trivially portable between the two. Exposes `executeLiquidation`
     restricted to the CRE workflow's registered executor address only.
   - **Bonus (optional, after core works):** separately call `join()` on the real
     `ChallengeLending` contract and adapt the CRE workflow to defend that position, to
     also qualify for the standalone $500 Automated Liquidation Protection Challenge. Does
     not gate or distort the core architecture.

3. **The Graph — cross-protocol exposure input**
   - Query a live Messari Standardized Subgraph, Lending/CDP schema v3.1.0 (Market /
     Position / Deposit / Borrow / Liquidate entities), via Subgraph Studio, for the
     account's real exposure on an external lending protocol (e.g. Aave).
   - This number feeds the risk score as a real, load-bearing input, not a decorative
     query — satisfies "meaningfully use a standardized schema."

4. **Chainlink CRE Confidential Workflow — the risk brain**
   - Adapted from the `automated-liquidation-protection` CRE template.
   - Public/non-confidential inputs: crypto price, Sepolia vault LTV/health, Hedera RWA
     status via Mirror Node.
   - Confidential (TEE, `handlerInTee`) inputs: private liquidation policy thresholds
     (loaded from CRE secrets) + the Graph-derived cross-protocol exposure figure (treated
     as sensitive user data).
   - Only the verdict (liquidate / hold / partial + amount) leaves the enclave for DON
     consensus and the onchain write to the Sepolia vault.
   - Qualification only requires CLI simulation with evidence OR live deployment — build
     and prove out simulation first (`cre workflow simulate`), attempt live testnet
     registration only if time/access allow.

5. **Frontend — Next.js**
   - Minimal, bold, high-contrast, no AI-slop gradients-and-emojis aesthetic.
   - Two collateral-leg panels (Hedera RWA / Sepolia crypto), a live health readout, a
     "trigger stress" control, and a decision/evidence log (tx hashes, HashScan/Etherscan
     links, workflow run output) — this is the artifact judges actually watch.

## Kill-test order (verify before building on top)
1. ATS: issue a token on Hedera testnet, perform one lifecycle op.
2. CRE: get `hello-confidential-workflows` simulating locally, then adapt
   `automated-liquidation-protection`.
3. Sepolia: call `join()` on the challenge contract, confirm balances/roles.
4. Graph: run one live query against a Messari standardized Lending/CDP subgraph deployment.

If any of these fail or are impractical, adapt the product claim immediately rather than
building further on a broken assumption (see CLAUDE.md).
