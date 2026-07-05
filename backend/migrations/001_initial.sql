create table if not exists chains (
  chain_id bigint primary key,
  name text not null,
  rpc_url text not null,
  confirmation_depth integer not null default 12,
  c_weth_address text,
  last_seen_block bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists factories (
  id text primary key,
  chain_id bigint not null references chains(chain_id),
  address text not null,
  mode text not null check (mode in ('public', 'confidential')),
  collateral_symbol text not null,
  collateral_address text,
  start_block bigint,
  created_at timestamptz not null default now(),
  unique(chain_id, address)
);

create table if not exists matching_engines (
  id text primary key,
  chain_id bigint not null references chains(chain_id),
  address text not null,
  mode text not null check (mode in ('public', 'confidential')),
  factory_address text,
  c_weth_address text,
  start_block bigint,
  created_at timestamptz not null default now(),
  unique(chain_id, address)
);

create table if not exists series (
  id text primary key,
  chain_id bigint not null,
  factory_address text not null,
  series_id text not null,
  strike_price numeric not null,
  maturity_timestamp bigint not null,
  stable_token text not null,
  up_token text not null,
  mode text not null check (mode in ('public', 'confidential')),
  collateral_symbol text not null,
  collateral_address text,
  created_block bigint not null,
  created_tx text not null,
  created_log_index integer not null,
  settled boolean not null default false,
  oracle_price numeric,
  stable_payout numeric,
  up_payout numeric,
  settled_block bigint,
  settled_tx text,
  settled_log_index integer,
  updated_at timestamptz not null default now(),
  unique(chain_id, factory_address, series_id)
);

create index if not exists series_lookup_idx
  on series(chain_id, factory_address, mode, strike_price, maturity_timestamp, settled);

create table if not exists public_position_activity (
  id text primary key,
  chain_id bigint not null,
  factory_address text not null,
  user_address text not null,
  series_id text not null,
  split_amount numeric not null default 0,
  merge_amount numeric not null default 0,
  redeemed_claim numeric not null default 0,
  split_count integer not null default 0,
  merge_count integer not null default 0,
  redeemed_count integer not null default 0,
  last_block bigint not null,
  last_tx text not null,
  last_log_index integer not null,
  updated_at timestamptz not null default now(),
  unique(chain_id, factory_address, user_address, series_id)
);

create table if not exists market_listings (
  id text primary key,
  chain_id bigint not null,
  engine_address text not null,
  listing_id numeric not null,
  mode text not null check (mode in ('public', 'confidential')),
  series_id text,
  factory_address text,
  seller text not null,
  token text not null,
  token_side text not null check (token_side in ('P', 'N', 'unknown')),
  quote_token text not null,
  strike_price numeric not null,
  maturity_timestamp bigint not null,
  active boolean not null default true,
  fill_attempt_count integer not null default 0,
  last_buyer text,
  created_block bigint not null,
  created_tx text not null,
  created_log_index integer not null,
  cancelled_block bigint,
  cancelled_tx text,
  cancelled_log_index integer,
  filled_block bigint,
  filled_tx text,
  filled_log_index integer,
  updated_at timestamptz not null default now(),
  unique(chain_id, engine_address, listing_id)
);

create index if not exists market_listings_lookup_idx
  on market_listings(chain_id, series_id, mode, active, seller);

create table if not exists indexed_logs (
  chain_id bigint not null,
  contract_address text not null,
  block_number bigint not null,
  tx_hash text not null,
  log_index integer not null,
  event_name text not null,
  primary key(chain_id, tx_hash, log_index)
);

create table if not exists indexer_cursors (
  chain_id bigint not null,
  contract_address text not null,
  event_group text not null,
  last_indexed_block bigint not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, contract_address, event_group)
);
