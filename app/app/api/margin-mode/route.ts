import { NextResponse } from "next/server";
import { env, etherscan } from "@/lib/env";
import { getVaultWriter } from "@/lib/contracts";

export const dynamic = "force-dynamic";

/**
 * Switches the demo account between pooled margin and the firewall.
 *
 * This is the control the whole demo turns on. In pooled mode a crypto-side default
 * can reach the protected note; under the firewall it cannot. Same contract, same
 * account, same price move — only this flag differs.
 */
export async function POST(req: Request) {
  const vault = getVaultWriter();
  if (!vault || !env.demoAccount) {
    return NextResponse.json({ error: "Vault not configured" }, { status: 400 });
  }

  const { mode } = (await req.json().catch(() => ({}))) as { mode?: "firewall" | "pooled" };
  if (mode !== "firewall" && mode !== "pooled") {
    return NextResponse.json({ error: 'mode must be "firewall" or "pooled"' }, { status: 400 });
  }

  try {
    const tx = await vault.setMarginModeFor(env.demoAccount, mode === "pooled" ? 1 : 0);
    await tx.wait();
    return NextResponse.json({ ok: true, mode, txHash: tx.hash, explorer: etherscan(tx.hash) });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.shortMessage ?? err?.message ?? err) },
      { status: 500 }
    );
  }
}
