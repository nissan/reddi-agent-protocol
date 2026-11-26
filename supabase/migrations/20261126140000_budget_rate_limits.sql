-- Budget routes: durable rate limits (#1204, audit 1079ce8 S2-claude-06).
--
-- The Budget routes limited each client in each server instance's memory, so a
-- limit held only per warm instance. These counters live in the database and
-- hold across every instance: one row per bucket (for example a route and a
-- client address, a Budget key, or a payer) per fixed window.
--
-- budget_rate_hit(bucket, window_seconds, limit) counts one hit in the current
-- window and answers how many seconds to wait, 0 when the hit is allowed. One
-- statement, so concurrent hits cannot race past the limit. A hit refused is
-- still counted: a client that keeps hammering stays refused for the window.
-- Rows of windows that ended more than a day ago are removed as they are seen.

create table if not exists public.budget_rate_limits (
  bucket text not null check (length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

create index if not exists budget_rate_limits_window_idx on public.budget_rate_limits (window_start);

alter table public.budget_rate_limits enable row level security;
revoke all on public.budget_rate_limits from public, anon, authenticated, service_role;

create or replace function public.budget_rate_hit(
  p_bucket text,
  p_window_seconds integer,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
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
  insert into public.budget_rate_limits as r (bucket, window_start, hits)
    values (p_bucket, v_start, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1
    returning hits into v_hits;
  -- Housekeeping: a few old rows at a time, so no hit pays for a big delete.
  delete from public.budget_rate_limits
    where ctid in (select ctid from public.budget_rate_limits where window_start < now() - interval '1 day' limit 20);
  if v_hits <= p_limit then
    return 0;
  end if;
  return greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))::integer);
end;
$$;

revoke all on function public.budget_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.budget_rate_hit(text, integer, integer) to service_role;
