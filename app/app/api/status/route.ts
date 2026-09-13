import { NextResponse } from "next/server";
import fs from "fs";
import { env } from "@/lib/env";
import { getVaultReader, formatHealthFactor } from "@/lib/contracts";

export const dynamic = "force-dynamic";

async function readSepoliaStatus() {
  const vault = getVaultReader();
  if (!vault || !env.demoAccount) {
    return { configured: false as const };
  }

  const [price, pos, hf, executor] = await Promise.all([
    vault.price(),
    vault.positions(env.demoAccount),
    vault.healthFactor(env.demoAccount),
    vault.creExecutor(),
  ]);

  return {
    configured: true as const,
    vaultAddress: env.sepoliaVault,
    executorAddress: executor as string,
    demoAccount: env.demoAccount,
    price: price.toString(),
    collateral: pos.collateral.toString(),
    debt: pos.debt.toString(),
    healthFactor: formatHealthFactor(hf as bigint),
    healthFactorRaw: hf.toString(),
    healthy: (hf as bigint) >= 10n ** 18n,
  };
}

function readHederaStatus() {
  try {
    const raw = fs.readFileSync(env.hederaEvidencePath, "utf8");
    const data = JSON.parse(raw);
    return { configured: true as const, ...data };
  } catch {
    return { configured: false as const };
  }
}

export async function GET() {
  const [sepolia, hedera] = await Promise.all([
    readSepoliaStatus().catch((err) => ({
      configured: false as const,
      error: String(err),
    })),
    Promise.resolve(readHederaStatus()),
  ]);

  return NextResponse.json({ sepolia, hedera });
}
