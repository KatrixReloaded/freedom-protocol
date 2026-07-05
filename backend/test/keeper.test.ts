import { encodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/db/memory.js";
import type { BridgeFinalizeClient, FinalizeUnshieldInput } from "../src/keeper/finalizeClient.js";
import type { PublicDecryptRequest, PublicDecryptService } from "../src/keeper/publicDecrypt.js";
import { UnshieldKeeper } from "../src/keeper/unshieldKeeper.js";
import {
  bridgeAddress,
  bridgeConfig,
  burnedAmountHandle,
  keeperPrivateKey,
  testConfig,
  unshieldFinalizedLog,
  unshieldRequestedLog,
} from "./helpers.js";
import { EventProcessor } from "../src/indexer/eventProcessor.js";

class MockDecrypt implements PublicDecryptService {
  calls: PublicDecryptRequest[] = [];
  throwError: Error | null = null;

  async publicDecryptHandle(request: PublicDecryptRequest) {
    this.calls.push(request);
    if (this.throwError) throw this.throwError;
    return {
      clearValue: 900_000n,
      abiEncodedCleartexts: encodeAbiParameters(parseAbiParameters("uint64"), [900_000n]),
      decryptionProof: "0x1234" as Hex,
    };
  }
}

class MockFinalize implements BridgeFinalizeClient {
  calls: FinalizeUnshieldInput[] = [];
  throwError: Error | null = null;

  async getBlockNumber() {
    return 100n;
  }

  async finalizeUnshield(input: FinalizeUnshieldInput) {
    this.calls.push(input);
    if (this.throwError) throw this.throwError;
    return `0x${"aa".repeat(32)}` as Hex;
  }
}

async function repoWithRequest(config = testConfig) {
  const repo = new MemoryRepository();
  await repo.initializeConfig(config);
  const processor = new EventProcessor(repo);
  await processor.processBridgeLog(31337, bridgeConfig, unshieldRequestedLog());
  return repo;
}

describe("UnshieldKeeper", () => {
  it("skips when keeper is disabled or has no signer", async () => {
    const repo = await repoWithRequest();
    const decrypt = new MockDecrypt();
    const finalize = new MockFinalize();
    const keeper = new UnshieldKeeper(testConfig, repo, decrypt, finalize);

    await keeper.tick();

    expect(decrypt.calls).toHaveLength(0);
    expect(finalize.calls).toHaveLength(0);
    expect((await repo.getBridgeRequest(`31337:${bridgeAddress}:9`))?.status).toBe("requested");
  });

  it("public-decrypts the handle and submits finalize when enabled", async () => {
    const enabledConfig = {
      ...testConfig,
      chains: [
        {
          ...testConfig.chains[0],
          bridges: [{ ...bridgeConfig, keeperEnabled: true, keeperPrivateKey }],
        },
      ],
    };
    const repo = await repoWithRequest(enabledConfig);
    const decrypt = new MockDecrypt();
    const finalize = new MockFinalize();
    const keeper = new UnshieldKeeper(enabledConfig, repo, decrypt, finalize);

    await keeper.tick();

    expect(decrypt.calls[0]).toMatchObject({ chainId: 31337, handle: burnedAmountHandle, type: "euint64" });
    expect(finalize.calls[0]).toMatchObject({
      chainId: 31337,
      bridgeAddress,
      requestId: 9n,
      privateKey: keeperPrivateKey,
    });
    const request = await repo.getBridgeRequest(`31337:${bridgeAddress}:9`);
    expect(request?.status).toBe("finalize_submitted");
    expect(request?.finalizeTxHash).toMatch(/^0xaa/);
  });

  it("keeps final status event-indexed rather than setting finalized after tx submission", async () => {
    const enabledConfig = {
      ...testConfig,
      chains: [
        {
          ...testConfig.chains[0],
          bridges: [{ ...bridgeConfig, keeperEnabled: true, keeperPrivateKey }],
        },
      ],
    };
    const repo = await repoWithRequest(enabledConfig);
    const decrypt = new MockDecrypt();
    const finalize = new MockFinalize();
    const keeper = new UnshieldKeeper(enabledConfig, repo, decrypt, finalize);
    await keeper.tick();

    expect((await repo.getBridgeRequest(`31337:${bridgeAddress}:9`))?.status).toBe("finalize_submitted");

    const processor = new EventProcessor(repo);
    await processor.processBridgeLog(31337, { ...bridgeConfig, keeperEnabled: true, keeperPrivateKey }, unshieldFinalizedLog());
    expect((await repo.getBridgeRequest(`31337:${bridgeAddress}:9`))?.status).toBe("finalized");
  });

  it("marks failed on public decrypt errors and can retry failed requests", async () => {
    const enabledConfig = {
      ...testConfig,
      chains: [
        {
          ...testConfig.chains[0],
          bridges: [{ ...bridgeConfig, keeperEnabled: true, keeperPrivateKey }],
        },
      ],
    };
    const repo = await repoWithRequest(enabledConfig);
    const decrypt = new MockDecrypt();
    decrypt.throwError = new Error("public decrypt unavailable / SDK not configured");
    const finalize = new MockFinalize();
    const keeper = new UnshieldKeeper(enabledConfig, repo, decrypt, finalize);

    await keeper.tick();
    expect((await repo.getBridgeRequest(`31337:${bridgeAddress}:9`))?.status).toBe("failed");

    decrypt.throwError = null;
    await keeper.tick();
    expect((await repo.getBridgeRequest(`31337:${bridgeAddress}:9`))?.status).toBe("finalize_submitted");
  });

  it("handles already-finalized transaction errors gracefully", async () => {
    const enabledConfig = {
      ...testConfig,
      chains: [
        {
          ...testConfig.chains[0],
          bridges: [{ ...bridgeConfig, keeperEnabled: true, keeperPrivateKey }],
        },
      ],
    };
    const repo = await repoWithRequest(enabledConfig);
    const decrypt = new MockDecrypt();
    const finalize = new MockFinalize();
    finalize.throwError = new Error("ShieldBridge__AlreadyFinalized()");
    const keeper = new UnshieldKeeper(enabledConfig, repo, decrypt, finalize);

    await keeper.tick();
    const request = await repo.getBridgeRequest(`31337:${bridgeAddress}:9`);
    expect(request?.status).toBe("failed");
    expect(request?.error).toContain("already finalized");
  });
});
