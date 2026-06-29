import { loadAbis } from "../src/config/abis.js";
import { DeploymentRegistry } from "../src/config/deployments.js";
import { openDb, seedDeployments } from "../src/db/client.js";
import { createContext, dispatch } from "../src/server.js";
import { seriesId, seriesKey, upsertSeries } from "../src/services/registry.js";
export const A = {
    oracle: "0x0000000000000000000000000000000000000001",
    publicFactory: "0x0000000000000000000000000000000000000010",
    publicVault: "0x0000000000000000000000000000000000000011",
    collateral: "0x0000000000000000000000000000000000000012",
    confFactory: "0x0000000000000000000000000000000000000020",
    confVault: "0x0000000000000000000000000000000000000021",
    cWETH: "0x0000000000000000000000000000000000000022",
    bridge: "0x0000000000000000000000000000000000000030",
    matching: "0x0000000000000000000000000000000000000040",
    stable: "0x0000000000000000000000000000000000000050",
    up: "0x0000000000000000000000000000000000000051"
};
export function testContext() {
    const registry = new DeploymentRegistry([
        {
            chainId: 31337,
            startBlock: 0,
            confirmations: 0,
            oracle: A.oracle,
            publicFactories: [
                { mode: "ERC20", collateralToken: A.collateral, factory: A.publicFactory, vault: A.publicVault }
            ],
            confidentialFactories: [{ mode: "cWETH", cWETH: A.cWETH, factory: A.confFactory, vault: A.confVault }],
            bridge: A.bridge,
            matchingEngine: A.matching,
            seriesPoolImplementation: "0x0000000000000000000000000000000000000041"
        }
    ]);
    const db = openDb(":memory:");
    seedDeployments(db, registry.chains);
    const key = seriesKey(31337, A.publicFactory, 2000, 1800000000);
    upsertSeries(db, {
        key,
        chainId: 31337,
        factoryAddress: A.publicFactory,
        seriesId: seriesId(2000, 1800000000),
        strike: "2000",
        maturity: "1800000000",
        mode: "ERC20",
        collateralToken: A.collateral,
        stableToken: A.stable,
        upToken: A.up,
        settled: false
    });
    const confKey = seriesKey(31337, A.confFactory, 2000, 1800000000);
    upsertSeries(db, {
        key: confKey,
        chainId: 31337,
        factoryAddress: A.confFactory,
        seriesId: seriesId(2000, 1800000000),
        strike: "2000",
        maturity: "1800000000",
        mode: "cWETH",
        collateralToken: A.cWETH,
        stableToken: A.stable,
        upToken: A.up,
        settled: false
    });
    return createContext({
        db,
        registry,
        abis: loadAbis(),
        env: {
            nodeEnv: "test",
            host: "127.0.0.1",
            port: 0,
            databaseUrl: ":memory:",
            deploymentsPath: "",
            contractsOut: "../contracts/out",
            indexerEnabled: false,
            indexerPollMs: 1000,
            indexerBlockRange: 100n
        }
    });
}
export async function request(method, path, body) {
    return dispatch(testContext(), method, path, body);
}
export const publicSeriesKey = seriesKey(31337, A.publicFactory, 2000, 1800000000);
export const confidentialSeriesKey = seriesKey(31337, A.confFactory, 2000, 1800000000);
