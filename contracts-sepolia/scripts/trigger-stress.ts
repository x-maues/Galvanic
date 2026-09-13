import { ethers } from "hardhat";

/**
 * Deterministic demo trigger: crashes the mock collateral price so the account's
 * health factor drops below 1, making it eligible for the CRE workflow to liquidate
 * the crypto leg. Run this live during the demo recording.
 *
 * Usage: VAULT=0x... hardhat run scripts/trigger-stress.ts --network sepolia
 */
async function main() {
  const vaultAddress = process.env.SEPOLIA_VAULT;
  if (!vaultAddress) throw new Error("Set SEPOLIA_VAULT in env");

  const vault = await ethers.getContractAt("CryptoMarginVault", vaultAddress);
  const before = await vault.price();
  console.log("Price before:", before.toString());

  const crashed = (before * 40n) / 100n; // -60%
  const tx = await vault.setPrice(crashed);
  await tx.wait();

  console.log("Price after crash:", crashed.toString());
  console.log("Stress triggered — crypto leg should now be liquidatable.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
