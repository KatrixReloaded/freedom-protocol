import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../env.js";
const ARTIFACTS = {
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
function readAbi(contractsOut, name) {
    const artifactPath = path.join(contractsOut, ARTIFACTS[name]);
    const raw = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    if (!raw.abi)
        throw new Error(`Missing ABI in ${artifactPath}`);
    return raw.abi;
}
export function loadAbis(contractsOut = loadEnv().contractsOut) {
    const cache = new Map();
    return {
        names: Object.keys(ARTIFACTS),
        get(name) {
            if (!cache.has(name))
                cache.set(name, readAbi(contractsOut, name));
            return cache.get(name);
        },
        all() {
            const out = {};
            for (const name of Object.keys(ARTIFACTS))
                out[name] = this.get(name);
            return out;
        }
    };
}
