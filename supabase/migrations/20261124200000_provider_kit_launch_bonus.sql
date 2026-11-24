-- Launch Budget bonus (apps/providers/lib/launch-bonus.ts): for 30 days after
-- mainnet launch a USDC Budget earns a 50% bonus to spend with RAP's own
-- providers. The bonus is a discount those providers give on their own price:
-- these rows are its ledger. They hold no funds and no key, and nothing here
-- moves money.
--
-- Same rules as the rest of provider_kit: server only, no client role has any
-- privilege, and the providers reach it as provider_kit_app.

-- One row per offer: how much bonus is granted and not yet released, locked
-- for every grant and release so the pool cap holds across instances.
create table provider_kit.launch_bonus_pool (
  offer text primary key check (offer ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  granted numeric(30, 0) not null check (granted >= 0)
);

-- One grant per Budget, keyed by the Budget address. A Budget that earns
-- nothing (wallet or pool cap reached) has a zero grant, so it is not
-- reconsidered. `released` is unspent bonus that lapsed when the Budget closed.
create table provider_kit.launch_bonus_grants (
  offer text not null references provider_kit.launch_bonus_pool (offer),
  budget text not null check (budget ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  payer text not null check (payer ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  amount numeric(30, 0) not null check (amount >= 0),
  remaining numeric(30, 0) not null check (remaining >= 0),
  released numeric(30, 0) not null check (released >= 0),
  created_at timestamptz not null default now(),
  primary key (offer, budget),
  check (remaining + released <= amount)
);
create index launch_bonus_grants_payer on provider_kit.launch_bonus_grants (offer, payer);

-- Each call spends bonus once: a retry of the same call finds its row.
create table provider_kit.launch_bonus_uses (
  offer text not null,
  budget text not null,
  call text not null check (call ~ '^[\x21-\x7e]{1,200}$'),
  provider text not null,
  cost numeric(30, 0) not null check (cost > 0),
  bonus numeric(30, 0) not null check (bonus > 0),
  paid numeric(30, 0) not null check (paid > 0),
  created_at timestamptz not null default now(),
  primary key (offer, budget, call),
  foreign key (offer, budget) references provider_kit.launch_bonus_grants (offer, budget),
  check (bonus + paid = cost and bonus <= paid)
);

alter table provider_kit.launch_bonus_pool enable row level security;
alter table provider_kit.launch_bonus_grants enable row level security;
alter table provider_kit.launch_bonus_uses enable row level security;

revoke all on provider_kit.launch_bonus_pool, provider_kit.launch_bonus_grants, provider_kit.launch_bonus_uses from public, anon, authenticated;

grant select, insert, update on provider_kit.launch_bonus_pool, provider_kit.launch_bonus_grants, provider_kit.launch_bonus_uses to provider_kit_app;
create policy provider_kit_app_all on provider_kit.launch_bonus_pool for all to provider_kit_app using (true) with check (true);
create policy provider_kit_app_all on provider_kit.launch_bonus_grants for all to provider_kit_app using (true) with check (true);
create policy provider_kit_app_all on provider_kit.launch_bonus_uses for all to provider_kit_app using (true) with check (true);
