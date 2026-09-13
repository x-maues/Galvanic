import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getVaultWriter, getVaultReader } from "@/lib/contracts";
import { env, etherscan } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The demo's one deliberately synthetic input: the crypto mark.
 *
 *   restore — mark fmETH at the live ETH price The Graph reports across Aave,
 *             Compound and Spark. Not a stored constant; a real market number.
 *   stress  — a scripted 92% collapse in that mark, which is the event the whole
 *             product exists to contain. Nothing else about the run is simulated.
 */
const CRASH_FACTOR = 8n; // mark falls to 8% of the live price

async function livePriceUsd(account: string): Promise<number> {
  const res = await fetch(`${env.exposureServerUrl}/firewall-margin/exposure?account=${account}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Graph service returned HTTP ${res.status}`);
  const data = (await res.json()) as { collateral_price_usd?: number };
  if (!data.collateral_price_usd) throw new Error("Graph service returned no collateral price");
  return data.collateral_price_usd;
}

export async function POST(req: Request) {
  const writer = getVaultWriter();
  const reader = getVaultReader();
  if (!writer || !reader || !env.demoAccount) {
    return NextResponse.json({ error: "Vault not configured" }, { status: 400 });
  }

  const { action } = (await req.json().catch(() => ({}))) as { action?: "stress" | "restore" };

  try {
    const live = await livePriceUsd(env.demoAccount);
    const livePrice = ethers.parseUnits(live.toFixed(6), 18);
    const newPrice = action === "stress" ? (livePrice * CRASH_FACTOR) / 100n : livePrice;

    const tx = await writer.setPrice(newPrice);
    const receipt = await tx.wait();

    return NextResponse.json({
      ok: true,
      action: action ?? "stress",
      livePriceUsd: live,
      newPriceUsd: Number(ethers.formatUnits(newPrice, 18)),
      txHash: tx.hash,
      explorer: etherscan(tx.hash),
      blockNumber: receipt?.blockNumber,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.shortMessage ?? err?.message ?? err) },
      { status: 500 }
    );
  }
}
