import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentConfigFromEnv } from "../deployment-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDir(source, target);
    } else if (entry.isFile()) {
      await fs.copyFile(source, target);
    }
  }
}

const config = deploymentConfigFromEnv(process.env);
const generated = `const GENERATED_DEPLOYMENTS = ${JSON.stringify(config, null, 2)};\n\nexport { GENERATED_DEPLOYMENTS };\n`;

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(path.join(dist, "src"), { recursive: true });
await fs.writeFile(path.join(root, "src", "generated-env.js"), generated);
await fs.copyFile(path.join(root, "index.html"), path.join(dist, "index.html"));
await fs.copyFile(path.join(root, "env.js"), path.join(dist, "env.js"));
await copyDir(path.join(root, "src"), path.join(dist, "src"));

console.log("Wrote dist static frontend");
