"use client";

import { useState } from "react";

// ─── Icons — minimal hand-rolled line icons, no dependency ─────────────────
const iconProps = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function ShieldIcon(props: { className?: string }) {
  return (
    <svg {...iconProps} className={props.className}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    </svg>
  );
}
export function BoltIcon(props: { className?: string }) {
  return (
    <svg {...iconProps} className={props.className}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}
export function NetworkIcon(props: { className?: string }) {
  return (
    <svg {...iconProps} className={props.className}>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M6.8 7.4 11 16M17.2 7.4 13 16M7.2 6h9.6" />
    </svg>
  );
}
export function LockIcon(props: { className?: string }) {
  return (
    <svg {...iconProps} className={props.className}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}
export function WalletIcon(props: { className?: string }) {
  return (
    <svg {...iconProps} className={props.className}>
      <rect x="3" y="6" width="18" height="13" rx="1.5" />
      <path d="M3 9h18M15 13.5h3" />
    </svg>
  );
}
export function GridIcon(props: { className?: string }) {
  return (
    <svg {...iconProps} className={props.className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </svg>
  );
}
export function ExternalLinkIcon(props: { className?: string }) {
  return (
    <svg {...iconProps} width={14} height={14} className={props.className}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}
export function CopyIcon(props: { className?: string }) {
  return (
    <svg {...iconProps} width={14} height={14} className={props.className}>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" />
    </svg>
  );
}
export function CheckIcon(props: { className?: string }) {
  return (
    <svg {...iconProps} width={14} height={14} className={props.className}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────
export function PrimaryButton({
  children,
  onClick,
  disabled,
  tone = "paper",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "paper" | "signal";
  className?: string;
}) {
  const toneClass =
    tone === "signal"
      ? "bg-signal text-ink hover:bg-signal/90 disabled:bg-signal/30"
      : "bg-paper text-ink hover:bg-paper/90 disabled:bg-paper/30";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`mono text-xs uppercase tracking-wide rounded-md px-4 py-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:text-ink/40 ${toneClass} ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`mono text-xs uppercase tracking-wide rounded-md border border-line text-paper/70 px-4 py-2.5 hover:bg-white/5 hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Badge / status pill ───────────────────────────────────────────────
export function Badge({
  tone,
  children,
}: {
  tone: "safe" | "signal" | "warn" | "neutral";
  children: React.ReactNode;
}) {
  const color =
    tone === "safe"
      ? "text-safe border-safe/30 bg-safe/10"
      : tone === "signal"
        ? "text-signal border-signal/30 bg-signal/10"
        : tone === "warn"
          ? "text-warn border-warn/30 bg-warn/10"
          : "text-paper/60 border-line";
  return (
    <span className={`mono text-[11px] uppercase tracking-wide border px-2 py-1 rounded-full ${color}`}>
      {children}
    </span>
  );
}

// ─── Card primitives ────────────────────────────────────────────────────
export function Card({
  children,
  className = "",
  accent,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: "safe" | "signal" | "warn";
}) {
  const accentClass =
    accent === "safe"
      ? "border-l-2 border-l-safe"
      : accent === "signal"
        ? "border-l-2 border-l-signal"
        : accent === "warn"
          ? "border-l-2 border-l-warn"
          : "";
  return (
    <div className={`rounded-lg border border-line bg-white/[0.015] p-6 ${accentClass} ${className}`}>{children}</div>
  );
}

export function StatTile({
  label,
  value,
  valueClassName = "",
  sub,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-paper/40">{label}</span>
      <span className={`mono tnum text-2xl font-medium ${valueClassName}`}>{value}</span>
      {sub && <span className="text-xs text-paper/40">{sub}</span>}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <span className="mono text-[11px] uppercase tracking-widest text-paper/40">{eyebrow}</span>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1">{title}</h1>
      </div>
      {action}
    </div>
  );
}

// ─── Address chip: copy + explorer link, de-emphasized vs. hero numbers ──
export function AddressChip({ address, href }: { address: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — ignore, chip still shows the address
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 mono text-xs text-paper/60 bg-white/[0.03] border border-line rounded-md px-2 py-1">
      {short}
      <button onClick={copy} className="text-paper/40 hover:text-paper/80" aria-label="Copy address">
        {copied ? <CheckIcon className="text-safe" /> : <CopyIcon />}
      </button>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="text-paper/40 hover:text-paper/80" aria-label="View on explorer">
          <ExternalLinkIcon />
        </a>
      )}
    </span>
  );
}

export function Empty({ hint }: { hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line/70 p-5 text-sm text-paper/40">
      Not deployed yet. {hint}
    </div>
  );
}
