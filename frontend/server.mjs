import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentConfigFromEnv } from "./deployment-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5173);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function envScript() {
  const config = deploymentConfigFromEnv(process.env);
  return `window.__FREEDOM_CONFIG__ = ${JSON.stringify(config)};\n`;
}

function fileFor(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  if (clean.startsWith("/src/")) return path.join(root, clean);
  if (clean === "/" || clean === "/deposit" || clean === "/trade" || clean === "/settle" || clean === "/shield") {
    return path.join(root, "index.html");
  }
  return path.join(root, clean);
}

http
  .createServer((req, res) => {
    const urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/env.js") return send(res, 200, envScript(), "text/javascript; charset=utf-8");
    if (urlPath === "/") {
      res.writeHead(302, { location: "/deposit" });
      res.end();
      return;
    }
    const file = fileFor(req.url || "/");
    if (!file.startsWith(root)) return send(res, 403, "Forbidden");
    fs.readFile(file, (error, body) => {
      if (error) return send(res, 404, "Not found");
      send(res, 200, body, types.get(path.extname(file)) || "application/octet-stream");
    });
  })
  .listen(port, host, () => {
    console.log(`Freedom frontend listening on http://${host}:${port}`);
  });
