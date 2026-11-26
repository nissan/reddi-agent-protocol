# Changelog — @redditech/provider-kit

All notable changes to this package are documented here. Dates are AEST.

## 0.4.1 — unreleased

### Added

- Limits on what a pooled budget can cost a provider before it is paid, each checked before anything is signed and each with a default: `budgets.maxReservesPerHour` (6 reserves and raises for one budget in an hour, else `429 budget_reserve_limit`), `budgets.maxPriorityFeeLamports` (600 lamports of priority fee on a reserve, else `invalid_reserve`), `budgets.maxFrontedRent` (0.05 SOL of rent held in reservations at once, else `503 provider_budget_slots_full`; raises go on) and `budgets.maxPayerAccountsPerDay` (3 payers' token accounts created a day; past it the payout is sent without one and `budget_payer_account_missing` is logged as an alert).
- A slice is remembered when its reserve is signed, not when its first call is served. A reservation whose first call failed is now settled by the sweep: nothing is posted, and a payout after the budget's dispute window closes it and returns its rent. A reserve that was signed but did not land leaves the budget usable, and the sweep reads a slice's size from the chain when a reserve's result was not recorded.
- The sweep takes each budget's lease (the one a call holds while it is served) and works from the slice as stored at that moment, so a sweep that runs across a raise or a call cannot write an older copy of the slice back. A budget that is busy is left for the next pass. `BudgetDeskDeps.lease` and `leaseMs` (optional) carry the handler's lease into a desk built in code.
- `budgets.maxFrontedRent` counts a reserve that is signed and still on its way, and its check and the record of the reserve are one step for the whole provider, so reserves for several budgets sent at once cannot each see room for itself.
- The slice of an earlier budget at the same address is finished (`onBudgetDone` called, record marked done) before a reserve or call of the next budget there replaces its record; if that fails, the reserve is refused unsigned.
- `ProviderChain.readRentExempt` (optional): the rent of a reservation account, read from the cluster. Without it a fixed estimate is used. `BudgetSliceStore.payerAccountsSince` (optional): the day's count of payers' accounts across instances; the three stores in the kit have it.

### Changed

- Pooled budgets are accepted with `network: "solana-mainnet-beta"`, under the same rules as devnet: the budget's token must be the provider's price currency, and a judge it names must be in `budgets.acceptedJudges`. The escrow program on a network must include the budget instructions for budgets to run there.
- Closing a paid slice of an earlier budget no longer creates token accounts: that call moves only the reservation's rent. A payout creates the payer's token account only when it is missing.

## 0.4.0 — 2026-11-26

### Added

- Pooled budgets, devnet only and off by default (`budgets.enabled`; refused on mainnet until the budget instructions are released there). A provider takes calls paid from its slice of a budget in its own price currency: the `402` offers a slice, the kit checks and co-signs the spender's reserve transaction, verifies the spender's signature on every call, meters each call into a signed receipt, and its sweep posts the total, closes an expired budget and pays out. Slices are kept in `budgets.file`, or in Postgres on a serverless host (`provider_kit.budget_slices`, migration `20261124180000_provider_kit_budgets.sql`). Requires `@redditech/x402-solana` 0.2.0.
- `budgetCallPricing`: an optional per-call hook that sets what a budget pays for a call (at most its cost) and may add a `bonus` block to the receipt. A failing hook refuses the call. `budgetCallPricingVoided` reports a priced call refused afterwards, and `onBudgetDone` reports each settled slice from the sweep.
- The sweep's payout and close transactions first create the provider's and the payer's token accounts if either is missing (associated token program `CreateIdempotent`), so a payer who closed their account after locking cannot stall a payout. The provider pays the rent, and only for an account that does not exist yet.
- Follows the budget program's audit round 4 rules through `@redditech/x402-solana`: a reserve the provider co-signs may carry at most one compute-unit limit and one capped compute-unit price, and the `budget_reserved` log shows the most it could cost (`maxFeeLamports`). After a spender closes a budget early (no allowlist), the sweep waits until the end of the open period plus the dispute window before paying out.
- A budget call may carry any call number above the last one served, not only the next one: the spender numbers its calls and signs each number once, so a call that failed on the way leaves a gap instead of a number that would have to be signed again over another body.
- Budgets whose spender is a P-256 key (flag `0x08`, such as a key held in a cloud KMS): the kit checks the reserve's secp256r1 approval, made for this provider's cluster, co-signs as the only signer, and verifies each call's P-256 signature (`x402-budget-signature` carries the 33-byte key and the 64-byte signature).

### Known limits

- Budgets: the provider pays the network fee of every reserve and raise it co-signs and the rent of the accounts its payout needs, and 0.4.0 does not yet limit how often a spender may ask for one or close a reservation whose first call failed before the budget ends. Devnet only for that reason; see README "Pooled budgets". Limits come before budgets are accepted on mainnet.

## 0.3.1 — 2026-11-24

### Changed

- Requires `@redditech/x402-solana` 0.1.3, so a provider refuses, before anything is served or remembered, an escrow opted in to the delivery check (`402 delivery_escrow_declined`) and an escrow carrying flag bits this version does not know (`402 unknown_escrow_flags`). Either could otherwise be served and never settled, leaving the buyer free to refund. Upgrade before an escrow program with the delivery check is in use on your network.

## 0.3.0 — 2026-11-23

### Added

- Serverless hosts: `createServerlessProvider` runs a provider on a host with many short-lived instances (Vercel and similar). It reads the wallet keypair, the private system prompt and the model key from environment variables, mounts the provider under a path, and gives `handle(request)` and `sweep()` for a cron job. It refuses to start without any of them, and refuses sessions and the refund-account subsidy, which still keep their state in one process.
- Postgres stores (`postgresProviderStores`) for everything a provider remembers: accepted locks, a lease per lock, answers waiting for their settle, settles not yet known to land, and the model's limits. Every instance of one provider shares them. The tables and a least-privilege role are in this repository's `provider_kit` migration. The kit has no database driver dependency: pass a `pg` Pool.
- `loadProviderKeyFromEnv`, the provider key from an environment variable; `redactLogEvent`, which takes URLs out of log events.
- Claude models through the Anthropic API (`upstream.provider: "anthropic"`, with `effort` and `thinking`), and a `capacity` setting: when the model is at its per-minute or per-day limit, a call is refused with `503 provider_busy` before any lock is read.
- When the payer's token account cannot receive the unused part of a lock, the settle returns it to a fresh account the provider creates for the payer, so a payer cannot block the settle.

### Changed

- The minimum lock counts one token a UTF-8 byte of input, and the request body limit is enforced while the body streams in. Sessions are offered on devnet only.
- A held answer is given only to the payer of its lock, checked by the escrow address the payer's wallet and nonce derive, and only for the lock instance the payer signed for. Another wallet that names the escrow is refused before any lock is read.
- A pending settle records its payer and lock slot. The sweep declines only the lock it recorded; a record without them is dropped with an alert instead of declining a later lock at the same address.

### Upgrading

- The replay key now names the lock instance, so keys stored by 0.2.x do not match. Deploy 0.3.0 when the sweep shows no pending settles.

## 0.2.1 and earlier

First public releases were 0.2.0 and 0.2.1 (2026-11-22).
