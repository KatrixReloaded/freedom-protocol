import assert from "node:assert/strict";
import test from "node:test";
import { request } from "../helpers.js";

test("health and config routes respond", async () => {
  const health = await request("GET", "/health");
  assert.equal(health.status, 200);
  assert.equal((health.body as any).ok, true);

  const config = await request("GET", "/config");
  assert.equal((config.body as any).chains[0].chainId, 31337);

  const openapi = await request("GET", "/openapi.json");
  assert.equal((openapi.body as any).info.title, "Freedom Protocol Backend API");
});
