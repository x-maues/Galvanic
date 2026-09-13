# contracts-hedera — Hedera ATS asset issuance (Firewall Margin, protected RWA leg)

This directory issues the **protected RWA collateral leg** of the Firewall Margin demo: a real
security token ("Firewall Margin Short-Term Note", a bond) on **Hedera testnet**, deployed via
the already-live **Asset Tokenization Studio (ATS)** Factory + Business Logic Resolver (BLR),
followed by a real on-chain compliance lifecycle operation (KYC grant + compliant transfer).

It does **not** redeploy ATS itself — it calls the Hedera team's existing testnet deployment.

## What the script does (`issue-asset.ts`)

1. Connects to Hedera testnet via the Hiero JSON-RPC relay using your operator key.
2. Reads the live Bond configuration version from the BLR (`getLatestVersionByConfiguration`) —
   does not hardcode it, so the script keeps working if the Hedera team registers a newer
   configuration version before the hackathon.
3. Deploys a **Bond** security token via `Factory.deployBond(...)`, granting the operator account
   `DEFAULT_ADMIN_ROLE`, `ROLE_SSI_MANAGER`, `ROLE_KYC`, `ROLE_ISSUER`, and `ROLE_PAUSER` on the
   new diamond proxy at deployment time (so no second signer/wallet is ever required).
4. Registers the operator as a trusted KYC issuer (`addIssuer`).
5. Grants the operator itself KYC (`grantKyc`) — required before it can hold/mint balance.
6. Issues (mints) initial supply to the operator (`issue`, ERC-1594).
7. Generates a fresh "investor" EVM keypair and grants it KYC.
8. Performs a **KYC-gated compliant transfer** of units to that investor (`transferByPartition`).
9. Reads back name/symbol/decimals/balances/total supply as on-chain confirmation.
10. Writes `issued-asset.json` with every contract address, tx hash, and HashScan link — the
    evidence artifact for the demo/judging.

`internalKycActivated: true` is the load-bearing compliance switch: the investor transfer would
revert on-chain if KYC had not been granted first. This is a real, enforced compliance gate, not
a decorative flag — see "Design notes" below for how this was verified against the Solidity
source.

## Setup

```bash
cd contracts-hedera
npm install
```

Fill in the repo-root `.env` (copy from `.env.example` if you haven't already):

```bash
cd ..
cp .env.example .env   # if not already done
# edit .env:
#   HEDERA_OPERATOR_ID=0.0.xxxxx        (a funded Hedera testnet account, ECDSA)
#   HEDERA_OPERATOR_KEY=302e...          (raw hex or DER-encoded ECDSA private key — either works)
#   HEDERA_NETWORK=testnet
#   HEDERA_JSON_RPC_URL=https://testnet.hashio.io/api
```

The operator account **must be ECDSA** (not ED25519) since it needs an EVM address to sign
Hiero JSON-RPC relay transactions. Fund it at https://portal.hedera.com/faucet.

Run it:

```bash
cd contracts-hedera
npm run issue-asset
```

Everything the script prints (contract addresses, tx hashes, HashScan links) is also written to
`contracts-hedera/issued-asset.json` when it finishes.

## Status as of this setup pass

- **Not yet run against real credentials** — no funded Hedera testnet account was available yet.
  Per instructions, no live transactions were attempted.
- **Fully installed and type-checked**: `npm install` succeeds, `npx tsc --noEmit` is clean.
- **Verified as far as possible without funds**, against the *real* Hedera testnet JSON-RPC relay
  (`https://testnet.hashio.io/api`, no credentials required for reads):
  - The Factory and BLR/Resolver contract addresses below are live contracts on testnet (bytecode
    present, confirmed via `eth_getCode`).
  - `resolver.getLatestVersionByConfiguration(BOND_CONFIG_ID)` returns `1`, and
    `getConfigurationsLength()` returns `8` — matching the 8 configurations (Equity, Bond,
    BondFixedRate, BondKpiLinkedRate, DepositToken, Loan, LoansPortfolio, Factory) in the
    2026-06-12 deployment record from the ATS repo (see below). This cross-validates the
    addresses against two independent sources.
  - A private-key normalization round-trip (DER ⇄ raw ⇄ EVM address derivation) was tested with
    a locally generated throwaway key.
  - A **static call** (`factory.deployBond.staticCall(...)`, i.e. a read-only `eth_call`, no
    transaction broadcast/no funds spent) was made with the exact struct the script builds. It
    reached the contract and produced valid calldata — Hashio rejected it only because the
    `from` address used in the test (a random unfunded keypair) does not exist as a Hedera
    account yet (`"Sender account not found"`, a Hedera-specific relay requirement — the ledger
    needs to know the sending account already exists). This confirms the ABI/struct encoding is
    well-formed; the real business-logic path (ISIN checksum, role checks, etc.) can only be
    exercised by an account that actually exists on testnet, which is exactly what's still needed.
- **Next step once a funded account is available**: just run `npm run issue-asset`. No code
  changes should be required.

## Where the testnet addresses came from

Two independent sources in the `hashgraph/asset-tokenization-studio` GitHub repo agree exactly:

1. `apps/ats/web/.env.example` (the ATS team's own reference web app config, preconfigured for
   testnet):
   ```
   REACT_APP_RPC_RESOLVER='0.0.9212226'
   REACT_APP_RPC_FACTORY='0.0.9213391'
   ```
2. `packages/ats/contracts/deployments/hedera-testnet/newBlr-2026-06-12T11-19-42-198.json` (the
   most recent of five checkpointed deployment records under that directory, all landing in the
   single squashed commit `feat: v8.0.0 (#1298)`):
   ```json
   {
     "network": "hedera-testnet",
     "infrastructure": {
       "blr":     { "proxyContractId": "0.0.9212226", "proxy": "0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a" },
       "factory": { "proxyContractId": "0.0.9213391", "proxy": "0xd1F118A40f3b02883D35909eF2517e7EDd78379d" }
     }
   }
   ```

**Important:** the *published docs page*
(`docs/ats/developer-guides/contracts/deployed-addresses.md`) is stale — it still lists the
"Smart Contract Version 4.0.0" addresses (`0.0.7707874` / `0.0.7708432`). The npm packages this
script depends on (`@hashgraph/asset-tokenization-contracts` / `-sdk`) are both at **8.0.0**,
which the contracts package's own `CHANGELOG.md` describes as a breaking, "clean redeploy
required" release (facet interface IDs, storage layout, and role hashes all changed). Deploying
against the old 4.0.0 addresses with 8.0.0 ABIs/typechain bindings would silently break, so this
script uses the 8.0.0-era addresses above (`FACTORY_ADDRESS` / `RESOLVER_ADDRESS` env vars,
overridable if the Hedera team redeploys again before the hackathon). Both were confirmed live
with real bytecode on testnet during this setup pass.

Configuration IDs (`EQUITY_CONFIG_ID = bytes32(1)`, `BOND_CONFIG_ID = bytes32(2)`, etc.) come from
`packages/ats/contracts/scripts/domain/constants.ts`, and are also re-exported at runtime from the
installed npm package via `@hashgraph/asset-tokenization-contracts/scripts` — the script imports
them from there directly rather than hardcoding, along with the `ATS_ROLES` role-hash map,
`RegulationType`/`RegulationSubType` enums, and `GAS_LIMIT` constants.

## Design notes / why this approach

- **Bypasses the `@hashgraph/asset-tokenization-sdk` package on purpose.** That SDK's transaction
  layer (`RPCTransactionAdapter` → `MetamaskService`) is hard-wired to a browser-injected
  `window.ethereum` provider (it calls `@metamask/detect-provider` and requires
  `ethProvider.isMetaMask === true`). There is no supported headless/private-key signing path in
  the current SDK (`SupportedWallets` only lists `METAMASK`, `HWALLETCONNECT`, `DFNS`,
  `Fireblocks`, `AWSKMS` — a raw-key `CLIENT` mode exists in the source only as a commented-out
  enum value). Rather than shimming a fake `window.ethereum` object to trick the SDK, this script
  calls the same underlying contracts directly with `ethers` v6 + the typechain bindings and
  `/scripts` helper constants published by `@hashgraph/asset-tokenization-contracts` — the exact
  same calls the SDK itself makes under the hood (confirmed by reading
  `RPCTransactionAdapter.ts`'s `createBond`/`transfer`/etc., which are thin wrappers over
  `Factory__factory` / `IAsset__factory`). This is a much smaller, more reliable dependency
  surface for a headless script and matches CLAUDE.md's "boring, reliable infrastructure" bias.
- **Bond, not equity.** Bond deployment needs no counterparty proceed-recipient wiring to reach a
  working state, and matches "tokenized short-term note" from the task directly.
- **KYC grant + compliant transfer, not pause/unpause.** Both are one operator-executable
  transaction pair, but KYC + transfer more directly demonstrates "compliance-gated RWA
  collateral" for the Firewall Margin story (see `docs/architecture.md` at the repo root, which
  already commits to this choice). The script still grants itself `ROLE_PAUSER` at deploy time in
  case pause/unpause is wanted later as a second lifecycle op — it's a one-line addition to call.
- **`isWhiteList: false`.** The Solidity control-list gate (`ControlListStorageWrapper
  .isAbleToAccess`) is `isWhiteList == list.contains(account)`. With `isWhiteList: true` you'd
  additionally need to explicitly add every address to an on-chain control list before it could
  hold tokens. With `isWhiteList: false` (blacklist mode) and nobody ever blacklisted, every
  address passes that gate by default, leaving `internalKycActivated: true` as the sole, real
  compliance check — one less moving part, same enforced-on-chain guarantee.
  `compliance`/`identityRegistry` are left at `address(0)` (external ERC-3643 compliance/identity
  modules disabled) — verified in `ERC1594StorageWrapper`/`LowLevelCall.functionStaticCall` that a
  zero address there is explicitly special-cased to short-circuit as "no restriction," not call
  into a non-existent contract.
- **Version lookup uses `getLatestVersionByConfiguration`, not `getLatestVersion`.** These are two
  different functions on the resolver with different key namespaces (facet business-logic keys
  vs. factory configuration ids) — calling the wrong one silently returns `0` instead of
  reverting, which would have been a nasty runtime surprise. Caught and verified live against
  testnet during this setup pass (see `IDiamondCutManager.sol` / `IBusinessLogicResolver.sol`).
- **ISIN** uses `US0378331005` — the same placeholder value the ATS team's own reference deploy
  scripts (`packages/ats/contracts/scripts/domain/factory/deployBondToken.ts` and siblings) use in
  their examples; it has a valid ISIN checksum, which the Solidity factory validates on-chain.

## Files

- `issue-asset.ts` — the script described above. Self-contained; run with `npm run issue-asset`.
- `package.json` / `tsconfig.json` — minimal Node/TS project (`ethers` v6,
  `@hashgraph/asset-tokenization-contracts`, `@hashgraph/sdk` for private-key normalization,
  `dotenv`, `tsx` to run the `.ts` file directly without a build step).
- `issued-asset.json` — generated after a successful run (gitignored; contains the throwaway
  investor demo private key, not sensitive but not meant to be committed).

No full monorepo clone of `hashgraph/asset-tokenization-studio` was needed or added here — the
published `@hashgraph/asset-tokenization-contracts@8.0.0` npm package already exports everything
required (typechain ABIs via the package root, and the reference deployment helpers/constants via
its `/scripts` subpath export). The full repo was cloned to a scratch location only to inspect
source code, deployment records, and docs while researching the addresses/roles above; nothing
from that clone is copied into this project.
