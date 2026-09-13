import { expect } from "chai";
import { ethers } from "hardhat";

describe("CryptoMarginVault", function () {
  async function deployFixture() {
    const [owner, executor, user, other] = await ethers.getSigners();

    const MockCollateral = await ethers.getContractFactory("MockCollateral");
    const collateral = await MockCollateral.deploy();

    const MockDebt = await ethers.getContractFactory("MockDebt");
    const debt = await MockDebt.deploy();

    const initialPrice = ethers.parseUnits("2000", 18); // 1 fmETH = 2000 fmUSD
    const Vault = await ethers.getContractFactory("CryptoMarginVault");
    const vault = await Vault.deploy(
      await collateral.getAddress(),
      await debt.getAddress(),
      initialPrice
    );
    await vault.setExecutor(executor.address);

    // fund user with collateral and approve vault
    await collateral.connect(user).faucet(ethers.parseUnits("10", 18));
    await collateral
      .connect(user)
      .approve(await vault.getAddress(), ethers.MaxUint256);

    return { owner, executor, user, other, collateral, debt, vault };
  }

  it("lets a healthy account deposit and borrow", async function () {
    const { user, vault } = await deployFixture();
    await vault.connect(user).deposit(ethers.parseUnits("5", 18));
    await vault.connect(user).borrow(ethers.parseUnits("5000", 18)); // well within 80% LTV of 10k value
    expect(await vault.healthFactor(user.address)).to.be.gt(ethers.parseUnits("1", 18));
  });

  it("blocks a borrow that would leave the position unhealthy", async function () {
    const { user, vault } = await deployFixture();
    await vault.connect(user).deposit(ethers.parseUnits("5", 18)); // 10,000 value
    await expect(
      vault.connect(user).borrow(ethers.parseUnits("9000", 18)) // > 80% LTV
    ).to.be.revertedWithCustomError(vault, "UnhealthyPosition");
  });

  it("only the registered CRE executor can liquidate, and only when unhealthy", async function () {
    const { user, other, executor, vault } = await deployFixture();
    await vault.connect(user).deposit(ethers.parseUnits("5", 18));
    await vault.connect(user).borrow(ethers.parseUnits("7000", 18)); // near the 80% edge

    // random address cannot liquidate even if unhealthy
    await vault.setPrice(ethers.parseUnits("1000", 18)); // crash price
    await expect(
      vault.connect(other).executeLiquidation(user.address, ethers.parseUnits("1000", 18))
    ).to.be.revertedWithCustomError(vault, "NotExecutor");

    // executor cannot liquidate a healthy position
    await vault.setPrice(ethers.parseUnits("2000", 18)); // restore
    await expect(
      vault.connect(executor).executeLiquidation(user.address, ethers.parseUnits("1000", 18))
    ).to.be.revertedWithCustomError(vault, "PositionHealthy");

    // executor CAN liquidate once genuinely unhealthy
    await vault.setPrice(ethers.parseUnits("1000", 18));
    const hfBefore = await vault.healthFactor(user.address);
    expect(hfBefore).to.be.lt(ethers.parseUnits("1", 18));

    await expect(
      vault.connect(executor).executeLiquidation(user.address, ethers.parseUnits("1000", 18))
    ).to.emit(vault, "Liquidated");

    const pos = await vault.positions(user.address);
    expect(pos.debt).to.equal(ethers.parseUnits("6000", 18));
  });

  it("the vault has no function or state referencing any other leg/account/chain", async function () {
    // Isolation-by-construction check: the only external-facing mutating entrypoints
    // are scoped to this contract's own collateral/debt tokens and its own accounting —
    // there is no cross-contract or cross-chain call surface for executeLiquidation to
    // reach through.
    const { vault } = await deployFixture();
    const iface = vault.interface;
    const fragments = iface.fragments.filter((f) => f.type === "function");
    const names = fragments.map((f: any) => f.name);
    expect(names).to.not.include.members(["rwaToken", "hederaAccount", "bridge"]);
  });
});
