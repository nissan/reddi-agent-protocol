-- Pooled budget slices for providers on serverless hosts (@redditech/provider-kit,
-- src/budgets.ts). One row per provider and budget: what the provider's slice
-- of a buyer's budget has served and cost, and whether its total was posted
-- and paid. Every instance of one provider shares it, so the sweep can post
-- and pay out a slice whichever instance served it.
--
-- Same rules as 20261123120000_provider_kit_state: server only, not exposed
-- through the API, and only provider_kit_app may use it.

create table provider_kit.budget_slices (
  provider text not null,
  budget text not null,
  status text not null check (status in ('open', 'posted', 'done')),
  record text not null,
  updated_at timestamptz not null default now(),
  primary key (provider, budget)
);
create index budget_slices_due on provider_kit.budget_slices (provider) where status <> 'done';

alter table provider_kit.budget_slices enable row level security;
revoke all on provider_kit.budget_slices from public, anon, authenticated;
grant select, insert, update, delete on provider_kit.budget_slices to provider_kit_app;
create policy provider_kit_app_all on provider_kit.budget_slices for all to provider_kit_app using (true) with check (true);
