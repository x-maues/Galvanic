"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Sepolia = {
  configured: true;
  account: string;
  vaultAddress: string;
  registryAddress: string;
  executorAddress: string;
  collateralTokenAddress: string;
  debtTokenAddress: string;
  markPriceUsd: number;
  collateralUnits: number;
  cryptoValueUsd: number;
  protectedValueUsd: number;
  totalCollateralUsd: number;
  debtUsd: number;
  healthFactor: string;
  cryptoHealthFactor: string;
  healthy: boolean;
  cryptoLegSolvent: boolean;
  marginMode: "firewall" | "pooled";
  borrowingRestricted: boolean;
  protectedRecognitionRevoked: boolean;
  liquidationThresholdPct: number;
  rwaHaircutPct: number;
  attestation: {
    units: string;
    valueUsd: number;
    attestedAt: number;
    hederaToken: string;
    claimSeized: boolean;
    claimHolder: string;
  } | null;
  preview: {
    closeFactorDebtUsd: number;
    cryptoSeizedUsd: number;
    shortfallUsd: number;
    protectedSeizedUsdPooled: number;
    protectedSeizedUsdFirewall: number;
  };
};

export type SepoliaStatus = Sepolia | { configured: false; error?: string };

export type HederaStatus =
  | { configured: false }
  | {
      configured: true;
      bondAddress: string;
      bondHashscan: string;
      asset: { name: string; symbol: string; totalSupply: string; isin: string; decimals: string };
      operator: { evmAddress: string; balanceOfDefaultPartition: string };
      investor: { evmAddress: string; balanceOfDefaultPartition: string };
      transactions: Record<string, { hash: string; url: string }>;
      compliance?: { transferRejectedAfterKycRevocation: boolean; evidence: string };
      corporateAction?: {
        type: string;
        couponId: string;
        ratePct: number;
        recordDate: number;
        executionDate: number;
        holder: string;
        recordDateReached: boolean;
        tokenBalanceAtRecordDate: string;
        numerator: string;
        denominator: string;
      };
      note?: { unitDecimals: number; nominalValueUsd: number; holderUnits: string; holderValueUsd: number };
    };

export type PerProtocol = {
  name: string;
  network: string;
  schema_version: string;
  subgraph_id: string;
  ok: boolean;
  error?: string;
  account_borrow_exposure_usd: number;
  position_count: number;
  protocol_total_borrow_usd: number;
  liquidated_7d_usd: number;
  eth_market_count: number;
  eth_borrow_usd: number;
  eth_deposit_usd: number;
  eth_price_usd: number | null;
};

export type ExposureStatus =
  | { configured: false; error?: string }
  | {
      configured: true;
      source: "live";
      degraded: boolean;
      account: string;
      queried_at: string;
      protocols_answered: number;
      cross_protocol_borrow_exposure_usd: number;
      market_stress_bps: number;
      collateral_asset_symbol: string;
      collateral_price_usd: number | null;
      collateral_utilization_pct: number;
      liquidation_intensity_bps: number;
      per_protocol: PerProtocol[];
    };

export type Verdict = {
  liquidate: boolean;
  action: "hold" | "restrict_borrowing" | "liquidate";
  account: string;
  amountUsd: number;
  riskScore: number;
  reason: string;
  requiredHealthFactor: number;
  marketStressBps: number;
  protectedUnits: string;
  protectedValueUsd: number;
  reportPayload: string;
  execution?: "enclave" | "don-delivered";
};

export type Settlement = { txHash: string; explorer: string; blockNumber?: number };
export type LogEntry = { at: string; kind: string; detail: string; tone: "safe" | "warn" | "signal"; href?: string };

type State = {
  sepolia: SepoliaStatus | null;
  hedera: HederaStatus | null;
  exposure: ExposureStatus | null;
  verdict: Verdict | null;
  settlement: Settlement | null;
  log: LogEntry[];
  busy: string | null;
  error: string | null;
  exposureAccount: string | null;
  refresh: () => Promise<void>;
  setExposureAccount: (address: string | null) => void;
  setMode: (mode: "firewall" | "pooled") => Promise<void>;
  setMark: (action: "stress" | "restore") => Promise<void>;
  runVerdict: () => Promise<void>;
  settle: () => Promise<void>;
};

const Ctx = createContext<State | null>(null);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [sepolia, setSepolia] = useState<SepoliaStatus | null>(null);
  const [hedera, setHedera] = useState<HederaStatus | null>(null);
  const [exposure, setExposure] = useState<ExposureStatus | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exposureAccount, setExposureAccount] = useState<string | null>(null);

  const append = useCallback((entry: Omit<LogEntry, "at">) => {
    setLog((l) => [{ ...entry, at: new Date().toISOString() }, ...l].slice(0, 12));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const q = exposureAccount ? `?exposureAccount=${exposureAccount}` : "";
      const res = await fetch(`/api/status${q}`, { cache: "no-store" });
      const data = await res.json();
      setSepolia(data.sepolia);
      setHedera(data.hedera);
      setExposure(data.exposure);
    } catch (err) {
      setError(String(err));
    }
  }, [exposureAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const call = useCallback(
    async (key: string, url: string, body: unknown, onOk: (data: any) => void) => {
      setBusy(key);
      setError(null);
      try {
        const res = await fetch(url, { method: "POST", body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? data.hint ?? "request failed");
        onOk(data);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const setMode = useCallback(
    (mode: "firewall" | "pooled") =>
      call(`mode:${mode}`, "/api/margin-mode", { mode }, (data) => {
        setVerdict(null);
        setSettlement(null);
        append({
          kind: "Margin mode",
          detail: mode === "pooled" ? "switched to pooled margin — the note is now reachable" : "switched to firewall — the note is ring-fenced",
          tone: mode === "pooled" ? "warn" : "safe",
          href: data.explorer,
        });
      }),
    [call, append]
  );

  const setMark = useCallback(
    (action: "stress" | "restore") =>
      call(`mark:${action}`, "/api/trigger-stress", { action }, (data) => {
        setVerdict(null);
        setSettlement(null);
        append({
          kind: action === "stress" ? "Market event" : "Mark restored",
          detail:
            action === "stress"
              ? `fmETH marked down to $${Math.round(data.newPriceUsd).toLocaleString()} from the live $${Math.round(data.livePriceUsd).toLocaleString()}`
              : `fmETH re-marked at the live Graph price $${Math.round(data.newPriceUsd).toLocaleString()}`,
          tone: action === "stress" ? "signal" : "safe",
          href: data.explorer,
        });
      }),
    [call, append]
  );

  const runVerdict = useCallback(
    () =>
      call("verdict", "/api/verdict", {}, (data) => {
        setVerdict({ ...data.verdict, execution: data.execution });
        setSettlement(null);
        append({ kind: "Confidential policy", detail: data.verdict.reason, tone: data.verdict.action === "liquidate" ? "signal" : data.verdict.action === "restrict_borrowing" ? "warn" : "safe" });
      }),
    [call, append]
  );

  const settle = useCallback(async () => {
    if (!verdict) return;
    await call("settle", "/api/settle", { reportPayload: verdict.reportPayload }, (data) => {
      setSettlement({ txHash: data.txHash, explorer: data.explorer, blockNumber: data.blockNumber });
      append({ kind: "Settled on Sepolia", detail: `report applied in block ${data.blockNumber}`, tone: "safe", href: data.explorer });
    });
  }, [call, append, verdict]);

  return (
    <Ctx.Provider
      value={{ sepolia, hedera, exposure, verdict, settlement, log, busy, error, exposureAccount, refresh, setExposureAccount, setMode, setMark, runVerdict, settle }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
