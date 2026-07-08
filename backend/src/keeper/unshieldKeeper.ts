import type { Hex } from "viem";
import type { AppConfig } from "../types.js";
import type { Repository } from "../db/repository.js";
import type { BridgeFinalizeClient } from "./finalizeClient.js";
import type { PublicDecryptService } from "./publicDecrypt.js";
import { errorMessage } from "../errors.js";

function isAlreadyFinalizedError(message: string): boolean {
  return /AlreadyFinalized|already finalized|request.*finalized/i.test(message);
}

export class UnshieldKeeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly repository: Repository,
    private readonly publicDecrypt: PublicDecryptService,
    private readonly finalizeClient: BridgeFinalizeClient,
  ) {}

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.keeperPollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const headByChain = new Map<number, bigint>();
      for (const chain of this.config.chains) {
        if (!chain.bridges.some((bridge) => bridge.keeperEnabled && bridge.keeperPrivateKey)) continue;
        try {
          headByChain.set(chain.chainId, await this.finalizeClient.getBlockNumber(chain.chainId));
        } catch {
          continue;
        }
      }
      const requests = await this.repository.listKeeperReadyBridgeRequests({
        chains: this.config.chains,
        headByChain,
      });

      for (const request of requests) {
        await this.finalizeRequest(request.id);
      }
    } finally {
      this.running = false;
    }
  }

  async finalizeRequest(id: string): Promise<void> {
    const request = await this.repository.getBridgeRequest(id);
    if (!request || request.status === "finalized" || request.status === "finalize_submitted") return;

    const chain = this.config.chains.find((candidate) => candidate.chainId === request.chainId);
    const bridge = chain?.bridges.find((candidate) => candidate.address === request.bridgeAddress);
    if (!chain || !bridge?.keeperEnabled || !bridge.keeperPrivateKey) return;

    await this.repository.updateBridgeRequestStatus({ id, status: "decrypting", error: null });

    try {
      const decrypted = await this.publicDecrypt.publicDecryptHandle({
        chainId: request.chainId,
        handle: request.burnedAmountHandle,
        type: "euint64",
        fheConfig: chain.fheConfig,
      });

      if (decrypted.clearValue > BigInt(request.requestedAmount)) {
        await this.repository.updateBridgeRequestStatus({
          id,
          status: "failed",
          error: "public decrypt amount exceeds requested amount",
        });
        return;
      }

      const txHash = await this.finalizeClient.finalizeUnshield({
        chainId: request.chainId,
        bridgeAddress: request.bridgeAddress,
        requestId: BigInt(request.requestId),
        abiEncodedCleartexts: decrypted.abiEncodedCleartexts,
        decryptionProof: decrypted.decryptionProof,
        privateKey: bridge.keeperPrivateKey,
      });

      await this.repository.updateBridgeRequestStatus({
        id,
        status: "finalize_submitted",
        finalizeTxHash: txHash,
        error: null,
      });
    } catch (error) {
      const message = errorMessage(error);
      await this.repository.updateBridgeRequestStatus({
        id,
        status: "failed",
        error: isAlreadyFinalizedError(message) ? "already finalized; waiting for indexed event" : message,
      });
    }
  }
}
