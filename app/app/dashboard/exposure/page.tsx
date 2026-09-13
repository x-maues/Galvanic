"use client";

import { useState } from "react";
import { useDashboard } from "@/lib/dashboardContext";
import { Card, StatTile, Badge, SectionHeading, PrimaryButton, SecondaryButton } from "../_ui";

const money = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: d })}`;

/** Real Aave v3 borrowers, found by querying the standardized schema for the largest
 *  open BORROWER positions. Paste one and the policy reacts to live mainnet debt. */
const SAMPLE_BORROWERS = [
  { label: "$52M USDe borrower", address: "0x6142eb927529974c5cded66dafc57cb5aaaf73ab" },
  { label: "$15M DAI borrower", address: "0xa32e350c5397b78fe31d8e65d6bfa3d2c58a2ebb" },
  { label: "$12M GHO borrower", address: "0xdf2609ec3d2e07a79d2e25e52960e75250bd9aaa" },
];

const QUERY = `query GalvanicProtocolRisk($account: ID!) {
  account(id: $account) {
    positions(where: { side: BORROWER, hashClosed: null }, first: 1000) {
      balance
      asset { symbol decimals lastPriceUSD }
    }
  }
  financialsDailySnapshots(first: 7, orderBy: timestamp, orderDirection: desc) {
    dailyLiquidateUSD
    totalBorrowBalanceUSD
  }
  markets(first: 200, where: { isActive: true }) {
    totalBorrowBalanceUSD
    totalDepositBalanceUSD
    inputToken { symbol lastPriceUSD }
  }
}`;

export default function NetworkData() {
  const { exposure, sepolia, exposureAccount, setExposureAccount, busy } = useDashboard();
  const [draft, setDraft] = useState("");
  const ex = exposure?.configured ? exposure : null;
  const demoAccount = sepolia?.configured ? sepolia.account : "";

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        eyebrow="The Graph · Messari standardized Lending schema v3.1.0"
        title="One query. Three protocols. Three risk questions."
        action={<Badge tone={ex && !ex.degraded ? "safe" : "warn"}>{ex ? `${ex.protocols_answered} answering` : "Unavailable"}</Badge>}
      />

      <p className="text-sm text-paper/45 max-w-3xl leading-relaxed">
        Messari&apos;s common schema gives Aave v3, Compound v3 and Spark Lend the same
        entities — <span className="mono text-paper/70">Account</span>,{" "}
        <span className="mono text-paper/70">Position</span>,{" "}
        <span className="mono text-paper/70">Market</span>,{" "}
        <span className="mono text-paper/70">Token</span>,{" "}
        <span className="mono text-paper/70">FinancialsDailySnapshot</span>. So the query
        below is written once and sent unmodified to all three. Adding a fourth protocol
        is one row in <span className="mono text-paper/70">LENDING_SUBGRAPHS</span>.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px border border-line bg-line">
        <div className="bg-ink p-4"><StatTile label="ETH mark" value={money(ex?.collateral_price_usd, 2)} sub="Median across protocols" /></div>
        <div className="bg-ink p-4"><StatTile label="Market stress" value={ex ? `${ex.market_stress_bps} bps` : "—"} sub="Added to the required health factor" /></div>
        <div className="bg-ink p-4"><StatTile label="ETH utilization" value={ex ? `${ex.collateral_utilization_pct.toFixed(1)}%` : "—"} sub="Borrowed / supplied" /></div>
        <div className="bg-ink p-4"><StatTile label="Liquidation intensity" value={ex ? `${ex.liquidation_intensity_bps.toFixed(2)} bps` : "—"} sub="7d liquidated / total borrows" /></div>
      </div>

      {/* The proof that the account query is load-bearing, not decorative. */}
      <Card className="flex flex-col gap-4">
        <SectionHeading eyebrow="Try it against a real borrower" title="Whose exposure?" />
        <p className="text-sm text-paper/45 leading-relaxed max-w-3xl">
          The demo account is fresh, so it has no borrows anywhere — the honest answer is
          $0. Point the same query at a real mainnet borrower and the exposure cap trips:
          the policy restricts new borrowing instead of liquidating, because debt owed
          elsewhere is not a breach of <em>this</em> position&apos;s terms.
        </p>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_BORROWERS.map((b) => (
            <SecondaryButton key={b.address} disabled={busy !== null} onClick={() => setExposureAccount(b.address)}>
              {b.label}
            </SecondaryButton>
          ))}
          <SecondaryButton disabled={busy !== null} onClick={() => setExposureAccount(null)}>
            Back to demo account
          </SecondaryButton>
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="0x… any address"
            className="flex-1 mono text-xs bg-white/[0.03] border border-line rounded-md px-3 py-2.5 text-paper/80 placeholder:text-paper/25 focus:outline-none focus:border-paper/30"
          />
          <PrimaryButton disabled={!/^0x[0-9a-fA-F]{40}$/.test(draft.trim())} onClick={() => setExposureAccount(draft.trim())}>
            Query
          </PrimaryButton>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-line/60 pt-4">
          <div>
            <span className="text-xs text-paper/40">Open borrows for {exposureAccount ?? demoAccount}</span>
            <div className="mono text-4xl font-medium tracking-tight mt-2">
              {money(ex?.cross_protocol_borrow_exposure_usd)}
            </div>
          </div>
          <span className="mono text-[11px] text-paper/30">{ex ? new Date(ex.queried_at).toLocaleTimeString() : ""}</span>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <SectionHeading eyebrow="Per deployment" title="Same document, every protocol" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-paper/35">
              <tr className="text-left">
                <th className="font-normal py-2">Deployment</th>
                <th className="font-normal">Schema</th>
                <th className="font-normal text-right">This account</th>
                <th className="font-normal text-right">Protocol borrows</th>
                <th className="font-normal text-right">Liquidated 7d</th>
                <th className="font-normal text-right">ETH markets</th>
                <th className="font-normal text-right">ETH price</th>
              </tr>
            </thead>
            <tbody>
              {(ex?.per_protocol ?? []).map((p) => (
                <tr key={p.subgraph_id} className="border-t border-line/60">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${p.ok ? "bg-safe" : "bg-warn"}`} />
                      <span className="text-paper/70">{p.name}</span>
                    </div>
                    <span className="mono text-[10px] text-paper/25">{p.subgraph_id}</span>
                  </td>
                  <td className="mono text-paper/40">{p.schema_version}</td>
                  <td className="mono text-right text-paper/70">{p.ok ? money(p.account_borrow_exposure_usd) : "—"}</td>
                  <td className="mono text-right text-paper/45">{p.ok ? money(p.protocol_total_borrow_usd) : "—"}</td>
                  <td className="mono text-right text-paper/45">{p.ok ? money(p.liquidated_7d_usd) : "—"}</td>
                  <td className="mono text-right text-paper/45">{p.ok ? p.eth_market_count : "—"}</td>
                  <td className="mono text-right text-paper/45">{money(p.eth_price_usd, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {exposure && !exposure.configured && exposure.error && (
          <p className="mono text-xs text-signal">{exposure.error}</p>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionHeading eyebrow="The query itself" title="Written once" />
        <pre className="mono text-[11px] leading-relaxed text-paper/55 overflow-x-auto bg-white/[0.02] border border-line/70 rounded-md p-4">
          {QUERY}
        </pre>
        <p className="text-xs text-paper/35 leading-relaxed">
          Not one field here is protocol-specific. USD values for positions are derived
          the standard Messari way — <span className="mono">balance / 10^decimals ×
          asset.lastPriceUSD</span> — which works identically everywhere precisely because{" "}
          <span className="mono">Token.lastPriceUSD</span> is part of the shared schema.
        </p>
      </Card>
    </div>
  );
}
