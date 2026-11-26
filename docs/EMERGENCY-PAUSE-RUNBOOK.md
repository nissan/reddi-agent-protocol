# Emergency pause runbook

What to do when a bug or exploit in the Reddi Agent Protocol program is found
and a fix cannot be deployed at once. The pause holds new money coming in and
payouts to providers. It never stops anyone getting their own money back.

Program detail: `programs/pinocchio-escrow/README.md`, "Emergency pause".
Tool: `scripts/emergency-pause.mjs` (build `packages/x402-solana` first:
`(cd packages/x402-solana && npm ci && npm run build)`).

## What a pause does

| While paused | Instructions |
| --- | --- |
| Refused | every escrow lock (SOL and token, metered or not), every escrow release, claim and settle; `open_budget`, `open_token_budget`, `reserve` |
| Refund only | a Budget payout or the judge's ruling on a Budget slice goes ahead only when it pays the provider nothing; the judge's ruling on a disputed delivery goes ahead only when it pays the payee nothing |
| Unchanged | every cancel and refund, Budget closes, disputes, waives, posting a total, ratings, attestations, the registry, the delivery record |

A pause lasts at most `PAUSE_SLOTS` (1,512,000 slots, about 7 days). It ends on
its own; the vault can end it sooner or renew it.

**The trade-off.** Deadlines keep running while paused. A provider whose
release, claim or settle is refused may see the payer refund once the escrow's
cancel window passes, and a disputed Budget slice the judge cannot pay out
refunds in full once the judge window ends. Refunds win by design: a buyer is
never stuck, and a provider can lose a payment it was owed. So keep pauses as
short as the fix allows, and tell providers at once (below).

## Roles and keys

| Role | Who | Can |
| --- | --- | --- |
| Guardian | one hot key the owner holds (1Password, Reddi account, OpenClaw-Agents vault) | pause once, for about 7 days, when not already paused |
| Admin | mainnet: the Squads vault `5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe` (2 of 3). Devnet build: the devnet deployer `hbr2Fee3ewDbm33wTDrdEF3e7byNCzNgQ57CwJWaPtt` | create the pause account, pause, renew a running pause, unpause, name a new guardian |

The guardian cannot unpause, renew, or rotate itself, so a lost or stolen
guardian key can hold the protocol for 7 days at most, and the vault can undo
it at once. The guardian may not be the zero key or the admin.

Guardian key creation is the owner's step and needs the owner's typed go. Make
it on a machine the owner controls without printing the seed phrase
(`solana-keygen new --no-bip39-passphrase --silent --outfile <file>`), store the
file's contents in 1Password, and share only the address. Agents never create,
read or hold the key.

## Set up (once per deploy)

Until the pause account exists, a build with the pause refuses every lock,
Budget open, reserve and payout (3012). So right after the deploy and the
upgrade-authority handover, before the treasury is prepared and before any
buyer:

1. Print the instruction:
   `node scripts/emergency-pause.mjs vault-ix init --guardian <guardian address> --network mainnet`
2. Propose it in Squads as a vault transaction (program, accounts and data
   exactly as printed); two of three approve and execute. The vault is the
   payer: it needs about 0.0015 SOL for the rent and must stay rent-exempt, so
   send it 0.01 SOL first.
3. `node scripts/emergency-pause.mjs status --network mainnet --url <rpc>` must
   say `not paused` and name the guardian.
4. Drill: guardian pauses, `status` says paused, vault unpauses. Record the
   signatures on the launch issue.

Devnet: the same, with the devnet admin signing directly:
`node scripts/emergency-pause.mjs devnet-admin init --guardian <address> --keypair <devnet admin keypair> --network devnet`.

## Pausing

Anyone who sees a credible bug or exploit tells the owner. The guardian holder
then pauses at once; it is cheap to undo:

```bash
node scripts/emergency-pause.mjs pause --keypair <guardian keypair file> --network mainnet --url <rpc>
```

It checks the key is the guardian, prints the plan, asks for `PAUSE`, sends,
and prints the new status. If the guardian key is not at hand, the vault can
pause instead (`vault-ix pause` through Squads), which takes two approvals.

Then, within the hour:

1. Post on the status channels (X, the app's Updates page, Discord/Telegram
   where providers are) in plain words: payments and payouts are on hold while
   an issue is checked; refunds and closing a Budget still work; how to refund.
   The app shows a banner on every page by itself while the program is paused.
2. Tell each listed provider directly: payouts wait, and the payer can refund
   an escrow after its cancel window, so a long pause can cost them a payment.
3. Open an incident issue with the time, the slot, the pause signature and what
   is known.

## While paused

- Provider sweeps get 6101 (`ProtocolPaused`) on payouts that pay the
  provider; they report `paused` and pay on the first sweep after the pause.
  Reserves answer `protocol_paused` to callers. The judge's rulings that pay a
  provider are refused too: rule again after the pause if the window allows.
  Nothing needs switching off.
- Fix, review and deploy the upgrade through Squads (`MAINNET-LAUNCH-RUNBOOK.md`
  on building and verifying a build of record).
- If the fix needs longer than the pause, the vault renews it before it ends
  (`vault-ix pause` again: a fresh 7 days from then). Renew only with a reason
  recorded on the incident issue.

## Unpausing

After the fix is deployed and checked:

```bash
node scripts/emergency-pause.mjs vault-ix unpause --network mainnet
```

Propose in Squads, two approve, execute, then run `status`. Tell everyone it is
over, and that providers' waiting payouts go out on the next sweep.

## Rotating the guardian

If the guardian key may be exposed, or its holder changes:
`vault-ix set-guardian --guardian <new address>`, proposed through Squads. A
running pause is left as it is.

## Clients

Every instruction a pause can refuse takes the pause account
(`["pause"]` = `Fxx73r7JeSoCg28GhSGhksrwdpzRWWKXas5a2BQtkbEi`) as one more
read-only account, last. The builders in `@redditech/x402-solana` add it
(`pauseAccountMeta`, `withPauseAccount`), and `readPauseStatus`,
`isPausedError` and `PAUSED_MESSAGE` cover showing the state. A build from
before the pause ignores the extra account, so clients can ship first; deploy
the program soon after, because a refused lock or payout without the account
fails with 6102 (`PauseAccountRequired`).

## Errors

| Number | Name | Meaning |
| --- | --- | --- |
| 6101 | `ProtocolPaused` | refused while paused |
| 6102 | `PauseAccountRequired` | a lock, release, settle, Budget open or reserve without the pause account |
| 6103 | `NotPauseAuthority` | the signer is not the guardian or admin |
| 6104 | `AlreadyPaused` | the guardian tried to pause during a pause |
| 6105 | `InvalidGuardian` | the guardian named is the zero key or the admin |
