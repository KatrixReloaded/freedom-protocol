import { describe, expect, it } from "vitest";
import { chunkBlockRanges, planCursorRange } from "../src/indexer/cursor.js";

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
});
