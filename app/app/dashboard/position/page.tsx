"use client";

import { useCallback, useEffect, useState } from "react";
import { Contract, formatUnits, parseUnits } from "ethers";
import { useDashboard } from "@/lib/dashboardContext";
import { useWallet, shortAddress } from "@/lib/useWallet";
import vaultAbi from "@/lib/abi/CryptoMarginVault.json";
import erc20Abi from "@/lib/abi/MockCollateral.json";
import { Card, StatTile, Badge, SectionHeading, PrimaryButton, SecondaryButton, AddressChip, Empty } from "../_ui";

const WAD = 10n ** 18n;

function fmt(n: bigint): string {
  return Number(formatUnits(n, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}
function formatHealthFactor(hf: bigint): string {
  if (hf > 1_000_000n * WAD) return "∞";
  return Number(formatUnits(hf, 18)).toFixed(2);
}

function YourWalletPosition({ vaultAddress, collateralTokenAddress, debtTokenAddress }: { vaultAddress: string; collateralTokenAddress: string; debtTokenAddress: string }) {
  const wallet = useWallet();
  const [collateral, setCollateral] = useState<bigint | null>(null);
  const [debt, setDebt] = useState<bigint | null>(null);
  const [healthFactor, setHealthFactor] = useState<bigint | null>(null);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const { address: walletAddress, getSigner } = wallet;

  const refresh = useCallback(async () => {
    if (!walletAddress) return;
    const signer = await getSigner();
    if (!signer) return;
    const vault = new Contract(vaultAddress, vaultAbi, signer);
    const collateralToken = new Contract(collateralTokenAddress, erc20Abi, signer);

    const [posResult, hfResult, balResult] = await Promise.allSettled([
      vault.positions(walletAddress),
      vault.healthFactor(walletAddress),
      collateralToken.balanceOf(walletAddress),
    ]);

    const errors: string[] = [];
    if (posResult.status === "fulfilled") {
      setCollateral(posResult.value.collateral as bigint);
      setDebt(posResult.value.debt as bigint);
    } else errors.push(`position: ${posResult.reason?.shortMessage ?? posResult.reason?.message ?? posResult.reason}`);

    if (hfResult.status === "fulfilled") setHealthFactor(hfResult.value as bigint);
    else errors.push(`health factor: ${hfResult.reason?.shortMessage ?? hfResult.reason?.message ?? hfResult.reason}`);

    if (balResult.status === "fulfilled") setWalletBalance(balResult.value as bigint);
    else errors.push(`balance: ${balResult.reason?.shortMessage ?? balResult.reason?.message ?? balResult.reason}`);

    setNote(errors.length ? errors.join(" · ") : null);
  }, [walletAddress, vaultAddress, collateralTokenAddress, getSigner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(action: string, fn: () => Promise<any>) {
    setBusy(action);
    setNote(null);
    try {
      const tx = await fn();
      await tx.wait();
      setNote(`${action} confirmed: ${tx.hash.slice(0, 10)}…`);
      await refresh();
    } catch (err: any) {
      setNote(err?.shortMessage ?? err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  }

  const parsedAmount = (() => {
    try {
      return parseUnits(amount || "0", 18);
    } catch {
      return 0n;
    }
  })();

  async function withVault(fn: (vault: Contract, collateralToken: Contract, debtToken: Contract) => Promise<any>) {
    const signer = await getSigner();
    if (!signer) throw new Error("wallet not connected");
    const vault = new Contract(vaultAddress, vaultAbi, signer);
    const collateralToken = new Contract(collateralTokenAddress, erc20Abi, signer);
    const debtToken = new Contract(debtTokenAddress, erc20Abi, signer);
    return fn(vault, collateralToken, debtToken);
  }

  return (
    <Card className="flex flex-col gap-5">
      <SectionHeading
        eyebrow="Connected account · Sepolia"
        title="Manage your position"
        action={
          !wallet.hasProvider ? (
            <span className="text-xs text-paper/40 mono">Wallet unavailable</span>
          ) : !wallet.isConnected ? (
            <PrimaryButton tone="signal" onClick={wallet.connect}>
              {wallet.connecting ? "Connecting…" : "Connect account"}
            </PrimaryButton>
          ) : !wallet.isSepolia ? (
            <SecondaryButton onClick={wallet.switchToSepolia}>Switch to Sepolia</SecondaryButton>
          ) : (
            <Badge tone="safe">{shortAddress(wallet.address!)}</Badge>
          )
        }
      />

      {!wallet.isConnected || !wallet.isSepolia ? (
        <p className="text-sm text-paper/40 max-w-xl">
        Connect your Sepolia account to view and manage its liquid position. You can supply
          collateral, draw credit, repay, or withdraw while the protection policy monitors the
          account independently.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile
              label="Health factor"
              value={healthFactor !== null ? formatHealthFactor(healthFactor) : "—"}
              valueClassName={healthFactor !== null && healthFactor < WAD ? "text-signal" : "text-safe"}
            />
            <StatTile label="Collateral (fmETH)" value={collateral !== null ? fmt(collateral) : "—"} />
            <StatTile label="Debt (fmUSD)" value={debt !== null ? fmt(debt) : "—"} />
            <StatTile label="Available balance" value={walletBalance !== null ? fmt(walletBalance) : "—"} sub="fmETH" />
          </div>

          <div className="flex items-center gap-3 pt-1 border-t border-line/60">
            <label className="text-xs text-paper/40 pt-4">Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mono text-sm bg-transparent border border-line rounded-md px-3 py-2 w-28 text-paper mt-4"
              placeholder="amount"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              disabled={busy !== null}
              onClick={() => run("faucet", () => withVault((_v, collateralToken) => collateralToken.faucet(parsedAmount)))}
            >
              {busy === "faucet" ? "Confirm in wallet…" : "Receive collateral"}
            </SecondaryButton>
            <PrimaryButton
              disabled={busy !== null}
              onClick={() =>
                run("deposit", async () =>
                  withVault(async (vault, collateralToken) => {
                    const allowance: bigint = await collateralToken.allowance(wallet.address, vaultAddress);
                    if (allowance < parsedAmount) {
                      const approveTx = await collateralToken.approve(vaultAddress, parsedAmount);
                      await approveTx.wait();
                    }
                    return vault.deposit(parsedAmount);
                  })
                )
              }
            >
              {busy === "deposit" ? "Confirm in wallet…" : "Deposit"}
            </PrimaryButton>
            <PrimaryButton
              disabled={busy !== null}
              onClick={() => run("borrow", () => withVault((vault) => vault.borrow(parsedAmount)))}
            >
              {busy === "borrow" ? "Confirm in wallet…" : "Borrow"}
            </PrimaryButton>
            <SecondaryButton
              disabled={busy !== null}
              onClick={() =>
                run("repay", async () =>
                  withVault(async (vault, _c, debtToken) => {
                    const allowance: bigint = await debtToken.allowance(wallet.address, vaultAddress);
                    if (allowance < parsedAmount) {
                      const approveTx = await debtToken.approve(vaultAddress, parsedAmount);
                      await approveTx.wait();
                    }
                    return vault.repay(parsedAmount);
                  })
                )
              }
            >
              {busy === "repay" ? "Confirm in wallet…" : "Repay"}
            </SecondaryButton>
            <SecondaryButton
              disabled={busy !== null}
              onClick={() => run("withdraw", () => withVault((vault) => vault.withdraw(parsedAmount)))}
            >
              {busy === "withdraw" ? "Confirm in wallet…" : "Withdraw"}
            </SecondaryButton>
          </div>
          {note && <p className="mono text-xs text-paper/50 break-all">{note}</p>}
        </>
      )}
    </Card>
  );
}

export default function PositionPage() {
  const { sepolia, busy, setMark } = useDashboard();

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading eyebrow="Sepolia vault" title="Your position" />

      {sepolia?.configured ? (
        <YourWalletPosition
          vaultAddress={sepolia.vaultAddress}
          collateralTokenAddress={sepolia.collateralTokenAddress}
          debtTokenAddress={sepolia.debtTokenAddress}
        />
      ) : (
        <Empty hint="The Sepolia account environment is not available yet." />
      )}

      {sepolia?.configured && (
        <Card className="flex flex-col gap-5" accent={sepolia.healthy ? "safe" : "signal"}>
          <SectionHeading
            eyebrow="Account under protection"
            title="Reference position"
            action={<Badge tone={sepolia.healthy ? "safe" : "signal"}>{sepolia.healthy ? "Within policy" : "Liquidation required"}</Badge>}
          />
          <p className="text-sm text-paper/40 max-w-xl">
            This account is used for the live protection walkthrough. Price controls below are
            reserved for authorised market testing and do not affect other connected accounts.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatTile
              label="Health factor"
              value={sepolia.healthFactor}
              valueClassName={sepolia.healthy ? "text-safe" : "text-signal"}
            />
            <StatTile
              label="Borrowing access"
              value={sepolia.borrowingRestricted ? "Restricted" : "Available"}
              valueClassName={sepolia.borrowingRestricted ? "text-warn" : "text-safe"}
              sub={sepolia.borrowingRestricted ? "Exposure policy" : "Within policy"}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-paper/40">Vault</span>
              <AddressChip address={sepolia.vaultAddress} href={`https://sepolia.etherscan.io/address/${sepolia.vaultAddress}`} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-paper/40">Protection executor</span>
              <AddressChip address={sepolia.executorAddress} href={`https://sepolia.etherscan.io/address/${sepolia.executorAddress}`} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton tone="signal" disabled={busy !== null} onClick={() => setMark("stress")}>
              {busy === "mark:stress" ? "Marking down…" : "Crash the crypto mark"}
            </PrimaryButton>
            <SecondaryButton disabled={busy !== null} onClick={() => setMark("restore")}>
              {busy === "mark:restore" ? "Restoring…" : "Restore live mark"}
            </SecondaryButton>
          </div>
        </Card>
      )}
    </div>
  );
}
