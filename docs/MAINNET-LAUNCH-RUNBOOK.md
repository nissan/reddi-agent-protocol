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
4. The second review (Codex) works from that commit. A program change after the
   freeze means a new freeze commit, record and hash.

## 2. Fund the deployer

The deployer needs the program account's rent, plus room for the temporary
buffer during the deploy and fees. On 22 November 2026 mainnet and devnet both
charged 5,080 lamports per byte (check with `solana rent <bytes> --url
mainnet-beta` before funding). With rating and attestation in the V1 build, the
mainnet variant is about 96 KB (rent about 0.49 SOL); take the size of record
from the freeze. 2 SOL is enough.
The owner funds it.

## 3. Deploy (owner signs)

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
4. Tell each provider operator to keep its SOL payee wallet rent-exempt, open
   and not a program account from lock to payout, or SOL payouts to it fail
   (`docs/ESCROW-PAYOUT-SAFETY.md`).
5. Tell each provider operator how rated escrows behave. A buyer can opt an
   escrow in to rating at lock. Providers refuse such an escrow before serving
   unless the operator sets `acceptRatedEscrows`. One that accepts them must
   pass the rating account on every exit of that escrow (settle, claim,
   decline), name the job by the rating's opened slot read with the lock, and has agreed to commit and reveal a rating of the buyer within
   about 7 days each (`docs/RATINGS-AND-ATTESTATIONS.md`).

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
4. Public copy changes from "planned" to "collected" for the fee only after
   this step (`docs/PUBLIC-CLAIM-BOUNDARY.md`).

See `docs/ESCROW-PAYOUT-SAFETY.md` for what a lock means to buyers and sellers,
and for the issuer powers over PYUSD and USDG.
