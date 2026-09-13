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

Copy the printed `SEPOLIA_MOCK_COLLATERAL` / `SEPOLIA_MOCK_DEBT` / `SEPOLIA_VAULT`
addresses into `../.env`.

## Demo trigger

Once deployed, crash the price on cue during the recorded demo:

```bash
SEPOLIA_VAULT=0x... npm run demo:trigger-stress
```

This drops the health factor below 1, making the crypto leg eligible for the CRE
workflow's `executeLiquidation` call — while the RWA leg on Hedera is untouched by
construction (different contract, different chain, no shared custody).
