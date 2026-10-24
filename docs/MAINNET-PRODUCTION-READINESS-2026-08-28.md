# Mainnet production readiness assessment

_Originally written 2026-08-28 against source tree `11311a4`._
_Rewritten 2026-10-03 against source tree `801d0d1`, after the Quasar experimental freeze (#674)._

**Verdict: NOT READY.** No lane in this repository is production-bound.

The 2026-08-28 edition of this document framed readiness as "4 blocking gates open" — four
specific defects standing between the code and an external audit. That framing is no longer
accurate, and not because the gates were closed. Two of them were, and a third was
substantially addressed. But the Quasar experimental freeze on 2026-10-02
([`docs/QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md))
changed which code is on the path at all, and the honest headline is now simpler and worse
than a gate count:

- There is no mainnet deployment, and no program in this repository is a mainnet candidate.
- The lane the freeze declares authoritative — stable Anchor `1.1.2` under `programs/escrow/` —
  has never been audited, and carries open design defects of its own.
- Some of the hardening work this project completed lives in the lane that was just frozen,
  and does not exist in the lane that was just made authoritative.

That last point is the material finding of this rewrite and is developed in §1.

## 1. The freeze moved the gap, it did not close it

The freeze retires Quasar from product, production, submission, deployment, audit-readiness,
and mainnet planning, and names stable Anchor `1.1.2` under `programs/escrow/` as "the
authoritative on-chain reference implementation". That is a defensible decision on the
evidence — the freeze's own qualification table shows the Quasar benchmark never established
a material advantage. But it has a consequence the freeze does not discuss.

The job-binding series (#642–#645) hardened the **Quasar** reputation and attestation
programs. `experiments/quasar-reputation/src/lib.rs:20` records it: "Job binding (2026-08-24,
closes CRITICAL-1): ratings are keyed by the …". The regression tests for it are in
`experiments/quasar-reputation/src/tests.rs:1021` onward. None of that work was ported to
`programs/escrow/`. So the lane now declared authoritative is the **unhardened** one, and two
defect classes that this project believed it had addressed are live in it.

### 1.1 CRITICAL-4 (the reveal deadlock) is present in the authoritative lane, in a worse form

This was tracked as gate G-1 against the Quasar lane. It is also in `programs/escrow/`, and
there it has no mitigation at all.

The rating state machine in the Anchor lane:

- `commit_rating.rs:65-67` — once both commitments are recorded, state advances to
  `RatingState::BothCommitted`.
- `reveal_rating.rs:21-24` — reveal requires `BothCommitted`; `:59-73` — reputation is applied
  only when *both* scores are present.
- `expire_rating.rs:17-20` — expiry requires `RatingState::Pending`.

`BothCommitted` is therefore absorbing. Once both parties have committed, the only exit is
both parties revealing. `expire_rating` cannot be called, because the state is no longer
`Pending`.

The incentive follows directly. Reputation is a rolling average
(`reveal_rating.rs:79-86`: `new = (old * 9 + rating * 1000) / 10`). A party who expects an
incoming score below their current score simply never reveals. The cost of stalling is zero:
no penalty, no `jobs_failed` increment, no reputation change, indefinitely. The rating PDA
sits funded forever and the first committer never recovers its rent.

This is strictly worse than the Quasar behaviour the original G-1 described. In the Quasar
lane, stalling at least cost `RATING_EXPIRE_PENALTY` through an expiry path, which made
stalling rational only below roughly 3/10. In the Anchor lane there is no expiry path out of
`BothCommitted` at all, so **stalling is unconditionally dominant for any party who dislikes
their incoming score**. The practical effect is that negative ratings are systematically
unrecordable: the reputation system converges to only recording ratings both parties were
content with.

`docs/QUASAR-C4-DURABLE-JOB-RECORD-DESIGN-2026-08-26.md:3-4` already states CRITICAL-4 remains
open. What is new here is that it is open in the authoritative lane and not only the frozen
one, and that the design round owed for it now has to target `programs/escrow/`.

### 1.2 The Anchor rating lane has no job binding and no caller authorization on expiry

This is not a restatement of G-1. It is a separate defect, and I did not find it disclosed in
`SECURITY.md`, the audit readiness pack, or the audit appendix — those three name
`commit_rating` / `reveal_rating` / `expire_rating` only as instruction inventory
(`docs/SOLANA-CONTRACT-AUDIT-READINESS-2026-06-24.md:172`,
`docs/SOLANA-CONTRACT-AUDIT-APPENDIX-2026-06-24.md:200`).

Two things combine:

1. **No job binding.** `CommitRating` (`commit_rating.rs:72-88`) takes no escrow account and
   no job record. The first committer supplies `consumer_pk` and `specialist_pk` as
   instruction arguments (`:22-23`, written to state at `:38-39`) under `init_if_needed`
   (`:77`). Nothing on-chain verifies that a job between those two parties ever existed.
2. **No caller check on expiry.** `ExpireRating` (`expire_rating.rs:52-79`) declares
   `caller: Signer<'info>` with the comment "Either consumer or specialist may trigger
   expiry" — but there is no `require!` enforcing that. Any signer can call it.

The resulting griefing path against any registered agent:

1. Attacker registers an agent once, burning `AGENT_REGISTRATION_FEE` (0.01 SOL).
2. Attacker calls `commit_rating` for an arbitrary `job_id`, naming the victim as
   `specialist_pk` and themself as `consumer_pk`, and commits any hash. State is `Pending`,
   with only the consumer side committed.
3. Attacker waits `RATING_EXPIRE_SLOTS` = 1,512,000 slots (≈7 days at 400ms/slot,
   `constants.rs:15`).
4. Attacker calls `expire_rating`. The handler sees `consumer_committed && !specialist_committed`
   and penalises the specialist (`expire_rating.rs:31-39`): victim's `reputation_score` loses
   `RATING_EXPIRE_PENALTY` = 500 (5.00 points on the 0–10000 scale, `constants.rs:17`) and
   `jobs_failed` is incremented.

No job existed. The victim never interacted with the attacker. The attack is repeatable in
parallel across distinct `job_id` values at the cost of rent per rating PDA (175 bytes,
`state.rs:140`) plus transaction fees, and the one-time registration burn. With enough
parallel job_ids an attacker can drive any registered agent's reputation to zero and inflate
its failure count arbitrarily.

This is precisely the defect class the Quasar lane closed as CRITICAL-1 job binding. The fix
exists in the frozen lane and is absent from the authoritative one.

### 1.3 Consequence for the audit handoff

[`docs/SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md`](SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md)
was **not** updated by #674. Its reconciliation note (lines 7-13) still tells an auditor that
"Current code binds reputation and attestation to `experiments/quasar-escrow`
(`VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`)", and line 79 still records "Current active
escrow target for reputation/attestation job binding: `experiments/quasar-escrow`". The
freeze retires that target from audit. The packet now points an auditor at frozen
experimental code.

The original G-2 (handoff target ambiguity) was closed on 2026-08-31 by that note. The freeze
reopens it in a new form: the answer the note gives is now the wrong answer. The handoff must
be re-pointed at `programs/escrow/` before it goes anywhere, and re-pointing it means the
packet's scope has to grow to cover §1.1 and §1.2, which the Quasar-era pack never assessed.

## 2. Gate status, restated

| Gate | 2026-08-28 | 2026-10-03 | Notes |
|---|---|---|---|
| G-1 — CRITICAL-4 reveal deadlock | open (Quasar) | **open, and wider** | Present in `programs/escrow/` with no expiry path out of `BothCommitted`. See §1.1. |
| G-2 — audit handoff target ambiguity | open | **reopened by the freeze** | Closed 2026-08-31, invalidated 2026-10-02. See §1.3. |
| G-3 — `SECURITY.md` trust-boundary wording | open | **closed** | `SECURITY.md:38` now states the devnet addresses are Quasar, not Anchor, and warns against relying on Anchor `has_one` wording for that boundary. A "Source-level, not yet deployed" bullet records that the deployed binaries predate job binding. |
| G-4 — mainnet config would resolve to a placeholder | open | **substantially addressed; one residual** | See §2.1. |
| New — Anchor rating lane unbound, expiry unauthorized | not identified | **open** | See §1.2. Reputation griefing against any registered agent. |

### 2.1 G-4 residual

`config/networks/mainnet.json` now carries `mainnetDeploymentStatusNote: "not_deployed"`, an
explicitly labelled PLACEHOLDER `escrowProgramId`, per-program notes for registry /
reputation / attestation, and a `quasarProgramSetNote` recording that mainnet stays disabled
until audited ids are registered and the resolver is deliberately enabled.
`lib/config/network.ts` refuses the Quasar target on mainnet (`:203-205`), reports
`submissionReady: false`, `deploymentStatus: "mainnet-not-deployed"`, and
`activationGate: "external_audit_and_mainnet_deployment_required"`. The silent fallback the
original G-4 described is gone.

What remains: on `mainnet` the resolver still *resolves* to the `legacy-anchor` target with
the placeholder program id rather than refusing outright. Every downstream disclosure says
the profile is blocked, so this is disclosed rather than hidden — but a profile with no
deployment should not produce a usable-looking program id at all. This is the residual code
fix.

## 3. Structural gaps

These are not defects. They are features the product model assumes and the code does not have.
All three were verified against `programs/escrow/` for this rewrite, since that is now the
authoritative lane.

### S-1 — Escrow is SOL-only; the product model is denominated in USDC

`programs/escrow/src/` contains no SPL-token code whatsoever — no `spl_token`, no `Mint`, no
`TokenAccount`, no ATA handling. `EscrowAccount.amount` is lamports (`state.rs:22`).
`lock_escrow.rs:29-38` moves value with `system_program::transfer`; `release_escrow.rs:19-24`
and `cancel_escrow.rs:28-32` move it with raw `try_borrow_mut_lamports`. Agent pricing is
`rate_lamports` (`state.rs:74`).

Meanwhile every economic fixture is in USDC — `lib/economic-demo/fixture.ts:145` quotes
`currency: "USDC"` with `downstreamFeesUsdc`, `attestorFeesUsdc`, `totalUsdc`. The demo
economics and the on-chain escrow do not share a unit of account. Adding an SPL rail changes
`EscrowAccount`'s layout and the escrow instruction surface, which is why it has to land
before an audit rather than after.

### S-2 — The 0.05% protocol fee is not implemented anywhere on-chain

`release_escrow.rs:17-24` transfers the escrow's full `amount` to the payee. There is no fee
account, no treasury PDA, no basis-point arithmetic, and no collection step. The figure lives
only in fixtures and claim-boundary data: `lib/economic-demo/fixture.ts:119-120`
(`REDDI_PROTOCOL_RAIL_FEE_BPS = 5`), the transfer labelled "Reddi Agent Protocol rail fee
(0.05%)" at `:151`, and `lib/public-claims/public-claim-boundary-terms.ts:179`, which exists
specifically to flag "The protocol collects a 0.05% take-rate" as an unqualified claim.

The only on-chain economic constant is `AGENT_REGISTRATION_FEE = 10_000_000` lamports
(`constants.rs:9`), burned to the incinerator (`constants.rs:11`,
`register_agent.rs:22-32`) — a burn, not revenue. The protocol has no revenue mechanism in
code. Per `AGENTS.md`, the 0.05% figure must be described as planned or fixture semantics and
never as implemented behaviour; this document does so.

This remains an open product decision, not a defect: implement on-chain collection in
`release` before the audit, or launch with no protocol revenue. It is listed in §5 as a
decision owed, not as work to schedule.

### S-3 — No upgrade-authority or key-custody plan

`DEPLOY.md` is 85 lines and covers one devnet keypair. There is no multisig, no authority
transfer procedure, no rotation plan, and no custody model for a program upgrade authority.
Agent private keys live in a gitignored `packages/demo-agents/.env.devnet`, with three
hardcoded wallet addresses in the guide itself.

The repository's one key-rotation runbook,
[`docs/ONBOARDING-OPERATOR-KEY-ROTATION-RUNBOOK.md`](ONBOARDING-OPERATOR-KEY-ROTATION-RUNBOOK.md),
rotates `ONBOARDING_ATTEST_OPERATOR_SECRET_KEY` — an application secret, not a program
upgrade authority. Nothing in the repository addresses the latter.

#674 did add a correct status header to `DEPLOY.md:3` ("historical/reference deployment notes.
This guide does not authorize redeployments, live funds, mainnet, custody, or public
production claims"), which makes the gap honest without closing it.

## 4. Operational gaps

`SECURITY.md:104` states this list itself: "paid mainnet RPC/fallback, on-chain monitoring,
incident response, safe-harbour/bounty terms, and the historical Jupiter key rotation are
still owed before production readiness." Verified row by row:

| Item | State | Evidence |
|---|---|---|
| RPC | Public endpoint, no paid tier, no fallback | `config/networks/devnet.json:5-6` — `https://api.devnet.solana.com` / `wss://api.devnet.solana.com` |
| Jupiter API key | Purged from the working tree but still in git history; **must be treated as compromised**. Rotation is owed by a human and has not happened. | `.env.example:64` |
| On-chain monitoring | None | No monitoring configuration in the repository |
| Production incident runbook | None | The eight runbooks under `docs/` cover demo recording, devnet cleanup, Quasar validation, and hosted-marketplace operator review — none is a production incident response |
| Vulnerability disclosure | Channel exists; no safe harbour, no bounty | `SECURITY.md:115-119`. The text is explicit that acknowledgement intent "is not an SLA or managed security-service commitment" |
| Waitlist | 0 entries | Latest backup run: `count: 0` |

## 5. What has to happen, and in what order

Two rules carry over from the 2026-08-28 edition and still hold:

1. Nothing goes to an auditor until the code is the code we intend to ship.
2. Anything that changes an account layout must land before the audit, not after.

The freeze changes the sequence, because the work now has to land in `programs/escrow/`
rather than in the Quasar lane where its predecessors were built.

**Phase 0 — decisions owed before any of this can be scheduled.** These are not mine to
make and nothing below is estimable without them:

- Does the SPL/USDC rail (S-1) land before the audit? It changes `EscrowAccount`'s layout, so
  "after" is not available.
- Is on-chain 0.05% fee collection implemented in `release` (S-2), or does the protocol launch
  with no revenue mechanism? Also a layout and instruction-surface change.
- Does the CRITICAL-4 design round 4 now target `programs/escrow/` rather than the frozen
  Quasar reputation program?

**Phase 1 — port the hardening to the authoritative lane.** Job binding and caller
authorization for the Anchor rating instructions (§1.2), and an exit from `BothCommitted`
(§1.1). The Quasar implementations in `experiments/quasar-reputation/` are the design
reference; their regression tests (`src/tests.rs:1021`+) are the behavioural specification to
match. Both changes touch account layout and instruction accounts, so this is pre-audit work.

**Phase 2 — layout-affecting product decisions from Phase 0.** Whatever S-1 and S-2 resolve
to, implemented here, while the account layouts are still open.

**Phase 3 — re-point and re-scope the audit handoff.** Rewrite
`docs/SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md` to name `programs/escrow/` as the target,
record the real handoff source commit (line 77 still says "the merge commit for PR #534, to
be recorded in" #530), and extend the readiness and appendix packs to cover the Anchor rating
lane, which the Quasar-era packs never assessed. Auditor selection stays with Nissan.

**Phase 4 — custody and operations.** S-3 and §4. Upgrade authority and key custody before a
mainnet deployment exists to have an authority over; the operational rows can run in parallel
with the audit. The Jupiter key rotation is owed by a human and is not blocked by any of the
above.

**Phase 5 — mainnet.** Only after an audit against the shipped code, with audited ids
recorded in `config/networks/mainnet.json` and the resolver deliberately enabled. The G-4
residual in §2.1 should be fixed before this point, not as part of it.

## 6. What this document does not claim

- It does not claim an audit date, an audit scope, or an auditor. Auditor selection, any
  spend, any deployment, and any external submission are reserved to Nissan's explicit
  approval.
- It does not authorize any deployment, upgrade authority change, mainnet activation,
  transaction, signing, simulation, funding, or RPC execution.
- It does not claim the Quasar freeze was wrong. The freeze's benchmark qualification stands
  on its own evidence. This document records a consequence the freeze did not address.
- It does not claim §1.2 has been exploited, or that any agent's recorded reputation reflects
  griefing. The finding is a source-level reading of `programs/escrow/src/instructions/`;
  nothing here was tested on-chain, and no transaction, simulation, validator, or RPC call was
  made for this assessment.
- It does not claim the 0.05% protocol fee is implemented. It is a planned product and fixture
  model. See §3 S-2.
- It does not claim readiness of any kind for `programs/escrow/`. "Authoritative reference
  implementation" is the freeze's term for which source lane is current. It is not an audit
  status, a deployment status, or a production status. `README.md` records that even the
  recorded Anchor devnet deployment `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD` is
  historical and reference-only.

## Verification basis

Source tree `801d0d1`. Every claim above was read from the files cited, at that commit. No
command that spends, signs, simulates, deploys, funds, or touches an RPC endpoint was run for
this assessment, in line with the freeze's safe-validation constraints.
