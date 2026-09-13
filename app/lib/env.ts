import path from "path";
import dotenv from "dotenv";

// Shared configuration lives in the repo-root .env — every other package in this
// project (contracts-sepolia, contracts-hedera, cre-workflow, subgraph) reads the
// same file.
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

export const env = {
  sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL,
  sepoliaDeployerKey: process.env.SEPOLIA_DEPLOYER_KEY,
  sepoliaVault: process.env.SEPOLIA_VAULT,
  sepoliaRegistry: process.env.SEPOLIA_REGISTRY,
  sepoliaCollateral: process.env.SEPOLIA_MOCK_COLLATERAL,
  sepoliaDebt: process.env.SEPOLIA_MOCK_DEBT,
  sepoliaExecutor: process.env.SEPOLIA_EXECUTOR,
  demoAccount: process.env.DEMO_ACCOUNT,
  exposureServerUrl: process.env.EXPOSURE_SERVER_URL || "http://127.0.0.1:8790",
  hederaNetwork: process.env.HEDERA_NETWORK || "testnet",
  hederaBondAddress: process.env.HEDERA_BOND_ADDRESS,
  creWorkflowDir: path.resolve(process.cwd(), "../cre-workflow/firewall-margin-workflow"),
  hederaEvidencePath: path.resolve(process.cwd(), "../contracts-hedera/issued-asset.json"),
};

export const etherscan = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
export const etherscanAddress = (address: string) =>
  `https://sepolia.etherscan.io/address/${address}`;
