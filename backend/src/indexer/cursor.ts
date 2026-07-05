export interface CursorPlan {
  fromBlock: bigint;
  toBlock: bigint;
  shouldIndex: boolean;
}

export function planCursorRange(args: {
  lastIndexedBlock: bigint | null;
  startBlock: bigint;
  safeHead: bigint;
  rewindBlocks: bigint;
}): CursorPlan {
  const baseFrom =
    args.lastIndexedBlock === null
      ? args.startBlock
      : args.lastIndexedBlock > args.rewindBlocks
        ? args.lastIndexedBlock - args.rewindBlocks + 1n
        : args.startBlock;
  const fromBlock = baseFrom < args.startBlock ? args.startBlock : baseFrom;
  if (args.safeHead < fromBlock) {
    return { fromBlock, toBlock: args.safeHead, shouldIndex: false };
  }
  return { fromBlock, toBlock: args.safeHead, shouldIndex: true };
}

export function chunkBlockRanges(fromBlock: bigint, toBlock: bigint, maxBlockRange: bigint): Array<[bigint, bigint]> {
  const ranges: Array<[bigint, bigint]> = [];
  let from = fromBlock;
  while (from <= toBlock) {
    const to = from + maxBlockRange - 1n > toBlock ? toBlock : from + maxBlockRange - 1n;
    ranges.push([from, to]);
    from = to + 1n;
  }
  return ranges;
}
