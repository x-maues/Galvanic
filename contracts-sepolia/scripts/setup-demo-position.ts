import { ethers } from "hardhat";

/**
 * One-time setup: faucet-mint collateral to the deployer/demo account, deposit
 * it into the vault, and borrow against it — so the frontend has a real,
 * healthy position to display before "Trigger stress" is clicked.
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  const vaultAddress = process.env.SEPOLIA_VAULT;
  const collateralAddress = process.env.SEPOLIA_MOCK_COLLATERAL;
  if (!vaultAddress || !collateralAddress) {
    throw new Error("Set SEPOLIA_VAULT and SEPOLIA_MOCK_COLLATERAL in env");
  }

  const vault = await ethers.getContractAt("CryptoMarginVault", vaultAddress);
  const collateral = await ethers.getContractAt("MockCollateral", collateralAddress);

  const depositAmount = ethers.parseUnits("10", 18); // 10 fmETH
  const borrowAmount = ethers.parseUnits("12000", 18); // 12,000 fmUSD (60% LTV at price 2000)

  console.log("Faucet-minting collateral to", deployer.address);
  await (await collateral.faucet(depositAmount)).wait();

  console.log("Approving vault...");
  await (await collateral.approve(vaultAddress, depositAmount)).wait();

  console.log("Depositing", ethers.formatUnits(depositAmount, 18), "fmETH...");
  await (await vault.deposit(depositAmount)).wait();

  console.log("Borrowing", ethers.formatUnits(borrowAmount, 18), "fmUSD...");
  await (await vault.borrow(borrowAmount)).wait();

  const hf = await vault.healthFactor(deployer.address);
  console.log("Health factor:", ethers.formatUnits(hf, 18));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
