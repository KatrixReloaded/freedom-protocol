import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function fileFor(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  if (clean.startsWith("/src/")) return path.join(root, clean);
  if (clean === "/" || clean === "/deposit" || clean === "/trade" || clean === "/settle") {
    return path.join(root, "index.html");
  }
  return path.join(root, clean);
}

http
  .createServer((req, res) => {
    if ((req.url || "/").split("?")[0] === "/") {
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
