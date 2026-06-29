# Freedom Protocol Backend

Off-chain API and event indexer for Freedom Protocol.

This service:

- loads deployment registries and contract ABIs from the repo;
- persists indexed read models in SQLite;
- exposes frontend-friendly HTTP APIs;
- returns unsigned transaction objects for user wallets;
- tracks async bridge requests and finalization state.

It never stores or uses user private keys.

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` with RPC URLs and deployment registry path. By default:

- `FREEDOM_DEPLOYMENTS_PATH=../contracts/deployments`
- `FREEDOM_CONTRACTS_OUT=../contracts/out`
- `DATABASE_URL=file:./freedom.sqlite`

## Run

```bash
npm run build
npm start
```

Default URL:

```text
http://127.0.0.1:4010
```

Health check:

```bash
curl http://127.0.0.1:4010/health
```

## Indexing

Enable the indexer in `.env`:

```text
INDEXER_ENABLED=true
FREEDOM_31337_RPC_URL=http://127.0.0.1:8545
```

Then run:

```bash
npm start
```

Or run the worker directly:

```bash
npm run index
```

The worker scans configured deployment addresses, decodes events, stores raw logs in `events`, and updates read-model tables. Checkpoints are stored in `indexer_checkpoints`.

## Deployment Registry

The preferred registry shape is one JSON record per chain:

```json
{
  "chainId": 31337,
  "rpcUrlEnv": "FREEDOM_31337_RPC_URL",
  "startBlock": 0,
  "confirmations": 3,
  "oracle": "0x0000000000000000000000000000000000000001",
  "publicFactories": [
    {
      "mode": "ETH",
      "collateralToken": "0x0000000000000000000000000000000000000000",
      "factory": "0x...",
      "vault": "0x..."
    }
  ],
  "confidentialFactories": [
    {
      "mode": "cWETH",
      "cWETH": "0x...",
      "factory": "0x...",
      "vault": "0x..."
    }
  ],
  "matchingEngine": "0x...",
  "seriesPoolImplementation": "0x...",
  "bridge": "0x..."
}
```

Series keys are always:

```text
chainId:factoryAddress:strike:maturity
```

## Transaction Builders

All `/tx/...` endpoints return unsigned wallet transactions:

```json
{
  "chainId": 31337,
  "to": "0x...",
  "data": "0x...",
  "value": "0",
  "functionName": "split",
  "args": [],
  "summary": "...",
  "preconditions": [],
  "warnings": []
}
```

Important:

- ERC20/WETH approvals use the public vault as spender, not the factory.
- Confidential endpoints accept encrypted handles/proofs generated client-side.
- `/tx/bridge/unshield` only builds the async burn request.
- `/tx/bridge/finalize` requires KMS `abiEncodedCleartexts` and `decryptionProof`.
- Public bridge mint amount is the verified actual burned amount, not requested amount.

## Useful Endpoints

```text
GET  /health
GET  /config
GET  /series?chainId=&factory=&mode=
GET  /bridge/requests?chainId=&user=&seriesKey=&status=
POST /tx/public/split
POST /tx/confidential/split
POST /tx/bridge/unshield
POST /tx/bridge/finalize
GET  /openapi.json
```

## Tests

```bash
npm run build
npm test
```

