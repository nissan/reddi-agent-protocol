-- State for providers run on serverless hosts (@redditech/provider-kit,
-- src/postgres.ts): RAP's own first-party providers on Vercel (#832). Every
-- instance of one provider shares these rows, keyed by the provider's id, so a
-- lock pays for one call, one request at a time settles a lock, a held answer
-- can be collected from any instance, the sweep finds every settle whose
-- outcome was not known, and the model's limits count all calls.
--
-- Server only: the schema is not exposed through the API, and no client role
-- has any privilege on it. The providers connect with a server-side database
-- connection string kept in the host's sensitive environment variables.

create schema provider_kit;
revoke all on schema provider_kit from public;
revoke all on schema provider_kit from anon, authenticated;

-- A lock (and any other payment key) is accepted once per provider.
create table provider_kit.replay (
  provider text not null,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (provider, key)
);

-- One request at a time per lock. A lease ends when its holder releases it or
-- when until_ms passes, so a crashed instance cannot hold a lock for ever.
create table provider_kit.leases (
  provider text not null,
  escrow text not null,
  token uuid not null,
  until_ms bigint not null,
  primary key (provider, escrow)
);

-- The answer of a call whose settle was sent but not yet known to land, for
-- the same request to collect. Deleted when collected, and by the sweep after
-- ten minutes.
create table provider_kit.held_answers (
  provider text not null,
  escrow text not null,
  call text not null,
  created_ms bigint not null,
  primary key (provider, escrow)
);
create index held_answers_age on provider_kit.held_answers (provider, created_ms);

-- A settle signed and recorded before it was sent. The last record for an
-- escrow wins; 'pending' ones are looked at again until they land or cannot.
create table provider_kit.pending_settles (
  provider text not null,
  escrow text not null,
  status text not null check (status in ('pending', 'landed', 'dropped')),
  record text not null,
  updated_at timestamptz not null default now(),
  primary key (provider, escrow)
);
create index pending_settles_open on provider_kit.pending_settles (provider) where status = 'pending';

-- How many calls the provider's model has taken, updated under a row lock.
create table provider_kit.capacity (
  provider text primary key,
  state jsonb not null
);

alter table provider_kit.replay enable row level security;
alter table provider_kit.leases enable row level security;
alter table provider_kit.held_answers enable row level security;
alter table provider_kit.pending_settles enable row level security;
alter table provider_kit.capacity enable row level security;

revoke all on all tables in schema provider_kit from public, anon, authenticated;
