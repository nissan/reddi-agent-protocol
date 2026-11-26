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
   deployer address. Record the same values on #1212.
4. Countersign before deploy: a person other than whoever wrote the record (the
   owner, if a Claude session wrote it) downloads the `escrow-mainnet-<commit>`
   artifact from the `buildRun` named in the record, runs `stat -c %s`,
   `sha256sum` and `solana-verify get-executable-hash` on `pinocchio_escrow.so`,
   and confirms all three equal the record's `size`, `sha256` and
   `executableHash`, and that the run's image digest equals `imageDigest`. Post
   the three outputs and "countersigned" on #1212. The check script only compares
   the chain with the record; this step is what ties the record to the build.
5. The second review (Codex) works from that commit. A program change after the
   freeze means a new freeze commit, record and hash.

## 2. Fund the deployer

The deployer needs the program account's rent, plus room for the temporary
buffer during the deploy and fees. On 22 November 2026 mainnet and devnet both
charged 5,080 lamports per byte (check with `solana rent <bytes> --url
mainnet-beta` before funding). With rating, attestation, the delivery check and
the pooled Budget (with its P-256 spender) in the V1 build, the mainnet variant
was 195,672 bytes at the 339ac70 freeze; the emergency pause adds about 10 KB
(206,120 bytes at the pause change, rent about 1.05 SOL), and the deploy's
temporary buffer holds about the same again until it is closed. Take the size
of record from the new freeze. The program data account is 45 bytes larger than
the build (206,165 bytes for 206,120): run `solana rent <size + 45> --url
mainnet-beta` on the day. At 5,080 lamports per byte that is about 1.05 SOL;
at the older 6,960 it would be about 1.43 SOL, and the buffer needs the same
again while the deploy runs. Fund 3 SOL: 2 SOL leaves almost no margin. The
owner funds it. The pause account (§3a) costs about 0.0015 SOL more, paid by
the vault or the deployer.

Plan an emergency float too. The program has an emergency pause (§3a,
`docs/EMERGENCY-PAUSE-RUNBOOK.md`) that holds new payments and payouts for up
to 7 days while refunds keep working, but the fix itself is an upgrade through
Squads, and that upgrade needs a buffer of the new build's size (about 1.0 to
1.4 SOL, refunded when the buffer is consumed or closed). Keep that much where
the owner can reach it quickly after the deploy, separate from the deploy
funding.

## 3. Deploy (owner signs)

0. Confirm the secp256r1 precompile is active on mainnet: `solana feature
   status --url mainnet-beta` must list the secp256r1 precompile feature as
   active. The Budget's P-256 spender approval checks its signature through
   that precompile (`Secp256r1SigVerify1111111111111111111111111`); if it is not
   active, stop.
   Rehearse first. There is SOL for one mainnet deploy, so run the whole of §3
   and §4 on a throwaway local validator with mainnet's feature set and the
   four mints cloned, using the downloaded build of record:

   ```bash
   scripts/rehearse-mainnet-deploy.sh --so <path to pinocchio_escrow.so>
   ```

   It checks the file against the record, reads the secp256r1 feature from
   mainnet, then deploys with the same command and flags as step 1, hands over to
   the vault, runs the deployment check, shows the deployer is refused, creates
   the treasury accounts and runs the treasury check. It uses throwaway keys and
   local SOL, sends nothing to mainnet, and prints what each part cost. Every
   line must say `ok` before the real deploy.
1. Check the bytes before the step that cannot be undone, then deploy exactly
   as rehearsed, with the program keypair for `DcfW3Cxt…5Ucu`:

   ```bash
   # The file is the build of record (its size, sha256 and executable hash).
   node scripts/rehearse-escrow-deployment.mjs verify-file \
     --record config/releases/v1-mainnet-339ac70.json --so <path to pinocchio_escrow.so>
   # Upload into a buffer; note the "Buffer:" address it prints.
   solana program write-buffer <path to pinocchio_escrow.so> \
     --keypair <deployer keypair path> --use-rpc --url <mainnet rpc>
   # The buffer holds the build of record (same as solana-verify get-buffer-hash).
   node scripts/rehearse-escrow-deployment.mjs buffer-hash \
     --record config/releases/v1-mainnet-339ac70.json --url <mainnet rpc> --buffer <buffer address>
   # Only if every line said ok: deploy from that buffer.
   solana program deploy --buffer <buffer address> \
     --program-id <program keypair path> --keypair <deployer keypair path> \
     --max-len <size of record> --url <mainnet rpc>
   ```

   The deploy must report program id `DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu`.
   If the buffer check fails, close the buffer and stop.

   `--max-len` fixes the program account at the build's size, so the rent is
   what §2 says. It leaves no headroom: a later, larger build first needs
   `solana program extend` signed through the vault, paying rent for the added
   bytes. If the deploy stops part way, its buffer still holds the SOL:
   close it (`solana program close --buffers --keypair <deployer keypair path>
   --url <mainnet rpc>`) to get the SOL back before trying again, so a failed
   attempt costs only fees.
2. Hand upgrade authority to the Squads **vault** `5CsBuT…3Hxe`, never the
   multisig account. The vault cannot sign, so this needs
   `solana program set-upgrade-authority DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu
   --new-upgrade-authority 5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe
   --skip-new-upgrade-authority-signer-check --url mainnet-beta`. Paste the
   address from this runbook; do not type it. First confirm it is the vault:
   `solana account 5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe --url mainnet-beta`
   shows a system-owned account with 0 data bytes, and Squads shows it as vault 0
   of the RAP multisig.
3. Complete the release record first: add the multisig account address and the
   deployer under `forbiddenAuthorities`, and set `deployer` and `deployedSlot`.
   Then run the read-only deployment check against it, **after** the handover, so
   an upgrade between the deploy and the handover would show:

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
   and the deploy slot on #1212 (RAP-MB10-S1). If any line fails, stop:
   nothing opens to buyers.
4. Show that the deployer can no longer change the program (RAP-MB10-S3):
   `solana program set-upgrade-authority DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu
   --upgrade-authority <deployer keypair path> --new-upgrade-authority <deployer keypair path>
   --url mainnet-beta` must be refused (incorrect authority) and change
   nothing (it costs one transaction fee). Record the error on #1212. If it
   succeeds, the handover did not happen: stop.
5. Close any leftover buffer (`solana program close --buffers --url
   mainnet-beta`), then send the deployer's remaining SOL back to the owner and
   retire the deployer key. From here no single hot key can change the program.

## 3a. Create the pause account (before the treasury and any buyer)

Until the pause account exists the program refuses every lock, Budget open,
reserve and payout (3012), so this comes straight after the handover. Full
detail in `docs/EMERGENCY-PAUSE-RUNBOOK.md`.

1. The owner creates the guardian key on a machine they control and keeps it
   in 1Password (never in this repository, a chat or an agent's shell; the
   owner types the go for the key creation). Only its address is shared.
2. Print the instruction and propose it as a Squads vault transaction:

   ```bash
   node scripts/emergency-pause.mjs vault-ix init --guardian <guardian address> --network mainnet
   ```

   Two of three approve and execute it. The vault pays the 0.0015 SOL rent
   (the vault is the payer account) and must stay rent-exempt after it, so
   send the vault 0.01 SOL first; it counts toward §4.1.
3. Check it: `node scripts/emergency-pause.mjs status --network mainnet --url
   <mainnet rpc>` must say `not paused` and name the guardian address. Record
   the output on #1212.
4. Drill once on mainnet before opening to buyers: the guardian pauses
   (`emergency-pause.mjs pause --keypair <guardian keypair>`), `status` says
   paused, and the vault unpauses (`vault-ix unpause` through Squads). Both
   cost only fees. Record the two signatures on #1212.

Never put the mainnet build on devnet under this program id, or the devnet
build on mainnet. Both networks use `DcfW3Cxt…5Ucu`; what keeps signed
approvals from replaying between them is the cluster byte each variant is built
with.

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
4. Check the four mints: `node scripts/rehearse-escrow-deployment.mjs mint-check
   --url <mainnet rpc>` must show USDC and AUDD under the classic token program
   and PYUSD and USDG under Token-2022, each initialised with 6 decimals. A
   mismatch fails closed (every lock in that currency is refused), but find out
   before launch.
5. Run `node scripts/check-token2022-mint-posture.mjs` and confirm PYUSD and
   USDG still match the recorded posture (no transfer hook, zero fee). Run it
   again on launch day, before the first PYUSD or USDG lock, and record both
   results. If it fails, follow "If the posture changes" in
   `docs/ESCROW-PAYOUT-SAFETY.md` and keep that mint closed.

## 5. Switch the app to mainnet

1. `config/networks/mainnet.json` already names `DcfW3Cxt…5Ucu` for all four
   program slots (one program) and records `mainnetDeploymentStatusNote:
   "not_deployed"`, which keeps the mainnet profile blocked: nothing signs
   against it. After sections 3 and 4 pass, change that value to `"deployed"` in
   a reviewed pull request (#1151). The resolver reads it from the committed
   file only, never from the environment.
2. Set the Vercel variables in `docs/MAINNET-RPC.md`, and the firewall rate
   limit on `/api/rpc`. Build the app with `NEXT_PUBLIC_NETWORK_PROFILE=mainnet`
   (Production). Remove these stale Production variables first (freeze review,
   25 November 2026): `NEXT_PUBLIC_PROGRAM_ID` (old id, read by nothing),
   `NEXT_PUBLIC_INDEX_API` (`http://localhost:4000`), `NEXT_PUBLIC_RPC_URL`
   (devnet; on mainnet the resolver refuses any RPC override except the app's
   own `/api/rpc`), and the two preview-only drill variables marked "remove
   after test". Leave `NEXT_PUBLIC_RAP_MAINNET_LIVE` unset until section 6.
   On the mainnet build, Try it, the Agent pass, the Planner and the sandbox
   carry a "runs on Solana devnet" banner, and the Planner refuses wallet
   payments (owner decision, 26 November 2026: single paid calls stay on
   devnet at launch).
3. Set `X402_PROTOCOL_FEE_TREASURY` for providers to the vault.
4. Check the `reddi-agent-protocol` Supabase project before any service on that
   `x402-solana` version takes a real payment. Record each result on #1212.
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
      exist), so the record on #1212 is their only review.
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

1. Launch scope (owner decision, 26 November 2026): mainnet opens Budgets;
   direct per-call payments stay on devnet. The launch-day verification is the
   Budget run in #1214: a 5 USDC Budget with two RAP providers, a small SOL
   Budget, close, payout after the window, and the provider, treasury and payer
   amounts on chain checked against the receipts. If per-call payments open on
   mainnet later, check one small metered call per currency the same way first.
2. If rated escrows are opened to buyers at launch: one small rated call,
   settled by a provider that accepts them, with the rating account as the
   extra account and the rating's opened slot after the settle's data, in a later transaction than the lock and `open_rating`
   (an exit in the opening slot is refused, 6050). Check that the same amounts moved as for an unrated call,
   and that the rating account exists afterwards. The full rated lane
   (commit, reveal, expiry, attestation) is exercised on devnet by
   `scripts/devnet-escrow-e2e.cjs` (`docs/DEVNET-ESCROW-E2E.md`); its expiry
   step needs 7 days, so it is not a launch-day check.
3. Record the signatures on #1212, and the rated and attestation checks on #844.
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
   this step (`docs/PUBLIC-CLAIM-BOUNDARY.md`). With the owner's go, set
   `NEXT_PUBLIC_RAP_MAINNET_LIVE=true` (Production) on the app and on
   `rap-marketing` and redeploy both: the footer, the home and marketing stage
   lines and the fee labels switch together (`lib/config/launch-stage.ts`,
   `apps/marketing/lib/copy.ts`). It changes copy only and opens no payment
   path. The served Markdown (`public/pricing.md`, `public/provider.md`, the
   provider kit README) is edited in the same launch-day pull request.

See `docs/ESCROW-PAYOUT-SAFETY.md` for what a lock means to buyers and sellers,
and for the issuer powers over PYUSD and USDG.
