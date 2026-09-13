import { ethers } from "hardhat";

/**
 * Point the deployed executor at Chainlink's Sepolia CRE Forwarder, so that only
 * DON-delivered reports are accepted. Run this once Confidential Workflow
 * deployment access is available; nothing else in the system changes.
 */
const CHAINLINK_SEPOLIA_FORWARDER = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482";

async function main() {
  const executorAddress = process.env.SEPOLIA_EXECUTOR;
  if (!executorAddress) throw new Error("Set SEPOLIA_EXECUTOR in env");
  const target = process.env.DON_FORWARDER || CHAINLINK_SEPOLIA_FORWARDER;

  const executor = await ethers.getContractAt("FirewallMarginExecutor", executorAddress);
  const tx = await executor.setForwarderAddress(target);
  await tx.wait();
  console.log(`Executor ${executorAddress} now only accepts reports from ${target}`);
  console.log("tx:", tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
