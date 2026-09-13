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
  // Confirmed via Chainlink's own Forwarder Directory (docs.chain.link/cre/guides/workflow/
  // using-evm-client/forwarder-directory-ts) as of this setup pass:
  //   - Production (real DON-delivered reports):      0xF8344CFd5c43616a4366C34E3EEE75af79a74482
  //   - Local `cre workflow simulate` w/ onchain.enabled (MockKeystoneForwarder):
  //                                                     0x15fC6ae953E024d975e77382eEeC56A9101f9F88
  // Re-verify against that page before a real deploy in case Chainlink rotates it.
  const PRODUCTION_FORWARDER = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482";
  const forwarderAddress = process.env.SEPOLIA_CRE_FORWARDER || PRODUCTION_FORWARDER;

  const Executor = await ethers.getContractFactory("FirewallMarginExecutor");
  const executor = await Executor.deploy(forwarderAddress, await vault.getAddress());
  await executor.waitForDeployment();
  console.log("FirewallMarginExecutor:", await executor.getAddress());
  console.log("  forwarder:", forwarderAddress);

  const tx = await vault.setExecutor(await executor.getAddress());
  await tx.wait();
  console.log("Vault executor wired to FirewallMarginExecutor.");

  console.log("\nSet these in your .env:");
  console.log(`SEPOLIA_MOCK_COLLATERAL=${await collateral.getAddress()}`);
  console.log(`SEPOLIA_MOCK_DEBT=${await debt.getAddress()}`);
  console.log(`SEPOLIA_VAULT=${await vault.getAddress()}`);
  console.log(`SEPOLIA_EXECUTOR=${await executor.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
