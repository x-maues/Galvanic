import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

const REPORT_TYPES = ["uint8", "address", "uint256", "uint256", "uint256", "address"];

/**
 * The executor is the only thing that can turn an enclave report into Sepolia state.
 * It carries two payloads: the Hedera attestation (which creates borrowing power) and
 * the policy action (which may remove it).
 */
describe("FirewallMarginExecutor (CRE report -> attestation + verdict)", function () {
  const HEDERA_TOKEN = "0x96c21F5900f7587549A4207B12232cA752072c25";
  const NOTE_UNITS = 1000n;
  const NOTE_VALUE = ethers.parseUnits("30000", 18);

  async function deployFixture() {
    const [owner, forwarder, user] = await ethers.getSigners();

    const collateral = await (await ethers.getContractFactory("MockCollateral")).deploy();
    const debt = await (await ethers.getContractFactory("MockDebt")).deploy();
    const registry = await (
      await ethers.getContractFactory("ProtectedCollateralRegistry")
    ).deploy();

    const vault = await (
      await ethers.getContractFactory("CryptoMarginVault")
    ).deploy(
      await collateral.getAddress(),
      await debt.getAddress(),
      ethers.parseUnits("2000", 18)
    );

    const executor = await (
      await ethers.getContractFactory("FirewallMarginExecutor")
    ).deploy(forwarder.address, await vault.getAddress(), await registry.getAddress());

    await vault.setExecutor(await executor.getAddress());
    await vault.setRegistry(await registry.getAddress());
    await registry.setAttestor(await executor.getAddress());
    await registry.setVault(await vault.getAddress());

    await collateral.connect(user).faucet(ethers.parseUnits("10", 18));
    await collateral.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(user).deposit(ethers.parseUnits("5", 18));
    await vault.connect(user).borrow(ethers.parseUnits("7000", 18));

    return { owner, forwarder, user, collateral, debt, registry, vault, executor };
  }

  function encodeReport(
    action: number,
    account: string,
    amountUsd: bigint,
    units = NOTE_UNITS,
    valueUsd = NOTE_VALUE,
    token = HEDERA_TOKEN
  ) {
    return AbiCoder.defaultAbiCoder().encode(REPORT_TYPES, [
      action,
      account,
      amountUsd,
      units,
      valueUsd,
      token,
    ]);
  }

  it("rejects reports from anyone other than the configured sender", async function () {
    const { user, executor } = await deployFixture();
    await expect(
      executor.connect(user).onReport("0x", encodeReport(2, user.address, 1000n))
    ).to.be.revertedWithCustomError(executor, "InvalidSender");
  });

  it("writes the enclave's Hedera attestation into the registry", async function () {
    const { forwarder, user, registry, vault, executor } = await deployFixture();

    await expect(executor.connect(forwarder).onReport("0x", encodeReport(0, user.address, 0n)))
      .to.emit(executor, "AttestationApplied")
      .withArgs(user.address, HEDERA_TOKEN, NOTE_UNITS, NOTE_VALUE);

    const attestation = await registry.attestationOf(user.address);
    expect(attestation.units).to.equal(NOTE_UNITS);
    expect(attestation.hederaToken).to.equal(HEDERA_TOKEN);
    expect(attestation.attestedAt).to.be.greaterThan(0n);

    // The attestation is what turns the Hedera note into Sepolia borrowing power.
    expect(await vault.protectedValue(user.address)).to.equal(
      ethers.parseUnits("28500", 18)
    );
  });

  it("a hold verdict changes no position", async function () {
    const { forwarder, user, vault, executor } = await deployFixture();
    const before = await vault.positions(user.address);
    await executor.connect(forwarder).onReport("0x", encodeReport(0, user.address, 0n));
    const after = await vault.positions(user.address);
    expect(after.debt).to.equal(before.debt);
    expect(after.collateral).to.equal(before.collateral);
  });

  it("persists an exposure restriction without liquidating a healthy position", async function () {
    const { forwarder, user, vault, executor } = await deployFixture();
    const before = await vault.positions(user.address);

    await expect(executor.connect(forwarder).onReport("0x", encodeReport(1, user.address, 0n)))
      .to.emit(vault, "BorrowingRestrictionUpdated")
      .withArgs(user.address, true);

    expect(await vault.borrowingRestricted(user.address)).to.equal(true);
    expect((await vault.positions(user.address)).collateral).to.equal(before.collateral);
    await expect(vault.connect(user).borrow(1n)).to.be.revertedWithCustomError(
      vault,
      "BorrowingRestricted"
    );
  });

  it("a liquidate verdict drives a real, gated liquidation and leaves the note alone", async function () {
    const { forwarder, user, vault, registry, executor } = await deployFixture();

    // Attest first, then collapse the crypto price. The executor does not decide any
    // of this — it only applies what the enclave already decided.
    await executor.connect(forwarder).onReport("0x", encodeReport(0, user.address, 0n));
    // The $28,500 of recognised note value lets the account borrow well past what the
    // crypto leg alone could support — then the crypto price collapses 20x.
    await vault.connect(user).borrow(ethers.parseUnits("20000", 18));
    await vault.setPrice(ethers.parseUnits("100", 18));
    expect(await vault.healthFactor(user.address)).to.be.lessThan(ethers.parseUnits("1", 18));

    await expect(executor.connect(forwarder).onReport("0x", encodeReport(2, user.address, 27000n)))
      .to.emit(vault, "Liquidated")
      .and.to.emit(vault, "ProtectedCollateralPreserved")
      .and.to.emit(executor, "VerdictReceived");

    // Firewall is the default mode: the note's claim survives a full crypto wipeout.
    expect((await registry.attestationOf(user.address)).claimSeized).to.equal(false);
    expect(await registry.marginValueOf(user.address)).to.equal(NOTE_VALUE);
  });

  it("a report with no Hedera token skips attestation but still applies the verdict", async function () {
    const { forwarder, user, registry, executor } = await deployFixture();
    await executor
      .connect(forwarder)
      .onReport("0x", encodeReport(1, user.address, 0n, 0n, 0n, ethers.ZeroAddress));
    expect((await registry.attestationOf(user.address)).attestedAt).to.equal(0n);
  });
});
