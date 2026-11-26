-- Mainnet Budget jobs (#1145) and dispute evidence on mainnet (#1232), for the
-- mainnet app's own role (`budget_mainnet_app`). The mainnet app holds no
-- service role key (#1205), so without these grants it could neither read the
-- receipts its relay saved nor record a job paid from a mainnet Budget.
--
-- 1. Receipts: the app reads the copies its relay saved (source = 'relay').
--    The Budget jobs recorder needs only those (the relay saves the provider's
--    signed receipt header with every call), and so does the evidence beside
--    each share on the Budget page. Receipts a provider sent to the judge
--    (source = 'provider') stay the judge's. The app still cannot update or
--    delete a receipt (append-only triggers, no grant), and the judge's log
--    stays closed to it (20261127100000_budget_mainnet_judge.sql).
-- 2. Jobs: the app records a job paid from a mainnet Budget in public.jobs and
--    looks up which payouts already have one. Only rows on 'solana-mainnet'
--    that name a Budget, never with a signed-in buyer, and only the columns
--    the recorder sends (lib/jobs/job-store.ts recordVerifiedJob). It reads
--    back only id, network and tx_signature. No update or delete. The provider
--    foreign key is checked as the table owner, so no grant on providers.

create policy app_reads_relay_receipts on budget_mainnet.budget_call_receipts
  for select to budget_mainnet_app using (source = 'relay');
grant select on budget_mainnet.budget_call_receipts to budget_mainnet_app;

grant usage on schema public to budget_mainnet_app;
grant select (id, network, tx_signature) on public.jobs to budget_mainnet_app;
grant insert (buyer_wallet, buyer_user_id, provider_wallet, network, declared_model, request_hash, response_hash,
              amount_base_units, mint, tx_signature, status, completed_at, budget, budget_created_slot)
  on public.jobs to budget_mainnet_app;

create policy mainnet_app_reads_budget_jobs on public.jobs
  for select to budget_mainnet_app using (network = 'solana-mainnet' and budget is not null);
create policy mainnet_app_records_budget_jobs on public.jobs
  for insert to budget_mainnet_app with check (network = 'solana-mainnet' and budget is not null and buyer_user_id is null);
