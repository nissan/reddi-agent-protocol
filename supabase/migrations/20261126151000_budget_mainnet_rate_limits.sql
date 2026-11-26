-- The mainnet Budget routes' rate limits (#1204, for the schema of #1205).
--
-- The same counters and function as public.budget_rate_limits and
-- public.budget_rate_hit (20261126140000_budget_rate_limits.sql), in the
-- mainnet schema: the mainnet app counts its own clients here, as its own
-- database role. The service role key (the devnet app and devnet signer)
-- cannot run the function or touch the table, so it can neither use up a
-- mainnet client's allowance nor clear it. The mainnet signer has no use for
-- it and is not granted it.

create table budget_mainnet.budget_rate_limits (
  bucket text not null check (length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
create index budget_rate_limits_window_idx on budget_mainnet.budget_rate_limits (window_start);

-- No policy and no grant: only the function below (which runs as its owner) reads or writes it.
alter table budget_mainnet.budget_rate_limits enable row level security;
revoke all on budget_mainnet.budget_rate_limits from public, anon, authenticated, service_role, budget_mainnet_signer, budget_mainnet_app;

create function budget_mainnet.budget_rate_hit(
  p_bucket text,
  p_window_seconds integer,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = budget_mainnet, pg_temp
as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_bucket is null or length(p_bucket) < 1 or length(p_bucket) > 200 then
    raise exception 'budget_rate_hit needs a bucket of 1 to 200 characters';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 or p_limit is null or p_limit < 1 then
    raise exception 'budget_rate_hit needs a window of 1 to 86400 seconds and a positive limit';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into budget_mainnet.budget_rate_limits as r (bucket, window_start, hits)
    values (p_bucket, v_start, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1
    returning hits into v_hits;
  -- Housekeeping: a few old rows at a time, so no hit pays for a big delete.
  delete from budget_mainnet.budget_rate_limits
    where ctid in (select ctid from budget_mainnet.budget_rate_limits where window_start < now() - interval '1 day' limit 20);
  if v_hits <= p_limit then
    return 0;
  end if;
  return greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))::integer);
end;
$$;

revoke all on function budget_mainnet.budget_rate_hit(text, integer, integer) from public, anon, authenticated, service_role, budget_mainnet_signer;
grant execute on function budget_mainnet.budget_rate_hit(text, integer, integer) to budget_mainnet_app;
