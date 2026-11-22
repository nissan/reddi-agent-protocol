-- Records several replay keys for one payment together (security review round 1,
-- condition C6). A real payment is recorded under two keys, its transaction
-- signature and its challenge nonce. Inserting them in two calls could leave the
-- first recorded when the second failed, so an honest retry was refused. This
-- function inserts every key or none: true when all were new and are now
-- recorded, false when any was already present.
create function public.replay_check_and_store_all(p_keys text[])
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_keys is null or cardinality(p_keys) = 0 then
    raise exception 'at least one replay key is required';
  end if;
  insert into public.payment_replay (key) select unnest(p_keys);
  return true;
exception when unique_violation then
  -- The block's work is rolled back, so no key of this call stays recorded.
  return false;
end;
$$;

revoke execute on function public.replay_check_and_store_all(text[]) from public, anon, authenticated;
grant execute on function public.replay_check_and_store_all(text[]) to service_role;
