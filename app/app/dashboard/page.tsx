"use client";

import Link from "next/link";
import { useDashboard } from "@/lib/dashboardContext";
import { Card, StatTile, Badge, SectionHeading, PrimaryButton, SecondaryButton, AddressChip, ShieldIcon, LockIcon } from "./_ui";

const money = (n: number | undefined, digits = 0) =>
  n === undefined ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: digits })}`;

function Dot({ tone }: { tone: "safe" | "signal" | "warn" }) {
  const c = tone === "signal" ? "bg-signal" : tone === "warn" ? "bg-warn" : "bg-safe";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${c}`} />;
}

function Counterfactual() {
  const { sepolia } = useDashboard();
  if (!sepolia?.configured) return null;
  const p = sepolia.preview;
  const pooled = sepolia.marginMode === "pooled";
  const exposed = p.shortfallUsd > 0;

  return (
    <Card className="flex flex-col gap-5" accent={pooled && exposed ? "signal" : "safe"}>
      <SectionHeading
        eyebrow="If this position were liquidated right now"
        title="Where the loss lands"
        action={<Badge tone={pooled ? "warn" : "safe"}>{pooled ? "Pooled margin" : "Firewall"}</Badge>}
      />
      <p className="text-sm text-paper/45 leading-relaxed max-w-2xl">
        Both columns are computed by the vault itself from the same close factor on the
        same debt. The only difference is the account&apos;s margin mode.
      </p>

      <div className="grid md:grid-cols-2 gap-px bg-line border border-line">
        {[
          { key: "pooled", label: "Pooled margin", note: p.protectedSeizedUsdPooled, active: pooled },
          { key: "firewall", label: "Firewall", note: p.protectedSeizedUsdFirewall, active: !pooled },
        ].map((col) => (
          <div key={col.key} className={`bg-ink p-5 flex flex-col gap-4 ${col.active ? "" : "opacity-55"}`}>
            <div className="flex items-center justify-between">
              <span className="mono text-[11px] uppercase tracking-widest text-paper/45">{col.label}</span>
              {col.active && <Badge tone="neutral">Active</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <StatTile label="From crypto" value={money(p.cryptoSeizedUsd)} />
              <StatTile
                label="From the Hedera note"
                value={money(col.note)}
                valueClassName={col.note > 0 ? "text-signal" : "text-safe"}
              />
            </div>
            <p className={`text-xs leading-relaxed ${col.note > 0 ? "text-signal/80" : "text-safe/80"}`}>
              {col.note > 0
                ? "The crypto bucket runs out and the liquidator takes the margin claim on the protected note. Contamination."
                : exposed
                  ? "The crypto bucket runs out and the loss stops there. The note's borrowing power is withdrawn; the note itself is untouched."
                  : "The crypto bucket covers it. Nothing reaches the note in either mode — stress the mark to see them diverge."}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Overview() {
  const { sepolia, hedera, exposure, verdict, settlement, log, busy, error, setMode, setMark, runVerdict, settle } = useDashboard();
  const s = sepolia?.configured ? sepolia : null;
  const ex = exposure?.configured ? exposure : null;
  const stressed = s ? !s.healthy : false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Dot tone={stressed ? "signal" : "safe"} />
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-paper/40">Cross-margin account · Sepolia + Hedera</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Command center.</h1>
          <p className="text-sm text-paper/45 max-w-2xl leading-relaxed">
            One account, two collateral classes, one private policy. The tokenized note
            grants real borrowing power here — and the firewall is what keeps a crypto
            crash from collecting on it.
          </p>
        </div>
        {s && <AddressChip address={s.account} href={`https://sepolia.etherscan.io/address/${s.account}`} />}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px border border-line bg-line">
        <div className="bg-ink p-4">
          <StatTile label="Crypto collateral" value={money(s?.cryptoValueUsd)} sub={s ? `${s.collateralUnits} fmETH @ ${money(s.markPriceUsd)}` : "—"} />
        </div>
        <div className="bg-ink p-4">
          <StatTile label="Protected note" value={money(s?.protectedValueUsd)} valueClassName="text-safe" sub={s ? `Hedera ATS · ${s.rwaHaircutPct}% haircut` : "—"} />
        </div>
        <div className="bg-ink p-4">
          <StatTile label="Portfolio health" value={s?.healthFactor ?? "—"} valueClassName={s?.healthy ? "text-safe" : "text-signal"} sub={`Debt ${money(s?.debtUsd)}`} />
        </div>
        <div className="bg-ink p-4">
          <StatTile
            label="Crypto-only health"
            value={s?.cryptoHealthFactor ?? "—"}
            valueClassName={s?.cryptoLegSolvent ? "text-safe" : "text-warn"}
            sub={s && !s.cryptoLegSolvent ? "Below 1.0 — the note is carrying this position" : "Crypto could stand alone"}
          />
        </div>
      </div>

      <Counterfactual />

      <div className="grid xl:grid-cols-[1fr_1fr] gap-4">
        {/* Controls */}
        <Card className="flex flex-col gap-5">
          <SectionHeading eyebrow="Run the demo" title="Three controls" />
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs text-paper/40">1 · Choose how this account&apos;s collateral may be treated</span>
              <div className="flex gap-2">
                <PrimaryButton tone={s?.marginMode === "firewall" ? "paper" : "signal"} disabled={busy !== null} onClick={() => setMode("firewall")}>
                  {busy === "mode:firewall" ? "Switching…" : "Firewall"}
                </PrimaryButton>
                <SecondaryButton disabled={busy !== null} onClick={() => setMode("pooled")}>
                  {busy === "mode:pooled" ? "Switching…" : "Pooled margin"}
                </SecondaryButton>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-line/60 pt-4">
              <span className="text-xs text-paper/40">2 · Move the crypto mark</span>
              <div className="flex gap-2">
                <PrimaryButton tone="signal" disabled={busy !== null} onClick={() => setMark("stress")}>
                  {busy === "mark:stress" ? "Marking down…" : "Crash the crypto mark"}
                </PrimaryButton>
                <SecondaryButton disabled={busy !== null} onClick={() => setMark("restore")}>
                  {busy === "mark:restore" ? "Restoring…" : "Restore live mark"}
                </SecondaryButton>
              </div>
              <p className="text-[11px] text-paper/30 leading-relaxed">
                Restore re-marks fmETH at the live ETH price The Graph reports across Aave,
                Compound and Spark. The crash is the one scripted input in the whole demo.
              </p>
            </div>

            <div className="flex flex-col gap-2 border-t border-line/60 pt-4">
              <span className="text-xs text-paper/40">3 · Evaluate the private policy, then settle it</span>
              <div className="flex gap-2 flex-wrap">
                <PrimaryButton disabled={busy !== null} onClick={runVerdict}>
                  {busy === "verdict" ? "Running in the enclave…" : "Run confidential policy"}
                </PrimaryButton>
                <SecondaryButton disabled={busy !== null || !verdict} onClick={settle}>
                  {busy === "settle" ? "Settling…" : "Settle on Sepolia"}
                </SecondaryButton>
              </div>
            </div>
          </div>
          {error && <div className="rounded-md border border-signal/30 text-signal text-xs p-3 mono leading-relaxed">{error}</div>}
        </Card>

        {/* Verdict */}
        <Card className="flex flex-col gap-5" accent={verdict?.action === "liquidate" ? "signal" : verdict ? "safe" : undefined}>
          <SectionHeading
            eyebrow="Chainlink CRE · confidential handler"
            title={verdict ? { hold: "Hold", restrict_borrowing: "Restrict borrowing", liquidate: "Liquidate the crypto leg" }[verdict.action] : "No decision yet"}
            action={verdict && <Badge tone={verdict.action === "liquidate" ? "signal" : verdict.action === "hold" ? "safe" : "warn"}>{settlement ? "Settled" : "Decision only"}</Badge>}
          />
          {verdict ? (
            <>
              <p className="text-sm text-paper/55 leading-relaxed">{verdict.reason}</p>
              <div className="grid grid-cols-3 gap-4">
                <StatTile label="Required health" value={verdict.requiredHealthFactor.toFixed(3)} sub="Private floor × live market stress" />
                <StatTile label="Market stress" value={`${verdict.marketStressBps} bps`} sub="From The Graph" />
                <StatTile label="Debt to close" value={money(verdict.amountUsd)} sub="Private close factor" />
              </div>
              <div className="rounded-md border border-line/70 bg-white/[0.02] p-3">
                <p className="mono text-[10px] uppercase tracking-widest text-paper/35 mb-1.5">Attested from Hedera, inside the enclave</p>
                <p className="text-xs text-paper/55">
                  {Number(verdict.protectedUnits).toLocaleString()} units · {money(verdict.protectedValueUsd)} — read from the mirror node, signed into the report, never seizable by it.
                </p>
              </div>
              {settlement ? (
                <a href={settlement.explorer} target="_blank" rel="noreferrer" className="mono text-[11px] uppercase tracking-wide text-safe hover:underline">
                  View the settling transaction on Etherscan →
                </a>
              ) : (
                <p className="text-[11px] text-paper/30 leading-relaxed">
                  The thresholds that produced this never left the enclave. Only the action, the amount, and the Hedera attestation came back.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-paper/40 leading-relaxed">
              Run the policy to evaluate this account against private thresholds and live
              market data inside a Nitro TEE.
            </p>
          )}
        </Card>
      </div>

      <div className="grid xl:grid-cols-[1fr_1fr] gap-4">
        <Card className="flex flex-col gap-4">
          <SectionHeading eyebrow="The Graph · standardized lending schema" title="Live market input" />
          <div className="grid grid-cols-3 gap-4">
            <StatTile label="ETH mark" value={ex?.collateral_price_usd ? money(ex.collateral_price_usd) : "—"} sub={`Median of ${ex?.protocols_answered ?? 0} protocols`} />
            <StatTile label="Market stress" value={ex ? `${ex.market_stress_bps} bps` : "—"} sub="Raises the required health factor" />
            <StatTile label="External borrows" value={money(ex?.cross_protocol_borrow_exposure_usd)} sub="This account, all protocols" />
          </div>
          <div className="flex flex-col gap-1.5 pt-1">
            {(ex?.per_protocol ?? []).map((p) => (
              <div key={p.subgraph_id} className="flex items-center justify-between gap-3 text-xs border-t border-line/60 pt-2">
                <span className="flex items-center gap-2 text-paper/55 min-w-0">
                  <Dot tone={p.ok ? "safe" : "warn"} />
                  <span className="truncate">{p.name}</span>
                </span>
                <span className="mono text-paper/35 shrink-0">
                  {p.ok ? `${p.eth_market_count} ETH markets · ${money(p.liquidated_7d_usd)} liquidated 7d` : p.error}
                </span>
              </div>
            ))}
          </div>
          <Link href="/dashboard/exposure" className="mono text-[11px] uppercase tracking-wide text-paper/45 hover:text-paper">
            Inspect the query and test any borrower →
          </Link>
        </Card>

        <Card className="flex flex-col gap-4">
          <SectionHeading eyebrow="Hedera ATS · protected collateral" title="The note" action={<ShieldIcon className="text-safe" />} />
          <div className="flex items-start gap-3 rounded-md border border-safe/20 bg-safe/[0.04] p-3">
            <LockIcon className="text-safe shrink-0" />
            <p className="text-xs text-paper/55 leading-relaxed">
              {s?.attestation?.claimSeized
                ? "A pooled-margin liquidation has taken the claim on this note. This is the outcome the firewall prevents."
                : s?.protectedRecognitionRevoked
                  ? "A firewall event withdrew this note's borrowing power. The units never moved and the claim is still the account's."
                  : "Recognised as margin here, held under ATS compliance on Hedera. No contract in this system can transfer it."}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <StatTile label="Units held" value={s?.attestation ? Number(s.attestation.units).toLocaleString() : "—"} sub={hedera?.configured ? hedera.asset.symbol : "—"} />
            <StatTile label="Marked value" value={money(s?.attestation?.valueUsd)} sub="Before haircut" />
            <StatTile label="Claim holder" value={s?.attestation?.claimSeized ? "Liquidator" : "Account"} valueClassName={s?.attestation?.claimSeized ? "text-signal" : "text-safe"} sub={s?.attestation?.claimSeized ? "Contaminated" : "Intact"} />
          </div>
          <Link href="/dashboard/protected-assets" className="mono text-[11px] uppercase tracking-wide text-paper/45 hover:text-paper">
            Issuance, KYC and coupon evidence →
          </Link>
        </Card>
      </div>

      {log.length > 0 && (
        <Card className="flex flex-col gap-3">
          <SectionHeading eyebrow="Audit trail" title="This session" />
          <div className="flex flex-col">
            {log.map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-4 py-2.5 border-t border-line/60 first:border-t-0">
                <span className="flex items-center gap-3 min-w-0">
                  <Dot tone={e.tone} />
                  <span className="mono text-[10px] uppercase tracking-widest text-paper/35 shrink-0 w-40 truncate">{e.kind}</span>
                  <span className="text-sm text-paper/60 truncate">{e.detail}</span>
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  {e.href && (
                    <a href={e.href} target="_blank" rel="noreferrer" className="mono text-[10px] uppercase text-paper/35 hover:text-paper">
                      tx ↗
                    </a>
                  )}
                  <span className="mono text-xs text-paper/25">{new Date(e.at).toLocaleTimeString()}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
