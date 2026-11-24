-- Budget relay custody, review S6 fixes (2026-11-24).
--
-- budget_spender_use: the one way a spender key's use is logged. In a single
-- statement it locks the key's row, checks the pause switch, the row's status
-- and how often the key was used in the last ten minutes (by the database's
-- clock), and only then appends the use. The relay signs only when it answers
-- 'ok', so concurrent requests cannot all pass the overuse limit or slip past
-- a pause or freeze written meanwhile.
--
-- budget_controls.watched_at: when the watcher last finished a full pass, for
-- the stalled-watcher check.

create function public.budget_spender_use(
  p_spender_id text,
  p_purpose text,
  p_payee text,
  p_message_sha256 text,
  p_max_uses integer
) returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_sealed text;
  v_paused boolean;
  v_recent integer;
begin
  select status, sealed into v_status, v_sealed from public.budget_spenders where id = p_spender_id for update;
  if not found or v_sealed is null then
    return 'unknown';
  end if;
  if p_purpose = 'close' then
    if v_status = 'closed' then
      return 'closed';
    end if;
  else
    select paused into v_paused from public.budget_controls where id = 1;
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
  end if;
  insert into public.budget_spender_uses (spender_id, purpose, payee, message_sha256)
    values (p_spender_id, p_purpose, p_payee, p_message_sha256);
  return 'ok';
end;
$$;

revoke all on function public.budget_spender_use(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.budget_spender_use(text, text, text, text, integer) to service_role;

alter table public.budget_controls add column watched_at timestamptz;
