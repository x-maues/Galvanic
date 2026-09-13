import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const MockCollateral = await ethers.getContractFactory("MockCollateral");
  const collateral = await MockCollateral.deploy();
  await collateral.waitForDeployment();
  console.log("MockCollateral (fmETH):", await collateral.getAddress());

  const MockDebt = await ethers.getContractFactory("MockDebt");
  const debt = await MockDebt.deploy();
  await debt.waitForDeployment();
  console.log("MockDebt (fmUSD):", await debt.getAddress());

  // initial price: 1 fmETH = 2000 fmUSD, both 18 decimals -> price scaled by 1e18
  const initialPrice = ethers.parseUnits("2000", 18);

  const Vault = await ethers.getContractFactory("CryptoMarginVault");
  const vault = await Vault.deploy(
    await collateral.getAddress(),
    await debt.getAddress(),
    initialPrice
  );
  await vault.waitForDeployment();
  console.log("CryptoMarginVault:", await vault.getAddress());

  // The CRE Forwarder is the only address allowed to call FirewallMarginExecutor.onReport.
  // CONFIRM the current Sepolia KeystoneForwarder address at deploy time (see CRE docs /
  // `cre-workflow/README.md`) before relying on the env default below.
  const forwarderAddress = process.env.SEPOLIA_CRE_FORWARDER;
  if (!forwarderAddress) {
    console.log(
      "\nSEPOLIA_CRE_FORWARDER not set — skipping FirewallMarginExecutor deployment.\n" +
        "Set it once you've confirmed the current CRE KeystoneForwarder address for Sepolia, then re-run."
    );
  } else {
    const Executor = await ethers.getContractFactory("FirewallMarginExecutor");
    const executor = await Executor.deploy(forwarderAddress, await vault.getAddress());
    await executor.waitForDeployment();
    console.log("FirewallMarginExecutor:", await executor.getAddress());

    const tx = await vault.setExecutor(await executor.getAddress());
    await tx.wait();
    console.log("Vault executor wired to FirewallMarginExecutor.");
    console.log(`SEPOLIA_EXECUTOR=${await executor.getAddress()}`);
  }

  console.log("\nSet these in your .env:");
  console.log(`SEPOLIA_MOCK_COLLATERAL=${await collateral.getAddress()}`);
  console.log(`SEPOLIA_MOCK_DEBT=${await debt.getAddress()}`);
  console.log(`SEPOLIA_VAULT=${await vault.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
