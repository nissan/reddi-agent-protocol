# Devnet escrow end-to-end run

`scripts/devnet-escrow-e2e.cjs` exercises the V1 escrow program deployed on devnet
(`DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu`, see `DEPLOY.md`) in SOL and devnet USDC, with real
transactions. It complements the local-validator lane (`archive/anchor-escrow/tests/local_token_escrow.cjs`),
which covers the same paths with slot warps but never touches a public cluster.

Before it signs anything the script checks that the RPC is devnet (genesis hash) and that the deployed
program is the build of the latest devnet release record with a `deployedSlot` in `config/releases/`
(today `v1-devnet-9c34fac.json`): the ProgramData account must say it was last deployed in that slot, and
its bytes must hash to the record's `sha256` with only zeros after the record's size. It refuses otherwise.

The script also has a rated lane, for ratings and judge attestations: see
[Rated lane](#rated-lane-ratings-and-judge-attestations) below.

## Modes

| Mode | Signs | What it does |
| --- | --- | --- |
| `plan` | no | Reads balances of the two wallets and the treasury, simulates the SOL and USDC locks unsigned, lists shortfalls. Needs only `RAP_E2E_PAYER` and `RAP_E2E_PAYEE` (public addresses). |
| `run` | yes | Per currency: lock → payer release; metered lock → payee settle at a lower actual cost; lock → payee decline. Early claim, early payer refund, settle above the maximum, settle of zero, payee settle of an unmetered escrow, any settle by the payer, a release to the wrong account and replays are simulated with real signatures and must be refused. Then it leaves one "refund" and one "claim" escrow open per currency. |
| `finish-refund` | yes | After the cancel window the locks named (1,500 slots, about 10 minutes): payer refunds the open "refund" escrows. Before that it only shows the refusal. |
| `finish-claim` | yes | After the claim window the locks named (750 slots, about 5 minutes): payee claims the open "claim" escrows, fee included. Before that it only shows the refusal. |

Every fee is checked from the transaction's own balance changes, so other traffic to the treasury (the
sandbox settles there too) cannot disturb the checks.

## Inputs

- `RAP_E2E_PAYER_KEYPAIR`, `RAP_E2E_PAYEE_KEYPAIR`: absolute paths to two different devnet wallets'
  keypair files (signing modes only). The script reads them and never prints or writes key material.
  The payer pays rent and the fees of its own actions. The payee signs its own actions alone and pays their
  fees, because the SOL release instruction treats any payer signature as a payer action and a fee
  payer always signs. `run` sends the payee 0.01 SOL first when it holds under 0.005 SOL.
- `RAP_E2E_RUN_ID`: 3-40 letters, digits or dashes. Escrow nonces derive from it, so the finish modes
  must use the same value as `run`. A run id can be used once: `run` refuses one whose escrows already exist.
- `RAP_E2E_LEFTOVER_RUN_ID` (optional, `run` only): an earlier interrupted run. The payee closes its open
  escrows first by declining each, so the whole amount returns to the payer.
- `RAP_E2E_OUT_DIR` (optional, absolute): one JSON result file per mode.
- `RAP_E2E_RPC` (optional): defaults to `https://api.devnet.solana.com`.

The payer needs about 0.1 devnet SOL and 3.7 devnet USDC (mint `4zMMC9…cDU`); `plan` reports any
shortfall. Devnet RPC airdrops are closed, so fund from faucet.solana.com and faucet.circle.com.

## Example

```bash
export RAP_E2E_PAYER=<payer address> RAP_E2E_PAYEE=<payee address>
npm run e2e:devnet:escrow -- plan

export RAP_E2E_PAYER_KEYPAIR=/abs/payer.json RAP_E2E_PAYEE_KEYPAIR=/abs/payee.json
export RAP_E2E_RUN_ID=v1-2026-11-21 RAP_E2E_OUT_DIR=/abs/out
npm run e2e:devnet:escrow -- run
# about 5 minutes later, then about 10 minutes after the run
npm run e2e:devnet:escrow -- finish-claim
npm run e2e:devnet:escrow -- finish-refund
```

## Rated lane (ratings and judge attestations)

Three more modes exercise ratings and judge attestations of a job paid through escrow
([`RATINGS-AND-ATTESTATIONS.md`](RATINGS-AND-ATTESTATIONS.md)). They are separate modes with their own
escrow labels, so the lane above still runs alone and one run id can serve both.

Devnet runs a build with ratings (the deployed devnet release record in `config/releases/`). Like the lane
above, the script refuses a program that is not that record's build, and the signing modes also check
first that the program answers `accept_rating`, and refuse otherwise.

| Mode | Signs | What it does |
| --- | --- | --- |
| `plan-rated` | no | Prints every transaction and refused case of the lane, in order, with instruction data and accounts. Then reads balances, whether each wallet is a registered agent, and whether the deployed program answers the rating instructions, and lists shortfalls. With `--offline` it prints the plan and opens no connection. Needs `RAP_E2E_PAYER`, `RAP_E2E_PAYEE` and optionally `RAP_E2E_JUDGE` (public addresses). |
| `run-rated` | yes | The five parts below. Expect several minutes: there are about 25 transactions and each is awaited to finality. |
| `finish-rated` | yes | After job 2's commit deadline: `expire_rating`, then the buyer's `close_rating`. Before the deadline it simulates the expiry, shows it is refused (`NotExpired`, 6014), prints the slots left and an estimated date, and sends nothing. |

What `run-rated` does. After each lock it reads the rating account and records its `opened_slot` (it
must be the slot of the lock transaction). Every rated exit, `accept_rating`, `commit_rating` and
commitment, `attest_quality` and `confirm_attestation` it sends names the job by that slot, and no exit of a rated escrow is sent until the chain is past it: no exit ever
shares a transaction with `open_rating`. `plan-rated` shows those instructions with slot 0, and lists under
`openedSlotOf` the job each one names.

1. **Job 1, SOL, metered.** Lock of a 0.02 SOL maximum and `open_rating` (naming the judge, when there is
   one) in one transaction. The payee settles 0.008 SOL with the rating account and the job's opened slot. Both sides commit, both
   reveal (the buyer scores 9, the seller 8). The script checks the rating account at each stage, the 2.5%
   fee to the treasury, and both agent records. Then the attestation (part 3), and last the buyer's
   `close_rating`, with the rating account's whole balance back to the buyer. The close comes after the
   attestation because a job can only be attested while its rating account exists.
2. **Job 2, devnet USDC, fixed price.** Lock of 1 USDC and `open_rating` in one transaction, then the
   seller's `accept_rating`, built with `buildSellerAcceptRating`: it reads the escrow and rating account
   and checks the opened slot (the slot of the lock), no judge, the amount and the mint. The script first
   checks that the same helper refuses another opened slot, another amount and a judge, without signing
   anything, and that what it builds is the plan's instruction. Then the payer's release (fee checked),
   the buyer commits and the seller does not. The rating is left open for `finish-rated`.
3. **Attestation of job 1.** The judge's `attest_quality`, the buyer's `confirm_attestation` (the judge's
   accuracy must rise by 10.00 and its reputation take a top score), the judge's `close_attestation` with
   the rent back. Skipped, with a message, when there is no usable judge.
4. **A rated escrow the payee declines** (escrow and rating account closed; the locked amount and both
   rents back to the payer; no fee), **and one the payer releases without the seller's agreement** (paid as
   usual with the fee; rating account closed and its rent back; neither agent record changes).
5. **Refused cases**, simulated with real signatures and never sent. Each must fail with exactly this
   program error number:

   | Case | Error |
   | --- | --- |
   | Settle of a rated escrow without the rating account | 6033 `RatingAccountRequired` |
   | Commit before the job is paid (rating not open) | 6039 `JobNotPaid` |
   | Commit on an escrow that was never opted in, and on one released without agreement | 3012 `AccountNotInitialized` |
   | `open_rating` in a later slot than the lock | 6036 `RatingOptInClosed` |
   | Attestation by a wallet the rating does not name | 6000 `UnauthorisedSigner` (see below) |
   | `delegate_escrow` and `release_escrow_per` (PER is not in V1) | 101 `InstructionFallbackNotFound` |
   | Reveal before both committed | 6011 `BothMustCommitFirst` |
   | `accept_rating` a second time | 6046 `RatingAlreadyAccepted` |
   | The payee's settle of job 1 naming another opened slot (as a settle held back from an earlier job at the address would) | 6051 `RatingJobMismatch` |
   | `accept_rating` naming another opened slot (as one signed for an earlier job at the address would) | 6051 `RatingJobMismatch` |
   | `attest_quality` of job 1 naming another opened slot (with a judge) | 6051 `RatingJobMismatch` |
   | Lock, `open_rating` and the payer's release in one transaction (a separate escrow that never lands) | 6050 `RatingJustOpened` |
   | A second attestation of job 1; a dispute after the confirmation | 6048 `AlreadyAttested`; 6018 `AttestationAlreadyResolved` |

   The wrong-judge case is run twice. With a judge, the judge tries to attest job 2, which names no judge:
   6000. Always, the payee tries to attest job 1: 6000 when the payee is a registered agent, and 3012 when
   it is not, because `attest_quality` reads the signer's agent record before it compares the signer with
   the named judge.

At the end `run-rated` checks that it executed every step of the plan, in the plan's order.

### Registered and unregistered parties

A party that is not a registered agent can rate and be rated; the program updates only the records that
exist. The lane follows that:

- For a registered payer or payee it asserts the exact change: reputation becomes
  `(old × 9 + score × 1000) / 10` rounded down (at most 10,000), jobs completed rises by one, and nothing
  else moves. After `finish-rated`, the silent seller's reputation falls by 500 (not below zero), its
  failed jobs rise by one, and the buyer's record is unchanged.
- For an unregistered party it asserts only that no agent record exists before or after. Nothing about
  reputation is checked for that party, so a run with two unregistered parties proves the money, the
  rating account and the refusals, but not the reputation arithmetic.
- `RAP_E2E_REGISTER_PARTIES=1` makes `run-rated` register the payer and the payee as agents (type 0)
  when they are not. Each pays the 0.01 SOL registration fee, which is burned, and the record's rent.
- The judge must be registered as an attestation agent. A judge wallet with no record is registered by
  `run-rated` as type 1 (same fee and rent, paid by the judge). A judge wallet already registered as type
  0, or switched off, is not usable: no judge is named and the attestation steps are skipped.

### Inputs for the rated lane

The same variables as above, plus:

- `RAP_E2E_JUDGE_KEYPAIR` (optional, `run-rated`): absolute path to a third devnet wallet's keypair file.
  Without it no judge is named and part 3 is skipped with a message. The judge signs and pays for its own
  actions; `run-rated` sends it 0.025 SOL from the payer when it holds under 0.02 SOL.
- `RAP_E2E_JUDGE` (optional, `plan-rated`): the judge's public address.
- `RAP_E2E_REGISTER_PARTIES=1` (optional, `run-rated`): see above.
- `RAP_E2E_LEFTOVER_RUN_ID` (optional, `run-rated`): an earlier interrupted rated run. The payee declines
  the escrows it left locked. A rating that is already open (job 2 after its release) cannot be closed
  early; it waits for `finish-rated` under its own run id.
- `finish-rated` needs the payer and payee keypairs and the run id of the `run-rated` it finishes.

The payer needs about 0.10 devnet SOL (0.032 SOL of locks, four rating accounts at about 0.00202 SOL each,
of which three come back during the run, the top-ups for the payee and the judge, and room for fees) and
1 devnet USDC. With `RAP_E2E_REGISTER_PARTIES=1` the payer and the payee each need about 0.012 SOL more.
`plan-rated` reports any shortfall. Payee transactions are signed by the payee alone: a seller's settle or
claim that also carries the payer's signature counts as the payer's action.

Salts are derived from the run id so that a later mode could reveal. That is for this test only; a real
rating uses a random salt kept secret until the reveal.

### Finish date

Job 2's rating can be expired from the slot after `settled_slot + 1,512,000`, where `settled_slot` is the
slot of the payer's release. 1,512,000 slots at the nominal 400 ms are 604,800 seconds: 7 days. So
`finish-rated` works from about the same time of day, 7 days after `run-rated` (a run on 21 November is
finishable from about 28 November). Slot times drift, so allow some hours. `run-rated` prints
`openRating.expireFromSlot` and `openRating.estimatedEarliest`; `finish-rated` recomputes both from the
current slot each time and is safe to run early, because before the deadline it only simulates. The other
deadlines in the program (reveal, and an unresolved attestation) are also 1,512,000 slots, but the lane
does not leave anything waiting on them.

### Commands and expected output

```bash
# No network, no keys: the plan only
RAP_E2E_PAYER=<payer address> RAP_E2E_PAYEE=<payee address> RAP_E2E_JUDGE=<judge address> \
  npm run e2e:devnet:escrow -- plan-rated --offline
npm run test:e2e:devnet:escrow-rated-plan   # the offline unit test of the plan and its instructions

# Read only, against devnet
npm run e2e:devnet:escrow -- plan-rated

export RAP_E2E_PAYER_KEYPAIR=/abs/payer.json RAP_E2E_PAYEE_KEYPAIR=/abs/payee.json
export RAP_E2E_JUDGE_KEYPAIR=/abs/judge.json          # optional
export RAP_E2E_RUN_ID=v1-rated-2026-11-21 RAP_E2E_OUT_DIR=/abs/out
npm run e2e:devnet:escrow -- run-rated
# about 7 days later
npm run e2e:devnet:escrow -- finish-rated
```

`run-rated` prints one `✓ <step>  <explorer link>` line per transaction and one
`✓ refused (simulated): <case> [<error number>]` line per refused case, under five headings, then a JSON
result with `"result": "passed"`, the steps with their checked amounts, `agentRecords` (before and after,
or "no agent record before or after"), `skipped` (why the attestation steps did not run, if they did not)
and `openRating`. Any failed check stops the run with the step's name and a non-zero exit. `finish-rated`
prints either `"result": "commit deadline not yet passed; nothing sent"` with the slots remaining, or two
transactions and `"result": "passed"`.
