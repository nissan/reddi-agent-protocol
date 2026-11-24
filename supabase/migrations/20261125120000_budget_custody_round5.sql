-- Budget relay custody, audit round 5 (3102743) fixes.
--
-- - budget_spender_uses.detail: what each approval allowed (the approval
--   message itself in hex, the amount and payout account, the expiry and who
--   asked), so the log can say what was signed (S6-claude-05).
-- - budget_spender_use also refuses ('global_overuse') once all relay Budgets
--   together were approved p_max_global times in ten minutes (R5-M2). The
--   pause row is locked for the count, so concurrent claims on different
--   Budgets cannot slip past the ceiling together. A close still goes through
--   while paused or over either limit.
-- - The function's argument list changes; the old one is dropped. No deployed
--   route calls it (the incident close is the only caller, and it ships with
--   this change).

alter table public.budget_spender_uses add column detail jsonb not null default '{}'::jsonb;

drop function if exists public.budget_spender_use(text, text, text, text, integer);

create function public.budget_spender_use(
  p_spender_id text,
  p_purpose text,
  p_payee text,
  p_message_sha256 text,
  p_detail jsonb,
  p_max_uses integer,
  p_max_global integer
) returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_paused boolean;
  v_recent integer;
begin
  select status into v_status from public.budget_spenders where id = p_spender_id for update;
  if not found then
    return 'unknown';
  end if;
  if p_purpose = 'close' then
    if v_status = 'closed' then
      return 'closed';
    end if;
  else
    -- Locking the one control row serialises every non-close claim, so the
    -- global count below cannot be raced past.
    select paused into v_paused from public.budget_controls where id = 1 for update;
    if v_paused is distinct from false then
      return 'paused';
    end if;
    if v_status <> 'open' then
      return 'not_open';
    end if;
    select count(*) into v_recent from public.budget_spender_uses
      where spender_id = p_spender_id and at >= now() - interval '10 minutes';
    if v_recent >= p_max_uses then
      return 'overuse';
    end if;
    select count(*) into v_recent from public.budget_spender_uses
      where purpose <> 'close' and at >= now() - interval '10 minutes';
    if v_recent >= p_max_global then
      return 'global_overuse';
    end if;
  end if;
  insert into public.budget_spender_uses (spender_id, purpose, payee, message_sha256, detail)
    values (p_spender_id, p_purpose, p_payee, p_message_sha256, coalesce(p_detail, '{}'::jsonb));
  return 'ok';
end;
$$;

revoke all on function public.budget_spender_use(text, text, text, text, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.budget_spender_use(text, text, text, text, jsonb, integer, integer) to service_role;
