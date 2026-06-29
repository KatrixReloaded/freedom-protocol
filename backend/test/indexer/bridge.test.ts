import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Log } from "viem";
import { processBridgeLog } from "../../src/indexer/bridge.js";
import { A, testContext } from "../helpers.js";

function requestedLog(): Log {
  return {
    address: A.bridge,
    blockNumber: 10n,
    blockHash: "0x0000000000000000000000000000000000000000000000000000000000000010",
    transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({
      abi: [
        {
          type: "event",
          name: "UnshieldRequested",
          inputs: [
            { name: "requestId", type: "uint256", indexed: true },
            { name: "user", type: "address", indexed: true },
            { name: "strike", type: "uint256", indexed: true },
            { name: "maturity", type: "uint64" },
            { name: "isStable", type: "bool" },
            { name: "requestedAmount", type: "uint64" },
            { name: "burnedAmountHandle", type: "bytes32" }
          ]
        }
      ],
      eventName: "UnshieldRequested",
      args: { requestId: 7n, user: A.oracle, strike: 2000n }
    }),
    data: encodeAbiParameters(parseAbiParameters("uint64,bool,uint64,bytes32"), [
      1800000000n,
      true,
      500000n,
      "0x000000000000000000000000000000000000000000000000000000000007a120"
    ])
  } as unknown as Log;
}

function finalizedLog(): Log {
  return {
    address: A.bridge,
    blockNumber: 11n,
    blockHash: "0x0000000000000000000000000000000000000000000000000000000000000011",
    transactionHash: "0x00000000000000000000000000000000000000000000000000000000000000bb",
    transactionIndex: 0,
    logIndex: 1,
    removed: false,
    topics: encodeEventTopics({
      abi: [
        {
          type: "event",
          name: "UnshieldFinalized",
          inputs: [
            { name: "requestId", type: "uint256", indexed: true },
            { name: "user", type: "address", indexed: true },
            { name: "strike", type: "uint256", indexed: true },
            { name: "maturity", type: "uint64" },
            { name: "isStable", type: "bool" },
            { name: "amount", type: "uint64" }
          ]
        }
      ],
      eventName: "UnshieldFinalized",
      args: { requestId: 7n, user: A.oracle, strike: 2000n }
    }),
    data: encodeAbiParameters(parseAbiParameters("uint64,bool,uint64"), [1800000000n, true, 300000n])
  } as unknown as Log;
}

test("bridge indexer stores request idempotently and finalizes actual amount separately", () => {
  const ctx = testContext();
  assert.equal(processBridgeLog(ctx.db, ctx.registry, ctx.abis, 31337, requestedLog()), true);
  assert.equal(processBridgeLog(ctx.db, ctx.registry, ctx.abis, 31337, requestedLog()), true);
  let rows = ctx.db.prepare("SELECT * FROM bridge_requests").all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requested_amount, "500000");
  assert.equal(rows[0].actual_burned_amount, null);
  assert.equal(rows[0].burned_amount_handle, "0x000000000000000000000000000000000000000000000000000000000007a120");

  assert.equal(processBridgeLog(ctx.db, ctx.registry, ctx.abis, 31337, finalizedLog()), true);
  rows = ctx.db.prepare("SELECT * FROM bridge_requests").all() as any[];
  assert.equal(rows[0].requested_amount, "500000");
  assert.equal(rows[0].actual_burned_amount, "300000");
  assert.equal(rows[0].status, "finalized");
});
