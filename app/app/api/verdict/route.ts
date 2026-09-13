import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import { env } from "@/lib/env";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

function parseVerdict(stdout: string) {
  const lines = stdout.split("\n");
  const idx = lines.findIndex((l) => l.includes("Workflow Simulation Result"));
  if (idx === -1) return null;

  // The result is printed as a JSON-encoded string on the following non-empty line,
  // e.g.  "{\"liquidate\":true,\"account\":\"0x...\",...}"
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

  try {
    const { stdout, stderr } = await execFileAsync(
      "cre",
      ["workflow", "simulate", "firewall-margin", "--target", "staging-settings", "--non-interactive", "--trigger-index", "0"],
      { cwd, env: { ...process.env, PATH }, timeout: 60_000 }
    );

    const verdict = parseVerdict(stdout);
    return NextResponse.json({ ok: true, verdict, raw: stdout, stderr });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
        raw: err?.stdout,
        stderr: err?.stderr,
        hint:
          "Make sure the mock position/exposure server is running: `bun mock-server.js` inside cre-workflow/firewall-margin-workflow/firewall-margin/",
      },
      { status: 500 }
    );
  }
}
