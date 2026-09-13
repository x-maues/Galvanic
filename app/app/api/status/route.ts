import { NextResponse } from "next/server";
import fs from "fs";
import { ethers } from "ethers";
import { env } from "@/lib/env";
import { getVaultReader, getRegistryReader, formatHealthFactor, usd, WAD } from "@/lib/contracts";

export const dynamic = "force-dynamic";

/**
 * One read of everything the operator needs: the Sepolia cross-margin account, the
 * Hedera note recognised against it, the live Graph signals, and — the part that
 * makes the product legible — what a liquidation would do to each collateral class
 * under each margin mode, computed by the vault itself.
 */
async function readSepolia() {
  const vault = getVaultReader();
  const registry = getRegistryReader();
  if (!vault || !env.demoAccount) return { configured: false as const };

  const account = env.demoAccount;
  const [
    price,
    position,
    hf,
    cryptoHf,
    cryptoValue,
    protectedValue,
    totalValue,
    mode,
    restricted,
    revoked,
    executor,
    liqBps,
    haircutBps,
  ] = await Promise.all([
    vault.price(),
    vault.positions(account),
    vault.healthFactor(account),
    vault.cryptoHealthFactor(account),
    vault.cryptoValue(account),
    vault.protectedValue(account),
    vault.totalCollateralValue(account),
    vault.marginMode(account),
    vault.borrowingRestricted(account),
    vault.protectedRecognitionRevoked(account),
    vault.creExecutor(),
    vault.liquidationThresholdBps(),
    vault.rwaHaircutBps(),
  ]);

  const attestation = registry ? await registry.attestationOf(account) : null;

  // The counterfactual, straight from the contract: at the policy's close factor,
  // what does each mode take? This is the number the whole product turns on.
  const closeFactorDebt = (position.debt as bigint) / 2n;
  const preview = await vault.previewLiquidation(account, closeFactorDebt);

  return {
    configured: true as const,
    account,
    vaultAddress: env.sepoliaVault,
    registryAddress: env.sepoliaRegistry,
    executorAddress: executor as string,
    collateralTokenAddress: env.sepoliaCollateral,
    debtTokenAddress: env.sepoliaDebt,

    markPriceUsd: usd(price as bigint),
    collateralUnits: Number(ethers.formatUnits(position.collateral as bigint, 18)),
    cryptoValueUsd: usd(cryptoValue as bigint),
    protectedValueUsd: usd(protectedValue as bigint),
    totalCollateralUsd: usd(totalValue as bigint),
    debtUsd: usd(position.debt as bigint),

    healthFactor: formatHealthFactor(hf as bigint),
    cryptoHealthFactor: formatHealthFactor(cryptoHf as bigint),
    healthy: (hf as bigint) >= WAD,
    cryptoLegSolvent: (cryptoHf as bigint) >= WAD,

    marginMode: Number(mode) === 1 ? ("pooled" as const) : ("firewall" as const),
    borrowingRestricted: Boolean(restricted),
    protectedRecognitionRevoked: Boolean(revoked),
    liquidationThresholdPct: Number(liqBps) / 100,
    rwaHaircutPct: 100 - Number(haircutBps) / 100,

    attestation: attestation && {
      units: (attestation.units as bigint).toString(),
      valueUsd: usd(attestation.valueUsd as bigint),
      attestedAt: Number(attestation.attestedAt),
      hederaToken: attestation.hederaToken as string,
      claimSeized: Boolean(attestation.claimSeized),
      claimHolder: attestation.claimHolder as string,
    },

    preview: {
      closeFactorDebtUsd: usd(closeFactorDebt),
      cryptoSeizedUsd: usd(preview[0] as bigint),
      shortfallUsd: usd(preview[1] as bigint),
      protectedSeizedUsdPooled: usd(preview[2] as bigint),
      protectedSeizedUsdFirewall: usd(preview[3] as bigint),
    },
  };
}

function readHedera() {
  try {
    const data = JSON.parse(fs.readFileSync(env.hederaEvidencePath, "utf8"));
    const { privateKey, ...investor } = data.investor ?? {};
    return { configured: true as const, ...data, investor };
  } catch {
    return { configured: false as const };
  }
}

async function readGraph(account?: string) {
  const target = account ?? env.demoAccount;
  if (!target) return { configured: false as const };
  try {
    const res = await fetch(
      `${env.exposureServerUrl}/firewall-margin/exposure?account=${target}`,
      { cache: "no-store", signal: AbortSignal.timeout(25_000) }
    );
    const data = await res.json();
    if (!res.ok) return { configured: false as const, error: data.error ?? `HTTP ${res.status}` };
    return { configured: true as const, ...data };
  } catch (err) {
    return { configured: false as const, error: String(err) };
  }
}

export async function GET(req: Request) {
  // `?exposureAccount=` lets a judge point the standardized Graph query at any
  // address on Aave / Compound / Spark and watch the policy react to a real
  // borrower's real exposure.
  const exposureAccount =
    new URL(req.url).searchParams.get("exposureAccount") ?? undefined;

  const [sepolia, hedera, exposure] = await Promise.all([
    readSepolia().catch((err) => ({ configured: false as const, error: String(err) })),
    Promise.resolve(readHedera()),
    readGraph(exposureAccount),
  ]);

  return NextResponse.json({ sepolia, hedera, exposure, exposureAccount });
}
