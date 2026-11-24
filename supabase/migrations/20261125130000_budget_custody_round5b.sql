-- Budget relay custody, audit round 5b (5b062a9) fixes.
--
-- - budget_spender_uses.by_operator: a close the incident step asked for.
--   Only those skip the pause and the limits; a close the agent asks for is
--   counted and limited like any other approval (condition 2).
-- - budget_spender_use takes a per-payer limit and counts per network, so one
--   payer cannot use up the ceiling every relay Budget shares, and devnet
--   approvals never count against mainnet (condition 3). Past the global
--   ceiling it refuses ('global_overuse') instead of pausing everything; the
--   first refusal in ten minutes answers 'global_overuse_new' so the relay
--   tells the operator once, not on every request.
-- - It refuses NULL limits, and runs only at READ COMMITTED: under REPEATABLE
--   READ its counts would come from a snapshot taken before the lock.
-- - Indexes for the counts: the log by time, and records by payer.
-- - budget_controls.operator_pending: operator alerts no channel took, sent
--   again by the watcher (condition 4), through two functions so a queued
--   alert is never lost between a read and a write.
-- - The function's argument list changes; the old one is dropped. Nothing
--   deployed calls it yet.

alter table public.budget_spender_uses add column by_operator boolean not null default false;
create index budget_spender_uses_at on public.budget_spender_uses (at);
create index budget_spenders_payer on public.budget_spenders (payer);

alter table public.budget_controls add column operator_pending jsonb not null default '[]'::jsonb;
alter table public.budget_controls add column ceiling_alerted_at timestamptz;

drop function if exists public.budget_spender_use(text, text, text, text, jsonb, integer, integer);

create function public.budget_spender_use(
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
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_payer text;
  v_network text;
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
  select status, payer, network into v_status, v_payer, v_network
    from public.budget_spenders where id = p_spender_id for update;
  if not found then
    return 'unknown';
  end if;
  if p_purpose = 'close' and v_status = 'closed' then
    return 'closed';
  end if;
  if not p_by_operator then
    -- Locking the one control row serialises every counted claim, so no count
    -- below can be raced past.
    select paused, ceiling_alerted_at into v_paused, v_alerted
      from public.budget_controls where id = 1 for update;
    if v_paused is distinct from false then
      return 'paused';
    end if;
    if p_purpose <> 'close' and v_status <> 'open' then
      return 'not_open';
    end if;
    select count(*) into v_recent from public.budget_spender_uses
      where spender_id = p_spender_id and not by_operator and at >= now() - interval '10 minutes';
    if v_recent >= p_max_uses then
      return 'overuse';
    end if;
    select count(*) into v_recent from public.budget_spender_uses u
      join public.budget_spenders s on s.id = u.spender_id
      where s.payer = v_payer and s.network = v_network and not u.by_operator and u.at >= now() - interval '10 minutes';
    if v_recent >= p_max_payer then
      return 'payer_overuse';
    end if;
    select count(*) into v_recent from public.budget_spender_uses u
      join public.budget_spenders s on s.id = u.spender_id
      where s.network = v_network and not u.by_operator and u.at >= now() - interval '10 minutes';
    if v_recent >= p_max_global then
      if v_alerted is null or v_alerted < now() - interval '10 minutes' then
        update public.budget_controls set ceiling_alerted_at = now() where id = 1;
        return 'global_overuse_new';
      end if;
      return 'global_overuse';
    end if;
  end if;
  insert into public.budget_spender_uses (spender_id, purpose, payee, message_sha256, detail, by_operator)
    values (p_spender_id, p_purpose, p_payee, p_message_sha256, coalesce(p_detail, '{}'::jsonb), p_by_operator);
  return 'ok';
end;
$$;

revoke all on function public.budget_spender_use(text, text, text, text, jsonb, boolean, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.budget_spender_use(text, text, text, text, jsonb, boolean, integer, integer, integer) to service_role;

-- Keeps an operator alert no channel took; one of each (kind, subject,
-- record), the newest 50.
create function public.budget_operator_alert_queue(p_alert jsonb) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_pending jsonb;
begin
  if p_alert is null or jsonb_typeof(p_alert) <> 'object' then
    raise exception 'an alert is a JSON object';
  end if;
  select operator_pending into v_pending from public.budget_controls where id = 1 for update;
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
  update public.budget_controls
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

-- Hands over every queued operator alert and empties the queue, in one step.
create function public.budget_operator_alert_take() returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_pending jsonb;
begin
  select operator_pending into v_pending from public.budget_controls where id = 1 for update;
  update public.budget_controls set operator_pending = '[]'::jsonb where id = 1;
  return coalesce(v_pending, '[]'::jsonb);
end;
$$;

revoke all on function public.budget_operator_alert_queue(jsonb) from public, anon, authenticated;
revoke all on function public.budget_operator_alert_take() from public, anon, authenticated;
grant execute on function public.budget_operator_alert_queue(jsonb) to service_role;
grant execute on function public.budget_operator_alert_take() to service_role;
