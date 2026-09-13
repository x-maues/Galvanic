import { ethers } from "hardhat";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

/**
 * The whole claim of this project, run twice on Sepolia against the same account,
 * the same price collapse and the same enclave-produced report — changing only the
 * account's margin mode.
 *
 *   pooled   -> the liquidation runs out of crypto collateral and takes the margin
 *               claim on the Hedera note. The protected asset is contaminated.
 *   firewall -> the identical liquidation stops at the crypto bucket. The note's
 *               borrowing power is withdrawn; the note itself is never touched.
 *
 * Every verdict here comes from `cre workflow simulate` — the report bytes applied
 * on-chain are the bytes the confidential handler produced, not something this
 * script composed. Writes evidence to prove-firewall.json.
 */

const CRE_DIR = path.resolve(__dirname, "../../cre-workflow/firewall-margin-workflow");
const GRAPH_URL = process.env.EXPOSURE_SERVER_URL ?? "http://127.0.0.1:8790";
const FIREWALL = 0;
const POOLED = 1;

type Verdict = {
  action: string;
  amountUsd: number;
  reason: string;
  requiredHealthFactor: number;
  marketStressBps: number;
  protectedUnits: string;
  protectedValueUsd: number;
  reportPayload: string;
};

async function runEnclave(): Promise<Verdict> {
  const home = os.homedir();
  const PATH = `${path.join(home, ".cre/bin")}:${path.join(home, ".bun/bin")}:${process.env.PATH}`;
  const { CRE_API_KEY, CRE_ETH_PRIVATE_KEY, ...rest } = process.env;

  const { stdout } = await execFileAsync(
    "cre",
    ["workflow", "simulate", "firewall-margin", "--target", "staging-settings", "--non-interactive", "--trigger-index", "0"],
    { cwd: CRE_DIR, env: { ...rest, PATH }, timeout: 180_000, maxBuffer: 32 * 1024 * 1024 }
  );

  const lines = stdout.split("\n");
  const idx = lines.findIndex((l) => l.includes("Workflow Simulation Result"));
  if (idx === -1) throw new Error(`no verdict in CRE output:\n${stdout.slice(-2000)}`);
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const outer = JSON.parse(line);
    return typeof outer === "string" ? JSON.parse(outer) : outer;
  }
  throw new Error("verdict line not found");
}

async function livePrice(account: string): Promise<bigint> {
  const res = await fetch(`${GRAPH_URL}/firewall-margin/exposure?account=${account}`);
  const data = (await res.json()) as { collateral_price_usd?: number };
  if (!data.collateral_price_usd) throw new Error("Graph service unavailable — run `bun server.ts` in subgraph/");
  return ethers.parseUnits(data.collateral_price_usd.toFixed(6), 18);
}

const usd = (v: bigint) => Number(ethers.formatUnits(v, 18));
const money = (v: bigint) => `$${usd(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const TARGET_COLLATERAL = ethers.parseUnits("10", 18);
const TARGET_DEBT = ethers.parseUnits("35000", 18);

/** Restore the demo account to its documented starting position. */
async function resetAccount(vault: any, collateral: any, executor: any, account: string) {
  const bond = process.env.HEDERA_BOND_ADDRESS!;
  const units = BigInt(process.env.HEDERA_NOTE_UNITS ?? "300000");
  const valueUsd = ethers.parseUnits(
    (Number(units) / 100 * Number(process.env.HEDERA_NOTE_UNIT_PRICE_USD ?? 10)).toFixed(6),
    18
  );
  const attestation = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "address", "uint256", "uint256", "uint256", "address"],
    [0, account, 0n, units, valueUsd, bond]
  );
  await (await executor.onReport("0x", attestation)).wait();

  const position = await vault.positions(account);
  if (position.collateral < TARGET_COLLATERAL) {
    const top = TARGET_COLLATERAL - position.collateral;
    await (await collateral.faucet(top)).wait();
    await (await collateral.approve(await vault.getAddress(), top)).wait();
    await (await vault.deposit(top)).wait();
  }
  if (position.debt < TARGET_DEBT) {
    await (await vault.borrow(TARGET_DEBT - position.debt)).wait();
  }
}

async function main() {
  const account = process.env.DEMO_ACCOUNT!;
  const vault = await ethers.getContractAt("CryptoMarginVault", process.env.SEPOLIA_VAULT!);
  const registry = await ethers.getContractAt("ProtectedCollateralRegistry", process.env.SEPOLIA_REGISTRY!);
  const executor = await ethers.getContractAt("FirewallMarginExecutor", process.env.SEPOLIA_EXECUTOR!);
  const collateral = await ethers.getContractAt("MockCollateral", process.env.SEPOLIA_MOCK_COLLATERAL!);

  const mark = await livePrice(account);
  const crashed = (mark * 8n) / 100n;
  const evidence: Record<string, unknown> = {
    account,
    vault: process.env.SEPOLIA_VAULT,
    registry: process.env.SEPOLIA_REGISTRY,
    executor: process.env.SEPOLIA_EXECUTOR,
    liveMarkUsd: usd(mark),
    crashedMarkUsd: usd(crashed),
    runs: {} as Record<string, unknown>,
  };

  for (const [label, mode] of [["pooled", POOLED], ["firewall", FIREWALL]] as const) {
    console.log(`\n${"=".repeat(70)}\n  ${label.toUpperCase()} MARGIN\n${"=".repeat(70)}`);

    // Reset so both runs start from an identical account. This is bookkeeping, not
    // a policy decision: an attestation-only report (action 0) re-recognises the
    // Hedera note and clears any restriction, then the position is topped back up.
    await (await vault.setPrice(mark)).wait();
    await (await vault.setMarginModeFor(account, mode)).wait();
    await resetAccount(vault, collateral, executor, account);

    const before = await registry.attestationOf(account);
    console.log(`note before: ${before.units} units, claimSeized=${before.claimSeized}, holder=${before.claimHolder}`);

    // The crash.
    const crashTx = await vault.setPrice(crashed);
    await crashTx.wait();
    console.log(`mark ${money(mark)} -> ${money(crashed)}  (tx ${crashTx.hash})`);

    const [cryptoSeized, shortfall, pooledTakes, firewallTakes] = await vault.previewLiquidation(
      account,
      (await vault.positions(account)).debt / 2n
    );
    console.log(
      `preview: crypto ${money(cryptoSeized)} | shortfall ${money(shortfall)} | ` +
        `pooled would take ${money(pooledTakes)} of the note | firewall would take ${money(firewallTakes)}`
    );

    const verdict = await runEnclave();
    console.log(`enclave verdict: ${verdict.action} — ${verdict.reason}`);

    const tx = await executor.onReport("0x", verdict.reportPayload);
    const receipt = await tx.wait();
    console.log(`settled on Sepolia: https://sepolia.etherscan.io/tx/${tx.hash}`);

    const after = await registry.attestationOf(account);
    const position = await vault.positions(account);
    const seizedEvent = receipt!.logs.some((l) => {
      try {
        return vault.interface.parseLog(l)?.name === "ProtectedCollateralSeized";
      } catch {
        return false;
      }
    });

    console.log(
      `note after:  ${after.units} units, claimSeized=${after.claimSeized}, holder=${after.claimHolder}`
    );
    console.log(
      seizedEvent
        ? "  -> PROTECTED COLLATERAL SEIZED: the crypto default reached the Hedera note."
        : "  -> PROTECTED COLLATERAL PRESERVED: the default stopped at the crypto bucket."
    );

    (evidence.runs as Record<string, unknown>)[label] = {
      marginMode: label,
      crashTx: crashTx.hash,
      settleTx: tx.hash,
      settleExplorer: `https://sepolia.etherscan.io/tx/${tx.hash}`,
      verdict: { action: verdict.action, amountUsd: verdict.amountUsd, reason: verdict.reason },
      preview: {
        cryptoSeizedUsd: usd(cryptoSeized),
        shortfallUsd: usd(shortfall),
        protectedSeizedUsdPooled: usd(pooledTakes),
        protectedSeizedUsdFirewall: usd(firewallTakes),
      },
      protectedAssetSeized: seizedEvent,
      noteUnitsAfter: after.units.toString(),
      noteClaimHolderAfter: after.claimHolder,
      remainingCollateral: usd(position.collateral),
      remainingDebtUsd: usd(position.debt),
      borrowingRestricted: await vault.borrowingRestricted(account),
      protectedRecognitionRevoked: await vault.protectedRecognitionRevoked(account),
    };
  }

  // Leave the account where the demo starts.
  await (await vault.setPrice(mark)).wait();
  await (await vault.setMarginModeFor(account, FIREWALL)).wait();
  await resetAccount(vault, collateral, executor, account);

  evidence.generatedAt = new Date().toISOString();
  const out = path.resolve(__dirname, "../prove-firewall.json");
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence written to ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
