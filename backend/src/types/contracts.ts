import type { Address, Hex } from "viem";

export type Mode = "ETH" | "WETH" | "ERC20" | "cWETH";
export type BridgeStatus = "pending" | "finalized" | "failed" | "retryable";

export interface PublicFactoryDeployment {
  mode: "ETH" | "WETH" | "ERC20";
  collateralToken: Address;
  collateralSymbol?: string;
  collateralDecimals?: number;
  factory: Address;
  vault: Address;
}

export interface ConfidentialFactoryDeployment {
  mode: "cWETH";
  cWETH: Address;
  factory: Address;
  vault: Address;
}

export interface KnownSeriesDeployment {
  factory: Address;
  mode: Mode;
  strike: string;
  maturity: string;
  stableToken?: Address;
  upToken?: Address;
}

export interface ChainDeployment {
  chainId: number;
  rpcUrl?: string;
  rpcUrlEnv?: string;
  startBlock?: number;
  confirmations?: number;
  oracle?: Address;
  publicFactories: PublicFactoryDeployment[];
  confidentialFactories: ConfidentialFactoryDeployment[];
  matchingEngine?: Address;
  seriesPoolImplementation?: Address;
  bridge?: Address;
  quoteTokens?: Record<string, Address>;
  series?: KnownSeriesDeployment[];
}

export interface SeriesRecord {
  key: string;
  chainId: number;
  factoryAddress: Address;
  seriesId: Hex;
  strike: string;
  maturity: string;
  mode: Mode;
  collateralToken?: Address;
  stableToken?: Address;
  upToken?: Address;
  settled: boolean;
  stablePayout?: string;
  upPayout?: string;
  createdBlock?: string;
}

