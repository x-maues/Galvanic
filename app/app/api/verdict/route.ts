import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs";
import { env } from "@/lib/env";

const execFileAsync = promisify(execFile);
export const dynamic = "force-dynamic";

/**
 * Runs the Chainlink CRE confidential workflow and returns the verdict it produced.
 *
 * The workflow executes under `cre.handlerInTee`: the private policy thresholds and
 * the Graph credential are loaded as CRE secrets inside the enclave, the Hedera
 * mirror node and the standardized Graph subgraphs are read from inside the
 * enclave, and only the verdict plus the Hedera attestation cross back out. This
 * route never sees a threshold — read the JSON it returns and check.
 */
function parseVerdict(stdout: string) {
  const lines = stdout.split("\n");
  const idx = lines.findIndex((l) => l.includes("Workflow Simulation Result"));
  if (idx === -1) return null;
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const unescaped = JSON.parse(line); // unwraps the outer quoted string
      return typeof unescaped === "string" ? JSON.parse(unescaped) : unescaped;
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST() {
  const cwd = env.creWorkflowDir;
  const home = os.homedir();
  const PATH = `${path.join(home, ".cre/bin")}:${path.join(home, ".bun/bin")}:${process.env.PATH}`;

  // This Next.js process loads the repo-root .env, which carries placeholder CRE
  // credentials. The CRE CLI treats a *present* CRE_API_KEY as a real credential
  // and tries to authenticate with it, which breaks the unauthenticated local
  // `simulate` path. Strip just those rather than forwarding them.
  const { CRE_API_KEY, CRE_ETH_PRIVATE_KEY, ...restEnv } = process.env;

  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, "firewall-margin", "config.staging.json"), "utf8")
    ) as { onchain?: { enabled?: boolean } };

    const { stdout, stderr } = await execFileAsync(
      "cre",
      [
        "workflow",
        "simulate",
        "firewall-margin",
        "--target",
        "staging-settings",
        "--non-interactive",
        "--trigger-index",
        "0",
      ],
      { cwd, env: { ...restEnv, PATH }, timeout: 120_000 }
    );

    const verdict = parseVerdict(stdout);
    if (!verdict) {
      return NextResponse.json(
        { ok: false, error: "could not parse a verdict from the CRE run", raw: stdout },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      verdict,
      // "enclave" — the decision was produced inside the TEE but not yet written
      // anywhere. Settling it on Sepolia is a separate, explicit step.
      execution: config.onchain?.enabled ? "don-delivered" : "enclave",
      raw: stdout,
      stderr,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
        raw: err?.stdout,
        stderr: err?.stderr,
        hint:
          "The confidential workflow could not be evaluated. Check that the Graph service " +
          "(subgraph/) and the position bridge (cre-workflow/.../position-bridge.js) are running.",
      },
      { status: 500 }
    );
  }
}
