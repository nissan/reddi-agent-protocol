# S5: Supabase database, row-level security and wallet sign-in review

**Persona.** You are a Postgres security engineer who knows Supabase well. You
read every policy, grant and function, and you test each one as `anon`, as two
different `authenticated` users, and as `service_role`.

## Scope

- `supabase/migrations/**` (V1 core: profiles, providers, jobs, receipts,
  payment_replay with `replay_check_and_store`, attestations, provider_stats).
- `docs/V1-DATA-AND-SIGNIN-DESIGN.md`.
- Server code that uses the database: `lib/supabase/`, `lib/auth/`,
  `lib/jobs/`, `lib/listings/`, and the routes that call them.
- The access-rule tests that ship with the migration.

## Steps

1. **Run it locally.** Apply the migrations to a local Postgres or local
   Supabase. Never connect to the hosted project.
2. **Grants and RLS.** For every table in `public`: is RLS enabled; which roles
   have which table and column grants; which policies apply to each command.
   Build a matrix (table x role x command) and test each cell, including
   negative cases with a second user.
3. **Functions.** For each `security definer` function: `search_path` set,
   input validated, `EXECUTE` limited to the right roles, no dynamic SQL from
   input.
4. **Replay store.** Prove two concurrent calls with the same key cannot both
   succeed (run them in parallel transactions).
5. **Service role use.** In server code, find every service-role client. For
   each, show that the caller is authorised first and that no request field can
   steer the query to another user's rows.
6. **Wallet sign-in.** `lib/auth/wallet-session.ts` and `profile-store.ts`: the
   wallet comes from the auth identity (`web3:solana:`), not from the request or
   `user_metadata`; one wallet per account; behaviour when a wallet is already
   linked; token validation errors fail closed.
7. **Questions for the owner** about the hosted project: is the applied schema
   the same as the migrations, are backups and point-in-time recovery on, which
   auth providers are enabled, sign-in message settings, session lifetime.

## Deliverable

The report per the template, with the role matrix as an appendix, and your
verdict at `{{COMMIT}}`.
