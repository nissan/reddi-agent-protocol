-- Budget relay: paid calls signed by the spender (Budget page PR 2, 25 Nov 2026).
--
-- - budget_spender_uses.purpose takes 'call': the spender's P-256 signature
--   over one paid call (`x402-budget-signature`), logged before KMS is asked.
-- - budget_spender_use counts calls apart from approvals: a call is checked
--   against the call limits the relay passes with it, an approval against the
--   approval limits, so many calls never freeze a Budget's reserves and a
--   reserve is never refused for calls. Everything else is unchanged.
-- - The operator path still approves only a close, so it never signs a call.

alter table public.budget_spender_uses drop constraint if exists budget_spender_uses_purpose_check;
alter table public.budget_spender_uses add constraint budget_spender_uses_purpose_check
  check (purpose in ('reserve', 'waive', 'close', 'call'));

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
    select paused, ceiling_alerted_at into v_paused, v_alerted
      from public.budget_controls where id = 1 for update;
    if v_paused is distinct from false then
      return 'paused';
    end if;
    if p_purpose <> 'close' and v_status <> 'open' then
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
