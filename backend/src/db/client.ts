import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backendRoot, loadEnv } from "../env.js";
import type { ChainDeployment } from "../types/contracts.js";

export type Db = DatabaseSync;

function dbPathFromUrl(databaseUrl: string): string {
  if (databaseUrl === ":memory:" || databaseUrl === "file::memory:") return ":memory:";
  if (databaseUrl.startsWith("file:")) return path.resolve(backendRoot, databaseUrl.slice("file:".length));
  return path.resolve(backendRoot, databaseUrl);
}

export function openDb(databaseUrl = loadEnv().databaseUrl): Db {
  const filename = dbPathFromUrl(databaseUrl);
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const schemaPath = path.join(backendRoot, "src", "db", "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf8"));
}

export function seedDeployments(db: Db, chains: ChainDeployment[]): void {
  const upsertChain = db.prepare(
    "INSERT INTO chains (chain_id, rpc_url, start_block, confirmations, oracle) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(chain_id) DO UPDATE SET rpc_url=excluded.rpc_url,start_block=excluded.start_block,confirmations=excluded.confirmations,oracle=excluded.oracle"
  );
  const upsertDeployment = db.prepare(
    "INSERT INTO deployments (chain_id, kind, address, data) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(chain_id, kind, address) DO UPDATE SET data=excluded.data"
  );
  const upsertFactory = db.prepare(
    "INSERT INTO factories (chain_id, factory_address, mode, collateral_token, vault_address, oracle, bridge_address, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(chain_id, factory_address) DO UPDATE SET mode=excluded.mode,collateral_token=excluded.collateral_token,vault_address=excluded.vault_address,oracle=excluded.oracle,bridge_address=excluded.bridge_address,data=excluded.data"
  );

  for (const chain of chains) {
    upsertChain.run(chain.chainId, chain.rpcUrl ?? null, chain.startBlock ?? 0, chain.confirmations ?? 3, chain.oracle ?? null);
    for (const factory of chain.publicFactories) {
      upsertDeployment.run(chain.chainId, "publicFactory", factory.factory, JSON.stringify(factory));
      upsertFactory.run(
        chain.chainId,
        factory.factory,
        factory.mode,
        factory.collateralToken,
        factory.vault,
        chain.oracle ?? null,
        chain.bridge ?? null,
        JSON.stringify(factory)
      );
    }
    for (const factory of chain.confidentialFactories) {
      upsertDeployment.run(chain.chainId, "confidentialFactory", factory.factory, JSON.stringify(factory));
      upsertFactory.run(
        chain.chainId,
        factory.factory,
        factory.mode,
        factory.cWETH,
        factory.vault,
        chain.oracle ?? null,
        chain.bridge ?? null,
        JSON.stringify(factory)
      );
    }
    if (chain.bridge) upsertDeployment.run(chain.chainId, "bridge", chain.bridge, JSON.stringify({ address: chain.bridge }));
    if (chain.matchingEngine) {
      upsertDeployment.run(chain.chainId, "matchingEngine", chain.matchingEngine, JSON.stringify({ address: chain.matchingEngine }));
    }
  }
}

export function getCheckpoint(db: Db, chainId: number, indexerName: string, startBlock: bigint) {
  const row = db
    .prepare("SELECT last_indexed_block,last_finalized_block FROM indexer_checkpoints WHERE chain_id=? AND indexer_name=?")
    .get(chainId, indexerName) as { last_indexed_block: number; last_finalized_block: number } | undefined;
  if (row) return { lastIndexedBlock: BigInt(row.last_indexed_block), lastFinalizedBlock: BigInt(row.last_finalized_block) };
  return { lastIndexedBlock: startBlock - 1n, lastFinalizedBlock: startBlock - 1n };
}

export function saveCheckpoint(
  db: Db,
  chainId: number,
  indexerName: string,
  lastIndexedBlock: bigint,
  lastFinalizedBlock: bigint
): void {
  db.prepare(
    "INSERT INTO indexer_checkpoints (chain_id,indexer_name,last_indexed_block,last_finalized_block,updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) " +
      "ON CONFLICT(chain_id,indexer_name) DO UPDATE SET last_indexed_block=excluded.last_indexed_block,last_finalized_block=excluded.last_finalized_block,updated_at=CURRENT_TIMESTAMP"
  ).run(chainId, indexerName, Number(lastIndexedBlock), Number(lastFinalizedBlock));
}

