"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider } from "ethers";

export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

function getInjectedProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return (window as any).ethereum ?? null;
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);

  useEffect(() => {
    setHasProvider(!!getInjectedProvider());
  }, []);

  const sync = useCallback(async () => {
    const eth = getInjectedProvider();
    if (!eth) return;
    const [accounts, cid] = await Promise.all([
      eth.request({ method: "eth_accounts" }) as Promise<string[]>,
      eth.request({ method: "eth_chainId" }) as Promise<string>,
    ]);
    setAddress(accounts[0] ?? null);
    setChainId(cid);
  }, []);

  useEffect(() => {
    sync();
    const eth = getInjectedProvider();
    if (!eth) return;
    const onAccounts = (accounts: string[]) => setAddress(accounts[0] ?? null);
    const onChain = (cid: string) => setChainId(cid);
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [sync]);

  const connect = useCallback(async () => {
    const eth = getInjectedProvider();
    if (!eth) {
      window.open("https://metamask.io/download/", "_blank");
      return;
    }
    setConnecting(true);
    try {
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      setAddress(accounts[0] ?? null);
      const cid: string = await eth.request({ method: "eth_chainId" });
      setChainId(cid);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    // Injected wallets don't expose a real disconnect; this just clears local UI state.
    setAddress(null);
  }, []);

  const switchToSepolia = useCallback(async () => {
    const eth = getInjectedProvider();
    if (!eth) return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      });
    } catch (err: any) {
      if (err?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: SEPOLIA_CHAIN_ID_HEX,
              chainName: "Sepolia",
              nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://rpc.sepolia.org"],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });
      }
    }
    await sync();
  }, [sync]);

  const getSigner = useCallback(async () => {
    const eth = getInjectedProvider();
    if (!eth) return null;
    const provider = new BrowserProvider(eth as any);
    return provider.getSigner();
  }, []);

  return {
    hasProvider,
    address,
    isConnected: !!address,
    isSepolia: chainId === SEPOLIA_CHAIN_ID_HEX,
    connecting,
    connect,
    disconnect,
    switchToSepolia,
    getSigner,
  };
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
