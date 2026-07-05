create table if not exists bridges (
  id text primary key,
  chain_id bigint not null references chains(chain_id),
  address text not null,
  public_factory text not null,
  confidential_factory text not null,
  start_block bigint,
  keeper_enabled boolean not null default false,
  min_confirmations_before_finalize integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chain_id, address)
);

create table if not exists bridge_requests (
  id text primary key,
  chain_id bigint not null,
  bridge_address text not null,
  request_id numeric not null,
  user_address text not null,
  strike_price numeric not null,
  maturity_timestamp bigint not null,
  is_stable boolean not null,
  requested_amount numeric not null,
  burned_amount_handle text not null,
  status text not null check (status in ('requested', 'decrypting', 'finalize_submitted', 'finalized', 'failed')),
  finalized_amount numeric,
  request_block bigint not null,
  request_tx text not null,
  request_log_index integer not null,
  finalize_block bigint,
  finalize_tx text,
  finalize_log_index integer,
  finalize_tx_hash text,
  error text,
  updated_at timestamptz not null default now(),
  unique(chain_id, bridge_address, request_id)
);

create index if not exists bridge_requests_status_idx
  on bridge_requests(status);

create index if not exists bridge_requests_user_idx
  on bridge_requests(user_address);

create index if not exists bridge_requests_lookup_idx
  on bridge_requests(chain_id, bridge_address, request_id);
