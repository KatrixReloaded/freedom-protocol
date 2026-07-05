import type { AppConfig, SeriesRow } from "../types.js";
import type { Repository } from "../db/repository.js";
import type { SettlementClient } from "./settlementClient.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SettlementKeeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly repository: Repository,
    private readonly settlementClient: SettlementClient,
  ) {}

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.settlementKeeperPollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const chain of this.config.chains) {
        if (!chain.settlementKeeperEnabled) continue;
        if (!chain.settlementKeeperPrivateKey || (!chain.oracleAdapter && !chain.factories.some((factory) => factory.oracleAdapter))) {
          console.warn(`settlement keeper disabled for chain ${chain.chainId}: missing oracle adapter or signer`);
          continue;
        }

        let latest;
        try {
          latest = await this.settlementClient.getLatestBlock(chain.chainId);
        } catch (error) {
          console.warn(`settlement keeper failed to read latest block for chain ${chain.chainId}: ${errorMessage(error)}`);
          continue;
        }

        const candidates = await this.repository.listSettlementCandidates(chain.chainId, latest.timestamp);
        for (const series of candidates) {
          await this.trySettleSeries(series, latest.timestamp);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async trySettleSeries(series: SeriesRow, latestBlockTimestamp: bigint): Promise<void> {
    const chain = this.config.chains.find((candidate) => candidate.chainId === series.chainId);
    const factoryConfig = chain?.factories.find((factory) => factory.address === series.factoryAddress);
    const oracleAdapter = factoryConfig?.oracleAdapter ?? chain?.oracleAdapter;
    if (!chain || !oracleAdapter || !chain.settlementKeeperPrivateKey) return;
    if (series.settled || BigInt(series.maturityTimestamp) > latestBlockTimestamp) return;
    if (this.inFlight.has(series.id)) return;

    this.inFlight.add(series.id);
    try {
      const onChain = await this.settlementClient.readFactorySeries({
        chainId: series.chainId,
        factoryAddress: series.factoryAddress,
        strikePrice: BigInt(series.strikePrice),
        maturityTimestamp: BigInt(series.maturityTimestamp),
      });
      if (!onChain.exists || onChain.settled || onChain.maturityTimestamp > latestBlockTimestamp) return;

      await this.settlementClient.settleSeries({
        chainId: series.chainId,
        mode: series.mode,
        oracleAdapter,
        factoryAddress: series.factoryAddress,
        strikePrice: BigInt(series.strikePrice),
        maturityTimestamp: BigInt(series.maturityTimestamp),
        privateKey: chain.settlementKeeperPrivateKey,
      });
    } catch (error) {
      console.warn(`settlement keeper failed for ${series.id}: ${errorMessage(error)}`);
    } finally {
      this.inFlight.delete(series.id);
    }
  }
}
