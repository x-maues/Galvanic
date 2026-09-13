"use client";

import { useDashboard } from "@/lib/dashboardContext";
import { Card, StatTile, Badge, SectionHeading, AddressChip, ShieldIcon } from "../_ui";

const money = (n: number | undefined) =>
  n === undefined ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const LIFECYCLE: { key: string; label: string; detail: string }[] = [
  { key: "deployBond", label: "Bond deployed", detail: "ATS Factory + Business Logic Resolver, Hedera testnet" },
  { key: "addIssuer", label: "Trusted KYC issuer registered", detail: "SSI Management facet" },
  { key: "grantKycOperator", label: "KYC granted to issuer", detail: "Required to hold or mint" },
  { key: "issue", label: "Supply issued", detail: "ERC-1594 issue()" },
  { key: "grantKycInvestor", label: "KYC granted to holder", detail: "The same address as the Sepolia margin account" },
  { key: "transferByPartition", label: "Compliant transfer", detail: "KYC-gated transferByPartition" },
  { key: "setCoupon", label: "Coupon scheduled", detail: "Corporate action through the ATS Coupon facet" },
  { key: "revokeKycInvestor", label: "KYC revoked", detail: "Compliance exercised, not just configured" },
  { key: "regrantKycInvestor", label: "KYC restored", detail: "Holding returned to good standing" },
];

export default function ProtectedAssets() {
  const { hedera, sepolia } = useDashboard();
  const h = hedera?.configured ? hedera : null;
  const s = sepolia?.configured ? sepolia : null;
  const ca = h?.corporateAction;
  const couponUsd =
    ca && Number(ca.denominator) > 0 ? Number(ca.numerator) / Number(ca.denominator) : undefined;

  if (!h) {
    return (
      <Card>
        <p className="text-sm text-paper/50">
          No issuance evidence found. Run <span className="mono">npm run issue-asset</span> in{" "}
          <span className="mono">contracts-hedera/</span>.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        eyebrow="Hedera Asset Tokenization Studio · testnet"
        title={h.asset.name}
        action={<Badge tone="safe">{h.asset.symbol}</Badge>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px border border-line bg-line">
        <div className="bg-ink p-4"><StatTile label="Total supply" value={Number(h.asset.totalSupply).toLocaleString()} sub={`${h.asset.decimals} decimals`} /></div>
        <div className="bg-ink p-4"><StatTile label="Held by this account" value={Number(h.investor.balanceOfDefaultPartition).toLocaleString()} valueClassName="text-safe" sub={money(h.note?.holderValueUsd)} /></div>
        <div className="bg-ink p-4"><StatTile label="ISIN" value={h.asset.isin} sub="ZZ — reserved, never a real issuer" /></div>
        <div className="bg-ink p-4"><StatTile label="Recognised on Sepolia" value={money(s?.attestation?.valueUsd)} sub={s?.attestation?.claimSeized ? "Claim seized" : "Claim intact"} valueClassName={s?.attestation?.claimSeized ? "text-signal" : "text-safe"} /></div>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <Card className="flex flex-col gap-4" accent="safe">
          <SectionHeading eyebrow="Corporate action" title="A bond that actually pays" action={<ShieldIcon className="text-safe" />} />
          {ca ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <StatTile label="Coupon rate" value={`${ca.ratePct}%`} sub={`Coupon #${ca.couponId}`} />
                <StatTile label="Balance at record date" value={Number(ca.tokenBalanceAtRecordDate).toLocaleString()} sub={ca.recordDateReached ? "Snapshot taken on-chain" : "Pending"} />
                <StatTile label="Payable to holder" value={couponUsd !== undefined ? `$${couponUsd.toFixed(2)}` : "—"} valueClassName="text-safe" sub="Read from the snapshot" />
              </div>
              <p className="text-xs text-paper/40 leading-relaxed">
                Scheduled through the ATS Coupon facet, its record date reached on-chain, and
                the holder&apos;s payable amount read back from the snapshot the contract took.
                Nothing here was computed off-chain.
              </p>
            </>
          ) : (
            <p className="text-sm text-paper/40">No coupon recorded in this issuance run.</p>
          )}
        </Card>

        <Card className="flex flex-col gap-4" accent={h.compliance?.transferRejectedAfterKycRevocation ? "safe" : "warn"}>
          <SectionHeading eyebrow="Compliance" title="Exercised, not configured" />
          <div className="flex items-start gap-3 rounded-md border border-safe/20 bg-safe/[0.04] p-4">
            <span className="mono text-safe text-lg leading-none">✓</span>
            <p className="text-sm text-paper/60 leading-relaxed">
              {h.compliance?.evidence ??
                "KYC was revoked and a transfer preflight was confirmed to revert."}{" "}
              The restriction is enforced by the token contract on Hedera — not by this UI,
              and not by anything on Sepolia.
            </p>
          </div>
          <p className="text-xs text-paper/40 leading-relaxed">
            This is why a seizure recorded on Sepolia is only ever a <em>claim</em>: settling
            it would still have to pass this compliance module. When the enclave looks again
            and sees the units still with the account, the claim is cleared.
          </p>
        </Card>
      </div>

      <Card className="flex flex-col gap-4">
        <SectionHeading eyebrow="On-chain evidence" title="Every step, on HashScan" action={<AddressChip address={h.bondAddress} href={h.bondHashscan} />} />
        <div className="flex flex-col">
          {LIFECYCLE.filter((step) => h.transactions[step.key]).map((step) => (
            <a
              key={step.key}
              href={h.transactions[step.key].url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-4 py-3 border-t border-line/60 first:border-t-0 group"
            >
              <span className="min-w-0">
                <span className="text-sm text-paper/75 group-hover:text-paper">{step.label}</span>
                <span className="block text-xs text-paper/35">{step.detail}</span>
              </span>
              <span className="mono text-[11px] text-paper/30 group-hover:text-paper/60 shrink-0">
                {h.transactions[step.key].hash.slice(0, 10)}… ↗
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
