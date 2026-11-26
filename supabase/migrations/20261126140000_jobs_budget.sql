-- Calls paid from a pooled Budget show up in My jobs (#1145; final round task list item 9).
--
-- - jobs.budget / jobs.budget_created_slot: set for a job recorded from a
--   Budget slice payout (lib/jobs/budget-call.ts), so My jobs can tag it and
--   link to the Budget. One job per paid slice; the payout transaction is its
--   tx_signature, so the existing (network, tx_signature) key keeps it unique.
-- - A buyer reads a job by the wallet that paid, as well as by user id. A
--   Budget payout is recorded by the server's sweep, not during a signed-in
--   request, so it has no buyer_user_id; the payer still proves the wallet by
--   signing in with it (profiles.wallet, written by the server only).

alter table public.jobs
  add column budget text check (budget is null or budget ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  add column budget_created_slot bigint check (budget_created_slot is null or budget_created_slot > 0),
  add constraint jobs_budget_pair check ((budget is null) = (budget_created_slot is null));

create index jobs_buyer_wallet_idx on public.jobs (buyer_wallet, created_at desc);

drop policy jobs_select_party on public.jobs;
create policy jobs_select_party on public.jobs
  for select to authenticated using (
    buyer_user_id = auth.uid()
    or buyer_wallet = (select p.wallet from public.profiles p where p.user_id = auth.uid())
    or public.is_provider_owner(provider_wallet)
  );
