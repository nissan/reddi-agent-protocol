-- The RAP judge for pooled Budget disputes (thread "Build the RAP judge for
-- Budget disputes", 26 Nov 2026; audit 1079ce8 S7-claude-05, #1157 item 10).
--
-- - budget_call_receipts: the provider receipts the judge weighs. The relay
--   saves the receipt header of every call it relays, and a provider may send
--   its own through the judge's evidence route. A receipt proves itself (it
--   is signed by the provider), so rows are evidence to check, never trusted
--   as they stand. Append-only.
-- - budget_judge_log: the judge's record: holds and releases (Nissan's
--   override), rulings with their evidence hash and transaction, alerts.
--   Append-only. A hold or release counts only with the judge's MAC, keyed
--   from BUDGET_JUDGE_OPS_SECRET, which only the judge project holds, over its
--   place in the slice's log (lib/budget/judge/store.ts). So the app, which
--   can write these tables too, can neither hold nor release a dispute.

create table public.budget_call_receipts (
  id bigserial primary key,
  budget text not null check (budget ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_slot text not null check (created_slot ~ '^[1-9][0-9]{0,19}$'),
  payee text not null check (payee ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  source text not null check (source in ('relay', 'provider')),
  receipt text not null check (char_length(receipt) between 1 and 8192),
  at timestamptz not null default now()
);
create index budget_call_receipts_slice on public.budget_call_receipts (budget, created_slot, payee, id desc);

create table public.budget_judge_log (
  id bigserial primary key,
  budget text not null check (budget ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_slot text not null check (created_slot ~ '^[1-9][0-9]{0,19}$'),
  payee text not null check (payee ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  kind text not null check (kind in ('seen', 'hold', 'release', 'ruling', 'alert')),
  reason text not null default '' check (char_length(reason) <= 500),
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 8192),
  mac text check (mac is null or mac ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now(),
  check (kind not in ('hold', 'release') or mac is not null)
);
create index budget_judge_log_slice on public.budget_judge_log (budget, created_slot, payee, id);
create index budget_judge_log_recent on public.budget_judge_log (at);

alter table public.budget_call_receipts enable row level security;
alter table public.budget_judge_log enable row level security;
revoke all on public.budget_call_receipts, public.budget_judge_log from public, anon, authenticated, service_role;
revoke all on sequence public.budget_call_receipts_id_seq, public.budget_judge_log_id_seq from public, anon, authenticated, service_role;
grant select on public.budget_call_receipts, public.budget_judge_log to service_role;
grant insert (budget, created_slot, payee, source, receipt) on public.budget_call_receipts to service_role;
grant insert (budget, created_slot, payee, kind, reason, detail, mac) on public.budget_judge_log to service_role;
grant usage on sequence public.budget_call_receipts_id_seq, public.budget_judge_log_id_seq to service_role;

create or replace function public.budget_judge_append_only() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;
revoke all on function public.budget_judge_append_only() from public, anon, authenticated, service_role;
create trigger budget_call_receipts_no_update before update or delete on public.budget_call_receipts
  for each row execute function public.budget_judge_append_only();
create trigger budget_call_receipts_no_truncate before truncate on public.budget_call_receipts
  for each statement execute function public.budget_judge_append_only();
create trigger budget_judge_log_no_update before update or delete on public.budget_judge_log
  for each row execute function public.budget_judge_append_only();
create trigger budget_judge_log_no_truncate before truncate on public.budget_judge_log
  for each statement execute function public.budget_judge_append_only();
