PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chains (
  chain_id INTEGER PRIMARY KEY,
  rpc_url TEXT,
  start_block INTEGER NOT NULL DEFAULT 0,
  confirmations INTEGER NOT NULL DEFAULT 3,
  oracle TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deployments (
  chain_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  address TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (chain_id, kind, address)
);

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
  chain_id INTEGER NOT NULL,
  indexer_name TEXT NOT NULL,
  last_indexed_block INTEGER NOT NULL DEFAULT 0,
  last_finalized_block INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chain_id, indexer_name)
);

CREATE TABLE IF NOT EXISTS factories (
  chain_id INTEGER NOT NULL,
  factory_address TEXT NOT NULL,
  mode TEXT NOT NULL,
  collateral_token TEXT,
  vault_address TEXT,
  oracle TEXT,
  bridge_address TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (chain_id, factory_address)
);

CREATE TABLE IF NOT EXISTS series (
  series_key TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  factory_address TEXT NOT NULL,
  series_id TEXT NOT NULL,
  strike TEXT NOT NULL,
  maturity TEXT NOT NULL,
  mode TEXT NOT NULL,
  collateral_token TEXT,
  stable_token TEXT,
  up_token TEXT,
  settled INTEGER NOT NULL DEFAULT 0,
  stable_payout TEXT,
  up_payout TEXT,
  created_block INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chain_id, factory_address, strike, maturity)
);

CREATE TABLE IF NOT EXISTS tokens (
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  factory_address TEXT,
  series_key TEXT,
  is_stable INTEGER,
  kind TEXT NOT NULL,
  symbol TEXT,
  decimals INTEGER,
  PRIMARY KEY (chain_id, token_address)
);

CREATE TABLE IF NOT EXISTS public_reserves (
  chain_id INTEGER NOT NULL,
  series_key TEXT NOT NULL,
  reserve TEXT NOT NULL DEFAULT '0',
  bridge_capacity TEXT NOT NULL DEFAULT '0',
  updated_block INTEGER,
  PRIMARY KEY (chain_id, series_key)
);

CREATE TABLE IF NOT EXISTS bridge_requests (
  request_key TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  bridge_address TEXT NOT NULL,
  request_id TEXT NOT NULL,
  user_address TEXT NOT NULL,
  factory_address TEXT,
  series_key TEXT,
  strike TEXT NOT NULL,
  maturity TEXT NOT NULL,
  is_stable INTEGER NOT NULL,
  requested_amount TEXT NOT NULL,
  burned_amount_handle TEXT NOT NULL,
  actual_burned_amount TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  finalized INTEGER NOT NULL DEFAULT 0,
  request_tx_hash TEXT,
  finalize_tx_hash TEXT,
  created_block INTEGER,
  finalized_block INTEGER,
  failure_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chain_id, bridge_address, request_id)
);

CREATE TABLE IF NOT EXISTS matching_listings (
  listing_key TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  engine_address TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  seller TEXT NOT NULL,
  token TEXT NOT NULL,
  quote_token TEXT NOT NULL,
  strike TEXT NOT NULL,
  maturity TEXT NOT NULL,
  active INTEGER NOT NULL,
  created_block INTEGER,
  updated_block INTEGER,
  UNIQUE (chain_id, engine_address, listing_id)
);

CREATE TABLE IF NOT EXISTS pools (
  chain_id INTEGER NOT NULL,
  pool_address TEXT PRIMARY KEY,
  factory_address TEXT,
  series_key TEXT,
  option_token TEXT,
  quote_token TEXT,
  strike TEXT,
  maturity TEXT,
  is_stable INTEGER,
  min_price_per_token TEXT,
  seller_count INTEGER,
  enc_pool_balance_handle TEXT,
  created_block INTEGER
);

CREATE TABLE IF NOT EXISTS pool_sellers (
  chain_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL,
  seller TEXT NOT NULL,
  first_seen_block INTEGER,
  PRIMARY KEY (chain_id, pool_address, seller)
);

CREATE TABLE IF NOT EXISTS events (
  chain_id INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  block_hash TEXT,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  args TEXT NOT NULL,
  finalized INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

