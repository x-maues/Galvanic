import { ethers } from "ethers";
import { env } from "./env";
import vaultAbi from "./abi/CryptoMarginVault.json";
import erc20Abi from "./abi/MockCollateral.json";

export function getSepoliaProvider() {
  if (!env.sepoliaRpcUrl) return null;
  return new ethers.JsonRpcProvider(env.sepoliaRpcUrl, undefined, {
    staticNetwork: true,
  });
}

export function getVaultReader() {
  const provider = getSepoliaProvider();
  if (!provider || !env.sepoliaVault) return null;
  return new ethers.Contract(env.sepoliaVault, vaultAbi, provider);
}

export function getVaultWriter() {
  const provider = getSepoliaProvider();
  if (!provider || !env.sepoliaVault || !env.sepoliaDeployerKey) return null;
  const wallet = new ethers.Wallet(env.sepoliaDeployerKey, provider);
  return new ethers.Contract(env.sepoliaVault, vaultAbi, wallet);
}

export function getErc20Reader(address: string) {
  const provider = getSepoliaProvider();
  if (!provider) return null;
  return new ethers.Contract(address, erc20Abi, provider);
}

export const WAD = 10n ** 18n;

export function formatHealthFactor(hf: bigint): string {
  if (hf > 1_000_000n * WAD) return "∞"; // no debt
  return Number(ethers.formatUnits(hf, 18)).toFixed(2);
}
