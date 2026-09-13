import path from "path";
import dotenv from "dotenv";

// Shared secrets live in the repo-root .env (see /.env.example), not app/.env —
// every other piece of this project (contracts-sepolia, contracts-hedera,
// cre-workflow) reads from the same place.
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

export const env = {
  sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL,
  sepoliaDeployerKey: process.env.SEPOLIA_DEPLOYER_KEY,
  sepoliaVault: process.env.SEPOLIA_VAULT,
  sepoliaCollateral: process.env.SEPOLIA_MOCK_COLLATERAL,
  sepoliaDebt: process.env.SEPOLIA_MOCK_DEBT,
  sepoliaExecutor: process.env.SEPOLIA_EXECUTOR,
  demoAccount: process.env.DEMO_ACCOUNT,
  hederaNetwork: process.env.HEDERA_NETWORK || "testnet",
  creWorkflowDir: path.resolve(
    process.cwd(),
    "../cre-workflow/firewall-margin-workflow"
  ),
  hederaEvidencePath: path.resolve(
    process.cwd(),
    "../contracts-hedera/issued-asset.json"
  ),
};
