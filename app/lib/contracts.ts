import { ethers } from "ethers";
import { env } from "./env";
import vaultAbi from "./abi/CryptoMarginVault.json";
import executorAbi from "./abi/FirewallMarginExecutor.json";
import registryAbi from "./abi/ProtectedCollateralRegistry.json";
import erc20Abi from "./abi/MockCollateral.json";

export function getSepoliaProvider() {
  if (!env.sepoliaRpcUrl) return null;
  return new ethers.JsonRpcProvider(env.sepoliaRpcUrl, undefined, { staticNetwork: true });
}

function readerFor(address: string | undefined, abi: ethers.InterfaceAbi) {
  const provider = getSepoliaProvider();
  if (!provider || !address) return null;
  return new ethers.Contract(address, abi, provider);
}

/**
 * The operator wallet. It holds three distinct roles in this demo and it is worth
 * being precise about which: it is the vault's demo price operator, it is the
 * address the executor currently accepts reports from (standing in for the CRE
 * Forwarder until DON deployment access is granted), and it pays gas. It is NOT
 * able to seize the protected note — no key can; only the account's margin mode
 * decides that.
 */
function writerFor(address: string | undefined, abi: ethers.InterfaceAbi) {
  const provider = getSepoliaProvider();
  if (!provider || !address || !env.sepoliaDeployerKey) return null;
  return new ethers.Contract(address, abi, new ethers.Wallet(env.sepoliaDeployerKey, provider));
}

export const getVaultReader = () => readerFor(env.sepoliaVault, vaultAbi);
export const getVaultWriter = () => writerFor(env.sepoliaVault, vaultAbi);
export const getRegistryReader = () => readerFor(env.sepoliaRegistry, registryAbi);
export const getExecutorWriter = () => writerFor(env.sepoliaExecutor, executorAbi);
export const getErc20Reader = (address: string) => readerFor(address, erc20Abi);

export const WAD = 10n ** 18n;

export const usd = (value: bigint): number => Number(ethers.formatUnits(value, 18));

export function formatHealthFactor(hf: bigint): string {
  if (hf > 1_000_000n * WAD) return "∞"; // no debt
  return Number(ethers.formatUnits(hf, 18)).toFixed(2);
}
