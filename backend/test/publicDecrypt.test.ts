import { describe, expect, it } from "vitest";
import { type Hex } from "viem";
import { ZamaPublicDecryptService } from "../src/keeper/publicDecrypt.js";
import type { AppConfig } from "../src/types.js";

const handle = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;

function sepoliaConfig(): AppConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    databaseUrl: "postgres://unused",
    pollIntervalMs: 10_000,
    keeperPollIntervalMs: 10_000,
    settlementKeeperPollIntervalMs: 10_000,
    rewindBlocks: 5n,
    maxBlockRange: 1_000n,
    chains: [
      {
        chainId: 11155111,
        name: "sepolia",
        rpcUrl: "https://sepolia.example",
        confirmationDepth: 1,
        settlementKeeperEnabled: false,
        factories: [],
        matchingEngines: [],
        bridges: [],
        fheConfig: { relayerUrl: "https://relayer.testnet.zama.org" },
      },
    ],
  };
}

describe("ZamaPublicDecryptService", () => {
  it("maps SDK public decrypt results to keeper finalize inputs", async () => {
    const createCalls: unknown[] = [];
    const decryptCalls: unknown[] = [];
    const service = new ZamaPublicDecryptService(sepoliaConfig(), async (config) => {
      createCalls.push(config);
      return {
        async publicDecrypt(handles) {
          decryptCalls.push(handles);
          return {
            clearValues: { [handle]: 100_000_000n },
            abiEncodedClearValues: "0x1234",
            decryptionProof: "0xabcd",
          };
        },
      };
    });

    const result = await service.publicDecryptHandle({
      chainId: 11155111,
      handle,
      type: "euint64",
      fheConfig: { relayerUrl: "https://relayer.testnet.zama.org" },
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      chainId: 11155111,
      network: "https://sepolia.example",
      relayerUrl: "https://relayer.testnet.zama.org",
    });
    expect(decryptCalls).toEqual([[handle]]);
    expect(result).toEqual({
      clearValue: 100_000_000n,
      abiEncodedCleartexts: "0x1234",
      decryptionProof: "0xabcd",
    });
  });

  it("reuses the SDK instance for the same chain and relayer config", async () => {
    let createCount = 0;
    const service = new ZamaPublicDecryptService(sepoliaConfig(), async () => {
      createCount += 1;
      return {
        async publicDecrypt() {
          return {
            clearValues: { [handle]: 100_000_000n },
            abiEncodedClearValues: "0x1234",
            decryptionProof: "0xabcd",
          };
        },
      };
    });

    await service.publicDecryptHandle({
      chainId: 11155111,
      handle,
      type: "euint64",
      fheConfig: { relayerUrl: "https://relayer.testnet.zama.org" },
    });
    await service.publicDecryptHandle({
      chainId: 11155111,
      handle,
      type: "euint64",
      fheConfig: { relayerUrl: "https://relayer.testnet.zama.org" },
    });

    expect(createCount).toBe(1);
  });

  it("fails clearly when relayer config is missing", async () => {
    const service = new ZamaPublicDecryptService(sepoliaConfig(), async () => {
      throw new Error("should not create SDK instance");
    });

    await expect(
      service.publicDecryptHandle({
        chainId: 11155111,
        handle,
        type: "euint64",
      }),
    ).rejects.toThrow("missing fheConfig.relayerUrl");
  });
});
