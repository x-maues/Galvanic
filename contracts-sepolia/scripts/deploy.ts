import { ethers } from "hardhat";

/**
 * Deploys the full Sepolia leg and wires the firewall:
 *
 *   MockCollateral / MockDebt   demo crypto collateral + borrow asset
 *   ProtectedCollateralRegistry recognition of the Hedera ATS holding
 *   CryptoMarginVault           cross-margin account (crypto + recognised RWA)
 *   FirewallMarginExecutor      the only writer of attestations and verdicts
 *
 * The executor's report sender ("forwarder") defaults to the deployer so the
 * verdict produced by the CRE enclave can be relayed on Sepolia during a local
 * demo. Switching to a live DON is one owner call —
 * `executor.setForwarderAddress(<Chainlink Forwarder>)` — and changes nothing
 * about the report bytes or `_processReport`. See scripts/use-don-forwarder.ts.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const collateral = await (await ethers.getContractFactory("MockCollateral")).deploy();
  await collateral.waitForDeployment();
  console.log("MockCollateral (fmETH):", await collateral.getAddress());

  const debt = await (await ethers.getContractFactory("MockDebt")).deploy();
  await debt.waitForDeployment();
  console.log("MockDebt (fmUSD):", await debt.getAddress());

  const registry = await (
    await ethers.getContractFactory("ProtectedCollateralRegistry")
  ).deploy();
  await registry.waitForDeployment();
  console.log("ProtectedCollateralRegistry:", await registry.getAddress());

  // initial price: 1 fmETH = 2000 fmUSD, both 18 decimals -> price scaled by 1e18
  const initialPrice = ethers.parseUnits("2000", 18);
  const vault = await (
    await ethers.getContractFactory("CryptoMarginVault")
  ).deploy(await collateral.getAddress(), await debt.getAddress(), initialPrice);
  await vault.waitForDeployment();
  console.log("CryptoMarginVault:", await vault.getAddress());

  // Chainlink's Sepolia CRE Forwarder, for the live-DON configuration:
  //   0xF8344CFd5c43616a4366C34E3EEE75af79a74482
  // (docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts)
  const forwarderAddress = process.env.SEPOLIA_CRE_FORWARDER || deployer.address;

  const executor = await (
    await ethers.getContractFactory("FirewallMarginExecutor")
  ).deploy(forwarderAddress, await vault.getAddress(), await registry.getAddress());
  await executor.waitForDeployment();
  console.log("FirewallMarginExecutor:", await executor.getAddress());
  console.log("  report sender (forwarder):", forwarderAddress);

  await (await vault.setExecutor(await executor.getAddress())).wait();
  await (await vault.setRegistry(await registry.getAddress())).wait();
  await (await registry.setAttestor(await executor.getAddress())).wait();
  await (await registry.setVault(await vault.getAddress())).wait();
  console.log("Wired: vault.executor, vault.registry, registry.attestor, registry.vault");

  console.log("\nSet these in your .env:");
  console.log(`SEPOLIA_MOCK_COLLATERAL=${await collateral.getAddress()}`);
  console.log(`SEPOLIA_MOCK_DEBT=${await debt.getAddress()}`);
  console.log(`SEPOLIA_REGISTRY=${await registry.getAddress()}`);
  console.log(`SEPOLIA_VAULT=${await vault.getAddress()}`);
  console.log(`SEPOLIA_EXECUTOR=${await executor.getAddress()}`);
  console.log(`SEPOLIA_CRE_FORWARDER=${forwarderAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
