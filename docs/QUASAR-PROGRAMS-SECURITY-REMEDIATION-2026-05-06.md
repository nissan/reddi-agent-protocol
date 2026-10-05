# Quasar Programs — Security Audit Remediation Log

> **Dated remediation record — qualification added 2026-10-05; superseded for current applicability 2026-10-02.** The fixed/open matrices and conclusions below are preserved unchanged as 2026-05-06 source history; they do not establish present closure, a current audit, deployment authority, or readiness. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

_Date:_ 2026-05-06 AEST  
_Source audit:_ `docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`

## Status

This branch applies the safe immediate hardening items and explicitly keeps the architectural job-binding findings open until we implement a canonical job/escrow binding design.

## Fixed in this pass

- **HIGH-1 / LOW-1:** restored Quasar escrow `created_at` / `created_slot` from `Clock::get()` and reintroduced the seven-day payer cancel window.
- **LOW-4:** changed escrow release/cancel lamport movement to checked arithmetic.
- **HIGH-4:** added release overflow checks, LTO, and single codegen unit profiles to every standalone Quasar program workspace.
- **HIGH-5:** replaced placeholder Quasar registry/reputation/attestation `declare_id!` values with the canonical devnet IDs tracked in project status.
- **HIGH-6:** pinned `quasar-svm` dev dependency to lockfile commit `cf3c06a08a9009631d42d7942a574da1eac6104d`.
- **MEDIUM-1:** reject all-zero reputation commitments.
- **MEDIUM-2:** domain-separate reputation commitments with `score || salt || job_id || program_id`.
- **MEDIUM-4:** restrict reputation expiry to the recorded consumer or specialist.
- **CRITICAL-2 defense-in-depth:** reject attestation where `consumer == judge`, blocking trivial self-confirmation loops while full job binding remains open.
- **MEDIUM-6 partial:** added `third_party/quasar/VERSION.md` with vendor/audit/re-vendor notes. Exact upstream SHA remains a mainnet-readiness TODO.


## Regression proof matrix

| Audit item | Remediation | Proof added |
|---|---|---|
| HIGH-1 — escrow cancel has no time-window guard | `lock` now records `Clock::get()` slot/time; `cancel` rejects before `CANCEL_WINDOW_SLOTS` | `experiments/quasar-escrow/src/tests.rs::test_audit_cancel_before_window_rejected`; existing cancel happy path now warps past the window |
| LOW-4 — unchecked lamport arithmetic | `release` and `cancel` use `checked_sub` / `checked_add` and return `ProgramError::ArithmeticOverflow` on impossible overflow/underflow | Covered by escrow compile/tests plus `git diff --check`; arithmetic sites are now mechanically checked |
| HIGH-4 — standalone workspaces missed overflow checks | Added `[profile.release] overflow-checks = true`, `lto = "fat"`, `codegen-units = 1` to all four Quasar program workspaces | `scripts/run-quasar-program-tests.sh` rebuilds every program workspace with these manifests |
| HIGH-5 — placeholder program IDs | Replaced registry/reputation/attestation `declare_id!` placeholders with canonical tracked devnet IDs | Quasar compile/test loop loads programs with the new IDs; readiness guard remains green |
| HIGH-6 — unpinned `quasar-svm` | Pinned `quasar-svm` git dependency to `cf3c06a08a9009631d42d7942a574da1eac6104d` | Cargo.lock source now includes the explicit rev; full Quasar test loop passed from pinned dependency |
| MEDIUM-1 — zero commitment sentinel footgun | `commit` rejects `[0u8; 32]` commitments | `experiments/quasar-reputation/src/tests.rs::test_audit_zero_commitment_rejected` |
| MEDIUM-2 — commitment lacks domain separation | Commitment hash now includes `score || salt || job_id || program_id`; tests updated to generate domain-separated commitments | `experiments/quasar-reputation/src/tests.rs::test_audit_cross_job_commitment_reuse_rejected` plus all existing reveal tests passing |
| MEDIUM-4 — `expire` callable by anyone | `expire` now requires caller to match recorded consumer or specialist | `experiments/quasar-reputation/src/tests.rs::test_audit_expire_third_party_rejected` |
| CRITICAL-2 defense-in-depth — judge self-confirmation | `attest` rejects `consumer == judge` until full job binding lands | `experiments/quasar-attestation/src/tests.rs::test_audit_self_confirmation_attest_rejected` |
| MEDIUM-6 — vendored framework provenance undocumented | Added `third_party/quasar/VERSION.md` with vendoring notes and re-vendor procedure | Documentation artifact committed; exact upstream SHA remains an explicit mainnet TODO |

## Validation command transcript

Latest local validation after remediation and regression tests:

```bash
PATH="$HOME/.cargo/bin:$PATH" bash scripts/run-quasar-program-tests.sh
# PASS: escrow 8/8, registry 10/10, reputation 14/14, attestation 14/14

npm run check:quasar:critical-success
# PASS

npm run test:bdd:index
# PASS

git diff --check
# PASS
```

## Still open / requires design work

- **CRITICAL-1 / CRITICAL-3 / CRITICAL-4 / MEDIUM-5:** rating and attestation PDAs are still keyed by caller-chosen `job_id`; full fix requires a canonical `JobAccount` or escrow-derived seed material.
- **HIGH-2:** payee dispute/claim path requires the same trustworthy job/attestation binding.
- **HIGH-3:** reputation laundering policy is still undecided; options are tombstone history PDA, cooldown, or stake burn.
- **HIGH-7:** three independent agent registries remain a benchmarking/deployment-shape risk; mainnet design should use a canonical registry or merge the programs.
- **LOW-3 / LOW-5:** user-facing fee economics and registration event consistency remain documentation/observability work.

## Mainnet gate

Do not present these Quasar programs as mainnet-ready until the open architectural items above are closed and independently re-reviewed.

## Follow-up audit observations

A follow-up review after the first remediation pass raised four minor/clarifying observations. Status:

- **N1 (Low) — fixed:** `CANCEL_WINDOW_SLOTS` originally used `7×24×3600×2`, assuming 2 slots/sec. The reputation code uses `1_512_000` slots for ~7 days at 2.5 slots/sec. Escrow now uses `1_512_000` too, keeping cancel and rating-expiry windows aligned.
- **N2 (Informational) — documented:** reputation commitments bind to `crate::ID` / compile-time `declare_id!`. Changing a program ID invalidates in-flight commits; clients/operators must drain or settle open ratings before a program-ID migration and must compute commitments against the exact target program ID.
- **N3 (Informational) — confirmed:** participant-only `expire` is defense-in-depth. It does not fully close CRITICAL-4 unless job/rating PDA binding is also implemented.
- **N4 (Informational) — confirmed:** rejecting `consumer == judge` blocks the trivial self-confirmation loop, but it is still a partial defense-in-depth mitigation. Full CRITICAL-2 closure requires binding attestations to a real job/escrow account and deriving the consumer from that binding.
