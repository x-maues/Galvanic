import { NextResponse } from "next/server";
import { getVaultWriter, getVaultReader } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const writer = getVaultWriter();
  const reader = getVaultReader();
  if (!writer || !reader) {
    return NextResponse.json(
      { error: "Vault not configured — set SEPOLIA_RPC_URL/SEPOLIA_VAULT/SEPOLIA_DEPLOYER_KEY" },
      { status: 400 }
    );
  }

  const { action } = (await req.json().catch(() => ({}))) as { action?: "stress" | "heal" };

  const current: bigint = await reader.price();
  const newPrice = action === "heal" ? (current * 100n) / 40n : (current * 40n) / 100n;

  try {
    const tx = await writer.setPrice(newPrice);
    const receipt = await tx.wait();
    return NextResponse.json({
      ok: true,
      action: action ?? "stress",
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber,
      newPrice: newPrice.toString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
