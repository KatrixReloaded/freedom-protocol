import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../config/env.js";

const { Pool } = pg;

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const currentDir = dirname(fileURLToPath(import.meta.url));
    const migrationsDir = join(currentDir, "../../migrations");
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const exists = await pool.query("select 1 from schema_migrations where filename = $1", [file]);
      if (exists.rowCount) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await pool.query("begin");
      try {
        await pool.query(sql);
        await pool.query("insert into schema_migrations(filename) values($1)", [file]);
        await pool.query("commit");
      } catch (error) {
        await pool.query("rollback");
        throw error;
      }
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  await runMigrations(config.databaseUrl);
}
