import { loadConfig } from "./config/env.js";
import { PgRepository } from "./db/pg.js";
import { createServer } from "./http/server.js";
import { MarketIndexer } from "./indexer/poller.js";
import { ViemBridgeFinalizeClient } from "./keeper/finalizeClient.js";
import { ZamaPublicDecryptService } from "./keeper/publicDecrypt.js";
import { ViemSettlementClient } from "./keeper/settlementClient.js";
import { SettlementKeeper } from "./keeper/settlementKeeper.js";
import { UnshieldKeeper } from "./keeper/unshieldKeeper.js";

const config = loadConfig();
const repository = new PgRepository(config);
await repository.migrate();
await repository.initializeConfig(config);

const indexer = new MarketIndexer(config, repository);
await indexer.start();

const keeper = new UnshieldKeeper(
  config,
  repository,
  new ZamaPublicDecryptService(config),
  new ViemBridgeFinalizeClient(config),
);
await keeper.start();

const settlementKeeper = new SettlementKeeper(config, repository, new ViemSettlementClient(config));
await settlementKeeper.start();

const server = createServer(config, repository);
await server.listen({ host: config.host, port: config.port });

async function shutdown(): Promise<void> {
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
