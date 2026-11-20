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
`listingNetworkForProfile` is the one place that maps between them.

When the public database settings are present, the planner (`executePlannerSpecialistCall`)
and the registry view (`fetchSpecialistListings`) read listings from the database through
`lib/listings/listing-index.ts`, and a failed read yields no listings instead of falling
back to files. Without those settings they read `data/` as before, which is the local
development path. A dollar price is stated only for a listing priced in a US dollar
stablecoin; there is no exchange rate. Attestation and feedback are not in the database
yet, so a database listing is never shown as attested.

Health is observed by the server: `/api/cron/heartbeat` calls each listed endpoint's
`/healthz` without following redirects and records pass or fail. The planner requires a
pass by default, so a new listing is not routed to until the first sweep has reached it.
If `CRON_SECRET` is set, the sweep only runs for a request that carries it. Listing
endpoints must be public https names: IP addresses and internal-looking hosts are refused.

When the database is configured, saving the capability profile on `/onboarding` also
publishes the listing through `PUT /api/listings` with the wallet sign-in session
(`lib/listings/listing-client.ts`). The price typed in US dollars becomes whole USDC base
units for the profile's USDC mint. Signed out, nothing is sent and the page says to sign
in. The page still writes `data/` as well, for the steps that have not moved yet.

## Jobs

Source-level, added 20 November 2026; not run against a live project or a real payment.

A job row says a call was paid for, so the app server checks the payment on chain
itself before writing one (`lib/jobs/paid-call.ts`). After a wallet-paid call on
`/planner`, with the database configured, the server reads the selected listing, rebuilds
what must have been paid from that listing alone (listed wallet, listed price, listed
currency), and asks `SolanaReceiptVerifier` whether the buyer's transaction paid it. Only
then is a `jobs` row written with the service role, as `delivered` or `failed` according
to the provider's answer. The provider's own verification is not taken as proof.

- The app keeps no replay ledger of its own. The `jobs` table's unique
  `(network, tx_signature)` refuses a second record for one transaction.
- The job is linked to a signed-in account only when that account's wallet is the payer.
- If anything needed for the check is missing (RPC, a mint for the currency, a fee
  decision on mainnet), nothing is recorded. The buyer's result is unaffected; the run
  trace says `job:not_recorded:<reason>`.
- If the provider takes the protocol fee, the app must be given the same treasury in
  `X402_PROTOCOL_FEE_TREASURY`, or its check will not match the split payment.
- `GET /api/jobs` lists the signed-in user's own jobs, read with their session so the
  database's access rules pick the rows.
- `/jobs` shows those rows to the signed-in user. Amounts are shown in a currency only
  for SOL and the mints this app knows on the job's own network; any other mint is shown
  in base units (`lib/jobs/job-display.ts`).

The provider-signed receipt has a format and an offline verifier
(`packages/agent-protocol/src/provider-receipt-extension.ts`, schema
`reddi.receipt.provider-extension.v1`). It is a separate signed block, so the
`reddi.receipt.v1` contract is unchanged; the owner's choice between this and a new
receipt version is still open. It records a declared model, never verified execution.

After a delivered, recorded job the app reads the `x-reddi-provider-receipt` response
header (base64url JSON of the signed block) and saves it to `receipts` only if the
signature verifies against the paid listing's wallet and the block names the request and
response bytes the app sent and received and the transaction it checked on chain
(`lib/jobs/provider-receipt.ts`). A missing or failed receipt never changes the job.

The specialist runtime (`packages/openrouter-specialists`) can issue that header for a
delivered chat completion paid with a real, verified payment. It is off unless the
operator passes a `signProviderReceipt` function to `handleRuntimeRequest`; the runtime
reads no key itself and `server.ts` passes none yet. It issues nothing while demo
payments are allowed.

Not built yet: how an operator supplies the provider signing key to `server.ts`,
attestations and `provider_stats` updates.

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
