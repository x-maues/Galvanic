# Crypto margin leg — Sepolia

The liquid, liquidatable leg of a Firewall Margin account. Deliberately dumb and small:
deposit/borrow/withdraw/repay against a mock collateral/debt pair, a demo-operator-settable
price (stand-in for a live feed, so the demo can trigger stress on cue), and a single
`executeLiquidation` entrypoint gated to the CRE workflow's onchain executor address.

Status: compiles clean, full local test suite passing (`npx hardhat test`) — see
`test/CryptoMarginVault.test.ts`. Not yet deployed to Sepolia testnet (needs
`SEPOLIA_RPC_URL` + `SEPOLIA_DEPLOYER_KEY` in the repo-root `.env`).

## Setup

```bash
cd contracts-sepolia
npm install
npx hardhat compile
npx hardhat test
```

## Deploy to Sepolia

Fill in `SEPOLIA_RPC_URL` and `SEPOLIA_DEPLOYER_KEY` in `../.env`, then:

```bash
npm run deploy:sepolia
```

This deploys the mock tokens, the vault, and `FirewallMarginExecutor` — wired to the
vault as its `creExecutor` and to the confirmed production CRE KeystoneForwarder for
Sepolia (`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`, from Chainlink's own Forwarder
Directory) by default. Override with `SEPOLIA_CRE_FORWARDER` in `.env` if you need the
`MockKeystoneForwarder` instead (`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`, for
onchain delivery under local `cre workflow simulate`).

Copy the printed `SEPOLIA_MOCK_COLLATERAL` / `SEPOLIA_MOCK_DEBT` / `SEPOLIA_VAULT` /
`SEPOLIA_EXECUTOR` addresses into `../.env`.

## Demo trigger

Once deployed, crash the price on cue during the recorded demo:

```bash
SEPOLIA_VAULT=0x... npm run demo:trigger-stress
```

This drops the health factor below 1, making the crypto leg eligible for the CRE
workflow's `executeLiquidation` call — while the RWA leg on Hedera is untouched by
construction (different contract, different chain, no shared custody).
