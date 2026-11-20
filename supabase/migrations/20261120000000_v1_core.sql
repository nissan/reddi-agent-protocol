-- RAP V1 core data model (#740). Design: docs/V1-DATA-AND-SIGNIN-DESIGN.md
--
-- Access model: the browser reads through row level security with the anon or
-- authenticated role. Every write that depends on verified facts (a job, a
-- receipt, a replay record, an attestation, reputation) is made by the Next.js
-- server with the service role, which bypasses row level security. No client
-- role can write those tables.
--
-- Privileges are explicit. Supabase grants ALL on new public tables to anon and
-- authenticated by default, which includes TRUNCATE (not stopped by row level
-- security). This migration revokes everything from the client roles and grants
-- back only what the rules below need.

create extension if not exists pgcrypto;

-- One row per signed-in wallet. Filled by the server after wallet sign-in.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  wallet text not null unique check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_at timestamptz not null default now()
);

-- A provider listing. One per wallet in V1.
create table public.providers (
  wallet text primary key check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 80),
  endpoint_url text not null check (endpoint_url ~ '^https://'),
  declared_models text[] not null default '{}',
  capabilities jsonb not null default '{}'::jsonb,
  capability_hash text check (capability_hash ~ '^[0-9a-f]{64}$'),
  -- Price of a fixed-price escrow job. Inference calls are priced per token below.
  price_per_call_base_units bigint not null default 0 check (price_per_call_base_units >= 0),
  -- Per-token prices, in whole base units of price_mint per million tokens.
  price_input_per_million_base_units bigint not null default 0 check (price_input_per_million_base_units >= 0),
  price_output_per_million_base_units bigint not null default 0 check (price_output_per_million_base_units >= 0),
  price_mint text not null,
  network text not null check (network in ('solana-devnet', 'solana-mainnet')),
  status text not null default 'draft' check (status in ('draft', 'listed', 'paused', 'removed')),
  -- Health is observed by the server, never asserted by the owner.
  health_status text not null default 'unknown' check (health_status in ('unknown', 'pass', 'fail')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index providers_listed_idx on public.providers (network, status);

-- One paid call. Prompts and responses are not stored, only their hashes.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  buyer_wallet text not null,
  buyer_user_id uuid references auth.users (id) on delete set null,
  provider_wallet text not null references public.providers (wallet) on delete restrict,
  network text not null check (network in ('solana-devnet', 'solana-mainnet')),
  declared_model text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_hash text check (response_hash ~ '^[0-9a-f]{64}$'),
  amount_base_units bigint not null check (amount_base_units > 0),
  mint text not null,
  tx_signature text not null,
  status text not null check (status in ('paid', 'delivered', 'failed', 'refund_due', 'refunded')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  -- One transaction pays for one call.
  unique (network, tx_signature)
);
create index jobs_buyer_idx on public.jobs (buyer_user_id, created_at desc);
create index jobs_provider_idx on public.jobs (provider_wallet, created_at desc);

-- The RAP receipt for a job, as signed by the provider.
create table public.receipts (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  receipt jsonb not null,
  provider_signature text not null,
  schema_version text not null,
  created_at timestamptz not null default now()
);

-- Durable replay ledger for payment verification (#723, #738). A key is either
-- a caller-chosen nonce or a namespaced transaction key such as
-- 'x402:tx:<network>:<signature>'. Insert-once: a second insert of the same
-- key fails, which is the replay signal.
create table public.payment_replay (
  key text primary key check (char_length(key) between 1 and 300),
  first_seen_at timestamptz not null default now()
);

-- Returns true when the key is new and has been recorded, false when it was
-- already present. Atomic across concurrent callers and server instances.
create function public.replay_check_and_store(p_key text)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.payment_replay (key) values (p_key);
  return true;
exception when unique_violation then
  return false;
end;
$$;

-- An attestor's check of one job.
create table public.attestations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  -- Copied from the job by the server so public reads need not see the job row.
  provider_wallet text not null references public.providers (wallet) on delete cascade,
  attestor_wallet text not null,
  outcome text not null check (outcome in ('pass', 'fail', 'inconclusive')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, attestor_wallet)
);

-- Reputation inputs per provider, derived by the server from jobs and
-- attestations. Stored so listings can sort without recomputing.
create table public.provider_stats (
  provider_wallet text primary key references public.providers (wallet) on delete cascade,
  jobs_delivered bigint not null default 0,
  jobs_failed bigint not null default 0,
  attestations_pass bigint not null default 0,
  attestations_fail bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index attestations_provider_idx on public.attestations (provider_wallet, created_at desc);

-- updated_at is set by the database, not by the caller.
create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger providers_set_updated_at before update on public.providers
  for each row execute function public.set_updated_at();
create trigger provider_stats_set_updated_at before update on public.provider_stats
  for each row execute function public.set_updated_at();

-- Row level security ---------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.providers enable row level security;
alter table public.jobs enable row level security;
alter table public.receipts enable row level security;
alter table public.payment_replay enable row level security;
alter table public.attestations enable row level security;
alter table public.provider_stats enable row level security;

-- profiles: a user reads their own row. Written by the server only.
create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = auth.uid());

-- providers: anyone reads listed providers; an owner reads and edits their own.
create policy providers_select_listed on public.providers
  for select to anon, authenticated using (status = 'listed');
create policy providers_select_own on public.providers
  for select to authenticated using (owner_user_id = auth.uid());
create policy providers_insert_own on public.providers
  for insert to authenticated
  with check (
    owner_user_id = auth.uid()
    and wallet = (select p.wallet from public.profiles p where p.user_id = auth.uid())
  );
create policy providers_update_own on public.providers
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (
    owner_user_id = auth.uid()
    and wallet = (select p.wallet from public.profiles p where p.user_id = auth.uid())
  );

-- jobs and receipts: the buyer and the provider's owner read theirs.
-- Tells the caller whether they own a provider, and nothing else. Definer rights
-- because clients hold no privilege on providers.owner_user_id.
create function public.is_provider_owner(p_wallet text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.providers pr
                 where pr.wallet = p_wallet and pr.owner_user_id = auth.uid());
$$;

create policy jobs_select_party on public.jobs
  for select to authenticated using (
    buyer_user_id = auth.uid() or public.is_provider_owner(provider_wallet)
  );
create policy receipts_select_party on public.receipts
  for select to authenticated using (
    exists (select 1 from public.jobs j where j.id = receipts.job_id)
  );

-- attestations and stats are public reputation data for listed providers.
-- The check reads providers only: jobs are private to their parties, so a
-- policy that went through jobs would hide every attestation from the public.
create policy attestations_select_public on public.attestations
  for select to anon, authenticated using (
    exists (select 1 from public.providers pr
            where pr.wallet = attestations.provider_wallet and pr.status = 'listed')
  );
create policy provider_stats_select_public on public.provider_stats
  for select to anon, authenticated using (
    exists (select 1 from public.providers pr
            where pr.wallet = provider_stats.provider_wallet and pr.status = 'listed')
  );

-- Privileges -----------------------------------------------------------------

-- Start from nothing for the client roles on every table, then grant back.
revoke all on public.profiles, public.providers, public.jobs, public.receipts,
  public.payment_replay, public.attestations, public.provider_stats
  from public, anon, authenticated;

-- The server role is granted explicitly so it does not depend on project defaults.
grant select, insert, update, delete on public.profiles, public.providers, public.jobs,
  public.receipts, public.payment_replay, public.attestations, public.provider_stats
  to service_role;

-- Read-only tables for clients; row level security decides which rows.
grant select on public.profiles, public.jobs, public.receipts to authenticated;
grant select on public.attestations, public.provider_stats to anon, authenticated;

-- providers: clients read every column except owner_user_id, which is an
-- internal account id. Clients must name columns (select * is refused).
grant select (wallet, display_name, endpoint_url, declared_models, capabilities, capability_hash,
              price_per_call_base_units, price_input_per_million_base_units,
              price_output_per_million_base_units, price_mint, network, status, health_status,
              last_seen_at, created_at, updated_at)
  on public.providers to anon, authenticated;
-- Owners may set only the descriptive columns. Health, timestamps and ownership
-- changes are server-owned. No client delete.
grant insert (wallet, owner_user_id, display_name, endpoint_url, declared_models, capabilities,
              capability_hash, price_per_call_base_units, price_input_per_million_base_units,
              price_output_per_million_base_units, price_mint, network, status)
  on public.providers to authenticated;
grant update (display_name, endpoint_url, declared_models, capabilities, capability_hash,
              price_per_call_base_units, price_input_per_million_base_units,
              price_output_per_million_base_units, price_mint, status)
  on public.providers to authenticated;

-- payment_replay has no client policy and no client privilege. Server only.
revoke execute on function public.replay_check_and_store(text) from public, anon, authenticated;
grant execute on function public.replay_check_and_store(text) to service_role;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.is_provider_owner(text) from public, anon;
grant execute on function public.is_provider_owner(text) to authenticated, service_role;
