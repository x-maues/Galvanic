import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

describe("FirewallMarginExecutor (CRE report -> vault liquidation)", function () {
  async function deployFixture() {
    const [owner, forwarder, user] = await ethers.getSigners();

    const MockCollateral = await ethers.getContractFactory("MockCollateral");
    const collateral = await MockCollateral.deploy();
    const MockDebt = await ethers.getContractFactory("MockDebt");
    const debt = await MockDebt.deploy();

    const initialPrice = ethers.parseUnits("2000", 18);
    const Vault = await ethers.getContractFactory("CryptoMarginVault");
    const vault = await Vault.deploy(
      await collateral.getAddress(),
      await debt.getAddress(),
      initialPrice
    );

    const Executor = await ethers.getContractFactory("FirewallMarginExecutor");
    const executor = await Executor.deploy(forwarder.address, await vault.getAddress());
    await vault.setExecutor(await executor.getAddress());

    await collateral.connect(user).faucet(ethers.parseUnits("10", 18));
    await collateral
      .connect(user)
      .approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(user).deposit(ethers.parseUnits("5", 18));
    await vault.connect(user).borrow(ethers.parseUnits("7000", 18));

    return { owner, forwarder, user, collateral, debt, vault, executor };
  }

  function encodeVerdict(liquidate: boolean, account: string, amountUsd: bigint) {
    return AbiCoder.defaultAbiCoder().encode(
      ["bool", "address", "uint256"],
      [liquidate, account, amountUsd]
    );
  }

  it("rejects reports from anyone other than the configured forwarder", async function () {
    const { user, executor } = await deployFixture();
    const report = encodeVerdict(true, user.address, 1000n);
    await expect(
      executor.connect(user).onReport("0x", report)
    ).to.be.revertedWithCustomError(executor, "InvalidSender");
  });

  it("a hold verdict changes nothing", async function () {
    const { forwarder, user, vault, executor } = await deployFixture();
    const before = await vault.positions(user.address);
    const report = encodeVerdict(false, user.address, 0n);
    await executor.connect(forwarder).onReport("0x", report);
    const after = await vault.positions(user.address);
    expect(after.debt).to.equal(before.debt);
    expect(after.collateral).to.equal(before.collateral);
  });

  it("a liquidate verdict from the forwarder drives a real, gated liquidation on the vault", async function () {
    const { forwarder, user, vault, executor } = await deployFixture();

    // stress the position so it's actually liquidatable — the executor doesn't
    // decide this, it only delivers what the (simulated) TEE already decided
    await vault.setPrice(ethers.parseUnits("1000", 18));
    expect(await vault.healthFactor(user.address)).to.be.lt(ethers.parseUnits("1", 18));

    const report = encodeVerdict(true, user.address, 1000n); // $1000 of debt
    await expect(executor.connect(forwarder).onReport("0x", report))
      .to.emit(vault, "Liquidated")
      .and.to.emit(executor, "VerdictReceived");

    const pos = await vault.positions(user.address);
    expect(pos.debt).to.equal(ethers.parseUnits("6000", 18)); // 7000 - 1000
  });
});
