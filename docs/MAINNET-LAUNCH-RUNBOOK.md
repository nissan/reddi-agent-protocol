# V1 mainnet launch runbook

The steps from the program freeze to the first mainnet payout, in order. Every
step that deploys, signs, spends or changes an authority needs the owner's
explicit go at the time; agents never create, read or hold keys. Nothing in this
runbook has been run on mainnet yet.

Program: `programs/pinocchio-escrow`, library `pinocchio_escrow`, default (V1)
build. Program id on both networks: `DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu`
(never deployed on mainnet, so the mainnet deploy is fresh and gets a program
account sized to the Pinocchio build). Treasury and upgrade authority: the
Squads vault `5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe` (always the vault
address, never the multisig account address).

## 1. Freeze

1. Record the freeze commit on `main`.
2. Take the build of record from the `escrow-verifiable-build.yml` run on that
   commit. The workflow is path-filtered, so if the freeze commit did not touch
   the program, start the run by hand (`workflow_dispatch`) on that commit.
   From the `escrow-mainnet-<commit>` artifact record: the size, the `sha256sum`
   of `pinocchio_escrow.so`, and the executable hash (the workflow's `hash`,
   from `solana-verify get-executable-hash`, which is the sha256 with trailing
   zero bytes removed). They are two different hashes; keep both. Record the
   build image's digest too (`docker inspect --format '{{index .RepoDigests 0}}'
   solanafoundation/solana-verifiable-build:4.2.2` on the machine that pulled it).
3. Commit them as the release record `config/releases/v1-mainnet-<commit7>.json`
   (format in `config/releases/README.md`), with `upgradeAuthority` set to the
   vault and `forbiddenAuthorities` holding the multisig account address and the
   deployer address. Record the same values on #736.
4. Countersign before deploy: a person other than whoever wrote the record (the
   owner, if a Claude session wrote it) downloads the `escrow-mainnet-<commit>`
   artifact from the `buildRun` named in the record, runs `stat -c %s`,
   `sha256sum` and `solana-verify get-executable-hash` on `pinocchio_escrow.so`,
   and confirms all three equal the record's `size`, `sha256` and
   `executableHash`, and that the run's image digest equals `imageDigest`. Post
   the three outputs and "countersigned" on #736. The check script only compares
   the chain with the record; this step is what ties the record to the build.
5. The second review (Codex) works from that commit. A program change after the
   freeze means a new freeze commit, record and hash.

## 2. Fund the deployer

The deployer needs the program account's rent, plus room for the temporary
buffer during the deploy and fees. On 22 November 2026 mainnet and devnet both
charged 5,080 lamports per byte (check with `solana rent <bytes> --url
mainnet-beta` before funding). With rating, attestation, the delivery check and
the pooled Budget (with its P-256 spender) in the V1 build, the mainnet variant
is about 196 KB (rent about 1.00 SOL), and the deploy's temporary buffer holds
about the same again until it is closed; take the size of record from the
freeze. Fund 3 SOL: 2 SOL leaves almost no margin.
The owner funds it.

## 3. Deploy (owner signs)

0. Confirm the secp256r1 precompile is active on mainnet: `solana feature
   status --url mainnet-beta` must list the secp256r1 precompile feature as
   active. The Budget's P-256 spender approval checks its signature through
   that precompile (`Secp256r1SigVerify1111111111111111111111111`); if it is not
   active, stop.
1. Deploy the container-built `pinocchio_escrow.so` whose sha256 matches the
   release record, with the program keypair for `DcfW3Cxt…5Ucu`.
2. Hand upgrade authority to the Squads **vault** `5CsBuT…3Hxe`, never the
   multisig account. The vault cannot sign, so this needs
   `solana program set-upgrade-authority DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu
   --new-upgrade-authority 5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe
   --skip-new-upgrade-authority-signer-check --url mainnet-beta`. Paste the
   address from this runbook; do not type it.
3. Run the read-only deployment check against the release record, **after** the
   handover, so an upgrade between the deploy and the handover would show:

   ```bash
   SOLANA_RPC_URL=<mainnet rpc> node scripts/check-escrow-deployment.mjs \
     --record config/releases/v1-mainnet-<commit7>.json --deployer <deployer address>
   ```

   It checks the cluster (mainnet genesis), the loader and ProgramData accounts,
   the length, that the bytes after the build are zero, both hashes, that the
   upgrade authority is the vault and not a forbidden address, and that no
   deploy buffer is left under the deployer. It prints only the RPC host. The
   genesis hash and the accounts come from the same RPC, so run it twice, once
   with the Helius URL and once with `--url https://api.mainnet-beta.solana.com`,
   and keep both outputs. Every line of both must say `ok`; record both outputs
   and the deploy slot on #736 (#737 RAP-737-S2). If any line fails, stop:
   nothing opens to buyers.
4. Close any leftover buffer (`solana program close --buffers --url
   mainnet-beta`), then send the deployer's remaining SOL back to the owner and
   retire the deployer key. From here no single hot key can change the program.

## 4. Prepare the treasury (before the first lock)

A payout fails if the treasury cannot receive it:

1. Send at least 0.001 SOL to the vault. Without it, a SOL fee below the
   rent-exempt minimum fails.
2. Create the vault's associated token accounts for USDC and AUDD (classic SPL
   Token) and PYUSD and USDG (Token-2022). Anyone can pay for these; the vault
   owns them. Nothing creates them later: release, claim and the provider's
   settle all expect them. Until the account for a currency exists and can
   receive, a provider running the provider kit refuses calls in that currency
   with `provider_not_ready`.
3. Run the read-only check until it passes:

   ```bash
   (cd packages/x402-solana && npm ci && npm run build)
   SOLANA_RPC_URL=<mainnet rpc> node scripts/check-escrow-treasury.mjs --network mainnet
   ```

   It prints only the RPC host, never the URL, so a keyed URL stays out of logs.
4. Run `node scripts/check-token2022-mint-posture.mjs` and confirm PYUSD and
   USDG still match the recorded posture (no transfer hook, zero fee). Run it
   again on launch day, before the first PYUSD or USDG lock, and record both
   results. If it fails, follow "If the posture changes" in
   `docs/ESCROW-PAYOUT-SAFETY.md` and keep that mint closed.

## 5. Switch the app to mainnet

1. In `config/networks/mainnet.json`, replace the placeholder escrow program id
   and its note with `DcfW3Cxt…5Ucu`, and record the deployment status.
2. Set the Vercel variables in `docs/MAINNET-RPC.md`, and the firewall rate
   limit on `/api/rpc`.
3. Set `X402_PROTOCOL_FEE_TREASURY` for providers to the vault.
4. Check the `reddi-agent-protocol` Supabase project before any service on that
   `x402-solana` version takes a real payment. Record each result on #736.
   Anything that does not match is a stop.
   1. **Migrations.** Every file in `supabase/migrations` is applied, in
      file-name order, and `supabase_migrations.schema_migrations` lists each
      one's version. On 23 November 2026 there are five:
      `20261120000000_v1_core.sql` (#742),
      `20261122000000_providers_server_writes_only.sql`,
      `20261122000001_replay_check_and_store_all.sql` (#904),
      `20261122100000_providers_adl.sql` (#934) and
      `20261123000000_providers_adl_public_read.sql` (#947). A file added after
      that date counts too. Without the replay migration the replay store fails
      closed and every payment is refused. Without #947 public listing reads are
      refused and `GET /api/listings` answers 503. List what is recorded with:

      ```sql
      select version, name from supabase_migrations.schema_migrations order by version;
      ```

   2. **Schema diff.** Run `supabase db diff --linked` (or `supabase db diff
      --db-url <hosted connection string>`) from the repository root. It must
      report no difference between the hosted schema and the migrations.
   3. **Replay function.** In the SQL editor, check that it exists and only the
      service role can run it:

      ```sql
      select p.oid::regprocedure,
             has_function_privilege('service_role', p.oid, 'execute') as service_role,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'replay_check_and_store_all';
      ```

      Expect one row, `replay_check_and_store_all(text[])`, with `true`, `false`,
      `false`.
   4. **Access rules on the hosted project.** Run `supabase/tests/10_access_rules.sql`
      against the hosted database inside one transaction that ends in `rollback`,
      so its test rows are not kept. Run that file only: never
      `00_supabase_stub.sql` or `run-local.sh`, which create roles and schemas
      for a throwaway local database. Every check must pass. The run of 22
      November 2026 does not count for launch day.
   5. **Backups.** In the Supabase dashboard (Database, Backups), daily backups
      are on and the latest one is less than a day old. Point-in-time recovery is
      on, or the owner has decided in writing to launch without it. Write down
      which.
   6. **Auth settings.** In Authentication: only the sign-in providers the app
      uses are enabled; the Site URL is `https://app.agent-protocol.reddi.tech`;
      the redirect allow list holds only the app's own origins (no `localhost`,
      no preview wildcard); and sign-ups match what the app expects. These
      settings are not in the repository (`supabase/config.toml` does not
      exist), so the record on #736 is their only review.
5. Tell each provider operator to keep its SOL payee wallet rent-exempt, open
   and not a program account from lock to payout, or SOL payouts to it fail
   (`docs/ESCROW-PAYOUT-SAFETY.md`).
6. Tell each provider operator how rated escrows behave. A buyer can opt an
   escrow in to rating at lock. Providers refuse such an escrow before serving
   unless the operator sets `acceptRatedEscrows`. One that accepts them must
   pass the rating account on every exit of that escrow (settle, claim,
   decline), name the job by the rating's opened slot read with the lock, and has agreed to commit and reveal a rating of the buyer within
   about 7 days each (`docs/RATINGS-AND-ATTESTATIONS.md`).
7. Tell each provider operator that direct per-call payments in a Token-2022
   mint that carries a transfer fee are refused, matching the zero-fee posture
   checked in section 4.

### 5a. Move the devnet sandbox to its own app (#1203)

Owner decision, 26 November 2026: the mainnet app holds no provider payee key,
provider ledger or payout job, so Try it, the Agent pass, the Planner and the
sandbox run from a separate devnet deploy of the same code.

1. Create a Vercel project for the devnet app from this repository (same root,
   no `NEXT_PUBLIC_NETWORK_PROFILE`, so it builds for devnet) and give it a
   domain, for example `devnet.agent-protocol.reddi.tech`.
2. Move `SANDBOX_DEVNET_PAYEE_KEYS`, `CRON_SECRET` for the sandbox sweep, the
   sandbox Supabase keys and the other sandbox variables to it. Remove
   `SANDBOX_DEVNET_PAYEE_KEYS` (and any `SANDBOX_PAYEE_KEYS`) from the mainnet
   app's Production environment: a mainnet build or server start with either
   set refuses to run and names the variable (`next.config.ts`,
   `instrumentation.ts`).
3. Set `DEVNET_APP_ORIGIN=https://<devnet domain>` on the mainnet app. Its proxy
   then sends `/try`, `/pass`, `/planner` and `/sandbox` there; without it those
   pages answer 404. `/api/try`, `/api/pass`, `/api/sandbox`,
   `/api/cron/sandbox-budgets` and `/api/cron/seller-ratings` answer 404 on the
   mainnet app either way.
4. Point the sandbox sweep in `.github/workflows/budget-watch.yml` at the devnet
   origin.
5. On the mainnet app, `BUDGET_USDC_PROVIDERS` lists RAP's own kit providers
   only; the scripted sandbox providers are left out of mainnet Budgets in code.

## 6. Verify (by 3 December)

1. One small metered call per currency, settled by the provider: check the
   provider, treasury and refund amounts on chain against the receipt.
2. If rated escrows are opened to buyers at launch: one small rated call,
   settled by a provider that accepts them, with the rating account as the
   extra account and the rating's opened slot after the settle's data, in a later transaction than the lock and `open_rating`
   (an exit in the opening slot is refused, 6050). Check that the same amounts moved as for an unrated call,
   and that the rating account exists afterwards. The full rated lane
   (commit, reveal, expiry, attestation) is exercised on devnet by
   `scripts/devnet-escrow-e2e.cjs` (`docs/DEVNET-ESCROW-E2E.md`); its expiry
   step needs 7 days, so it is not a launch-day check.
3. Record the signatures on #736 and #738.
4. Keep the treasury usable: an empty vault or a closed treasury token account
   makes paid exits in that currency fail. Write into the Squads notes that the
   vault never goes to zero lamports and its four token accounts are never
   closed, and run `node scripts/check-escrow-treasury.mjs --network mainnet` on a
   schedule that alerts the owner, before raising any cap.
5. Turn on the weekly deployment watch: in the pull request that records the
   deploy, fill in `deployedSlot` and `deployer` in the mainnet release record
   (the deployer must also be under `forbiddenAuthorities`), and make sure
   `MAINNET_RECORD` in `.github/workflows/escrow-deployment-watch.yml` names that
   record. The owner adds a `MAINNET_RPC_URL` Actions secret (a keyed Helius URL;
   without it the public RPC is used, which may refuse the buffer scan and so
   alert as "could not decide"). Then run the workflow by hand once and see it
   pass. From then on it runs every Tuesday 09:23 Sydney time (Monday 22:23 UTC)
   and opens a `deployment-watch` issue assigned to the owner when the program is
   not the build of record under the vault, or when the check cannot decide. A
   FAIL on a hash or authority line is an incident: stop new locks and follow the
   incident runbook.
6. Public copy changes from "planned" to "collected" for the fee only after
   this step (`docs/PUBLIC-CLAIM-BOUNDARY.md`).

See `docs/ESCROW-PAYOUT-SAFETY.md` for what a lock means to buyers and sellers,
and for the issuer powers over PYUSD and USDG.
