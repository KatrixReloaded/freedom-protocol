import type { Address, Hex } from "viem";

export interface TxPrecondition {
  kind: string;
  status: "satisfied" | "missing" | "unknown";
  spender?: Address;
  current?: string;
  required?: string;
  message?: string;
}

export interface TxResponse {
  chainId: number;
  to: Address;
  data: Hex;
  value: string;
  functionName: string;
  args: unknown[];
  summary: string;
  preconditions: TxPrecondition[];
  warnings: string[];
}

export interface ApiError {
  error: string;
  details?: unknown;
}

