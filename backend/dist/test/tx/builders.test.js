import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { A, confidentialSeriesKey, publicSeriesKey, request } from "../helpers.js";
async function post(path, body) {
    const res = await request("POST", path, body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
}
test("public ERC20 approval uses vault as spender", async () => {
    const tx = await post("/tx/public/approve-collateral", {
        chainId: 31337,
        factory: A.publicFactory,
        amount: "1000000"
    });
    assert.equal(tx.to, A.collateral);
    assert.equal(tx.functionName, "approve");
    assert.equal(tx.preconditions[0].spender, A.publicVault);
});
test("public split targets factory and flags vault allowance", async () => {
    const tx = await post("/tx/public/split", { seriesKey: publicSeriesKey, amount: "1000000" });
    assert.equal(tx.to, A.publicFactory);
    assert.equal(tx.value, "0");
    assert.equal(tx.preconditions[0].spender, A.publicVault);
});
test("confidential split preserves encrypted inputs", async () => {
    const tx = await post("/tx/confidential/split", {
        seriesKey: confidentialSeriesKey,
        encAmount: "0x00000000000000000000000000000000000000000000000000000000000f4240",
        proof: "0x1234"
    });
    assert.equal(tx.to, A.confFactory);
    assert.equal(tx.functionName, "split");
    assert.match(tx.warnings[0], /client-side/);
});
test("bridge builders keep request and finalize separate", async () => {
    const requestTx = await post("/tx/bridge/unshield", {
        chainId: 31337,
        strike: "2000",
        maturity: "1800000000",
        isStable: true,
        amount: "300000"
    });
    assert.equal(requestTx.functionName, "unshield");
    assert.match(requestTx.summary, /Request async unshield/);
    const cleartexts = encodeAbiParameters(parseAbiParameters("uint64"), [300000n]);
    const finalize = await post("/tx/bridge/finalize", {
        chainId: 31337,
        requestId: "0",
        abiEncodedCleartexts: cleartexts,
        decryptionProof: "0xabcd"
    });
    assert.equal(finalize.functionName, "finalizeUnshield");
    assert.match(finalize.summary, /300000/);
    assert.match(finalize.warnings[0], /not the requested amount/);
});
