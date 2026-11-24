-- Budget relay custody moves to Vercel KMS (owner decision, 24 November 2026).
--
-- The relay no longer makes or stores spender keys. A relay Budget is opened
-- with flag 0x08 (P-256 spender) and names the SHA-256 of the relay's KMS
-- public key; KMS signs each approval and the private key never leaves it.
-- So:
--
-- - `sealed` and `key_id` go: no key material is kept, sealed or not. The
--   sealed keys of the earlier design were never used by a deployed route;
--   dropping them also drops them from every future backup.
-- - `spender_key` holds the record's public key (33-byte compressed P-256,
--   hex), which approvals are checked against.
-- - `spender` stops being unique: every Budget opened under one KMS key names
--   the same spender. `budget` stays unique, so a Budget is one record's.
-- - budget_spender_use no longer asks for a sealed key; a missing record is
--   still 'unknown'.

alter table public.budget_spenders drop constraint if exists budget_spenders_check;
alter table public.budget_spenders drop constraint if exists budget_spenders_spender_key;
alter table public.budget_spenders drop column sealed;
alter table public.budget_spenders drop column key_id;
alter table public.budget_spenders
  add column spender_key text not null check (spender_key ~ '^0[23][0-9a-f]{64}$');
create index budget_spenders_spender on public.budget_spenders (spender);

create or replace function public.budget_spender_use(
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
