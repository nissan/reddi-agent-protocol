-- The Budget watcher as its own deployment, one per network (#1208, audit
-- 1079ce8 task 8). Each network's watcher keeps its own "last complete pass"
-- time here, so the devnet watcher's passes cannot hide a stalled mainnet
-- watcher (budget_controls.watched_at is one time for everything, and stays
-- for the app's own route).
--
-- One row per network, made here: the watcher only updates its row, so a
-- watcher pointed at a network with no row fails its pass instead of
-- inventing one.

create table public.budget_watch_passes (
  network text primary key check (network in ('solana-devnet', 'solana-mainnet-beta')),
  watched_at timestamptz
);
insert into public.budget_watch_passes (network) values ('solana-devnet'), ('solana-mainnet-beta');

alter table public.budget_watch_passes enable row level security;
revoke all on public.budget_watch_passes from public, anon, authenticated, service_role;
grant select on public.budget_watch_passes to service_role;
grant update (watched_at) on public.budget_watch_passes to service_role;
