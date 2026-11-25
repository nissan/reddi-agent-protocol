-- Budget signer re-check (audit 2026-11-25, RT-M2): what the main app can
-- write must not be enough to make the signer sign.
--
-- - budget_signer_holds: an append-only log of holds (a pause of every relay
--   Budget, or a freeze of one record) and their releases. The service role
--   may insert and select only, and may not name a row's id or time, so a
--   row cannot be placed elsewhere in the log. A hold needs nothing; a
--   release counts only with the signer's MAC over its place in the log,
--   checked in code (lib/budget/holds.ts). So the app can ask for a pause but
--   cannot lift one.
-- - budget_spender_call: claims a paid call like budget_spender_use and, in
--   the same locked step, gives it the next call number for this record and
--   provider, counted from the append-only use log. A number is handed out
--   once, whatever the app writes to the record.

create table public.budget_signer_holds (
  id bigserial primary key,
  scope text not null check (scope in ('all', 'spender')),
  spender_id text references public.budget_spenders (id),
  kind text not null check (kind in ('hold', 'release')),
  reason text not null default '' check (char_length(reason) <= 300),
  mac text check (mac is null or mac ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now(),
  check ((scope = 'all') = (spender_id is null)),
  check (kind = 'hold' or mac is not null)
);
create index budget_signer_holds_spender on public.budget_signer_holds (spender_id, id);

alter table public.budget_signer_holds enable row level security;
revoke all on public.budget_signer_holds from public, anon, authenticated, service_role;
revoke all on sequence public.budget_signer_holds_id_seq from public, anon, authenticated, service_role;
grant select on public.budget_signer_holds to service_role;
grant insert (scope, spender_id, kind, reason, mac) on public.budget_signer_holds to service_role;
grant usage on sequence public.budget_signer_holds_id_seq to service_role;

-- Even the table's owner role edits nothing through the API: rows only go in.
create or replace function public.budget_signer_holds_append_only() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'budget_signer_holds is append-only';
end;
$$;
revoke all on function public.budget_signer_holds_append_only() from public, anon, authenticated, service_role;
create trigger budget_signer_holds_no_update before update or delete on public.budget_signer_holds
  for each row execute function public.budget_signer_holds_append_only();
create trigger budget_signer_holds_no_truncate before truncate on public.budget_signer_holds
  for each statement execute function public.budget_signer_holds_append_only();

create index if not exists budget_spender_uses_calls on public.budget_spender_uses (spender_id, payee) where purpose = 'call';

create or replace function public.budget_spender_call(
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
set search_path = public, pg_temp
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
  -- The same row lock budget_spender_use takes: two calls of one record are numbered one after the other.
  select status into v_status from public.budget_spenders where id = p_spender_id for update;
  if not found then
    return 'unknown';
  end if;
  select coalesce(max((detail ->> 'sequence')::bigint), 0) into v_last
    from public.budget_spender_uses
    where spender_id = p_spender_id and purpose = 'call' and payee = p_payee and (detail ->> 'sequence') ~ '^[0-9]{1,7}$';
  if v_last + 1 > 1000000 then
    return 'exhausted';
  end if;
  v_answer := public.budget_spender_use(p_spender_id, 'call', p_payee, p_message_sha256,
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('sequence', (v_last + 1)::text),
    false, p_max_uses, p_max_payer, p_max_global);
  if v_answer = 'ok' then
    return 'ok:' || (v_last + 1)::text;
  end if;
  return v_answer;
end;
$$;

revoke all on function public.budget_spender_call(text, text, text, jsonb, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.budget_spender_call(text, text, text, jsonb, integer, integer, integer) to service_role;
