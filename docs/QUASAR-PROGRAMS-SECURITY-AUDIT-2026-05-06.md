# Quasar Programs — Security Audit Report

> **Dated audit record — qualification added 2026-10-05; superseded for current applicability 2026-10-02.** The findings below are preserved unchanged as an audit of the scoped 2026-05-06 source snapshot; this record is not a current-source audit, closure statement, deployment authorization, or readiness claim. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

**Auditor:** Claude (Opus 4.7), acting as security reviewer
**Date:** 2026-05-06
**Scope:** `experiments/quasar-{registry,escrow,attestation,reputation}/src/**/*.rs` (the four Quasar parity ports of the Anchor `programs/escrow/` program)
**Out of scope:** the Anchor source under `programs/escrow/`, the vendored framework under `third_party/quasar/`, the Next.js/TypeScript app, deployment artifacts. The framework was read only as far as needed to understand what guarantees the programs inherit vs. what they enforce themselves.
**Method:** Manual code review with full reading of every instruction, account struct, and `Cargo.toml`. Quasar framework's `lang/` and `derive/` were read first to establish the safety surface (PDA verification, owner+discriminator checks, `init` / `init_if_needed` semantics, `close` semantics).

---

## TL;DR

The Quasar programs are clean ports of the Anchor handlers — but two of them ship without the cross-program bindings that the Anchor design relies on for trust, and the result is a set of **critical authentication flaws** that allow:

- **Reputation grief**: any attacker can permanently drop any agent's reputation, repeatedly, for ~0.01 SOL per attack.
- **Reputation theft / self-confirmation**: judges can attest with themselves as the consumer and confirm their own attestations, inflating their own reputation to the maximum at near-zero cost.
- **Rating PDA squatting**: anyone can be the first to call `commit_rating` for an arbitrary `job_id` and lock in attacker-chosen consumer/specialist pubkeys, hijacking ratings for jobs they have no part in.

The escrow program is materially safer than the rating/attestation programs, but ships without the 7-day cancel window that the Anchor version has, leaving payees vulnerable to lock-then-cancel grief by the payer.

The root cause in every case is **missing job-binding**: the rating, attestation, and escrow programs do not share a job identity. `job_id` is a free-form `u128` chosen by whoever calls first, with no reference to an escrow account, a registered job, or any signed authorization from the counterparty. The Anchor version relies on PDA derivation through the escrow account; the Quasar ports drop that linkage as part of "parity port hot-path benchmarking."

**Do not deploy these Quasar programs to mainnet in their current form.** The flaws are not subtle Quasar-framework issues — they are missing application-level checks. The framework itself appears to enforce owner, discriminator, and PDA-bump checks correctly along the paths these programs use.

### Severity summary

| Severity      | Count |
|---------------|-------|
| Critical      | 4     |
| High          | 7     |
| Medium        | 6     |
| Low / Info    | 5     |

---

## Findings

### CRITICAL-1 — Rating PDA squatting in `quasar-reputation::commit`

**Location:** `experiments/quasar-reputation/src/instructions/commit.rs:25-125`

**Description.** The `commit` instruction takes `consumer_pk` and `specialist_pk` as caller-supplied parameters. On first call for a given `job_id`, the rating PDA is created with whatever pubkeys the caller supplied — there is no check that the caller is an actual job participant, and no link to an escrow / job record:

```rust
if self.rating.consumer == zero_addr {
    self.rating.set_inner(RatingAccountInner {
        consumer: consumer_pk,        // attacker-supplied
        specialist: specialist_pk,    // attacker-supplied
        ...
    });
}
match role {
    0 => { if signer != self.rating.consumer { reject } ... }
    1 => { if signer != self.rating.specialist { reject } ... }
}
```

The role-vs-signer check passes as long as the attacker plays *one* of the two roles. So an attacker can call:

```
commit(job_id = victim_job_id,
       role = 1,   // specialist
       consumer_pk  = victim_real_consumer,
       specialist_pk = ATTACKER)
```

Now the rating PDA at `[b"rating", victim_job_id]` is permanently bound to (`consumer = victim`, `specialist = ATTACKER`). The legitimate specialist can never participate in this rating. When the victim consumer later commits (role=0) they pass the auth check — they really are the recorded consumer — and reveal a rating about who they think is their counterparty. The reputation update lands on the **attacker's** AgentAccount.

**Impact.**
- **Reputation theft:** if the victim consumer reveals a high score, the attacker gains the full reputation update on their own agent. The attacker also reveals back, controlling whatever score lands on the victim consumer.
- **Rating denial-of-service:** the legitimate specialist can never rate this job. Their reputation history has a permanent gap, with the attacker holding the rating slot.
- **Compounds with CRITICAL-4 below** (expire grief).

**PoC sketch.**
1. Attacker pays 0.01 SOL once to register an `Attestation` agent (any agent type works for reputation; this is needed for some test scenarios).
2. Attacker monitors job creation off-chain or guesses sequential `job_id`s.
3. For each target `job_id`, attacker calls `commit(job_id, role=1, consumer_pk=real_consumer, specialist_pk=ATTACKER, commitment=H(10, salt))`. Cost: rent for the rating PDA (~1500 lamports) + tx fees.
4. Attacker waits for the victim consumer to commit and reveal.
5. Attacker reveals, getting the consumer's score applied to the attacker's agent reputation.

**Remediation.** Bind rating PDAs to the actual job. Two options:

- **Strong fix (recommended):** include the escrow PDA in the rating seeds (e.g. `[b"rating", escrow_pubkey]`), and pass the escrow account into `commit`. Verify `escrow.payer == consumer` and `escrow.payee == specialist`. The PDA can then only be created if a real, locked escrow exists. The rating program should CPI-verify the escrow account belongs to `quasar-escrow` (owner check on the passed-in account). Drop the `consumer_pk` and `specialist_pk` instruction args entirely — derive them from the escrow.
- **Weaker fix:** require *both* a consumer signer and a specialist signer on the first call (multi-sig commit), with their commitments supplied together. This still lets a job_id be squatted by the legitimate pair if they pre-coordinate, but no third party can squat. The rating PDA effectively becomes a job creation step.

Either way, the `init_if_needed`-with-caller-supplied-pubkeys pattern must be replaced.

---

### CRITICAL-2 — Self-confirmation in `quasar-attestation::confirm`

**Location:** `experiments/quasar-attestation/src/instructions/attest.rs:48-85`, `experiments/quasar-attestation/src/instructions/confirm.rs:42-72`

**Description.** In `attest`, the judge writes any address they like into `attestation.consumer`:

```rust
pub fn attest(&mut self, job_id: u128, scores: [u8; 5], consumer: Address, ...) {
    ...
    self.attestation.set_inner(AttestationAccountInner {
        ...
        consumer,           // unauthenticated, judge-supplied
        ...
    });
}
```

Then `confirm` only checks that the signer matches that stored consumer:

```rust
if *self.consumer.address() != self.attestation.consumer {
    return Err(...);
}
```

So a judge can attest with `consumer = themselves`, then confirm in the next instruction. Confirmation rewards the judge's own agent:

```rust
self.judge_agent.attestation_accuracy += ATTESTATION_CONFIRM_WEIGHT;   // +1000, capped at 10_000
self.judge_agent.reputation_score = (old * 9 + 10_000) / 10;            // EMA toward 10_000
```

After ~10 attest/confirm cycles, the judge's `reputation_score` saturates at 10_000 (maximum) and `attestation_accuracy` also caps at 10_000.

**Impact.** Any registered Attestation/Both agent can max out their own on-chain reputation for the cost of rent + tx fees per cycle (~0.002 SOL). The reputation score becomes meaningless as a trust signal.

**PoC sketch.**
```text
register_attestation(agent_type=Both, ...)        // pays 0.01 SOL fee, one-time
loop i = 0 .. 10:
    attest(job_id=i, scores=[10,10,10,10,10], consumer=self)
    confirm(job_id=i)
// reputation_score ≈ 10_000, attestation_accuracy = 10_000
```

**Remediation.** As with CRITICAL-1: bind attestations to a real job. Either:

- Include an escrow account as an `Account` input to `attest`, derive `attestation.consumer` from `escrow.payer` (or whatever role the consumer plays), and verify the escrow program is `quasar-escrow`. Reject any judge-supplied `consumer` argument.
- Or require a separate "job creation" step that signs the consumer and judge bindings; the attestation PDA seeds reference that job account.

Additionally — even after binding — disallow `judge == consumer` in `attest` as a defense-in-depth check (the same agent should never both attest and confirm).

---

### CRITICAL-3 — Unbounded attestation creation in `quasar-attestation::attest`

**Location:** `experiments/quasar-attestation/src/instructions/attest.rs:23-46`

**Description.** Any agent registered as `Attestation` or `Both` may create an attestation for *any* `job_id` — there is no link to a real job, and `init` ensures only the first attester wins the PDA at `[b"attestation", job_id]`:

```rust
#[account(init, payer = judge, seeds = AttestationAccount::seeds(job_id), bump)]
pub attestation: ...,
```

There is no check that the judge was hired for this job, that the job exists, or that the consumer (whoever the judge claims it is) authorized this judge.

**Impact.**
- **Squatting / DoS on legitimate attestations:** an attacker can pre-create attestations on guessable or sequential `job_id`s, blocking real judges from attesting. Costs only rent (~0.002 SOL).
- **Compounds with CRITICAL-2** to enable self-rated reputation.

**PoC sketch.** Register one `Attestation` agent, then call `attest(job_id, scores, consumer=anything)` for every `job_id` in a target range. All future legitimate attestations on those job_ids fail with `AccountAlreadyInitialized`.

**Remediation.** Same as CRITICAL-2 — derive `job_id` (or the seed material for the attestation PDA) from a real escrow / job account that the judge has been authorized for. The judge's authority should be provable on-chain, not asserted by the attest caller.

---

### CRITICAL-4 — Reputation grief via `quasar-reputation::expire`

**Location:** `experiments/quasar-reputation/src/instructions/expire.rs:22-92` combined with CRITICAL-1.

**Description.** `expire` deducts `RATING_EXPIRE_PENALTY = 500` from the reputation of whichever party did *not* commit, after `RATING_EXPIRE_SLOTS ≈ 7 days` have elapsed. Anyone can call expire — the `caller: Signer` field is unconstrained, which is fine on its own. The vulnerability appears when combined with CRITICAL-1:

1. Attacker squats a rating PDA: `commit(job_id, role=1, consumer_pk=victim, specialist_pk=ATTACKER, commitment=anything)`.
2. State is `Pending`. The real victim never knows this rating exists, so they never commit.
3. After 7 days, attacker (or anyone) calls `expire(job_id)`.
4. `consumer_committed = false`, `specialist_committed = true`, so the program penalises the consumer (the victim): `victim.reputation_score -= 500`, `victim.jobs_failed += 1`.

**Impact.** An attacker can permanently grief any target agent's reputation by 500 points per attack, with each attack costing ~0.01 SOL of effective fees and rent (rent for the rating PDA is recovered if the attacker eventually closes — but `expire` does not close the PDA, so rent is locked indefinitely; the attacker can choose this cost). Ten attacks fully zero out a max-rep agent.

This also bumps the victim's `jobs_failed` counter, which front-ends will display.

**Remediation.** Fixing CRITICAL-1 (binding rating PDAs to real jobs) closes this attack. Additionally:
- Require `caller` in `expire` to be one of `rating.consumer` or `rating.specialist`, to prevent third-party-triggered expiry. (Lower-stakes hardening; the real bug is upstream.)
- Cap the cumulative `RATING_EXPIRE_PENALTY` an agent can suffer per epoch, or slow the rate of decay.

---

### HIGH-1 — `quasar-escrow::cancel` has no time-window guard

**Location:** `experiments/quasar-escrow/src/instructions/cancel.rs:1-66`, `experiments/quasar-escrow/src/lib.rs:60-67`

**Description.** The Anchor version of `cancel_escrow` enforces a 7-day `CANCEL_WINDOW_SLOTS` guard before the payer can cancel a locked escrow. The Quasar port explicitly drops this guard:

```rust
/// Note: Anchor version has a 7-day CANCEL_WINDOW_SLOTS guard.
/// This POC omits the slot window check to keep the benchmark clean —
/// noted as a delta in QUASAR-BENCHMARKS.md.
```

The payer can therefore cancel and refund themselves at any time, including immediately after lock and after the payee has already begun work.

**Impact.** Payees have no protection against payers who lock-then-cancel as a DoS / non-payment grift. In a marketplace where payees commit compute (LLM inference, etc.) before being paid, this is a direct loss of work.

**Remediation.** Restore the time-window check, reading `clock.slot` and `escrow.created_slot`:

```rust
let elapsed = Clock::get()?.slot.get().saturating_sub(self.escrow.created_slot.get());
if elapsed < CANCEL_WINDOW_SLOTS {
    return Err(ProgramError::InvalidArgument);
}
```

Note that `escrow.created_slot` is currently hardcoded to `0` in `lock.rs` (also an Anchor-parity delta) — this needs to be set via `Clock::get()?.slot` for the cancel window to mean anything.

---

### HIGH-2 — No payee dispute path in escrow

**Location:** `experiments/quasar-escrow/src/instructions/release.rs`

**Description.** Only the payer can call `release`. The payee has no on-chain action available if the payer refuses to release after delivery. Combined with HIGH-1 (cancel always available), the payer is in full control: they can lock, receive the work, then cancel, refunding themselves.

**Impact.** Adversarial payers cannot be forced to pay. The protocol-level recourse is missing.

**Remediation.** Introduce a dispute / arbitration path. Options:
- A reverse-cancel-window: after some slot threshold, the payee can also call a `claim_escrow` that releases to themselves.
- An attestation/oracle-driven release: if a positive attestation exists in `quasar-attestation` for the escrow's `job_id`, allow the payee to release. (This requires fixing the attestation flaws in CRITICAL-2 and CRITICAL-3 first.)

---

### HIGH-3 — Reputation laundering via deregister + re-register

**Location:** `experiments/quasar-registry/src/instructions/deregister.rs`, `experiments/quasar-registry/src/instructions/register.rs`

**Description.** `deregister` closes the AgentAccount and returns rent to the owner. `register` then allows the same owner to re-register with `reputation_score = 0`, `jobs_failed = 0`, `jobs_completed = 0` — a clean slate.

**Impact.** Any agent with a damaged reputation can pay 0.01 SOL to reset it. The reputation system becomes advisory at best.

**Remediation.** Track a "reputation history" reference that survives deregistration:
- Either keep a sentinel/tombstone PDA at `[b"agent_history", owner]` that records deregistration events and final scores.
- Or: forbid re-registration within a cooldown window, and/or carry forward the previous final score.
- Or: require burn-of-stake for re-registration scaled to the previous reputation drop.

This is a parity issue with the Anchor version too — but worth flagging because the marketplace relies on reputation as a trust signal.

---

### HIGH-4 — `overflow-checks` not enabled in the Quasar program workspaces

**Location:** every `experiments/quasar-*/Cargo.toml` (each declares `[workspace]` at the bottom, making it a standalone workspace)

**Description.** The repo root `Cargo.toml` sets `[profile.release] overflow-checks = true`, but each Quasar program's `Cargo.toml` ends with `[workspace]` and does **not** define a `[profile.release]` block. They are independent workspaces and do not inherit the root profile.

I audited every arithmetic site in the four programs and the practical risk is low — `release.rs` and `cancel.rs` use plain `+`/`-` on lamports but those are bounded by total SOL supply; `apply_reputation_update` uses u32 with bounds that fit; expire uses `saturating_*`. None of the sites I found have a realistic overflow path.

**Impact.** Defense-in-depth gap: any future arithmetic added under `release` will silently wrap. Solana programs are conventionally built with `overflow-checks = true` because the cost (a few CU per arithmetic op) is acceptable and the audit cost of "is every callsite correct" is high.

**Remediation.** Add to each `experiments/quasar-*/Cargo.toml`:

```toml
[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
```

---

### HIGH-5 — Placeholder `declare_id!` values

**Location:** `quasar-registry/src/lib.rs:34` (`55555…`), `quasar-reputation/src/lib.rs:37` (`66666…`), `quasar-attestation/src/lib.rs:36` (`77777…`)

**Description.** Three of the four programs declare vanity-pattern program IDs that are clearly placeholders. The fourth (`quasar-escrow`, `VYCbMs…`) appears to be a real generated keypair.

**Impact.**
- These cannot be the deployed addresses on mainnet. Anything that compares `declare_id!` against a runtime program ID will fail.
- Worse: the all-5s, all-6s, all-7s addresses are publicly known points on the base58 address space. Anyone who can find a private key for them (impractical with current crypto, but a symbol of "we never generated a real key") could squat. More realistically, **whoever deploys first to those addresses wins** if a different team is also using these as placeholders.

**Remediation.** Generate real keypairs (`solana-keygen new`) for each program, set `declare_id!` to the real value, and check the keypair files into a secure location (not the public repo). Re-deploy and verify with `openclaw doctor`-equivalent for each program. The devnet artifacts under `artifacts/quasar-devnet-registration/` should be used to confirm the canonical IDs.

---

### HIGH-6 — `quasar-svm` git dev-dependency is unpinned

**Location:** every `experiments/quasar-*/Cargo.toml` dev-dependencies block

```toml
quasar-svm = { git = "https://github.com/blueshift-gg/quasar-svm" }
```

**Description.** No `rev`, `tag`, or `branch`. Every test build pulls whatever HEAD points to in the upstream repo.

**Impact.** Supply-chain risk. If the upstream is compromised or force-pushes, every developer's test environment runs the new code. Test rigs may have access to keys, network access to devnet/mainnet, etc. This is also a reproducibility problem — `cargo build` on different days produces different binaries.

**Remediation.**

```toml
quasar-svm = { git = "https://github.com/blueshift-gg/quasar-svm", rev = "<sha-pinned>" }
```

Pin to a specific commit. Re-pin only after auditing the diff.

---

### HIGH-7 — Three programs maintain independent `AgentAccount` registries

**Location:** `quasar-registry::AgentAccount`, `quasar-reputation::AgentAccount`, `quasar-attestation::AgentAccount` (the latter adds an `attestation_accuracy` field but otherwise mirrors the layout)

**Description.** All three programs use `discriminator = 20`, seeds `[b"agent", owner]`, and a register instruction. But because the PDA owner is the program ID, the PDAs are different addresses across programs — a user must register (and pay 0.01 SOL) in each.

**Impact.**
- **State divergence.** "Reputation" depends on which program looks at it. The attestation program awards/penalises its own copy of the agent's reputation; the reputation program awards/penalises a different copy. Front-ends pulling from one will show different values from front-ends pulling from another.
- 3× registration fee (0.03 SOL per agent for full marketplace participation).
- Increases attack surface: each registry is a separate target for the laundering attack in HIGH-3.

**Remediation.** Architectural — pick one source of truth for `AgentAccount`. Either:

- One canonical `quasar-registry`, with `quasar-reputation` and `quasar-attestation` doing CPI reads/writes against the registry's accounts (validate the registry program ID, then `Account::from_account_view` against the registry's struct definition).
- Or merge the three programs into one. Given the parity-port goal, splitting them was a benchmarking convenience — not a deployment shape.

This is the structural fix that, properly executed, also resolves a lot of the cross-program job-binding problems behind CRITICAL-1 / CRITICAL-2 / CRITICAL-3.

---

### MEDIUM-1 — Zero commitment treated as "no commitment"

**Location:** `experiments/quasar-reputation/src/state.rs:188-197`, `commit.rs:100-113`

**Description.** `consumer_committed()` / `specialist_committed()` return false when the commitment field is `[0u8; 32]`. This is the sentinel for "uninitialized." But a caller can also legally submit `commitment = [0u8; 32]` — `sha256` hashes can land on all-zeros (statistically near-impossible, but the program also accepts a literal zero).

If a party accidentally submits a zero commitment, the program does not error. The party then thinks they have committed; the program thinks they have not. After the 7-day expire window, they get penalised.

**Impact.** Footgun for legitimate users. Not directly exploitable but creates a bad UX failure mode.

**Remediation.** Reject zero commitments explicitly in `commit`:

```rust
if commitment == [0u8; 32] {
    return Err(ProgramError::InvalidArgument);
}
```

Better: replace the `commitment != [0u8;32]` sentinel with a separate `committed: bool` flag in `RatingAccount`, removing the implicit dependency on hash output.

---

### MEDIUM-2 — Commitment lacks domain separation

**Location:** `experiments/quasar-reputation/src/instructions/reveal.rs:71-74`

**Description.** `commitment = sha256(score || salt)`. There is no `job_id`, party identity, or program identifier in the hash.

**Impact.**
- If a user reuses a salt across two different jobs and the score is the same, the commitments are bit-identical. An observer learns "Alice is committing the same score on these two jobs."
- A caller can pre-compute commitments for `(score, salt)` pairs and reuse them as commitment material across PDAs they squat (when combined with CRITICAL-1).

**Remediation.**

```rust
hasher.update([score]);
hasher.update(salt);
hasher.update(&job_id.to_le_bytes());
hasher.update(<program_id>.as_ref());
```

Tie the commitment to the job and program. The reveal logic must use the same digest input.

---

### MEDIUM-3 — `attestation.consumer` writeable to any 32 bytes

**Location:** `experiments/quasar-attestation/src/lib.rs:67-75`

**Description.** `consumer` is taken as a 32-byte array and converted via `Address::new_from_array`. The program does not verify it is a "valid" Solana pubkey (e.g. on the ed25519 curve or off-curve as a known PDA). This is fine functionally — the address only matters for matching against `confirm`/`dispute` signers — but means any 32-byte string is acceptable.

**Impact.** Combined with CRITICAL-2, the judge can set `consumer = [0u8; 32]` (or any pattern) to ensure no real key can match it, effectively burning the attestation in `Pending` forever. Low-impact on its own.

**Remediation.** Drop the `consumer` parameter and derive it from a real escrow / job account, per CRITICAL-2's remediation.

---

### MEDIUM-4 — `expire` callable by anyone

**Location:** `experiments/quasar-reputation/src/instructions/expire.rs:33`

**Description.** `caller: Signer` is unconstrained. The doc comment says "either party may trigger expiry," but the code does not enforce it.

**Impact.** Defense-in-depth — combined with CRITICAL-1 / CRITICAL-4, a third-party attacker can complete the grief without needing to wait for one of the (squatted) parties to call expire.

**Remediation.** Constrain `caller` to be one of the recorded participants:

```rust
let caller_addr = *self.caller.address();
if caller_addr != self.rating.consumer && caller_addr != self.rating.specialist {
    return Err(ProgramError::InvalidArgument);
}
```

---

### MEDIUM-5 — `job_id` is caller-chosen u128 with no authorization

**Location:** all four programs use `job_id` as either a `u128` arg (`attest`, `commit`, `reveal`, `expire`) or `escrow_id: u64` (escrow lock/release/cancel)

**Description.** The first caller to choose a `job_id` wins the PDA. There is no allocator, no off-chain coordination required by the program, and no signing of `job_id` by an authoritative party.

**Impact.** Squatting (CRITICAL-1, CRITICAL-3) is enabled by this. Even with a legitimate user, two clients racing on the same `job_id` will see one fail unpredictably.

**Remediation.** Same as the structural fix in CRITICAL-1 / HIGH-7: derive `job_id` from a higher-authority account (the escrow PDA, a job-creation PDA, etc.) and verify the linkage in seed derivation.

---

### MEDIUM-6 — Vendored `third_party/quasar` framework is not a tagged release

**Location:** `third_party/quasar/`

**Description.** The vendored Quasar framework has `version.workspace = true` referencing `third_party/quasar/Cargo.toml`, but there is no `VENDORED_FROM` / `git rev` annotation in this repo. Audit status of the vendored framework is undocumented.

**Impact.** Programs inherit framework behaviour but you cannot easily verify the framework hasn't been subtly modified vs. upstream. The framework is the basis of every safety guarantee these programs rely on (PDA verification, owner checks, discriminator binding).

**Remediation.** Add a `third_party/quasar/VERSION.md` with the upstream commit SHA, a diff of any local modifications, and a re-vendor procedure. Ideally, replace the vendor with a Cargo path/git dep pinned to a known SHA.

---

### LOW-1 — `created_at = 0` and `created_slot = 0` in registry / escrow lock

`quasar-registry::register.rs:101`, `quasar-escrow::lock.rs:87-88`. Documented as an Anchor-parity delta. Functionally limits time-based reasoning later (and is a prerequisite for fixing HIGH-1 in escrow). Set via `Clock::get()?` when those fields are needed.

### LOW-2 — Counter init detection via `payer == Address::default()`

`experiments/quasar-escrow/src/instructions/lock.rs:63-69`. Brittle but correct in practice. The cleaner sentinel would be a separate `initialized: u8` byte set at first init.

### LOW-3 — `register` charges a fee that is non-refundable on deregister

By design, but worth documenting in user-facing docs so users understand the deregister economics. Combined with HIGH-3 (laundering), this is the only friction against rep reset.

### LOW-4 — Lamport arithmetic in `release` / `cancel` uses unchecked `+` / `-`

`experiments/quasar-escrow/src/instructions/release.rs:58-59`, `cancel.rs:52-53`. Bounded by total SOL supply, not exploitable in practice, but `checked_sub` / `checked_add` would survive future code changes (and HIGH-4's overflow-checks fix). Trivial fix.

### LOW-5 — No on-chain emit for `register` in attestation/reputation programs

Registry emits an event; attestation and reputation register handlers do not. Indexers will miss agent registration in these programs. Cosmetic / observability gap.

---

## Recommended remediation order

The findings cluster into three independent fix tracks. Tackle in this order:

1. **Architectural unification (closes CRITICAL-1, CRITICAL-2, CRITICAL-3, CRITICAL-4, HIGH-2, HIGH-7, MEDIUM-3, MEDIUM-5).**
   - One canonical `AgentAccount` (own program or shared).
   - A `JobAccount` that the escrow creates and the rating/attestation programs reference. The rating PDA seed becomes `[b"rating", job_account]`; the attestation PDA seed becomes `[b"attestation", job_account]`. Both programs read the consumer/specialist from the JobAccount, not from caller args.
   - Drop the caller-supplied `consumer_pk`, `specialist_pk`, and `consumer` (in attest) parameters entirely.

2. **Escrow hardening (closes HIGH-1, LOW-1, LOW-4).**
   - Restore `created_slot = Clock::get()?.slot.get()` in `lock`.
   - Restore the `CANCEL_WINDOW_SLOTS` check in `cancel`.
   - Switch lamport arithmetic to `checked_*`.

3. **Hygiene (closes HIGH-4, HIGH-5, HIGH-6, MEDIUM-1, MEDIUM-2, MEDIUM-6, LOW-3, LOW-5).**
   - Add `[profile.release] overflow-checks = true` to each program's `Cargo.toml`.
   - Generate real keypairs and update `declare_id!`.
   - Pin `quasar-svm` to a `rev`.
   - Reject zero commitments; add domain separation to commitment hashing.
   - Document vendored Quasar framework version.
   - Add registration events to all programs.
   - Document the deregister + re-register economics (or implement HIGH-3's hardening).

4. **Reputation laundering (HIGH-3).** Out-of-band design choice — depends on whether you want reputation to be sticky across deregister cycles. Pick a policy (cooldown, history sentinel, stake-burn) and apply consistently.

---

## What was NOT found

For completeness, here are classes of bugs I checked for and did not find:

- **PDA bump non-canonical-ization**: every register / first-create site uses bare `bump`, which the Quasar framework resolves via `based_try_find_program_address` (canonical bump). Re-validation paths use `bump = account.bump`, reading the canonical bump that was stored at creation time.
- **Owner / discriminator missing on `Account<T>` reads**: the framework's derive macros emit owner + discriminator checks for every `Account<T>` field; I traced the codegen path in `third_party/quasar/derive/src/accounts/fields_process.rs:474-493` and confirmed the programs use the standard `Account<T>` shape that picks up these checks.
- **`Signer` substitution / type confusion**: `Signer` only verifies `is_signer`, but every relevant instruction also checks `signer.address()` against an authoritative field (`agent.owner`, `escrow.payer`, `rating.consumer/specialist`). That check is what authenticates — `Signer` itself only proves a signature exists.
- **Reentrancy via CPI**: the only CPI calls are `system_program.transfer(...)`, which cannot reenter into these programs.
- **`init_if_needed` re-init after close**: the framework documents this risk; none of the programs both close and `init_if_needed` the same account, so the documented edge case does not apply.
- **Missing rent-exemption after lamport drain**: `release` / `cancel` leave the escrow at exactly its rent-exempt minimum before `close = payer` sweeps the remainder; the math is correct.
- **Account discriminator confusion across programs**: `AgentAccount` uses disc 20 in three programs but those PDAs live in different program ownership realms, so no cross-program confusion is possible.

---

## Files reviewed (full read)

```
experiments/quasar-registry/src/{lib.rs, state.rs, events.rs, instructions/{register,update,deregister}.rs}
experiments/quasar-escrow/src/{lib.rs, state.rs, events.rs, instructions/{lock,release,cancel}.rs}
experiments/quasar-attestation/src/{lib.rs, state.rs, instructions/{register,attest,confirm,dispute}.rs}
experiments/quasar-reputation/src/{lib.rs, state.rs, instructions/{register,commit,reveal,expire}.rs}
experiments/quasar-*/Cargo.toml
Cargo.toml (root)
rust-toolchain.toml
third_party/quasar/lang/src/{accounts/{account,signer}.rs, pda.rs}  (framework safety surface)
third_party/quasar/derive/src/accounts/{init.rs, fields_process.rs}  (constraint codegen)
```

Tests under `experiments/quasar-*/src/tests.rs` were not read in full — they are useful as next-step checks for the remediation patches but were out of scope for this review.
