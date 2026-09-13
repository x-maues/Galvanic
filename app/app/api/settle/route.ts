import { NextResponse } from "next/server";
import { env, etherscan } from "@/lib/env";
import { getExecutorWriter } from "@/lib/contracts";

export const dynamic = "force-dynamic";

/**
 * Settles a verdict on Sepolia by delivering the enclave's own report bytes to
 * FirewallMarginExecutor.onReport.
 *
 * Be precise about what this is. The report payload is produced verbatim by the
 * confidential workflow — this route does not build it and cannot alter its
 * meaning. What this route provides is the carrier: until Confidential Workflow
 * deployment access is granted, the executor accepts reports from the operator key
 * instead of Chainlink's CRE Forwarder. `scripts/use-don-forwarder.ts` flips that
 * with one owner call, and `_processReport` — the part that actually decides
 * anything — is identical either way.
 */
export async function POST(req: Request) {
  const executor = getExecutorWriter();
  if (!executor) {
    return NextResponse.json(
      { error: "Executor not configured — set SEPOLIA_EXECUTOR and SEPOLIA_DEPLOYER_KEY" },
      { status: 400 }
    );
  }

  const { reportPayload } = (await req.json().catch(() => ({}))) as { reportPayload?: string };
  if (!reportPayload || !/^0x[0-9a-fA-F]+$/.test(reportPayload)) {
    return NextResponse.json(
      { error: "missing or malformed reportPayload from the confidential workflow" },
      { status: 400 }
    );
  }

  try {
    const tx = await executor.onReport("0x", reportPayload);
    const receipt = await tx.wait();
    return NextResponse.json({
      ok: true,
      txHash: tx.hash,
      explorer: etherscan(tx.hash),
      blockNumber: receipt?.blockNumber,
      executor: env.sepoliaExecutor,
    });
  } catch (err: any) {
    // A liquidate verdict on an already-healthy account reverts with PositionHealthy;
    // surface that rather than a raw ethers dump.
    return NextResponse.json(
      { error: String(err?.shortMessage ?? err?.message ?? err) },
      { status: 500 }
    );
  }
}
