import { createPublicClient, http, type PublicClient } from "viem";
import { foundry, mainnet, sepolia } from "viem/chains";
import { rpcUrlFor } from "../env.js";
import type { ChainDeployment } from "../types/contracts.js";

export function chainConfig(chainId: number) {
  if (chainId === 1) return mainnet;
  if (chainId === 11155111) return sepolia;
  if (chainId === 31337) return foundry;
  return {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] } }
  };
}

export function clientForDeployment(deployment: ChainDeployment): PublicClient | undefined {
  const rpcUrl = rpcUrlFor(deployment.chainId, deployment.rpcUrl, deployment.rpcUrlEnv);
  if (!rpcUrl) return undefined;
  return createPublicClient({ chain: chainConfig(deployment.chainId), transport: http(rpcUrl) });
}

