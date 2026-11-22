# Prior reviews

A public-safe index of earlier security reviews: who, when, what commit,
verdict and counts. Finding detail is private (see [`SECURITY.md`](../../../../SECURITY.md));
the owner gives auditors the private addendum with finding IDs and
dispositions when a re-check is part of the brief.

Use this list to check that earlier issues stay fixed and to avoid spending the
round on ground already covered. Do not let it narrow your search: every
earlier review lists things it did not verify.

| Date | Surface | Reviewer | Commit | Verdict | Counts (C/H/M/L/I) | Status |
|---|---|---|---|---|---|---|
| 2026-11-20 | S1 escrow (archived Anchor program, first pass) | Claude | `8448b8a` | n/a (design input) | 0/0/3/–/– | Superseded by the Pinocchio rewrite; design points carried into it |
| 2026-11-20 | S4 registry, client and x402 payment verification | Claude | `8448b8a` era | n/a | 1/3/6/–/– | Fixes merged in #741, #743 and follow-ups; re-verify in S4 and S7 |
| 2026-11-21 | S1 Pinocchio program, default build | Claude | `ac45310` | No theft or fee redirect found | 0/0/1/4/4 | Closed by #818, #819, #821–#823 |
| 2026-11-21 | S1 Pinocchio program, default build | Codex | `ac45310`, #818 | NO-GO at the time | 0/2/2/1/1 (+4 in the then-optional extended build) | Both Highs fixed (#819, #822); Mediums closed or reduced (#823, mint watch) |
| 2026-11-21 | S1 Pinocchio program, follow-up | Codex | `a3995a4` | GO for a guarded beta (program); HOLD on provider rollout until provider items closed | counts on #737 | Provider and docs items routed to their owners; re-verify in S4 and S7 |
| 2026-11-21 | S1 rated escrow (rating and attestation, #855) | Claude | `d6fc739` | Merge OK | 0/0/1/5/3 | Fixed before merge |
| 2026-11-21 | S1 rated escrow (#855) | Codex | `f4a1881`, `5f3efe5`, `e37e755`, `f592382` | NO-GO ×3, then GO at `f592382` | per round | Merged as `b71a91e` |
| 2026-11-22 | S1–S7 pre-freeze round (interim, Codex S1/S7 pending) | Claude (Fable, Opus, Sonnet) | `45445b1` | Interim NO-GO; program itself 0 C/H; blockers all off-chain | S1 0/0/1/4/5, S2 0/0/5/6/1, S3 0/1/3/3/2, S4 0/1/2/3/2, S5 0/0/3/5/3, S6 1/1/6/4/3, S7 0/1/3/4/4 | Fixes routed to owning threads |
| 2026-11-22 | S1 fee launch-rate schedule (#896) | Claude | `6780b00` | Program OK | 0/0/0/0/1 (+ off-chain follow-ups) | Pending merge |
| 2026-11-21 | S2/S4 paid-request authentication | Claude (security thread) | #865, #879, #882, #884, #886 | Cleared each PR | – | Merged: every paid request carries the payer's signature |

## Surfaces with no dedicated review yet

As of this kit's first version, no review has covered these as a whole:

- S2 developer app and API routes (only payment-related routes were reviewed).
- S3 marketing site.
- S4 provider kit as a published package and the npm supply chain.
- S5 Supabase migration, RLS and wallet sign-in (an internal design review
  fixed two issues before merge in #742).
- S6 infrastructure, custody and CI/CD.
- S7 end-to-end flows across all parts at one commit.

## Known accepted risks and launch gates

These are decisions, not open findings. Auditors check that the control exists
and still holds; they do not need to re-argue the decision.

- Providers report their own token counts; the program does not check the bill.
  Buyers bound it with the authorised maximum (documented in
  `docs/ESCROW-PAYOUT-SAFETY.md`).
- Token-2022 issuers can change extensions after a lock. Control: daily mint
  posture watch and a stop switch per mint.
- Deregistering and re-registering resets reputation (accepted for V1).
- An idle buyer on a fixed-price escrow pays the seller after the claim window
  (per-escrow windows, claim no later than refund).
- Launch gates in `docs/MAINNET-LAUNCH-RUNBOOK.md`: the treasury holds at least
  0.001 SOL and its token accounts for all four tokens before the first lock;
  the deployed hash matches the build of record; upgrade authority is the Squads
  vault and is read back from chain.
- The optional `extended` and `per` program features are not in the V1 build;
  their open items must be fixed before either ships.

Add a row to the first table after each round.
