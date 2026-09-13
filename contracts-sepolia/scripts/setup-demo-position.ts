import { ethers } from "hardhat";

/**
 * Brings the demo account to its starting state, using live data throughout:
 *
 *   1. mark fmETH at the live ETH price The Graph reports across Aave, Compound
 *      and Spark (median of a standardized-schema field, not a hardcoded number);
 *   2. attest the account's Hedera ATS note balance, read from the Hedera mirror
 *      node, into the ProtectedCollateralRegistry;
 *   3. deposit crypto collateral and borrow against BOTH legs — deliberately more
 *      than the crypto leg alone could support, so the note is visibly doing work.
 *
 * Step 2 is a bootstrap: it delivers the same report shape the CRE workflow
 * produces, through the same executor entry point, so the account is usable before
 * the first scheduled enclave run. Every later run re-attests from inside the TEE.
 */

const GRAPH_URL = process.env.EXPOSURE_SERVER_URL ?? "http://127.0.0.1:8790";
const MIRROR = process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";

const DEPOSIT = ethers.parseUnits("10", 18); // 10 fmETH
const BORROW = ethers.parseUnits("35000", 18); // $35,000 — unpayable by crypto alone

async function liveEthPrice(account: string): Promise<bigint> {
  const res = await fetch(`${GRAPH_URL}/firewall-margin/exposure?account=${account}`);
  if (!res.ok) throw new Error(`Graph service returned HTTP ${res.status} — is \`bun server.ts\` running in subgraph/?`);
  const data = (await res.json()) as { collateral_price_usd?: number };
  if (!data.collateral_price_usd) throw new Error("Graph service returned no collateral price");
  return ethers.parseUnits(data.collateral_price_usd.toFixed(6), 18);
}

async function hederaNoteUnits(token: string, holder: string): Promise<bigint> {
  const iface = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
  const res = await fetch(`${MIRROR}/contracts/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      block: "latest",
      to: token,
      data: iface.encodeFunctionData("balanceOf", [holder]),
    }),
  });
  if (!res.ok) throw new Error(`Hedera mirror node returned HTTP ${res.status}`);
  const { result } = (await res.json()) as { result: string };
  return BigInt(result === "0x" ? "0x0" : result);
}

async function main() {
  const [operator] = await ethers.getSigners();
  const account = process.env.DEMO_ACCOUNT ?? operator.address;

  const vaultAddress = process.env.SEPOLIA_VAULT;
  const collateralAddress = process.env.SEPOLIA_MOCK_COLLATERAL;
  const executorAddress = process.env.SEPOLIA_EXECUTOR;
  const bondAddress = process.env.HEDERA_BOND_ADDRESS;
  const noteHolder = process.env.HEDERA_NOTE_HOLDER ?? account;
  const unitPriceUsd = Number(process.env.HEDERA_NOTE_UNIT_PRICE_USD ?? 10);
  const noteDecimals = Number(process.env.HEDERA_NOTE_DECIMALS ?? 2);

  if (!vaultAddress || !collateralAddress || !executorAddress || !bondAddress) {
    throw new Error(
      "Set SEPOLIA_VAULT, SEPOLIA_MOCK_COLLATERAL, SEPOLIA_EXECUTOR and HEDERA_BOND_ADDRESS in the repo-root .env"
    );
  }

  const vault = await ethers.getContractAt("CryptoMarginVault", vaultAddress);
  const collateral = await ethers.getContractAt("MockCollateral", collateralAddress);
  const executor = await ethers.getContractAt("FirewallMarginExecutor", executorAddress);

  // 1 — mark the collateral at the live cross-protocol price
  const price = await liveEthPrice(account);
  console.log(`Live ETH price from The Graph: $${ethers.formatUnits(price, 18)}`);
  await (await vault.setPrice(price)).wait();

  // 2 — attest the Hedera holding
  const units = await hederaNoteUnits(bondAddress, noteHolder);
  const wholeNotes = Number(units) / 10 ** noteDecimals;
  const valueUsd = ethers.parseUnits((wholeNotes * unitPriceUsd).toFixed(6), 18);
  console.log(`Hedera note balance: ${wholeNotes} units = $${ethers.formatUnits(valueUsd, 18)}`);
  if (units === 0n) {
    throw new Error(
      `${noteHolder} holds no units of the ATS note at ${bondAddress}. Run contracts-hedera/issue-asset.ts first.`
    );
  }

  const report = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "address", "uint256", "uint256", "uint256", "address"],
    [0, account, 0n, units, valueUsd, bondAddress]
  );
  await (await executor.onReport("0x", report)).wait();
  console.log("Attestation delivered through FirewallMarginExecutor.");

  // 3 — bring the cross-margin position to its documented starting state. Topping
  // up to a target rather than only-if-empty keeps the demo repeatable after a run
  // that liquidated part of the position.
  const position = await vault.positions(account);
  if (position.collateral < DEPOSIT) {
    const top = DEPOSIT - position.collateral;
    await (await collateral.faucet(top)).wait();
    await (await collateral.approve(vaultAddress, top)).wait();
    await (await vault.deposit(top)).wait();
  }
  if (position.debt < BORROW) {
    await (await vault.borrow(BORROW - position.debt)).wait();
  }

  const [cryptoValue, protectedValue, hf, cryptoHf] = await Promise.all([
    vault.cryptoValue(account),
    vault.protectedValue(account),
    vault.healthFactor(account),
    vault.cryptoHealthFactor(account),
  ]);

  const fmt = (v: bigint) => `$${Number(ethers.formatUnits(v, 18)).toLocaleString()}`;
  console.log("\n--- demo account ready ---");
  console.log(`crypto collateral     ${fmt(cryptoValue)}`);
  console.log(`protected note        ${fmt(protectedValue)} (after haircut)`);
  console.log(`debt                  ${fmt((await vault.positions(account)).debt)}`);
  console.log(`portfolio health      ${ethers.formatUnits(hf, 18)}`);
  const cryptoOnly = Number(ethers.formatUnits(cryptoHf, 18));
  console.log(
    `crypto-only health    ${cryptoOnly.toFixed(4)}` +
      (cryptoOnly < 1 ? "  <- below 1.0: the note is carrying this position" : "")
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
