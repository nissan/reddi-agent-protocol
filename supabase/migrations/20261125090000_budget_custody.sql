-- Pooled Budget off-chain custody (audit round 4, R4-M3 / S7-claude-03).
--
-- budget_spenders: one row per Budget the relay holds a spender key for. The
-- key is random per Budget and stored only sealed (AES-256-GCM under a
-- key-encryption key that lives outside the database, named by key id). The
-- sealed key is erased once the Budget is closed. The row also holds where to
-- alert the payer, the providers the payer expects, and what the watcher last
-- saw on chain.
-- budget_spender_uses: every signature the relay makes with a spender key,
-- written before the key is used. No write, no signature.
-- budget_alerts: every alert sent to a payer or to the operator.
-- budget_controls: one row; `paused` stops every spender signature at once.
--
-- Only the server reads or writes these (service role). Anon and signed-in
-- roles have no grant and RLS has no policies.

create table public.budget_spenders (
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  spender text not null unique,
  payer text not null,
  budget text unique,
  network text not null check (network in ('solana-devnet', 'solana-mainnet-beta')),
  status text not null check (status in ('pending', 'open', 'frozen', 'closing', 'closed')),
  sealed text,
  key_id text,
  record jsonb not null,
  version integer not null check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'closed') = (sealed is null))
);

create index budget_spenders_status on public.budget_spenders (status);

create table public.budget_spender_uses (
  id bigint generated always as identity primary key,
  spender_id text not null references public.budget_spenders (id),
  purpose text not null check (purpose in ('reserve', 'waive', 'close')),
  payee text,
  message_sha256 text not null check (message_sha256 ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now()
);

create index budget_spender_uses_recent on public.budget_spender_uses (spender_id, at);

create table public.budget_alerts (
  id bigint generated always as identity primary key,
  spender_id text references public.budget_spenders (id),
  audience text not null check (audience in ('payer', 'operator')),
  kind text not null,
  detail jsonb not null,
  delivered jsonb not null,
  at timestamptz not null default now()
);

create table public.budget_controls (
  id integer primary key check (id = 1),
  paused boolean not null default false,
  reason text,
  at timestamptz not null default now()
);

insert into public.budget_controls (id, paused) values (1, false);

alter table public.budget_spenders enable row level security;
alter table public.budget_spender_uses enable row level security;
alter table public.budget_alerts enable row level security;
alter table public.budget_controls enable row level security;
-- No policies: anon and signed-in roles can neither read nor write.
revoke all on public.budget_spenders, public.budget_spender_uses, public.budget_alerts, public.budget_controls from public, anon, authenticated;
-- Supabase grants the service role everything by default: take back what it
-- must not do, so the use log and alerts are append-only and nothing is deleted.
revoke all on public.budget_spenders, public.budget_spender_uses, public.budget_alerts, public.budget_controls from service_role;
grant select, insert, update on public.budget_spenders to service_role;
grant select, insert on public.budget_spender_uses, public.budget_alerts to service_role;
grant select, update on public.budget_controls to service_role;
