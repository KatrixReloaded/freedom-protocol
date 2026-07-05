import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentConfigFromEnv } from "../deployment-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.FREEDOM_ENV_OUTPUT
  ? path.resolve(process.env.FREEDOM_ENV_OUTPUT)
  : path.resolve(__dirname, "../src/generated-env.js");
const config = deploymentConfigFromEnv(process.env);
const body = `const GENERATED_DEPLOYMENTS = ${JSON.stringify(config, null, 2)};\n\nexport { GENERATED_DEPLOYMENTS };\n`;

fs.writeFileSync(output, body);
console.log(`Wrote ${path.relative(process.cwd(), output)}`);
