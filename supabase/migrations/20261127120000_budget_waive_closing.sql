-- No-judge Budgets release on completion (Nissan, 27 Nov 2026).
--
-- A Budget opened without a judge cannot be disputed, so its dispute window
-- protects nobody. Those Budgets now open with flag 0x01 (the spender may
-- waive), and the relay waives each slice as soon as its provider posts, so
-- the provider is paid on completion. Providers usually post after the
-- Budget closes, when the relay's record is `closing`; until now the use log
-- refused every approval but the close for a record that is not `open`.
--
-- The only change to both copies of budget_spender_use (public and
-- budget_mainnet): a `waive` is also allowed while the record is `closing`.
-- Everything else (pause, limits, logging, grants) is as before; the
-- function signatures are unchanged, so the grants stand.

create or replace function public.budget_spender_use(
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
    select paused, case when p_purpose = 'call' then call_ceiling_alerted_at else ceiling_alerted_at end
      into v_paused, v_alerted
      from public.budget_controls where id = 1 for update;
    if v_paused is distinct from false then
      return 'paused';
    end if;
    -- A waive may also go to a Budget that closed on chain with slices still
    -- posted (status closing): on a Budget without a judge the relay releases
    -- each posted slice at once (20261127120000). Reserves and calls still
    -- need an open record.
    if (p_purpose = 'waive' and v_status not in ('open', 'closing'))
       or (p_purpose not in ('close', 'waive') and v_status <> 'open') then
      return 'not_open';
    end if;
    select count(*) into v_recent from public.budget_spender_uses
      where spender_id = p_spender_id and not by_operator and at >= now() - interval '10 minutes'
        and (purpose = 'call') = (p_purpose = 'call');
    if v_recent >= p_max_uses then
      return 'overuse';
    end if;
    select count(*) into v_recent from public.budget_spender_uses u
      join public.budget_spenders s on s.id = u.spender_id
      where s.payer = v_payer and s.network = v_network and not u.by_operator and u.at >= now() - interval '10 minutes'
        and (u.purpose = 'call') = (p_purpose = 'call');
    if v_recent >= p_max_payer then
      return 'payer_overuse';
    end if;
    select count(*) into v_recent from public.budget_spender_uses u
      join public.budget_spenders s on s.id = u.spender_id
      where s.network = v_network and not u.by_operator and u.at >= now() - interval '10 minutes'
        and (u.purpose = 'call') = (p_purpose = 'call');
    if v_recent >= p_max_global then
      if v_alerted is null or v_alerted < now() - interval '10 minutes' then
        if p_purpose = 'call' then
          update public.budget_controls set call_ceiling_alerted_at = now() where id = 1;
        else
          update public.budget_controls set ceiling_alerted_at = now() where id = 1;
        end if;
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

-- The same change in the mainnet schema (20261126150000_budget_mainnet_custody.sql).
create or replace function budget_mainnet.budget_spender_use(
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
    -- A waive may also go to a Budget that closed on chain with slices still
    -- posted (status closing): on a Budget without a judge the relay releases
    -- each posted slice at once (20261127120000). Reserves and calls still
    -- need an open record.
    if (p_purpose = 'waive' and v_status not in ('open', 'closing'))
       or (p_purpose not in ('close', 'waive') and v_status <> 'open') then
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
