-- The mainnet Budget signer's own tables (#1205; owner decision, 26 November
-- 2026: same Supabase project, separate schema and roles).
--
-- Schema `budget_mainnet` holds the custody tables for mainnet Budgets, as
-- `public.budget_*` holds them for devnet. Nothing that can reach the devnet
-- tables can reach these:
--
-- - `service_role`, `anon` and `authenticated` have no rights on the schema,
--   so the devnet app and the devnet signer (which hold the service role key)
--   are refused every read and write here;
-- - two roles without a login reach it through the REST API, each with a
--   token only its own Vercel project holds: `budget_mainnet_signer` (the
--   mainnet signer) and `budget_mainnet_app` (the mainnet app);
-- - only `budget_mainnet_signer` may write the use log or run the functions
--   that count and log a use, so the limits and call numbers the signer goes
--   by are its own: the app cannot add, change or remove a use;
-- - every record here is a mainnet record (a check on the row).
--
-- Not a boundary against whoever holds the project's JWT signing secret or
-- the database owner's login: those can reach every schema
-- (docs/BUDGET-RELAY-CUSTODY.md, "The mainnet signer").
--
-- The owner adds `budget_mainnet` to the project's exposed schemas (API
-- settings) before the first request; until then the API answers 406.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'budget_mainnet_signer') then
    create role budget_mainnet_signer nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'budget_mainnet_app') then
    create role budget_mainnet_app nologin noinherit;
  end if;
end
$$;

-- The REST API switches to the role a request's token names.
grant budget_mainnet_signer to authenticator;
grant budget_mainnet_app to authenticator;

create schema budget_mainnet;
revoke all on schema budget_mainnet from public, anon, authenticated, service_role;
grant usage on schema budget_mainnet to budget_mainnet_signer, budget_mainnet_app;

create table budget_mainnet.budget_spenders (
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  spender text not null,
  spender_key text not null check (spender_key ~ '^0[23][0-9a-f]{64}$'),
  payer text not null,
  -- One record per Budget, and never a record without one (RAP-MB3-S2).
  budget text not null unique,
  network text not null check (network = 'solana-mainnet-beta'),
  status text not null check (status in ('pending', 'open', 'frozen', 'closing', 'closed')),
  record jsonb not null,
  version integer not null check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index budget_spenders_status on budget_mainnet.budget_spenders (status);
create index budget_spenders_spender on budget_mainnet.budget_spenders (spender);
create index budget_spenders_payer on budget_mainnet.budget_spenders (payer);

create table budget_mainnet.budget_spender_uses (
  id bigint generated always as identity primary key,
  spender_id text not null references budget_mainnet.budget_spenders (id),
  purpose text not null check (purpose in ('reserve', 'waive', 'close', 'call')),
  payee text,
  message_sha256 text not null check (message_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  by_operator boolean not null default false,
  at timestamptz not null default now()
);
create index budget_spender_uses_recent on budget_mainnet.budget_spender_uses (spender_id, at);
create index budget_spender_uses_at on budget_mainnet.budget_spender_uses (at);
create index budget_spender_uses_calls on budget_mainnet.budget_spender_uses (spender_id, payee) where purpose = 'call';

create table budget_mainnet.budget_alerts (
  id bigint generated always as identity primary key,
  spender_id text references budget_mainnet.budget_spenders (id),
  audience text not null check (audience in ('payer', 'operator')),
  kind text not null,
  detail jsonb not null,
  delivered jsonb not null,
  at timestamptz not null default now()
);

create table budget_mainnet.budget_controls (
  id integer primary key check (id = 1),
  paused boolean not null default false,
  reason text,
  at timestamptz not null default now(),
  watched_at timestamptz,
  operator_pending jsonb not null default '[]'::jsonb,
  ceiling_alerted_at timestamptz,
  call_ceiling_alerted_at timestamptz
);
insert into budget_mainnet.budget_controls (id, paused) values (1, false);

create table budget_mainnet.budget_signer_holds (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('all', 'spender')),
  spender_id text references budget_mainnet.budget_spenders (id),
  kind text not null check (kind in ('hold', 'release')),
  reason text not null default '' check (char_length(reason) <= 300),
  mac text check (mac is null or mac ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now(),
  check ((scope = 'all') = (spender_id is null)),
  check (kind = 'hold' or mac is not null)
);
create index budget_signer_holds_spender on budget_mainnet.budget_signer_holds (spender_id, id);

-- Append-only logs: the use log (limits and call numbers are counted from it)
-- and the hold log. Nobody edits, deletes or empties them through any role.
create function budget_mainnet.append_only() returns trigger
language plpgsql
set search_path = budget_mainnet, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;
revoke all on function budget_mainnet.append_only() from public, anon, authenticated, service_role;

create trigger budget_signer_holds_no_update before update or delete on budget_mainnet.budget_signer_holds
  for each row execute function budget_mainnet.append_only();
create trigger budget_signer_holds_no_truncate before truncate on budget_mainnet.budget_signer_holds
  for each statement execute function budget_mainnet.append_only();
create trigger budget_spender_uses_no_update before update or delete on budget_mainnet.budget_spender_uses
  for each row execute function budget_mainnet.append_only();
create trigger budget_spender_uses_no_truncate before truncate on budget_mainnet.budget_spender_uses
  for each statement execute function budget_mainnet.append_only();

-- A record keeps its id, payer, Budget and network for life.
create function budget_mainnet.budget_spenders_identity() returns trigger
language plpgsql
set search_path = budget_mainnet, pg_temp
as $$
begin
  if new.id is distinct from old.id or new.payer is distinct from old.payer
     or new.budget is distinct from old.budget or new.network is distinct from old.network then
    raise exception 'a Budget record keeps its id, payer, Budget and network';
  end if;
  return new;
end;
$$;
revoke all on function budget_mainnet.budget_spenders_identity() from public, anon, authenticated, service_role;
create trigger budget_spenders_identity before update on budget_mainnet.budget_spenders
  for each row execute function budget_mainnet.budget_spenders_identity();

alter table budget_mainnet.budget_spenders enable row level security;
alter table budget_mainnet.budget_spender_uses enable row level security;
alter table budget_mainnet.budget_alerts enable row level security;
alter table budget_mainnet.budget_controls enable row level security;
alter table budget_mainnet.budget_signer_holds enable row level security;

-- Row level security lets only the two mainnet roles see rows at all; the
-- grants below say what each may do.
create policy mainnet_roles on budget_mainnet.budget_spenders for all to budget_mainnet_signer, budget_mainnet_app using (true) with check (true);
create policy mainnet_roles on budget_mainnet.budget_spender_uses for all to budget_mainnet_signer, budget_mainnet_app using (true) with check (true);
create policy mainnet_roles on budget_mainnet.budget_alerts for all to budget_mainnet_signer, budget_mainnet_app using (true) with check (true);
create policy mainnet_roles on budget_mainnet.budget_controls for all to budget_mainnet_signer, budget_mainnet_app using (true) with check (true);
create policy mainnet_roles on budget_mainnet.budget_signer_holds for all to budget_mainnet_signer, budget_mainnet_app using (true) with check (true);

revoke all on all tables in schema budget_mainnet from public, anon, authenticated, service_role;
revoke all on all sequences in schema budget_mainnet from public, anon, authenticated, service_role;

-- Both: read and write records, alerts and the controls row; read the logs;
-- add a hold (only a release carrying the signer's MAC lifts one).
grant select, insert, update on budget_mainnet.budget_spenders to budget_mainnet_signer, budget_mainnet_app;
grant select, insert on budget_mainnet.budget_alerts to budget_mainnet_signer, budget_mainnet_app;
grant select, update on budget_mainnet.budget_controls to budget_mainnet_signer, budget_mainnet_app;
grant select on budget_mainnet.budget_spender_uses, budget_mainnet.budget_signer_holds to budget_mainnet_signer, budget_mainnet_app;
grant insert (scope, spender_id, kind, reason, mac) on budget_mainnet.budget_signer_holds to budget_mainnet_signer, budget_mainnet_app;
-- The signer only: the use log.
grant insert on budget_mainnet.budget_spender_uses to budget_mainnet_signer;

-- The same step as public.budget_spender_use
-- (20261125140000_budget_custody_calls.sql), over this schema's tables.
create function budget_mainnet.budget_spender_use(
  p_spender_id text,
  p_purpose text,
  p_payee text,
  p_message_sha256 text,
  p_detail jsonb,
  p_by_operator boolean,
  p_max_uses integer,
  p_max_payer integer,
  p_max_global integer
) returns text
language plpgsql
security invoker
set search_path = budget_mainnet, pg_temp
as $$
declare
  v_status text;
  v_payer text;
  v_paused boolean;
  v_alerted timestamptz;
  v_recent integer;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'budget_spender_use runs only at READ COMMITTED';
  end if;
  if p_by_operator is null or p_max_uses is null or p_max_payer is null or p_max_global is null
     or p_max_uses < 1 or p_max_payer < 1 or p_max_global < 1 then
    raise exception 'budget_spender_use needs every limit';
  end if;
  if p_by_operator and p_purpose <> 'close' then
    raise exception 'the operator path approves only a close';
  end if;
  select status, payer into v_status, v_payer
    from budget_mainnet.budget_spenders where id = p_spender_id for update;
  if not found then
    return 'unknown';
  end if;
  if p_purpose = 'close' and v_status = 'closed' then
    return 'closed';
  end if;
  if not p_by_operator then
    select paused, case when p_purpose = 'call' then call_ceiling_alerted_at else ceiling_alerted_at end
      into v_paused, v_alerted
      from budget_mainnet.budget_controls where id = 1 for update;
    if v_paused is distinct from false then
      return 'paused';
    end if;
    if p_purpose <> 'close' and v_status <> 'open' then
      return 'not_open';
    end if;
    select count(*) into v_recent from budget_mainnet.budget_spender_uses
      where spender_id = p_spender_id and not by_operator and at >= now() - interval '10 minutes'
        and (purpose = 'call') = (p_purpose = 'call');
    if v_recent >= p_max_uses then
      return 'overuse';
    end if;
    select count(*) into v_recent from budget_mainnet.budget_spender_uses u
      join budget_mainnet.budget_spenders s on s.id = u.spender_id
      where s.payer = v_payer and not u.by_operator and u.at >= now() - interval '10 minutes'
        and (u.purpose = 'call') = (p_purpose = 'call');
    -- One payer's ceiling is checked before the ceiling for all payers, and a
    -- refused use is not logged: a payer at its ceiling uses up none of the
    -- room the others have (RAP-MB3-S3).
    if v_recent >= p_max_payer then
      return 'payer_overuse';
    end if;
    select count(*) into v_recent from budget_mainnet.budget_spender_uses u
      where not u.by_operator and u.at >= now() - interval '10 minutes'
        and (u.purpose = 'call') = (p_purpose = 'call');
    if v_recent >= p_max_global then
      if v_alerted is null or v_alerted < now() - interval '10 minutes' then
        if p_purpose = 'call' then
          update budget_mainnet.budget_controls set call_ceiling_alerted_at = now() where id = 1;
        else
          update budget_mainnet.budget_controls set ceiling_alerted_at = now() where id = 1;
        end if;
        return 'global_overuse_new';
      end if;
      return 'global_overuse';
    end if;
  end if;
  insert into budget_mainnet.budget_spender_uses (spender_id, purpose, payee, message_sha256, detail, by_operator)
    values (p_spender_id, p_purpose, p_payee, p_message_sha256, coalesce(p_detail, '{}'::jsonb), p_by_operator);
  return 'ok';
end;
$$;

-- The same step as public.budget_spender_call (20261125160000_budget_signer_recheck.sql).
create function budget_mainnet.budget_spender_call(
  p_spender_id text,
  p_payee text,
  p_message_sha256 text,
  p_detail jsonb,
  p_max_uses integer,
  p_max_payer integer,
  p_max_global integer
) returns text
language plpgsql
security invoker
set search_path = budget_mainnet, pg_temp
as $$
declare
  v_status text;
  v_last bigint;
  v_answer text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'budget_spender_call runs only at READ COMMITTED';
  end if;
  if p_payee is null or p_payee = '' then
    raise exception 'budget_spender_call needs the provider';
  end if;
  select status into v_status from budget_mainnet.budget_spenders where id = p_spender_id for update;
  if not found then
    return 'unknown';
  end if;
  select coalesce(max((detail ->> 'sequence')::bigint), 0) into v_last
    from budget_mainnet.budget_spender_uses
    where spender_id = p_spender_id and purpose = 'call' and payee = p_payee and (detail ->> 'sequence') ~ '^[0-9]{1,7}$';
  if v_last + 1 > 1000000 then
    return 'exhausted';
  end if;
  v_answer := budget_mainnet.budget_spender_use(p_spender_id, 'call', p_payee, p_message_sha256,
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('sequence', (v_last + 1)::text),
    false, p_max_uses, p_max_payer, p_max_global);
  if v_answer = 'ok' then
    return 'ok:' || (v_last + 1)::text;
  end if;
  return v_answer;
end;
$$;

create function budget_mainnet.budget_operator_alert_queue(p_alert jsonb) returns boolean
language plpgsql
security invoker
set search_path = budget_mainnet, pg_temp
as $$
declare
  v_pending jsonb;
begin
  if p_alert is null or jsonb_typeof(p_alert) <> 'object' then
    raise exception 'an alert is a JSON object';
  end if;
  select operator_pending into v_pending from budget_mainnet.budget_controls where id = 1 for update;
  if not found then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_pending) e
    where e->>'kind' is not distinct from p_alert->>'kind'
      and e->>'subject' is not distinct from p_alert->>'subject'
      and coalesce(e->>'spenderId', '') = coalesce(p_alert->>'spenderId', '')
  ) then
    return true;
  end if;
  update budget_mainnet.budget_controls
    set operator_pending = (
      select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
      from (
        select e, n from jsonb_array_elements(operator_pending || jsonb_build_array(p_alert)) with ordinality as x(e, n)
        order by n desc limit 50
      ) kept
    )
    where id = 1;
  return found;
end;
$$;

create function budget_mainnet.budget_operator_alert_take() returns jsonb
language plpgsql
security invoker
set search_path = budget_mainnet, pg_temp
as $$
declare
  v_pending jsonb;
begin
  select operator_pending into v_pending from budget_mainnet.budget_controls where id = 1 for update;
  update budget_mainnet.budget_controls set operator_pending = '[]'::jsonb where id = 1;
  return coalesce(v_pending, '[]'::jsonb);
end;
$$;

revoke all on all functions in schema budget_mainnet from public, anon, authenticated, service_role;
grant execute on function budget_mainnet.budget_spender_use(text, text, text, text, jsonb, boolean, integer, integer, integer) to budget_mainnet_signer;
grant execute on function budget_mainnet.budget_spender_call(text, text, text, jsonb, integer, integer, integer) to budget_mainnet_signer;
grant execute on function budget_mainnet.budget_operator_alert_queue(jsonb) to budget_mainnet_signer, budget_mainnet_app;
grant execute on function budget_mainnet.budget_operator_alert_take() to budget_mainnet_signer, budget_mainnet_app;
