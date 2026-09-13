"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardProvider, useDashboard } from "@/lib/dashboardContext";
import { useWallet, shortAddress } from "@/lib/useWallet";
import { Badge, PrimaryButton, GridIcon, WalletIcon, ShieldIcon, NetworkIcon } from "./_ui";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: GridIcon },
  { href: "/dashboard/position", label: "Accounts", icon: WalletIcon },
  { href: "/dashboard/protected-assets", label: "Protected assets", icon: ShieldIcon },
  { href: "/dashboard/exposure", label: "Network data", icon: NetworkIcon },
];

function TopBar() {
  const wallet = useWallet();
  const { sepolia } = useDashboard();

  return (
    <div className="flex items-center justify-between gap-4 px-6 md:px-10 py-4 border-b border-line/60 bg-ink/80">
      <div className="flex items-center gap-3 min-w-0">
        <span className="hidden sm:inline mono text-[10px] uppercase tracking-[0.18em] text-paper/25">Account protection</span>
        {sepolia?.configured && (
          <Badge tone={sepolia.healthy ? "safe" : "signal"}>
            {sepolia.healthy ? "Crypto leg healthy" : "Crypto leg at risk"}
          </Badge>
        )}
      </div>
      {wallet.hasProvider === false ? (
        <a
          href="https://metamask.io/download/"
          target="_blank"
          rel="noreferrer"
          className="mono text-xs uppercase tracking-wide border border-line text-paper/50 rounded-md px-3 py-2 hover:bg-white/5"
        >
          Install a wallet
        </a>
      ) : !wallet.isConnected ? (
        <PrimaryButton tone="signal" onClick={wallet.connect}>
          {wallet.connecting ? "Connecting…" : "Connect Wallet"}
        </PrimaryButton>
      ) : (
        <Badge tone={wallet.isSepolia ? "safe" : "warn"}>
          {shortAddress(wallet.address!)} {wallet.isSepolia ? "· Connected" : "· Switch network"}
        </Badge>
      )}
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-full md:w-60 shrink-0 md:h-screen md:sticky md:top-0 border-b md:border-b-0 md:border-r border-line/60 flex md:flex-col justify-between">
      <div>
        <Link href="/" className="flex items-center gap-2.5 px-6 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" className="h-5 w-auto" />
          <span className="mono text-xs uppercase tracking-[0.2em] text-paper/80">Galvanic</span>
        </Link>
        <nav className="flex md:flex-col gap-1 px-3 pb-4 overflow-x-auto md:overflow-visible">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                  active ? "bg-white/[0.06] text-paper" : "text-paper/50 hover:text-paper/80 hover:bg-white/[0.03]"
                }`}
              >
                <Icon className={active ? "text-signal" : "text-paper/40"} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="hidden md:block px-6 py-5 text-[11px] text-paper/25 mono">
        GALVANIC
        <br />
        Isolated collateral. Confidential decisions.
      </div>
    </aside>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <div className="min-h-screen flex flex-col md:flex-row">
        <Sidebar />
        <div className="flex-1 min-w-0">
          <TopBar />
          <main className="px-6 md:px-10 py-8 max-w-[1400px] mx-auto">{children}</main>
        </div>
      </div>
    </DashboardProvider>
  );
}
