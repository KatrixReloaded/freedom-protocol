import { clientForDeployment } from "../config/chains.js";
export class ChainClients {
    registry;
    clients = new Map();
    constructor(registry) {
        this.registry = registry;
    }
    get(chainId) {
        if (this.clients.has(chainId))
            return this.clients.get(chainId);
        const deployment = this.registry.chain(chainId);
        if (!deployment)
            return undefined;
        const client = clientForDeployment(deployment);
        if (client)
            this.clients.set(chainId, client);
        return client;
    }
}
