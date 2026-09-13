import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const WAD = 10n ** 18n;
const FIREWALL = 0n;
const POOLED = 1n;

/**
 * The central claim of the product is a counterfactual: the SAME account, the SAME
 * price collapse, the SAME liquidation call produces two different outcomes for the
 * protected asset depending only on the margin mode. These tests are that proof.
 */
describe("CryptoMarginVault — cross-margin with a firewall", () => {
  let owner: HardhatEthersSigner;
  let account: HardhatEthersSigner;
  let executor: HardhatEthersSigner;

  // 10 fmETH @ 2000 = $20,000 crypto, plus a $30,000 attested note (5% haircut -> $28,500)
  const DEPOSIT = ethers.parseUnits("10", 18);
  const PRICE = ethers.parseUnits("2000", 18);
  const NOTE_UNITS = 30_000n;
  const NOTE_VALUE = ethers.parseUnits("30000", 18);

  async function deploy() {
    [owner, account, executor] = await ethers.getSigners();

    const collateral = await (await ethers.getContractFactory("MockCollateral")).deploy();
    const debt = await (await ethers.getContractFactory("MockDebt")).deploy();
    const registry = await (
      await ethers.getContractFactory("ProtectedCollateralRegistry")
    ).deploy();
    const vault = await (
      await ethers.getContractFactory("CryptoMarginVault")
    ).deploy(await collateral.getAddress(), await debt.getAddress(), PRICE);

    // In production the executor contract holds both roles; a signer stands in here so
    // the vault's own logic can be tested without the CRE report plumbing.
    await vault.setExecutor(executor.address);
    await vault.setRegistry(await registry.getAddress());
    await registry.setAttestor(executor.address);
    await registry.setVault(await vault.getAddress());

    await collateral.connect(account).faucet(DEPOSIT);
    await collateral.connect(account).approve(await vault.getAddress(), DEPOSIT);
    await vault.connect(account).deposit(DEPOSIT);

    return { collateral, debt, registry, vault };
  }

  it("recognises the attested Hedera note as borrowing power", async () => {
    const { vault, registry } = await deploy();

    expect(await vault.totalCollateralValue(account.address)).to.equal(
      ethers.parseUnits("20000", 18)
    );

    await registry
      .connect(executor)
      .attest(account.address, ethers.Wallet.createRandom().address, NOTE_UNITS, NOTE_VALUE);

    // $20,000 crypto + $30,000 * 95% haircut = $48,500
    expect(await vault.protectedValue(account.address)).to.equal(
      ethers.parseUnits("28500", 18)
    );
    expect(await vault.totalCollateralValue(account.address)).to.equal(
      ethers.parseUnits("48500", 18)
    );

    // Borrowing power now exceeds what the crypto leg alone could support: this is the
    // cross-margin the firewall exists to protect.
    await vault.connect(account).borrow(ethers.parseUnits("30000", 18));
    expect(await vault.healthFactor(account.address)).to.be.greaterThan(WAD);
  });

  it("only the executor can write a verdict or an attestation", async () => {
    const { vault, registry } = await deploy();
    await expect(
      vault.connect(account).executeLiquidation(account.address, 1n)
    ).to.be.revertedWithCustomError(vault, "NotExecutor");
    await expect(
      vault.connect(account).setBorrowingRestriction(account.address, true)
    ).to.be.revertedWithCustomError(vault, "NotExecutor");
    await expect(
      registry.connect(account).attest(account.address, account.address, 1n, 1n)
    ).to.be.revertedWithCustomError(registry, "NotAttestor");
  });

  it("a restriction blocks new borrowing without seizing anything", async () => {
    const { vault, registry } = await deploy();
    await registry
      .connect(executor)
      .attest(account.address, ethers.Wallet.createRandom().address, NOTE_UNITS, NOTE_VALUE);
    await vault.connect(account).borrow(ethers.parseUnits("10000", 18));

    const before = await vault.positions(account.address);
    await vault.connect(executor).setBorrowingRestriction(account.address, true);

    await expect(
      vault.connect(account).borrow(ethers.parseUnits("1", 18))
    ).to.be.revertedWithCustomError(vault, "BorrowingRestricted");

    const after = await vault.positions(account.address);
    expect(after.collateral).to.equal(before.collateral);
    expect(after.debt).to.equal(before.debt);
    expect(await registry.marginValueOf(account.address)).to.equal(NOTE_VALUE);
  });

  describe("the same crash, both modes", () => {
    /** Borrow against both legs, then collapse the crypto price. */
    async function stressed(mode: bigint) {
      const ctx = await deploy();
      const { vault, registry } = ctx;
      const hederaToken = ethers.Wallet.createRandom().address;
      await registry.connect(executor).attest(account.address, hederaToken, NOTE_UNITS, NOTE_VALUE);
      await vault.connect(account).setMarginMode(mode);
      await vault.connect(account).borrow(ethers.parseUnits("30000", 18));

      // fmETH 2000 -> 200. Crypto collateral is now $2,000 against $30,000 of debt:
      // the crypto bucket cannot possibly cover the liquidation on its own.
      await vault.setPrice(ethers.parseUnits("200", 18));
      expect(await vault.healthFactor(account.address)).to.be.lessThan(WAD);
      return ctx;
    }

    it("pooled margin reaches across and seizes the protected claim", async () => {
      const { vault, registry } = await stressed(POOLED);

      await expect(
        vault.connect(executor).executeLiquidation(account.address, ethers.parseUnits("30000", 18))
      ).to.emit(vault, "ProtectedCollateralSeized");

      // Contamination: the note's margin claim is gone and it no longer belongs to the account.
      expect(await registry.marginValueOf(account.address)).to.equal(0n);
      const attestation = await registry.attestationOf(account.address);
      expect(attestation.claimSeized).to.equal(true);
      expect(attestation.claimHolder).to.equal(executor.address);
    });

    it("the firewall stops the same liquidation at the crypto bucket", async () => {
      const { vault, registry } = await stressed(FIREWALL);
      const before = await registry.attestationOf(account.address);

      await expect(
        vault.connect(executor).executeLiquidation(account.address, ethers.parseUnits("30000", 18))
      ).to.emit(vault, "ProtectedCollateralPreserved");

      // The crypto leg was liquidated in full...
      expect((await vault.positions(account.address)).collateral).to.equal(0n);
      // ...and the protected asset is untouched: same units, same holder, not seized.
      const after = await registry.attestationOf(account.address);
      expect(after.claimSeized).to.equal(false);
      expect(after.claimHolder).to.equal(account.address);
      expect(after.units).to.equal(before.units);
      expect(await registry.marginValueOf(account.address)).to.equal(NOTE_VALUE);

      // What the firewall does instead of seizing: it withdraws the note's borrowing
      // power and stops new debt. A restriction, not a seizure.
      expect(await vault.protectedRecognitionRevoked(account.address)).to.equal(true);
      expect(await vault.protectedValue(account.address)).to.equal(0n);
      expect(await vault.borrowingRestricted(account.address)).to.equal(true);
    });

    it("previewLiquidation shows both outcomes before anything is executed", async () => {
      const { vault, registry } = await stressed(FIREWALL);
      const snapshot = await registry.attestationOf(account.address);

      const [cryptoSeized, shortfall, pooledTakes, firewallTakes] =
        await vault.previewLiquidation(account.address, ethers.parseUnits("30000", 18));

      expect(cryptoSeized).to.equal(ethers.parseUnits("2000", 18)); // the whole crypto bucket
      expect(shortfall).to.be.greaterThan(0n);
      expect(pooledTakes).to.be.greaterThan(0n); // pooled would take this much of the note
      expect(firewallTakes).to.equal(0n); // the firewall takes none of it, ever

      // A preview must not move state.
      expect(await registry.attestationOf(account.address)).to.deep.equal(snapshot);
    });
  });

  it("a healthy account cannot be liquidated in either mode", async () => {
    const { vault, registry } = await deploy();
    await registry
      .connect(executor)
      .attest(account.address, ethers.Wallet.createRandom().address, NOTE_UNITS, NOTE_VALUE);
    await vault.connect(account).borrow(ethers.parseUnits("10000", 18));

    await expect(
      vault.connect(executor).executeLiquidation(account.address, ethers.parseUnits("10000", 18))
    ).to.be.revertedWithCustomError(vault, "PositionHealthy");
  });
});
