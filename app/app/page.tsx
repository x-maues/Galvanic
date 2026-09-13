"use client";

import { useCallback, useEffect, useState } from "react";

type SepoliaStatus =
  | { configured: false; error?: string }
  | {
      configured: true;
      vaultAddress: string;
      executorAddress: string;
      demoAccount: string;
      price: string;
      collateral: string;
      debt: string;
      healthFactor: string;
      healthy: boolean;
    };

type HederaStatus =
  | { configured: false }
  | {
      configured: true;
      bondAddress: string;
      bondHashscan: string;
      asset: { name: string; symbol: string; totalSupply: string; isin: string };
      operator: { evmAddress: string; balanceOfDefaultPartition: string };
      investor: { evmAddress: string; balanceOfDefaultPartition: string };
      transactions: Record<string, { hash: string; url: string }>;
    };

type Verdict = {
  liquidate: boolean;
  account: string;
  amountUsd: number;
  riskScore: number;
  reason: string;
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono text-[11px] uppercase tracking-wider border border-line px-2 py-1 text-paper/60">
      {children}
    </span>
  );
}

function Badge({ tone, children }: { tone: "safe" | "signal" | "neutral"; children: React.ReactNode }) {
  const color =
    tone === "safe" ? "text-safe border-safe/40 bg-safe/10" : tone === "signal" ? "text-signal border-signal/40 bg-signal/10" : "text-paper/70 border-line";
  return <span className={`mono text-xs uppercase tracking-wide border px-2 py-1 rounded-sm ${color}`}>{children}</span>;
}

function Panel({
  title,
  eyebrow,
  tone,
  children,
}: {
  title: string;
  eyebrow: string;
  tone: "safe" | "signal";
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 border border-line p-6 md:p-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="mono text-xs uppercase tracking-widest text-paper/50">{eyebrow}</span>
        <Badge tone={tone}>{tone === "safe" ? "Protected" : "Liquid"}</Badge>
      </div>
      <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-t border-line/60">
      <span className="text-sm text-paper/50">{label}</span>
      <span className="mono tnum text-sm text-right break-all">{value}</span>
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="border border-dashed border-line/70 p-4 text-sm text-paper/40">
      Not deployed yet. {hint}
    </div>
  );
}

export default function Page() {
  const [sepolia, setSepolia] = useState<SepoliaStatus | null>(null);
  const [hedera, setHedera] = useState<HederaStatus | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [verdictRaw, setVerdictRaw] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = await res.json();
      setSepolia(data.sepolia);
      setHedera(data.hedera);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function runAction(action: "stress" | "heal") {
    setLoadingAction(action);
    setError(null);
    try {
      const res = await fetch("/api/trigger-stress", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingAction(null);
    }
  }

  async function runVerdict() {
    setLoadingAction("verdict");
    setError(null);
    setVerdict(null);
    setVerdictRaw(null);
    try {
      const res = await fetch("/api/verdict", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.hint ?? "failed");
      setVerdict(data.verdict);
      setVerdictRaw(data.raw);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <main className="min-h-screen max-w-6xl mx-auto px-6 py-10 md:py-16 flex flex-col gap-12">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 bg-signal" />
          <span className="mono text-xs uppercase tracking-[0.2em] text-paper/50">Firewall Margin</span>
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
          Cross-margin,
          <br />
          without cross-contamination.
        </h1>
        <p className="text-paper/50 max-w-xl text-sm md:text-base">
          A confidential risk decision can isolate and act on stressed crypto collateral — without
          ever touching protected, compliance-gated RWA collateral. Different contract, different
          chain, no shared custody.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Chip>Hedera · Asset Tokenization Studio</Chip>
          <Chip>The Graph · Standardized Subgraph</Chip>
          <Chip>Chainlink · CRE Confidential Workflow</Chip>
        </div>
      </header>

      <section className="flex flex-col md:flex-row gap-0 relative">
        <Panel title="Protected RWA Leg" eyebrow="Hedera Testnet · ATS" tone="safe">
          {hedera?.configured ? (
            <div>
              <Row label="Asset" value={`${hedera.asset.name} (${hedera.asset.symbol})`} />
              <Row label="Bond contract" value={hedera.bondAddress} />
              <Row label="Total supply" value={hedera.asset.totalSupply} />
              <Row label="Investor balance (KYC-gated)" value={hedera.investor.balanceOfDefaultPartition} />
              <a
                href={hedera.bondHashscan}
                target="_blank"
                rel="noreferrer"
                className="text-safe text-sm underline underline-offset-4 mt-2 inline-block"
              >
                View on HashScan →
              </a>
            </div>
          ) : (
            <Empty hint="Run contracts-hedera/issue-asset.ts with a funded Hedera testnet account." />
          )}
        </Panel>

        <div className="hidden md:block firewall-seam mx-2" />

        <Panel title="Liquid Crypto Leg" eyebrow="Ethereum Sepolia · Vault" tone="signal">
          {sepolia?.configured ? (
            <div>
              <div className="flex items-baseline gap-3 py-2">
                <span className="text-sm text-paper/50">Health factor</span>
                <span
                  className={`mono tnum text-3xl font-semibold ${
                    sepolia.healthy ? "text-safe" : "text-signal pulse"
                  }`}
                >
                  {sepolia.healthFactor}
                </span>
              </div>
              <Row label="Vault" value={sepolia.vaultAddress} />
              <Row label="Executor (CRE-gated)" value={sepolia.executorAddress} />
              <Row label="Status" value={sepolia.healthy ? "Healthy" : "Liquidatable"} />
              <div className="flex gap-2 pt-4">
                <button
                  onClick={() => runAction("stress")}
                  disabled={loadingAction !== null}
                  className="mono text-xs uppercase tracking-wide border border-signal text-signal px-3 py-2 hover:bg-signal/10 disabled:opacity-40"
                >
                  {loadingAction === "stress" ? "Triggering…" : "Trigger stress"}
                </button>
                <button
                  onClick={() => runAction("heal")}
                  disabled={loadingAction !== null}
                  className="mono text-xs uppercase tracking-wide border border-line text-paper/60 px-3 py-2 hover:bg-white/5 disabled:opacity-40"
                >
                  {loadingAction === "heal" ? "Healing…" : "Heal"}
                </button>
              </div>
            </div>
          ) : (
            <Empty hint="Run npm run deploy:sepolia in contracts-sepolia/ with a funded Sepolia key." />
          )}
        </Panel>
      </section>

      <section className="border border-line p-6 md:p-8 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <span className="mono text-xs uppercase tracking-widest text-paper/50">
            Chainlink CRE · Confidential Workflow
          </span>
          <button
            onClick={runVerdict}
            disabled={loadingAction !== null}
            className="mono text-xs uppercase tracking-wide border border-paper/30 px-3 py-2 hover:bg-white/5 disabled:opacity-40"
          >
            {loadingAction === "verdict" ? "Running in TEE…" : "Run confidential decision"}
          </button>
        </div>
        <p className="text-sm text-paper/40 max-w-2xl">
          Runs the real CRE workflow (<code className="mono">cre workflow simulate</code>) — private
          liquidation policy thresholds and cross-protocol exposure are combined inside a TEE.
          Only this verdict crosses the boundary; the inputs never do.
        </p>
        {verdict && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
            <div className="border border-line p-4">
              <div className="text-xs text-paper/40 mb-1">Verdict</div>
              <Badge tone={verdict.liquidate ? "signal" : "safe"}>
                {verdict.liquidate ? "Liquidate crypto leg" : "Hold"}
              </Badge>
            </div>
            <div className="border border-line p-4">
              <div className="text-xs text-paper/40 mb-1">Risk score</div>
              <div className="mono tnum text-xl">{verdict.riskScore.toFixed(2)}</div>
            </div>
            <div className="border border-line p-4">
              <div className="text-xs text-paper/40 mb-1">Amount (USD)</div>
              <div className="mono tnum text-xl">{verdict.amountUsd}</div>
            </div>
            <div className="border border-line p-4 col-span-2 md:col-span-1">
              <div className="text-xs text-paper/40 mb-1">Reason</div>
              <div className="text-sm">{verdict.reason}</div>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="border border-signal/40 text-signal text-sm p-4 mono">{error}</div>
      )}

      <footer className="text-paper/30 text-xs mono pt-8 border-t border-line/60">
        Firewall Margin — built for ETHGlobal. No AI in the critical risk path.
      </footer>
    </main>
  );
}
