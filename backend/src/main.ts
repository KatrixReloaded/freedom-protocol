import { loadConfig } from "./config/env.js";
import { CleanupRunner } from "./cleanup/retention.js";
import { PgRepository } from "./db/pg.js";
import { createServer } from "./http/server.js";
import { MarketIndexer } from "./indexer/poller.js";
import { ViemBridgeFinalizeClient } from "./keeper/finalizeClient.js";
import { ZamaPublicDecryptService } from "./keeper/publicDecrypt.js";
import { ViemSettlementClient } from "./keeper/settlementClient.js";
import { SettlementKeeper } from "./keeper/settlementKeeper.js";
import { UnshieldKeeper } from "./keeper/unshieldKeeper.js";
import { errorMessage } from "./errors.js";

const config = loadConfig();
const repository = new PgRepository(config);
await repository.migrate();
await repository.initializeConfig(config);

const server = createServer(config, repository);
await server.listen({ host: config.host, port: config.port });

const cleanup = new CleanupRunner(config, repository);

const indexer = new MarketIndexer(config, repository);

const keeper = new UnshieldKeeper(
  config,
  repository,
  new ZamaPublicDecryptService(config),
  new ViemBridgeFinalizeClient(config),
);

const settlementKeeper = new SettlementKeeper(config, repository, new ViemSettlementClient(config));

function startBackgroundRunner(name: string, runner: { start(): Promise<void> }): void {
  void runner.start().catch((error) => {
    console.warn(`${name} failed to start: ${errorMessage(error)}`);
  });
}

startBackgroundRunner("cleanup", cleanup);
startBackgroundRunner("indexer", indexer);
startBackgroundRunner("unshield keeper", keeper);
startBackgroundRunner("settlement keeper", settlementKeeper);

async function shutdown(): Promise<void> {
  await cleanup.stop();
  await settlementKeeper.stop();
  await keeper.stop();
  await indexer.stop();
  await server.close();
  await repository.close();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
