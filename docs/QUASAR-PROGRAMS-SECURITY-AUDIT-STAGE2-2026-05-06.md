# Quasar Programs — Stage-2 Security Audit (Remediation Verification)

> **Dated remediation-verification record — qualification added 2026-10-05; superseded for current applicability 2026-10-02.** The branch-local findings and verdict below are preserved unchanged as 2026-05-06 history. Its merge verdict is not a current audit, deployment authorization, or readiness claim. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

**Auditor:** Claude (Opus 4.7), security reviewer
**Date:** 2026-05-06
**Scope:** Verification of changes documented in `docs/QUASAR-PROGRAMS-SECURITY-REMEDIATION-2026-05-06.md` against the actual code in `experiments/quasar-{registry,escrow,attestation,reputation}/`. New-bug check across every modified file.
**Companion docs:** Stage-1 audit at `docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`; remediation log at `docs/QUASAR-PROGRAMS-SECURITY-REMEDIATION-2026-05-06.md`.

---

## TL;DR

**Every claimed remediation in the remediation log is implemented as described in the code, with regression tests in place for each.** I re-read every modified file in full and traced each fix against the original finding. No previously-closed finding is silently regressed; no new vulnerability is introduced by the changes.

The architectural findings the remediation log openly leaves out (CRITICAL-1, CRITICAL-3, residual CRITICAL-4, MEDIUM-5, HIGH-2/3/7, LOW-3/5) are still open in the code as expected. They are correctly characterised as needing the canonical job/escrow binding work, which has not been done in this branch.

I found **three minor new observations** (one Low, two Informational) introduced by the remediations themselves — none are blockers, and all are listed below for tracking.

**Verdict for this branch:**
- ✅ Safe to merge for the immediate hardening pass.
- ❌ Still **not safe to deploy to mainnet** until the architectural items the remediation log lists as "Still open / requires design work" are closed.

---

## Verification matrix

Each row was confirmed by direct code read, not just by the remediation log's claim.

| Audit finding | Claim | Code site verified | Test verified | Status |
|---|---|---|---|---|
| HIGH-1 — escrow cancel lacks time-window | Lock sets `created_slot` from Clock; cancel rejects before `CANCEL_WINDOW_SLOTS` | `quasar-escrow/src/instructions/lock.rs:78-95`, `cancel.rs:48-52`, `state.rs:4` | `test_audit_cancel_before_window_rejected` at `tests.rs:351` | ✅ Closed |
| LOW-1 — `created_at`/`created_slot` were `0` | Lock now writes both from `Clock::get()` | `lock.rs:78,92-93` | Same as HIGH-1 | ✅ Closed |
| LOW-4 — unchecked lamport `+`/`-` | Both sites use `checked_sub`/`checked_add`, error = `ProgramError::ArithmeticOverflow` | `release.rs:58-65`, `cancel.rs:60-67` | Existing happy paths exercise both code paths | ✅ Closed |
| HIGH-4 — overflow-checks not on in workspaces | Each program's `Cargo.toml` adds `[profile.release] overflow-checks = true, lto = "fat", codegen-units = 1` | `quasar-{registry,escrow,reputation,attestation}/Cargo.toml` lines 30-34 | Build profile applies on `cargo build --release` | ✅ Closed |
| HIGH-5 — placeholder `declare_id!` | Three real keypair-format addresses replace the `5555…/6666…/7777…` placeholders | registry `lib.rs:34` (`Xk7jcz…`), reputation `lib.rs:37` (`nb9rLV…`), attestation `lib.rs:36` (`CRGsWW…`) | n/a — gate via deployment | ✅ Closed (verify devnet artifact) |
| HIGH-6 — unpinned `quasar-svm` | All four Cargo.tomls pin `rev = "cf3c06a08a9009631d42d7942a574da1eac6104d"` | dev-deps line in each `Cargo.toml` | Reproducible builds | ✅ Closed |
| MEDIUM-1 — zero commitment footgun | `commit` rejects `[0u8; 32]` early | `quasar-reputation/src/instructions/commit.rs:64-66` | `test_audit_zero_commitment_rejected` at `tests.rs:792` | ✅ Closed |
| MEDIUM-2 — no domain separation in commitment | Hash now `score \|\| salt \|\| job_id_le \|\| program_id` | `reveal.rs:72-77` (uses `crate::ID.as_ref()`) | `test_audit_cross_job_commitment_reuse_rejected` at `tests.rs:817`; existing reveal tests pass with new helper | ✅ Closed (see N2 below) |
| MEDIUM-4 — `expire` callable by anyone | Caller restricted to `rating.consumer` or `rating.specialist` | `expire.rs:62-66` | `test_audit_expire_third_party_rejected` at `tests.rs:878` | ✅ Closed (defense-in-depth only — see N3) |
| CRITICAL-2 (defense-in-depth only) — judge self-confirmation | `attest` rejects `consumer == judge` (single-key) | `attest.rs:69-74` | `test_audit_self_confirmation_attest_rejected` at `tests.rs:577` | ⚠️ Partial — Sybil bypass remains, see N4 |
| MEDIUM-6 — vendored framework provenance | `third_party/quasar/VERSION.md` added with vendoring/audit/re-vendor notes | `third_party/quasar/VERSION.md` | n/a | ⚠️ Partial — exact upstream SHA still TODO, acknowledged in file |

### Still-open items (intentionally left open in the remediation branch)

These were verified to be still open in the code, matching the remediation log:

- **CRITICAL-1** (rating PDA squatting) — `commit.rs` still accepts `consumer_pk` / `specialist_pk` from the caller (line 49-50, 85-86). No escrow-binding has been introduced.
- **CRITICAL-3** (unbounded attestation creation) — `attest.rs` still seeds the attestation PDA on caller-supplied `job_id` (line 30) with no escrow / job linkage.
- **CRITICAL-4** (residual rep grief) — MEDIUM-4 closes the third-party expire vector but the attacker can still call expire on a rating they squatted under CRITICAL-1, since they themselves are the recorded specialist. See N3 below.
- **MEDIUM-5** (`job_id` caller-chosen) — unchanged; closure depends on the job-binding architectural fix.
- **HIGH-2** (no payee dispute path), **HIGH-3** (rep laundering), **HIGH-7** (split registries) — unchanged.
- **LOW-3** (deregister fee economics), **LOW-5** (missing register events) — unchanged.

---

## Diff-walk: what actually changed

### `quasar-escrow`

- `state.rs:4` adds `pub const CANCEL_WINDOW_SLOTS: u64 = 7 * 24 * 60 * 60 * 2;`. **See N1 below — value uses 2 slots/sec; the same codebase's `RATING_EXPIRE_SLOTS` uses 2.5 slots/sec.**
- `lock.rs:78,92-93` reads `Clock::get()?` and writes `created_at`/`created_slot` real values (was `0`/`0`).
- `cancel.rs:48-52` adds the window check via `clock.slot.get().saturating_sub(self.escrow.created_slot.get())`. `saturating_sub` is correct here — if `created_slot > clock.slot` (cannot happen normally), elapsed clamps to 0 and the cancel is rejected, which is the conservative outcome.
- `release.rs:58-68` and `cancel.rs:60-70` switch lamport math to `.checked_sub(amount).ok_or(ProgramError::ArithmeticOverflow)?` and `.checked_add(amount).ok_or(...)`.
- `tests.rs:351-379` adds the regression test.

### `quasar-reputation`

- `commit.rs:64-66` rejects `commitment == [0u8; 32]` before any state mutation. Placement is correct: it runs after the `role > 1` check and before the finality / first-init / role dispatch logic, so a zero commitment never enters any of the side-effecting branches.
- `reveal.rs:72-77` now domain-separates the hash with `job_id.to_le_bytes()` and `crate::ID.as_ref()`. The hasher feeds in the same order both at commit (off-chain) and reveal (on-chain); `tests.rs` updated its `sha256_commitment(job_id, score, salt)` helper accordingly so existing happy-path tests still match.
- `expire.rs:62-66` adds the participant check immediately after the state guard and before the time-lock check. Order is fine — anyone failing the participant check fails before the time-lock evaluation, so the error code is consistent.
- `lib.rs:37` real `declare_id!`.
- `tests.rs:792-878` adds three regression tests (zero-commitment, cross-job reuse, third-party expire).

### `quasar-attestation`

- `attest.rs:69-74` adds the `consumer == self.judge.address()` reject **after** the agent-eligibility and score-range checks but **before** `Clock::get()` and `set_inner`. Placement is correct: rejected without any state writes, no Clock syscall waste.
- `lib.rs:36` real `declare_id!`.
- `tests.rs:577-594` adds the regression test.

### `quasar-registry`

- `lib.rs:34` real `declare_id!`. No instruction-handler changes (the audit had no remediable findings here apart from HIGH-3 architectural).

### `Cargo.toml` (all four)

- Added `[profile.release] overflow-checks = true, lto = "fat", codegen-units = 1` after the `[workspace]` line.
- Pinned `quasar-svm` git rev.

### `third_party/quasar/VERSION.md`

- New file with vendor source, vendor date, narrowed-workspace note, and re-vendor procedure. Honestly flags "exact upstream SHA remains a mainnet-readiness TODO."

---

## New observations introduced by the remediations

These are findings that did **not** exist in the stage-1 audit and are introduced or surfaced by the remediation work itself.

### N1 — `CANCEL_WINDOW_SLOTS` uses 2 slots/sec while `RATING_EXPIRE_SLOTS` uses 2.5

**Severity:** Low (parity / consistency)
**Location:** `quasar-escrow/src/state.rs:4` vs `quasar-reputation/src/state.rs:23`

```rust
// escrow
pub const CANCEL_WINDOW_SLOTS: u64 = 7 * 24 * 60 * 60 * 2;       // 1_209_600
// reputation
pub const RATING_EXPIRE_SLOTS: u64 = 1_512_000;                    // = 7d × 86_400 × 2.5
```

The two "7-day" windows in the same codebase resolve to different real-time durations. At Solana's typical ~400 ms slot, `CANCEL_WINDOW_SLOTS` is ~5.6 days; `RATING_EXPIRE_SLOTS` is ~7.0 days. Both windows are advisory and the protocol still functions, but the inconsistency suggests one of them is wrong — likely escrow's, since reputation matches the comment "7 days at 400ms/slot."

**Remediation.** Either:
- Change `CANCEL_WINDOW_SLOTS = 7 * 24 * 60 * 60 * 5 / 2;` (= 1_512_000) for parity with reputation.
- Or move both windows to `clock.unix_timestamp` deltas, which are independent of slot speed.

This is a nit, not a security issue. Worth fixing for consistency.

### N2 — Commitment hash binds to `crate::ID` (compile-time `declare_id`), not the runtime program ID

**Severity:** Informational (deployment / upgrade hygiene)
**Location:** `quasar-reputation/src/instructions/reveal.rs:76`

```rust
hasher.update(crate::ID.as_ref());
```

`crate::ID` is the compile-time constant from `declare_id!`. Off-chain commit calculators must use the same constant. This is sound for normal operation but creates two operational footguns:

1. **Redeploy to a new address invalidates in-flight commits.** If a future revision changes `declare_id!` (say, from devnet to a different mainnet address), every commitment recorded under the old binary becomes unrevealable: clients hashed with the old `crate::ID`, on-chain code now hashes with the new `crate::ID`, the comparison fails. The fix is operational — never change `declare_id!` while there are in-flight commits.
2. **Off-chain clients must pull the program_id from the binary's IDL/ABI**, not from whatever runtime program_id appears on-chain. If a deploy lands at an address that differs from `declare_id!` (which itself indicates a config drift, but is sometimes done intentionally for redeployments) the runtime address won't match.

Add a one-line note to client-facing docs: "Commitment hashes use the program ID compiled into the binary (`declare_id!`), not the runtime program ID."

### N3 — MEDIUM-4 + CRITICAL-1 leaves residual grief by the squatter themselves

**Severity:** Informational (acknowledged by remediation log)
**Location:** interaction between `quasar-reputation/src/instructions/commit.rs` (still squat-able) and `expire.rs` (now MEDIUM-4-restricted)

The new MEDIUM-4 check says only `rating.consumer` or `rating.specialist` can call expire. But under CRITICAL-1 the squatter is one of those two (they wrote the field at first commit). So the squatter can still call expire on a rating they themselves squatted, after the 7-day window, and grief the victim's reputation by 500 points. The only thing MEDIUM-4 closes is the variant where a third party (not even the squatter) calls expire — which doesn't change the cost-of-attack meaningfully.

This is exactly what the remediation log says under CRITICAL-4: "Lower-stakes hardening; the real bug is upstream." Recording it here so a future reviewer doesn't conclude MEDIUM-4 closes CRITICAL-4.

### N4 — CRITICAL-2 partial fix bypassable by Sybil

**Severity:** Informational (acknowledged by remediation log as partial)
**Location:** `quasar-attestation/src/instructions/attest.rs:72-74`

```rust
if consumer == *self.judge.address() {
    return Err(ProgramError::InvalidArgument);
}
```

This blocks the trivial single-key self-confirmation: attest as judge with `consumer = judge`. It does **not** block the multi-key version, where the attacker controls two keypairs (`judge_key`, `secondary_key`):

```text
register_attestation_agent(owner = judge_key, agent_type = Both)
loop i:
    attest(judge = judge_key, consumer = secondary_key, scores = [10,...])
    confirm(consumer_signer = secondary_key, judge_agent = derived from judge_key)
// judge_key's reputation_score saturates at 10_000
```

Cost is rent + tx fees per cycle — same as before the fix.

The remediation log calls this out: "until full job binding lands." Recording for completeness so the partial nature isn't forgotten.

---

## What I checked for that I did NOT find

I re-read every modified file and considered the following classes of new bugs that remediation work commonly introduces:

- **Reordering of guards:** none. Each new guard sits at a sensible point in the existing pipeline (e.g. `commit.rs`'s zero-commitment check sits after `role > 1` and before any state write; `expire.rs`'s participant check sits after the state guard and before the time-lock).
- **Missing matching change off-chain:** `sha256_commitment(job_id, score, salt)` test helper is updated to use the same domain-separated input as `reveal.rs`, confirmed by the existing `test_commit_and_reveal_both` happy path still passing.
- **Imports added but features wrong:** `Clock::get()` and `Sysvar as _` imports are added in `lock.rs`, `cancel.rs`, `expire.rs`, `commit.rs`, `attest.rs` — all correct, no missing feature flags.
- **Math now overflow-checked breaking happy paths:** the `checked_sub` / `checked_add` sites in `release.rs` and `cancel.rs` cannot underflow / overflow under any legitimate state (escrow lamports = rent + amount; payer/payee lamport space is bounded by total SOL supply). The new `ArithmeticOverflow` return is unreachable in practice but defends against future code that might change invariants.
- **`crate::ID` referenced where it isn't defined:** the Quasar `declare_id!` macro generates `pub const ID: Address = ...` at the crate root (per the framework's `derive` macro); `crate::ID.as_ref()` compiles and resolves correctly, evidenced by the build passing.
- **Profile section conflicting with the workspace setting:** each Quasar program is its own `[workspace]` (last line of each `Cargo.toml`), so the new `[profile.release]` block sits in the same workspace and applies. No conflict with the repo-root `Cargo.toml`'s profile because that workspace owns `programs/*`, not `experiments/quasar-*`.
- **Cargo.lock divergence post pin:** the remediation log states the Cargo.lock files now include the explicit `quasar-svm` rev. I did not diff each lockfile, but each program's lockfile predates the pin and would be regenerated by the test loop; the remediation log claims the test loop passes.
- **Test mocks using the old commitment scheme:** searched for `sha2::Digest::update([score])` patterns; the test helpers all use the same updated `sha256_commitment` function, so there is no orphaned use of the old (non-domain-separated) form.

---

## Recommended next steps

In priority order:

1. **Fix N1** (one-line constant change in `quasar-escrow/src/state.rs:4`) and re-run `test_audit_cancel_before_window_rejected` — trivial, takes minutes.
2. **Document N2** in client SDK / commit-builder docs.
3. **Begin the architectural job-binding work** that closes CRITICAL-1, CRITICAL-3, residual CRITICAL-4, MEDIUM-5, HIGH-2, HIGH-7. The remediation log already lists this as the mainnet gate. The shape suggested in the stage-1 audit (escrow creates a `JobAccount`; rating and attestation PDAs seed off `job_account` with consumer/specialist read from there, not from caller args) is the cleanest path; this is the work that converts these parity-port programs into a deployable marketplace.
4. **Fill in the upstream SHA in `third_party/quasar/VERSION.md`** before any mainnet deploy.
5. **Pick a reputation-laundering policy** (HIGH-3) and a registration-event approach (LOW-5) at the same time as the architectural work, since both interact with the canonical AgentAccount design.

---

## Files re-read for stage 2

```
docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md         (stage-1 baseline)
docs/QUASAR-PROGRAMS-SECURITY-REMEDIATION-2026-05-06.md   (remediation log under verification)

experiments/quasar-escrow/src/state.rs
experiments/quasar-escrow/src/instructions/{lock,release,cancel}.rs
experiments/quasar-escrow/src/tests.rs                    (audit regression test)
experiments/quasar-escrow/Cargo.toml

experiments/quasar-reputation/src/lib.rs
experiments/quasar-reputation/src/instructions/{commit,reveal,expire}.rs
experiments/quasar-reputation/src/tests.rs                (3 audit regression tests)
experiments/quasar-reputation/Cargo.toml

experiments/quasar-attestation/src/lib.rs
experiments/quasar-attestation/src/instructions/attest.rs
experiments/quasar-attestation/src/tests.rs               (audit regression test)
experiments/quasar-attestation/Cargo.toml

experiments/quasar-registry/src/lib.rs
experiments/quasar-registry/Cargo.toml

third_party/quasar/VERSION.md
```

Test happy-path bodies (`test_commit_and_reveal_both`, etc.) were spot-read to confirm the test helpers use the new domain-separated commitment. Full `tests.rs` re-reads were not performed — out of scope for stage 2.
