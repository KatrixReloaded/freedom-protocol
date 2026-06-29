import fs from "node:fs";
import path from "node:path";
import type { Abi } from "viem";
import { loadEnv } from "../env.js";

const ARTIFACTS: Record<string, string> = {
  PublicOptionFactory: "PublicOptionFactory.sol/PublicOptionFactory.json",
  PublicOptionToken: "PublicOptionToken.sol/PublicOptionToken.json",
  CentralCollateralVault: "CentralCollateralVault.sol/CentralCollateralVault.json",
  OptionFactory: "OptionFactory.sol/OptionFactory.json",
  OptionToken: "OptionToken.sol/OptionToken.json",
  ConfidentialCollateralVault: "ConfidentialCollateralVault.sol/ConfidentialCollateralVault.json",
  ConfidentialMatchingEngine: "ConfidentialMatchingEngine.sol/ConfidentialMatchingEngine.json",
  SeriesPool: "SeriesPool.sol/SeriesPool.json",
  UnshieldBridge: "UnshieldBridge.sol/UnshieldBridge.json",
  IERC20: "IERC20.sol/IERC20.json"
};

export type AbiName = keyof typeof ARTIFACTS;

export interface AbiBundle {
  names: AbiName[];
  get(name: AbiName): Abi;
  all(): Record<AbiName, Abi>;
}

function readAbi(contractsOut: string, name: AbiName): Abi {
  const artifactPath = path.join(contractsOut, ARTIFACTS[name]);
  const raw = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi?: Abi };
  if (!raw.abi) throw new Error(`Missing ABI in ${artifactPath}`);
  return raw.abi;
}

export function loadAbis(contractsOut = loadEnv().contractsOut): AbiBundle {
  const cache = new Map<AbiName, Abi>();
  return {
    names: Object.keys(ARTIFACTS) as AbiName[],
    get(name: AbiName): Abi {
      if (!cache.has(name)) cache.set(name, readAbi(contractsOut, name));
      return cache.get(name)!;
    },
    all(): Record<AbiName, Abi> {
      const out = {} as Record<AbiName, Abi>;
      for (const name of Object.keys(ARTIFACTS) as AbiName[]) out[name] = this.get(name);
      return out;
    }
  };
}

