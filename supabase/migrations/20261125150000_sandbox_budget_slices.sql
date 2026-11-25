-- sandbox_budget_slices: what each devnet sandbox provider remembers of its
-- slice of a pooled Budget (lib/sandbox/budget-desk.ts): what its calls cost,
-- the next call number, and where its post and payout stand. One row per
-- provider and Budget address; `version` makes each write conditional, so two
-- calls with the same call number cannot both be recorded.
--
-- Devnet only, test SOL only. Only the server reads or writes it (service
-- role). Anon and signed-in roles have no grant and RLS has no policies.

create table public.sandbox_budget_slices (
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  budget text not null check (budget ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  status text not null check (status in ('open', 'posted', 'done')),
  record jsonb not null,
  version integer not null check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, budget)
);

create index sandbox_budget_slices_due on public.sandbox_budget_slices (status) where status <> 'done';

alter table public.sandbox_budget_slices enable row level security;
revoke all on public.sandbox_budget_slices from public, anon, authenticated;
-- Supabase grants the service role everything by default: take back what it
-- does not need.
revoke all on public.sandbox_budget_slices from service_role;
grant select, insert, update on public.sandbox_budget_slices to service_role;
