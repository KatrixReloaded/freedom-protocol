import type { AppConfig } from "../types.js";
import type { Repository } from "../db/repository.js";

export class CleanupRunner {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly repository: Repository,
  ) {}

  async start(): Promise<void> {
    if (!this.config.cleanupEnabled) return;
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.cleanupPollIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runOnce(): Promise<void> {
    try {
      const result = await this.repository.cleanupAncientData({
        retentionDays: this.config.cleanupRetentionDays,
        indexedLogRetentionBlocks: this.config.indexedLogRetentionBlocks,
      });
      console.info(
        `cleanup complete bridgeRequests=${result.bridgeRequestsDeleted} marketListings=${result.marketListingsDeleted} series=${result.seriesDeleted} indexedLogs=${result.indexedLogsDeleted}`,
      );
    } catch (error) {
      console.warn(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
