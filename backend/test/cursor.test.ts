import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/errors.js";
import { chunkBlockRanges, planCursorRange } from "../src/indexer/cursor.js";
import { isSplittableGetLogsError } from "../src/indexer/poller.js";

describe("cursor planning", () => {
  it("starts from configured start block when no cursor exists", () => {
    expect(
      planCursorRange({ lastIndexedBlock: null, startBlock: 10n, safeHead: 25n, rewindBlocks: 5n }),
    ).toEqual({ fromBlock: 10n, toBlock: 25n, shouldIndex: true });
  });

  it("rewinds an existing cursor without going before start block", () => {
    expect(
      planCursorRange({ lastIndexedBlock: 20n, startBlock: 10n, safeHead: 25n, rewindBlocks: 5n }),
    ).toEqual({ fromBlock: 16n, toBlock: 25n, shouldIndex: true });
  });

  it("skips when the confirmed head is behind the planned start", () => {
    expect(
      planCursorRange({ lastIndexedBlock: null, startBlock: 10n, safeHead: 9n, rewindBlocks: 5n }).shouldIndex,
    ).toBe(false);
  });

  it("chunks block ranges", () => {
    expect(chunkBlockRanges(10n, 15n, 2n)).toEqual([
      [10n, 11n],
      [12n, 13n],
      [14n, 15n],
    ]);
  });

  it("identifies provider range errors without splitting rate limits", () => {
    expect(isSplittableGetLogsError(new Error("Log response size exceeded; use a smaller block range"))).toBe(true);
    expect(isSplittableGetLogsError(new Error("Too many request, try again later"))).toBe(false);
  });

  it("redacts RPC API keys from error messages", () => {
    expect(errorMessage(new Error("URL: https://eth-sepolia.g.alchemy.com/v2/secret-key"))).toBe(
      "URL: https://eth-sepolia.g.alchemy.com/v2/[redacted]",
    );
  });
});
