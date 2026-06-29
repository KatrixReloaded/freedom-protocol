import type { PublicClient } from "viem";
import { clientForDeployment } from "../config/chains.js";
import type { DeploymentRegistry } from "../config/deployments.js";

export class ChainClients {
  private readonly clients = new Map<number, PublicClient>();

  constructor(private readonly registry: DeploymentRegistry) {}

  get(chainId: number): PublicClient | undefined {
    if (this.clients.has(chainId)) return this.clients.get(chainId);
    const deployment = this.registry.chain(chainId);
    if (!deployment) return undefined;
    const client = clientForDeployment(deployment);
    if (client) this.clients.set(chainId, client);
    return client;
  }
}

