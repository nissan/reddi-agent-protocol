# V1 data and sign-in design

Design for [#740](https://github.com/nissan/reddi-agent-protocol/issues/740), drafted
20 November 2026 against `main` at `e639581`. This is a design and a first migration.
Nothing here is deployed, no Supabase project is connected, and no app code reads or
writes the database yet.

## Why

The app keeps state in JSON files under `data/` written with `writeFileSync`. On the
hosted app those writes do not persist, and there is no sign-in, so nothing a user
creates survives and no record has an owner. V1 needs accounts and durable records.

## What is stored today, and where it goes

| Today (file under `data/`) | Written by | V1 home |
| --- | --- | --- |
| `onboarding/specialist-index.json`, `specialist-capabilities.json`, `specialist-profile.json` | `lib/onboarding/specialist-index.ts`, `capabilities.ts`, `endpoint-manager.ts` | `providers`, `provider_stats` |
| `onboarding/consumer-index.json` | `consumer-registry.ts` | `profiles` |
| `onboarding/planner-runs.json` | `planner-execution.ts`, `planner-settlement.ts` | `jobs`, `receipts` |
| `onboarding/attestations.json` | `attestation.ts` | `attestations` |
| `onboarding/planner-feedback.json`, `rating-commits.json` | `planner-feedback.ts`, `reputation-signal.ts` | `provider_stats` inputs; commit-reveal ratings are out of V1 |
| `orchestrator/policy.json`, `spend.json` | `lib/orchestrator/policy.ts` | Later: buyer spend policy (tracked with #738) |
| `onboarding/local-wallet.json`, `wallet-backup-checkpoint.json` | `wallet-sponsorship.ts`, `wallet-recovery.ts` | **Never stored.** Local development only; key material does not go in the database |
| In-memory nonce set | `packages/x402-solana/src/nonce.ts` | `payment_replay` (#723) |

`data/agents.json` and the fixture corpora stay as test and demo fixtures.

## Tables

Defined in `supabase/migrations/20261120000000_v1_core.sql`.

- `profiles`: one row per signed-in wallet, linking the auth user to its wallet address.
- `providers`: one listing per wallet, with endpoint, declared models, capabilities,
  price in base units, mint, network and status. Health fields are server-observed.
- `jobs`: one paid call, with buyer, provider, declared model, request and response
  hashes, amount, mint and transaction signature. `(network, tx_signature)` is unique,
  so one transaction pays for one call.
- `receipts`: the provider-signed RAP receipt for a job.
- `payment_replay`: insert-once ledger of nonces and transaction keys, used through
  `replay_check_and_store(key)`.
- `attestations`: an attestor's outcome for a job.
- `provider_stats`: delivered and failed job counts and attestation counts per provider.

Prompts and responses are not stored, only their SHA-256 hashes.

## Who can do what

| Table | Anyone | Signed-in user | Server (service role) |
| --- | --- | --- | --- |
| `profiles` | nothing | read own | write |
| `providers` | read listed | read own; create and edit own descriptive fields, only under their own wallet | write health and timestamps |
| `jobs`, `receipts` | nothing | read where they are the buyer or own the provider | write |
| `attestations`, `provider_stats` | read for listed providers | same | write |
| `payment_replay` | nothing | nothing | read and write |

Notes on the table:

- Privileges are explicit. The migration revokes everything from the two client roles and
  grants back only reads and the owner's listing edits, because Supabase's default grants
  include `TRUNCATE`, which row level security does not stop.
- Clients cannot read `providers.owner_user_id` (an internal account id) and must name the
  columns they read; `select *` on `providers` is refused.
- `attestations` carries the provider wallet, so public reputation reads never need the
  private job row. Reputation data is hidden once a provider is no longer listed.
- An owner can set their own listing to `listed` and name any https endpoint without a
  server check. That is intended for the guarded beta: health is observed by the server
  and shown separately, and the owner cannot write it.
- `updated_at` is set by the database on every update.

The rule behind the table: a client may describe its own listing, and every record that
states a verified fact (a payment happened, work was delivered, a check passed) is
written only by the server after it has verified that fact. The service-role key lives
only in the server environment.

## Sign-in

Wallet signature sign-in (Sign-In With Solana) through Supabase Auth's built-in Web3
provider: the browser calls `signInWithWeb3({ chain: "solana" })` with the connected
wallet, the wallet signs a message (never a transaction) naming the site and an expiry,
and the auth service verifies it and issues the session.

Settled on 20 November 2026: use the built-in provider and do not verify signatures in
our own route. The session lives in the browser and is sent to our write routes as a
bearer token, not a cookie, so a write cannot be triggered from another site.

- `lib/auth/wallet-session.ts` asks the auth service who a token belongs to and reads
  the wallet from the recorded sign-in identity (`web3:solana:<address>`). It never
  trusts a wallet in the request and never reads `user_metadata`, which a user can edit.
- `POST /api/auth/session` upserts `profiles` with the server's service role.
- `components/auth/WalletSignIn.tsx` is the control in the navigation bar. It renders
  nothing until `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set.

The owner must switch on "Sign in with Web3" for Solana in the project's auth settings.

## Listings

Source-level, added 20 November 2026; nothing is deployed and no page calls these yet.

- `PUT /api/listings` creates or updates the signed-in wallet's own listing. The wallet
  and owner come from the checked session and the network from the server's profile; the
  body cannot name them, or health fields. A listing the server marked `removed` cannot be
  saved again by its owner, and a listing is not moved between networks.
- `GET /api/listings/mine` returns that wallet's listing in any status.
- `GET /api/listings` returns listed providers for the deployment's network, read with
  the public key so the database's access rules apply.

A listing states one price: whole base units of one mint, or `SOL`. The database names
mainnet `solana-mainnet`; payment code calls it `solana-mainnet-beta`.
`listingNetworkForProfile` is the one place that maps between them. The existing
file-backed onboarding and planner routes still read `data/` and move in later changes.

## Replay store

`replay_check_and_store(key)` gives `SolanaReceiptVerifier` a store that is atomic
across instances and survives restarts. The adapter that implements the package's
`NonceReplayStore` interface with this function is the next build slice. Old keys can
be pruned once a transaction age bound is enforced in the verifier (open under #738);
until then nothing is deleted.

## Checks

`supabase/tests/run-local.sh` applies the migration to a throwaway local Postgres with
a small stand-in for Supabase's roles and `auth.uid()`, then runs
`supabase/tests/10_access_rules.sql`. It covers: a user cannot list under another
wallet, edit or delete another user's listing, set server-owned fields, write jobs or
profiles, or touch the replay ledger; a buyer and the provider's owner can read their
job and receipt and nobody else can; a replayed key is refused; one transaction cannot
be recorded for two jobs. The stand-in is not Supabase: the same checks must be re-run
against the real project before any user data is stored.

This script needs Postgres server binaries and is not yet wired into CI.

## What the owner needs to provide

1. A new Supabase project for RAP (region close to users; the database password stays
   with the owner).
2. Its project URL, anon key and service-role key set as environment variables in the
   hosting environment, never committed.
3. Approval to apply this migration to that project.

## Not in this design

Email or social sign-in, analytics, AUDD activation metrics (#626 to #628), buyer spend
policy storage, and moving any existing file-backed route to the database. Each route
moves in its own change once the project exists.
