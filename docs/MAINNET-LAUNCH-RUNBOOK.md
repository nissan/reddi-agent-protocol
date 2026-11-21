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
2. Take the size and sha256 of record from the `escrow-verifiable-build.yml` run
   on that commit (artifact `escrow-mainnet-build.json`). Record them on #736.
3. The second review (Codex) works from that commit. A program change after the
   freeze means a new freeze commit and hash.

## 2. Fund the deployer

The deployer needs the program account's rent at 6,960 lamports per byte, plus
room for the temporary buffer during the deploy and fees. With rating and
attestation in the V1 build, the program is expected at about 85–95 KB (rent
about 0.6–0.66 SOL); take the size of record from the freeze. 2 SOL is enough.
The owner funds it.

## 3. Deploy (owner signs)

1. Deploy the container-built `pinocchio_escrow.so` whose sha256 matches the
   freeze record, with the program keypair for `DcfW3Cxt…5Ucu`.
2. Read the program data account back and check its sha256 against the record
   (the e2e script's `PROGRAM_LEN` / `PROGRAM_SHA256` check does this).
3. Hand upgrade authority to the Squads vault. Read it back from chain (#737
   RAP-737-S2).

## 4. Prepare the treasury (before the first lock)

A payout fails if the treasury cannot receive it:

1. Send at least 0.001 SOL to the vault. Without it, a SOL fee below the
   rent-exempt minimum fails.
2. Create the vault's associated token accounts for USDC and AUDD (classic SPL
   Token) and PYUSD and USDG (Token-2022). Anyone can pay for these; the vault
   owns them. The provider settle path also creates them on demand, but release
   and claim do not.
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

## 6. Verify (by 3 December)

1. One small metered call per currency, settled by the provider: check the
   provider, treasury and refund amounts on chain against the receipt.
2. Record the signatures on #736 and #738.
3. Public copy changes from "planned" to "collected" for the fee only after
   this step (`docs/PUBLIC-CLAIM-BOUNDARY.md`).

See `docs/ESCROW-PAYOUT-SAFETY.md` for what a lock means to buyers and sellers,
and for the issuer powers over PYUSD and USDG.
