import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Env {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  deploymentsPath: string;
  contractsOut: string;
  indexerEnabled: boolean;
  indexerPollMs: number;
  indexerBlockRange: bigint;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(__dirname, "..", "..");
export const repoRoot = path.resolve(backendRoot, "..");

function envString(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.length > 0 ? process.env[name]! : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric env ${name}=${raw}`);
  return parsed;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function loadEnv(): Env {
  return {
    nodeEnv: envString("NODE_ENV", "development"),
    host: envString("HOST", "127.0.0.1"),
    port: envNumber("PORT", 4010),
    databaseUrl: envString("DATABASE_URL", "file:./freedom.sqlite"),
    deploymentsPath: path.resolve(backendRoot, envString("FREEDOM_DEPLOYMENTS_PATH", "../contracts/deployments")),
    contractsOut: path.resolve(backendRoot, envString("FREEDOM_CONTRACTS_OUT", "../contracts/out")),
    indexerEnabled: envBool("INDEXER_ENABLED", false),
    indexerPollMs: envNumber("INDEXER_POLL_MS", 12_000),
    indexerBlockRange: BigInt(envNumber("INDEXER_BLOCK_RANGE", 2_000))
  };
}

export function rpcUrlFor(chainId: number, configured?: string, rpcUrlEnv?: string): string | undefined {
  if (configured) return configured;
  if (rpcUrlEnv && process.env[rpcUrlEnv]) return process.env[rpcUrlEnv];
  return process.env[`FREEDOM_${chainId}_RPC_URL`];
}

