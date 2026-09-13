import fs from "fs";
import Link from "next/link";
import { env } from "@/lib/env";

function hederaEvidence() {
  try {
    return JSON.parse(fs.readFileSync(env.hederaEvidencePath, "utf8")) as {
      bondAddress: string;
      bondHashscan: string;
      asset: { name: string; symbol: string };
      corporateAction?: { ratePct: number };
    };
  } catch {
    return null;
  }
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="mono text-[10px] uppercase tracking-[0.2em] text-paper/35">{children}</span>;
}

function SplitPanel() {
  const rows = [
    { label: "Your ETH", pooled: "sold", firewall: "sold", pooledBad: true, firewallBad: true },
    { label: "Your bond", pooled: "sold", firewall: "untouched", pooledBad: true, firewallBad: false },
  ];
  return (
    <div className="border border-line bg-[#0d0d0d] shadow-2xl shadow-black/40">
      <div className="flex items-center gap-2 border-b border-line/70 px-4 py-3">
        <span className="h-1.5 w-1.5 rounded-full bg-signal pulse" />
        <span className="mono text-[10px] uppercase tracking-[0.16em] text-paper/45">ETH just fell 92%</span>
      </div>
      <div className="grid grid-cols-[1.1fr_1fr_1fr]">
        <div className="p-4 md:p-5 border-r border-line/70">
          <span className="mono text-[10px] uppercase tracking-widest text-paper/25">What you held</span>
        </div>
        <div className="p-4 md:p-5 border-r border-line/70">
          <span className="mono text-[10px] uppercase tracking-widest text-paper/40">Everywhere else</span>
        </div>
        <div className="p-4 md:p-5 bg-safe/[0.03]">
          <span className="mono text-[10px] uppercase tracking-widest text-safe/80">Galvanic</span>
        </div>
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <div className="p-4 md:p-5 border-t border-r border-line/70 text-sm text-paper/70">{r.label}</div>
            <div className={`p-4 md:p-5 border-t border-r border-line/70 mono text-sm ${r.pooledBad ? "text-signal" : "text-safe"}`}>
              {r.pooled}
            </div>
            <div className={`p-4 md:p-5 border-t border-line/70 bg-safe/[0.03] mono text-sm ${r.firewallBad ? "text-signal" : "text-safe"}`}>
              {r.firewall}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-line/70 px-4 md:px-5 py-4">
        <p className="text-xs text-paper/45 leading-relaxed">
          Your bond never moved in price. It was sold to cover somebody else&apos;s problem —
          your ETH. That is the default behaviour of every margin account in crypto today.
        </p>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <span className="mono text-[10px] text-paper/25 pt-1.5 shrink-0">{n}</span>
      <div>
        <h3 className="text-base font-medium">{title}</h3>
        <p className="text-sm text-paper/45 leading-relaxed mt-1.5">{body}</p>
      </div>
    </div>
  );
}

export default function Landing() {
  const hedera = hederaEvidence();

  return (
    <main className="min-h-screen">
      <nav className="max-w-6xl mx-auto px-6 lg:px-10 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" className="h-6 w-auto" />
          <span className="mono text-xs uppercase tracking-[0.22em] text-paper/75">Galvanic</span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm text-paper/45">
          <a href="#problem" className="hover:text-paper">The problem</a>
          <a href="#how" className="hover:text-paper">How it works</a>
          <a href="#proof" className="hover:text-paper">Proof</a>
        </div>
        <Link
          href="/dashboard"
          className="mono text-[11px] uppercase tracking-wide border border-signal text-signal rounded-sm px-4 py-2.5 hover:bg-signal/10"
        >
          Open the app →
        </Link>
      </nav>

      <section className="max-w-6xl mx-auto px-6 lg:px-10 pt-16 md:pt-24 pb-20">
        <div className="grid lg:grid-cols-[0.95fr_1.05fr] gap-14 xl:gap-20 items-center">
          <div className="flex flex-col items-start gap-7">
            <Eyebrow>Borrow against real-world assets</Eyebrow>
            <h1 className="text-5xl md:text-6xl font-semibold tracking-[-0.04em] leading-[0.98]">
              Your bond shouldn&apos;t be sold because your ETH crashed.
            </h1>
            <p className="text-base md:text-lg text-paper/50 leading-relaxed max-w-lg">
              Galvanic lets you borrow against a tokenized bond and volatile crypto at the
              same time — and guarantees a crypto crash can never reach the bond. Not by
              policy. By construction.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="mono text-xs uppercase tracking-wide border border-signal bg-signal/10 text-signal rounded-sm px-5 py-3 hover:bg-signal/20"
              >
                See it happen live →
              </Link>
              <a
                href="#how"
                className="mono text-xs uppercase tracking-wide border border-line text-paper/60 rounded-sm px-5 py-3 hover:bg-white/5"
              >
                How it works
              </a>
            </div>
          </div>
          <SplitPanel />
        </div>
      </section>

      <section id="problem" className="border-y border-line/60 bg-white/[0.015]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-20 md:py-24">
          <div className="max-w-3xl">
            <Eyebrow>The problem</Eyebrow>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mt-4">
              Put two assets in one account and you quietly agree to something.
            </h2>
            <div className="mt-8 flex flex-col gap-5 text-paper/55 leading-relaxed">
              <p>
                Say you hold a tokenized treasury bond and some ETH. Pledging both lets you
                borrow more than either would alone — that&apos;s the whole point of a margin
                account, and it&apos;s genuinely useful.
              </p>
              <p>
                But the fine print is that collateral is treated as interchangeable. When ETH
                falls at 3am, the system sells whatever recovers the loan fastest. Often that&apos;s
                the bond — the asset that didn&apos;t do anything wrong.
              </p>
              <p className="text-paper/70">
                For a fund, that&apos;s a bad night. For an institution, it&apos;s a dealbreaker. Their
                bond is a regulated security with an approved holder list and transfer rules —
                and a smart contract just sold it to a stranger to cover an unrelated position.
              </p>
              <p className="text-paper/40 text-sm">
                Today the only alternative is to keep the bond in a separate account, where it
                earns you no borrowing power at all. Safe, and useless.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="max-w-6xl mx-auto px-6 lg:px-10 py-20 md:py-24">
        <div className="max-w-2xl mb-14">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mt-4">
            Keep the borrowing power. Drop the risk of losing the bond.
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-10 md:gap-12">
          <div className="flex flex-col gap-6 border-t border-line/70 pt-6">
            <Eyebrow>01 · Your collateral</Eyebrow>
            <Step
              n=""
              title="The bond counts, for real"
              body="Your tokenized bond stays on Hedera, under its own compliance rules. Galvanic reads what you hold and lets it back your loan — with no bridge, no wrapper, and nothing locked up."
            />
            <p className="text-xs text-paper/30 leading-relaxed">
              In the live demo the bond is doing most of the work: the ETH alone couldn&apos;t
              support the loan.
            </p>
          </div>

          <div className="flex flex-col gap-6 border-t border-line/70 pt-6">
            <Eyebrow>02 · The decision</Eyebrow>
            <Step
              n=""
              title="Your risk rules stay yours"
              body="Where you get liquidated, and how much gets sold, are your numbers — and publishing them tells everyone exactly how to push you. So the decision runs inside a sealed environment that nobody, including us, can read into."
            />
            <p className="text-xs text-paper/30 leading-relaxed">
              It also watches how hard the wider lending market is liquidating right now, and
              moves your safety margin with it.
            </p>
          </div>

          <div className="flex flex-col gap-6 border-t border-line/70 pt-6">
            <Eyebrow>03 · The firewall</Eyebrow>
            <Step
              n=""
              title="The sale can only touch crypto"
              body="If you get liquidated, the engine is allowed to sell your crypto and nothing else. If that isn't enough, your borrowing power shrinks and new borrowing stops — but the bond stays where it is."
            />
            <p className="text-xs text-paper/30 leading-relaxed">
              The part that decides how much to sell has no way to name the bond. It isn&apos;t
              trusted not to — it structurally cannot.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-line/60 bg-white/[0.015]">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-16 grid md:grid-cols-[0.8fr_1.2fr] gap-10">
          <div>
            <Eyebrow>Who this is for</Eyebrow>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mt-4">
              Anyone whose collateral isn&apos;t all the same kind of risky.
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-8 text-sm">
            <div>
              <p className="text-paper/75 font-medium">Funds holding tokenized treasuries</p>
              <p className="text-paper/40 leading-relaxed mt-2">
                Borrow against the bond without accepting that a crypto drawdown can liquidate it.
              </p>
            </div>
            <div>
              <p className="text-paper/75 font-medium">Issuers and their holders</p>
              <p className="text-paper/40 leading-relaxed mt-2">
                Your security keeps its holder register intact. It cannot be transferred to
                someone outside it by a liquidation.
              </p>
            </div>
            <div>
              <p className="text-paper/75 font-medium">Lending venues</p>
              <p className="text-paper/40 leading-relaxed mt-2">
                Accept real-world assets as collateral without redesigning your liquidation
                engine around every asset class.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="proof" className="max-w-6xl mx-auto px-6 lg:px-10 py-20 md:py-24">
        <div className="max-w-2xl mb-12">
          <Eyebrow>Proof, not promises</Eyebrow>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mt-4">
            We ran the crash both ways and kept the receipts.
          </h2>
          <p className="text-paper/45 leading-relaxed mt-5">
            Same account. Same 92% crash. Same decision. The only difference is whether the
            firewall was on. Both settled on a public testnet — you can open them.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-px bg-line border border-line">
          <div className="bg-ink p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="mono text-[11px] uppercase tracking-widest text-paper/45">Firewall off</span>
              <span className="mono text-[10px] uppercase text-signal border border-signal/30 bg-signal/10 px-2 py-1">Bond sold</span>
            </div>
            <p className="mono text-3xl text-signal">$16,201</p>
            <p className="text-sm text-paper/45 leading-relaxed">
              taken from the bond after the crypto ran out. The holder register changed hands.
            </p>
            <a
              href="https://sepolia.etherscan.io/tx/0x66729f8b32676843f2432796edf0c030bbc23b727ce52051dcfd2c26418dee77"
              target="_blank"
              rel="noreferrer"
              className="mono text-[11px] uppercase tracking-wide text-paper/40 hover:text-paper"
            >
              View transaction ↗
            </a>
          </div>
          <div className="bg-ink p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="mono text-[11px] uppercase tracking-widest text-paper/45">Firewall on</span>
              <span className="mono text-[10px] uppercase text-safe border border-safe/30 bg-safe/10 px-2 py-1">Bond intact</span>
            </div>
            <p className="mono text-3xl text-safe">$0</p>
            <p className="text-sm text-paper/45 leading-relaxed">
              taken from the bond. The crypto was sold, borrowing was frozen, and the bond
              stayed exactly where it was.
            </p>
            <a
              href="https://sepolia.etherscan.io/tx/0x4c09580ec7b7d7987660400c031f18897fee564e976aef91c75dc087516c667b"
              target="_blank"
              rel="noreferrer"
              className="mono text-[11px] uppercase tracking-wide text-paper/40 hover:text-paper"
            >
              View transaction ↗
            </a>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-px bg-line border border-line border-t-0">
          <div className="bg-ink p-6">
            <Eyebrow>The bond is real</Eyebrow>
            <p className="text-sm text-paper/50 leading-relaxed mt-3">
              A live security token on Hedera with an approved-holder list and a{" "}
              {hedera?.corporateAction?.ratePct ?? 2.5}% coupon. We revoked a holder&apos;s approval
              and watched the contract refuse the transfer.
            </p>
            {hedera && (
              <a href={hedera.bondHashscan} target="_blank" rel="noreferrer" className="mono text-[11px] uppercase tracking-wide text-safe hover:underline mt-3 inline-block">
                {hedera.asset.symbol} on HashScan ↗
              </a>
            )}
          </div>
          <div className="bg-ink p-6">
            <Eyebrow>The market data is real</Eyebrow>
            <p className="text-sm text-paper/50 leading-relaxed mt-3">
              Prices and liquidation pressure come from Aave, Compound and Spark — live, right
              now. There is no offline mode; without real data the app refuses to decide.
            </p>
          </div>
          <div className="bg-ink p-6">
            <Eyebrow>The decision is sealed</Eyebrow>
            <p className="text-sm text-paper/50 leading-relaxed mt-3">
              Your risk rules are loaded inside a hardware-isolated enclave and never come
              back out. What comes out is one instruction, and it cannot name the bond.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-line/60">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-20 flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div className="max-w-xl">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              Watch a liquidation stop at the border.
            </h2>
            <p className="text-paper/45 leading-relaxed mt-4">
              Crash the market yourself, run the decision, and see which assets move.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="mono text-xs uppercase tracking-wide border border-signal bg-signal/10 text-signal rounded-sm px-5 py-3 shrink-0 hover:bg-signal/20"
          >
            Open the app →
          </Link>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 lg:px-10 py-7 border-t border-line/60 flex flex-wrap justify-between gap-4 text-[10px] mono uppercase tracking-widest text-paper/25">
        <span>Galvanic — cross-margin without cross-contamination</span>
        <span>Hedera · The Graph · Chainlink · Testnet</span>
      </footer>
    </main>
  );
}
