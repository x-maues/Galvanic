/**
 * Firewall Margin — Hedera ATS asset issuance + lifecycle script.
 *
 * Issues ONE real security token (a short-term bond / "note") on Hedera testnet
 * via the already-deployed Asset Tokenization Studio (ATS) Factory + Business
 * Logic Resolver (BLR), then performs a real on-chain lifecycle operation:
 *
 *   1. Deploy a Bond through the ATS Factory (diamond-proxy security token).
 *   2. Register the operator as a trusted KYC issuer (SSI Management facet).
 *   3. Grant the operator itself KYC (required to hold/mint balance).
 *   4. Issue (mint) the initial supply to the operator (ERC-1594 `issue`).
 *   5. Grant KYC to a freshly generated "investor" EVM address.
 *   6. Perform a KYC-gated compliant transfer of units to that investor.
 *
 * This demonstrates the protected-RWA leg of the "Firewall Margin" demo:
 * a real, compliance-gated tokenized asset whose lifecycle is enforced
 * on-chain (KYC required to receive units — not just decorative).
 *
 * ---------------------------------------------------------------------------
 * Where the addresses/config below came from (see README.md for detail):
 *   - Hedera ATS GitHub repo: hashgraph/asset-tokenization-studio
 *   - apps/ats/web/.env.example (REACT_APP_RPC_RESOLVER / REACT_APP_RPC_FACTORY)
 *   - packages/ats/contracts/deployments/hedera-testnet/newBlr-2026-06-12T*.json
 *     (infrastructure.blr.proxyContractId / infrastructure.factory.proxyContractId)
 *   - packages/ats/contracts/scripts/domain/constants.ts (config IDs, roles)
 *   - Both independent sources agree, and match @hashgraph/asset-tokenization-
 *     contracts@8.0.0 (the npm version this script is pinned to).
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   npm install
 *   cp ../.env.example ../.env   # then fill in HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY
 *   npm run issue-asset
 */

import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { PrivateKey } from "@hashgraph/sdk";
import {
  Factory__factory,
  IAsset__factory,
  IBusinessLogicResolver__factory,
} from "@hashgraph/asset-tokenization-contracts";

// Reuse the ATS team's own published config/role constants rather than
// re-declaring magic numbers/hashes by hand.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const atsScripts = require("@hashgraph/asset-tokenization-contracts/scripts");
const ATS_ROLES: Record<string, string> = atsScripts.ATS_ROLES;
const BOND_CONFIG_ID: string = atsScripts.BOND_CONFIG_ID;
const DEFAULT_PARTITION: string = atsScripts.DEFAULT_PARTITION;
const RegulationType: Record<string, number> = atsScripts.RegulationType;
const RegulationSubType: Record<string, number> = atsScripts.RegulationSubType;
const GAS_LIMIT: { high: number } = atsScripts.GAS_LIMIT;

// -----------------------------------------------------------------------------
// 0. Load environment
// -----------------------------------------------------------------------------

// The project's real .env lives at the repo root (one level up from this
// package), per /home/maues/mrgix/.env.example. Fall back to a local .env in
// this directory too, in case someone prefers to keep it here instead.
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const HEDERA_NETWORK = process.env.HEDERA_NETWORK || "testnet";
const HEDERA_JSON_RPC_URL = requireEnv("HEDERA_JSON_RPC_URL", "https://testnet.hashio.io/api");
const HEDERA_MIRROR_NODE_URL =
  process.env.HEDERA_MIRROR_NODE_URL || "https://testnet.mirrornode.hedera.com/api/v1/";
const HEDERA_OPERATOR_ID = requireEnv("HEDERA_OPERATOR_ID");
const HEDERA_OPERATOR_KEY = requireEnv("HEDERA_OPERATOR_KEY");

// Verified testnet deployment for @hashgraph/asset-tokenization-contracts@8.0.0
// (see README.md "Where these addresses came from"). Overridable via env in
// case the ATS team redeploys a newer BLR/Factory before the hackathon.
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "0xd1F118A40f3b02883D35909eF2517e7EDd78379d"; // 0.0.9213391
const RESOLVER_ADDRESS = process.env.RESOLVER_ADDRESS || "0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a"; // 0.0.9212226

const HASHSCAN_BASE = `https://hashscan.io/${HEDERA_NETWORK}`;

// -----------------------------------------------------------------------------
// 1. Small helpers
// -----------------------------------------------------------------------------

/** Normalize a Hedera ECDSA private key (raw hex or DER-encoded) to an ethers-compatible 0x-prefixed hex string. */
function toEthersPrivateKey(hederaKey: string): string {
  const key = PrivateKey.fromStringECDSA(hederaKey.trim());
  return "0x" + key.toStringRaw();
}

/** Encode a 3-letter ISO 4217 currency code as a Solidity `bytes3` value. */
function bytes3(code: string): string {
  if (code.length !== 3) throw new Error(`Currency code must be exactly 3 characters, got "${code}"`);
  return "0x" + Buffer.from(code, "ascii").toString("hex");
}

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

function hashscanTx(hash: string): string {
  return `${HASHSCAN_BASE}/transaction/${hash}`;
}

function hashscanContract(evmAddress: string): string {
  return `${HASHSCAN_BASE}/contract/${evmAddress}`;
}

function hashscanAddress(evmAddress: string): string {
  return `${HASHSCAN_BASE}/address/${evmAddress}`;
}

// -----------------------------------------------------------------------------
// 2. Asset parameters — a short-term tokenized note (bond)
// -----------------------------------------------------------------------------

const NOW = Math.floor(Date.now() / 1000);
const MATURITY_SECONDS = 180 * 24 * 60 * 60; // ~6 months

const ASSET = {
  name: "Firewall Margin Short-Term Note",
  symbol: "FWM-NOTE",
  isin: "US0378331005", // placeholder ISIN with a valid checksum (same one ATS's own example deploy scripts use)
  decimals: 2,
  currency: bytes3("USD"),
  nominalValue: "1000", // 10.00 (2 decimals)
  nominalValueDecimals: 2,
  startingDate: NOW,
  maturityDate: NOW + MATURITY_SECONDS,
};

const INITIAL_SUPPLY = 100_000n; // base units (100,000 * 10^-2 = 1,000.00 notes)
const TRANSFER_AMOUNT = 1_000n; // base units transferred to the investor address

// -----------------------------------------------------------------------------
// 3. Main
// -----------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(78));
  console.log("Firewall Margin — Hedera ATS asset issuance");
  console.log("=".repeat(78));

  const provider = new ethers.JsonRpcProvider(HEDERA_JSON_RPC_URL, undefined, {
    staticNetwork: true,
    batchMaxCount: 1, // Hashio rate-limits batched eth_call; keep requests sequential.
  });
  const wallet = new ethers.Wallet(toEthersPrivateKey(HEDERA_OPERATOR_KEY), provider);

  log("SETUP", `Network:          ${HEDERA_NETWORK}`);
  log("SETUP", `JSON-RPC relay:   ${HEDERA_JSON_RPC_URL}`);
  log("SETUP", `Operator account: ${HEDERA_OPERATOR_ID}`);
  log("SETUP", `Operator EVM addr:${wallet.address}`);
  log("SETUP", `Factory:          ${FACTORY_ADDRESS} (${hashscanContract(FACTORY_ADDRESS)})`);
  log("SETUP", `BLR / Resolver:   ${RESOLVER_ADDRESS} (${hashscanContract(RESOLVER_ADDRESS)})`);

  // Cross-check HEDERA_OPERATOR_ID against the mirror node and make sure its EVM address
  // matches the key we just derived. Hashio (the JSON-RPC relay) requires the `from` account
  // of any call to already exist on the ledger ("Sender account not found" otherwise), so a
  // mismatched id/key pair is a common mistake worth catching here with a clear message
  // instead of a cryptic relay error later.
  try {
    const res = await fetch(`${HEDERA_MIRROR_NODE_URL.replace(/\/$/, "")}/accounts/${HEDERA_OPERATOR_ID}`);
    if (res.ok) {
      const info = (await res.json()) as { evm_address?: string };
      const mirrorEvmAddress = (info.evm_address || "").toLowerCase();
      if (mirrorEvmAddress && mirrorEvmAddress !== wallet.address.toLowerCase()) {
        throw new Error(
          `HEDERA_OPERATOR_ID ${HEDERA_OPERATOR_ID} resolves to EVM address ${mirrorEvmAddress} on the ` +
            `mirror node, but HEDERA_OPERATOR_KEY derives ${wallet.address}. Double-check the account ` +
            `id/key pair in .env.`,
        );
      }
      log("SETUP", `Mirror node confirms account ${HEDERA_OPERATOR_ID} exists and matches the operator key.`);
    } else if (res.status === 404) {
      throw new Error(
        `HEDERA_OPERATOR_ID ${HEDERA_OPERATOR_ID} was not found on the mirror node (${HEDERA_MIRROR_NODE_URL}). ` +
          `Double-check the account id, or that it exists on ${HEDERA_NETWORK}.`,
      );
    } else {
      log("SETUP", `Mirror node lookup returned HTTP ${res.status}; skipping cross-check.`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("HEDERA_OPERATOR_ID")) throw err;
    log("SETUP", `Mirror node lookup failed (${err}); skipping cross-check and continuing.`);
  }

  const balance = await provider.getBalance(wallet.address);
  log("SETUP", `Operator balance: ${ethers.formatEther(balance)} HBAR (as tinybar-wei via EVM view)`);
  if (balance === 0n) {
    throw new Error(
      "Operator account has zero balance on the JSON-RPC relay. Fund it with testnet HBAR " +
        "(https://portal.hedera.com/faucet) before running this script.",
    );
  }

  const factory = Factory__factory.connect(FACTORY_ADDRESS, wallet);
  const resolver = IBusinessLogicResolver__factory.connect(RESOLVER_ADDRESS, provider);

  // ---------------------------------------------------------------------------
  // Preflight: confirm the Bond configuration version registered on this BLR.
  // The reference ATS deploy scripts hardcode version 1 for a freshly-deployed
  // BLR; we verify that against the live chain instead of assuming it, so a
  // stale hardcoded address doesn't silently deploy against the wrong config.
  // ---------------------------------------------------------------------------
  let bondConfigVersion: number;
  try {
    // NOTE: `getLatestVersion` (no suffix) resolves individual *facet* business-logic
    // keys (e.g. RESOLVER_KEY_KYC) — it is NOT the right call for a factory
    // "configuration" id like BOND_CONFIG_ID and returns 0 for it (verified live
    // against testnet). The correct call for configuration ids is
    // `getLatestVersionByConfiguration`, inherited from IDiamondCutManager.
    const latest: bigint = await resolver.getLatestVersionByConfiguration(BOND_CONFIG_ID);
    bondConfigVersion = Number(latest);
    log("PREFLIGHT", `Bond config (key ${BOND_CONFIG_ID}) latest version on-chain: ${bondConfigVersion}`);
  } catch (err) {
    throw new Error(
      `Could not read getLatestVersionByConfiguration(BOND_CONFIG_ID) from resolver at ${RESOLVER_ADDRESS}. ` +
        `Double-check RESOLVER_ADDRESS / HEDERA_JSON_RPC_URL are correct and reachable. Underlying error: ${err}`,
    );
  }
  if (bondConfigVersion < 1) {
    throw new Error(`Resolver returned an invalid Bond config version: ${bondConfigVersion}`);
  }

  // ---------------------------------------------------------------------------
  // Step 1 — Deploy the bond via the Factory
  // ---------------------------------------------------------------------------
  log("DEPLOY", `Deploying bond "${ASSET.name}" (${ASSET.symbol}) ...`);

  const rbacs = [
    { role: ATS_ROLES.DEFAULT_ADMIN_ROLE, members: [wallet.address] },
    { role: ATS_ROLES.ROLE_SSI_MANAGER, members: [wallet.address] }, // addIssuer
    { role: ATS_ROLES.ROLE_KYC, members: [wallet.address] }, // grantKyc / revokeKyc
    { role: ATS_ROLES.ROLE_ISSUER, members: [wallet.address] }, // issue / mint
    { role: ATS_ROLES.ROLE_PAUSER, members: [wallet.address] }, // pause / unpause (available, not used by default flow below)
  ];

  const securityData = {
    arePartitionsProtected: false,
    isMultiPartition: false, // required: ERC-1594 issue()/mint() only work in single-partition mode
    resolver: RESOLVER_ADDRESS,
    resolverProxyConfiguration: { key: BOND_CONFIG_ID, version: bondConfigVersion },
    rbacs,
    isControllable: true,
    isWhiteList: false, // control-list left in (empty) blacklist mode; KYC is the real compliance gate below
    // "Unlimited" is expressed as type(uint256).max, NOT 0 -- CapStorageWrapper.
    // requireValidNewMaxSupply reverts NewMaxSupplyCannotBeZero() on a literal 0
    // (verified via a static-call revert-selector lookup against the deployed
    // Factory before the real deploy tx: selector 0x76f138fb decodes to
    // ICap.NewMaxSupplyCannotBeZero() in CapStorageWrapper.sol).
    maxSupply: ethers.MaxUint256.toString(),
    erc20MetadataInfo: {
      name: ASSET.name,
      symbol: ASSET.symbol,
      isin: ASSET.isin,
      decimals: ASSET.decimals,
    },
    clearingActive: false,
    internalKycActivated: true, // <- the load-bearing compliance switch for this demo
    externalPauses: [] as string[],
    externalControlLists: [] as string[],
    externalKycLists: [] as string[],
    erc20VotesActivated: false,
    compliance: ethers.ZeroAddress, // no external ERC-3643 compliance module
    identityRegistry: ethers.ZeroAddress, // no external ERC-3643 identity registry
  };

  const bondDetails = {
    currency: ASSET.currency,
    nominalValue: ASSET.nominalValue,
    nominalValueDecimals: ASSET.nominalValueDecimals,
    startingDate: ASSET.startingDate,
    maturityDate: ASSET.maturityDate,
  };

  const bondData = {
    security: securityData,
    bondDetails,
    proceedRecipients: [] as string[],
    proceedRecipientsData: [] as string[],
  };

  const factoryRegulationData = {
    regulationType: RegulationType.REG_S,
    regulationSubType: RegulationSubType.NONE,
    additionalSecurityData: {
      countriesControlListType: false,
      listOfCountries: "",
      info: "Firewall Margin hackathon demo note",
    },
  };

  const deployTx = await factory.deployBond(bondData, factoryRegulationData, {
    gasLimit: GAS_LIMIT.high,
  });
  log("DEPLOY", `Tx sent: ${deployTx.hash}`);
  log("DEPLOY", hashscanTx(deployTx.hash));

  const deployReceipt = await deployTx.wait();
  if (!deployReceipt || deployReceipt.status !== 1) {
    throw new Error(`Bond deployment transaction failed. Receipt: ${JSON.stringify(deployReceipt)}`);
  }

  const bondDeployedEvent = deployReceipt.logs
    .map((l) => {
      try {
        return factory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === "BondDeployed");

  const bondAddress: string | undefined = bondDeployedEvent?.args?.bondAddress;
  if (!bondAddress || bondAddress === ethers.ZeroAddress) {
    throw new Error(
      `Could not find a BondDeployed event with a valid address in the deployment receipt. ` +
        `Logs: ${JSON.stringify(deployReceipt.logs)}`,
    );
  }

  log("DEPLOY", `Bond diamond proxy deployed at: ${bondAddress}`);
  log("DEPLOY", hashscanContract(bondAddress));

  const bond = IAsset__factory.connect(bondAddress, wallet);

  // ---------------------------------------------------------------------------
  // Step 2 — Register operator as a trusted KYC issuer (SSI Management facet)
  // ---------------------------------------------------------------------------
  log("LIFECYCLE 1/5", `Registering operator (${wallet.address}) as a trusted KYC issuer ...`);
  const addIssuerTx = await bond.addIssuer(wallet.address);
  await addIssuerTx.wait();
  log("LIFECYCLE 1/5", `addIssuer confirmed: ${hashscanTx(addIssuerTx.hash)}`);

  // ---------------------------------------------------------------------------
  // Step 3 — Grant the operator itself KYC (needed to hold/mint balance)
  // ---------------------------------------------------------------------------
  const MAX_UINT256 = ethers.MaxUint256;
  log("LIFECYCLE 2/5", `Granting KYC to operator (${wallet.address}) ...`);
  const grantKycSelfTx = await bond.grantKyc(
    wallet.address,
    "firewall-margin-operator-vc",
    0,
    MAX_UINT256,
    wallet.address,
  );
  await grantKycSelfTx.wait();
  log("LIFECYCLE 2/5", `grantKyc(operator) confirmed: ${hashscanTx(grantKycSelfTx.hash)}`);

  // ---------------------------------------------------------------------------
  // Step 4 — Issue (mint) the initial supply to the operator
  // ---------------------------------------------------------------------------
  log("LIFECYCLE 3/5", `Issuing ${INITIAL_SUPPLY} base units to operator ...`);
  const issueTx = await bond.issue(wallet.address, INITIAL_SUPPLY, "0x");
  await issueTx.wait();
  log("LIFECYCLE 3/5", `issue confirmed: ${hashscanTx(issueTx.hash)}`);

  // ---------------------------------------------------------------------------
  // Step 5 — Grant KYC to a freshly generated "investor" address
  // ---------------------------------------------------------------------------
  const investor = ethers.Wallet.createRandom();
  log("LIFECYCLE 4/5", `Generated investor address: ${investor.address} (${hashscanAddress(investor.address)})`);
  log("LIFECYCLE 4/5", `Granting KYC to investor ...`);
  const grantKycInvestorTx = await bond.grantKyc(
    investor.address,
    "firewall-margin-investor-vc",
    0,
    MAX_UINT256,
    wallet.address,
  );
  await grantKycInvestorTx.wait();
  log("LIFECYCLE 4/5", `grantKyc(investor) confirmed: ${hashscanTx(grantKycInvestorTx.hash)}`);

  // ---------------------------------------------------------------------------
  // Step 6 — Perform the compliant transfer
  // ---------------------------------------------------------------------------
  log("LIFECYCLE 5/5", `Transferring ${TRANSFER_AMOUNT} base units to investor (KYC-gated) ...`);
  const transferTx = await bond.transferByPartition(
    DEFAULT_PARTITION,
    { to: investor.address, value: TRANSFER_AMOUNT },
    "0x",
  );
  await transferTx.wait();
  log("LIFECYCLE 5/5", `transferByPartition confirmed: ${hashscanTx(transferTx.hash)}`);

  // ---------------------------------------------------------------------------
  // Verification reads — evidence for the demo
  // ---------------------------------------------------------------------------
  const [onChainName, onChainSymbol, onChainDecimals, operatorBalance, investorBalance, totalSupply] =
    await Promise.all([
      bond.name(),
      bond.symbol(),
      bond.decimals(),
      bond.balanceOfByPartition(DEFAULT_PARTITION, wallet.address),
      bond.balanceOfByPartition(DEFAULT_PARTITION, investor.address),
      bond.totalSupply(),
    ]);

  const evidence = {
    network: HEDERA_NETWORK,
    factoryAddress: FACTORY_ADDRESS,
    resolverAddress: RESOLVER_ADDRESS,
    bondAddress,
    bondHashscan: hashscanContract(bondAddress),
    asset: {
      name: onChainName,
      symbol: onChainSymbol,
      decimals: onChainDecimals.toString(),
      isin: ASSET.isin,
      totalSupply: totalSupply.toString(),
    },
    operator: {
      hederaAccountId: HEDERA_OPERATOR_ID,
      evmAddress: wallet.address,
      balanceOfDefaultPartition: operatorBalance.toString(),
    },
    investor: {
      evmAddress: investor.address,
      privateKey: investor.privateKey, // demo-only throwaway key, safe to log/store locally
      balanceOfDefaultPartition: investorBalance.toString(),
    },
    transactions: {
      deployBond: { hash: deployTx.hash, url: hashscanTx(deployTx.hash) },
      addIssuer: { hash: addIssuerTx.hash, url: hashscanTx(addIssuerTx.hash) },
      grantKycOperator: { hash: grantKycSelfTx.hash, url: hashscanTx(grantKycSelfTx.hash) },
      issue: { hash: issueTx.hash, url: hashscanTx(issueTx.hash) },
      grantKycInvestor: { hash: grantKycInvestorTx.hash, url: hashscanTx(grantKycInvestorTx.hash) },
      transferByPartition: { hash: transferTx.hash, url: hashscanTx(transferTx.hash) },
    },
    generatedAt: new Date().toISOString(),
  };

  const outPath = path.resolve(__dirname, "issued-asset.json");
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));

  console.log("\n" + "=".repeat(78));
  console.log("DONE — real Hedera testnet security token issued + compliant transfer executed");
  console.log("=".repeat(78));
  console.log(`Bond contract:        ${bondAddress}`);
  console.log(`HashScan:             ${hashscanContract(bondAddress)}`);
  console.log(`Total supply:         ${totalSupply.toString()} base units`);
  console.log(`Operator balance:     ${operatorBalance.toString()} base units`);
  console.log(`Investor balance:     ${investorBalance.toString()} base units (transferred, KYC-gated)`);
  console.log(`Evidence written to:  ${outPath}`);
  console.log("=".repeat(78));
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
