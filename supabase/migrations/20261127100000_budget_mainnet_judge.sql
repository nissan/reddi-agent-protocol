-- The mainnet RAP judge's tables (#1210), in the mainnet schema of
-- 20261126150000_budget_mainnet_custody.sql.
--
-- The mainnet app holds no service role key (#1205), so it cannot write the
-- devnet tables `public.budget_call_receipts` and `public.budget_judge_log`,
-- and must not: mainnet evidence stays with the mainnet records. Here:
--
-- - `budget_mainnet.budget_call_receipts`: the provider receipts the judge
--   weighs. The mainnet app (`budget_mainnet_app`) may add the receipts its
--   relay saw (source `relay`) and nothing else: it cannot read them, and
--   cannot add one as `provider`. The judge reads them and adds the ones a
--   provider sends to its evidence route (source `provider`). Append-only.
-- - `budget_mainnet.budget_judge_log`: the judge's record. Only the judge
--   role reads or writes it; on devnet the app could add rows (a hold still
--   needed the judge's MAC), here it cannot. Append-only.
-- - A third role without a login, `budget_mainnet_judge`, for the mainnet
--   judge's own Vercel project. It reads the columns of the relay's records
--   and call log that the rule needs (which calls the spender signed), and
--   cannot write them. The signer role gets nothing on the judge's tables.
--
-- A receipt proves itself (the provider signs it), so a row is evidence to
-- check, never trusted as it stands (lib/budget/judge/rule.ts).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'budget_mainnet_judge') then
    create role budget_mainnet_judge nologin noinherit;
  end if;
end
$$;
grant budget_mainnet_judge to authenticator;
grant usage on schema budget_mainnet to budget_mainnet_judge;

create table budget_mainnet.budget_call_receipts (
  id bigint generated always as identity primary key,
  budget text not null check (budget ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_slot text not null check (created_slot ~ '^[1-9][0-9]{0,19}$'),
  payee text not null check (payee ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  source text not null check (source in ('relay', 'provider')),
  receipt text not null check (char_length(receipt) between 1 and 8192),
  at timestamptz not null default now()
);
create index budget_call_receipts_slice on budget_mainnet.budget_call_receipts (budget, created_slot, payee, id desc);

create table budget_mainnet.budget_judge_log (
  id bigint generated always as identity primary key,
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
create index budget_judge_log_slice on budget_mainnet.budget_judge_log (budget, created_slot, payee, id);
create index budget_judge_log_recent on budget_mainnet.budget_judge_log (at);

create trigger budget_call_receipts_no_update before update or delete on budget_mainnet.budget_call_receipts
  for each row execute function budget_mainnet.append_only();
create trigger budget_call_receipts_no_truncate before truncate on budget_mainnet.budget_call_receipts
  for each statement execute function budget_mainnet.append_only();
create trigger budget_judge_log_no_update before update or delete on budget_mainnet.budget_judge_log
  for each row execute function budget_mainnet.append_only();
create trigger budget_judge_log_no_truncate before truncate on budget_mainnet.budget_judge_log
  for each statement execute function budget_mainnet.append_only();

alter table budget_mainnet.budget_call_receipts enable row level security;
alter table budget_mainnet.budget_judge_log enable row level security;
revoke all on budget_mainnet.budget_call_receipts, budget_mainnet.budget_judge_log
  from public, anon, authenticated, service_role, budget_mainnet_signer, budget_mainnet_app;

-- Receipts: the app adds what its relay saw; the judge reads all and adds what providers send.
create policy app_adds_relay_receipts on budget_mainnet.budget_call_receipts
  for insert to budget_mainnet_app with check (source = 'relay');
create policy judge_reads_receipts on budget_mainnet.budget_call_receipts
  for select to budget_mainnet_judge using (true);
create policy judge_adds_provider_receipts on budget_mainnet.budget_call_receipts
  for insert to budget_mainnet_judge with check (source = 'provider');
grant insert (budget, created_slot, payee, source, receipt) on budget_mainnet.budget_call_receipts
  to budget_mainnet_app, budget_mainnet_judge;
grant select on budget_mainnet.budget_call_receipts to budget_mainnet_judge;

-- The judge's log: the judge only.
create policy judge_reads_log on budget_mainnet.budget_judge_log
  for select to budget_mainnet_judge using (true);
create policy judge_adds_log on budget_mainnet.budget_judge_log
  for insert to budget_mainnet_judge with check (true);
grant select on budget_mainnet.budget_judge_log to budget_mainnet_judge;
grant insert (budget, created_slot, payee, kind, reason, detail, mac) on budget_mainnet.budget_judge_log to budget_mainnet_judge;

-- What the rule reads of the relay's records: which record a Budget has, and
-- the calls its spender signed. Read only, and only these columns.
create policy judge_reads_records on budget_mainnet.budget_spenders
  for select to budget_mainnet_judge using (true);
create policy judge_reads_uses on budget_mainnet.budget_spender_uses
  for select to budget_mainnet_judge using (true);
grant select (id, budget) on budget_mainnet.budget_spenders to budget_mainnet_judge;
grant select (id, spender_id, purpose, payee, detail) on budget_mainnet.budget_spender_uses to budget_mainnet_judge;
