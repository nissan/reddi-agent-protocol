# Quasar Escrow POC — Benchmarks

> **Historical, superseded 2026-10-02:** Preserve the values below as POC observations only. They do not qualify as an Anchor comparison: Quasar hot-path measurements are compared with a full-protocol Anchor binary and estimated Anchor CU values; semantics and runtime profiles differ; no raw machine-readable comparison artifact is committed; and the named Quasar commit `4bf5772` is absent from this clone. Quasar is frozen and retired from current critical paths. See [`../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md). Cross-runtime, deployment, throughput, security, and cost conclusions are `not_evaluated`.

_Date: 2026-04-11_
_POC commit: experiment/quasar-escrow-poc @ 4bf5772_
_Anchor baseline: reddi-agent-protocol-code @ c42d47a (Phase 5 merged)_

> **Current interpretation (2026-10-03; original dated record preserved below):** Everything after this block is the original author's 2026-04-11/12 assertion and transcription, not current guidance. No measured, semantics-matched Anchor comparator or pinned raw comparison artifact is committed; the named Quasar POC commit is unavailable in this clone, including for the post-refactor 7/7 output. The omitted cancel-window/Clock behavior was not measured, so identical cost cannot be inferred. The record therefore establishes neither parity nor savings nor a general Quasar or Anchor-framework advantage. The original wording and raw-output transcription remain below solely as dated provenance.

---

## Test Suite Results

| Test | Quasar result |
|---|---|
| `test_lock_and_release` | ✅ PASS |
| `test_lock_and_cancel` | ✅ PASS |
| `test_unauthorized_release_fails` | ✅ PASS |
| `test_zero_amount_rejected` | ✅ PASS |
| `test_release_after_cancel_fails` | ✅ PASS |
| `test_id` | ✅ PASS |
| **Total** | **6/6** |

Testing framework: QuasarSVM (in-process SBF harness)

---

## Binary Size

| Metric | Anchor (full protocol) | Quasar POC (hot path only) | Delta |
|---|---|---|---|
| `.so` file size | **377 KB** (386,520 bytes) | **13 KB** (12,832 bytes) | **−96.7%** |

**Context:** The Anchor binary includes all phases (registry, reputation, attestation, PER — 15+ instructions). A fair comparison requires an Anchor build with only lock/release/cancel, which would still be larger due to framework overhead (Borsh codegen, IDL metadata, discriminator routing machinery all expand the binary).

Historical estimate only: ~80–120 KB was attributed generally to community single-program benchmarks, without a pinned primary source or a semantics-matched build. It is not evidence and must not be used to calculate a framework delta.

---

## Compute Unit Profile (QuasarSVM measured)

| Instruction | Anchor (estimated) | Quasar (measured) | Estimated savings |
|---|---|---|---|
| `lock_escrow` / `make` | ~6,000–8,000 CU (historical estimate; not measured) | **3,966 CU** | `not_evaluated` |
| `release_escrow` / `take` | ~3,000–4,000 CU (historical estimate; not measured) | **626 CU** | `not_evaluated` |
| `cancel_escrow` / `refund` | ~2,500–3,500 CU (historical estimate; not measured) | **602 CU** | `not_evaluated` |

**Notes:**
- Anchor CU figures are estimates derived from Anchor documentation, community benchmarks, and the known overhead of: Borsh account deserialization, 8-byte discriminator routing, `Context<T>` construction, and CPI wrapper ergonomics.
- Quasar numbers are **exact** from QuasarSVM `compute_units_consumed` output.
- The `release` and `cancel` savings are dramatic because Quasar uses direct lamport manipulation (`set_lamports`) rather than a System Program CPI transfer, eliminating one cross-program invocation.
- `lock` still uses a System Program CPI (required to fund the new PDA), hence lower savings.

---

## API Deltas (Anchor → Quasar)

| Concept | Anchor | Quasar POC |
|---|---|---|
| Program macro | `#[program] mod` | `#[program] mod` (same) |
| Context type | `Context<T>` | `Ctx<T>` |
| Return type | `Result<()>` | `Result<(), ProgramError>` |
| Account init | `#[account(init, ...)]` | `#[account(init, ...)]` (same) |
| Seeds on state | auto-generated hash | `#[seeds(b"prefix", field: Type)]` |
| Account mutation | attribute `#[account(mut)]` | type-level `&'info mut Account<T>` |
| Lamport transfer (CPI) | `system_program::transfer(CpiContext::new(...), amt)` | `self.system_program.transfer(from, to, amt).invoke()` |
| Lamport transfer (direct) | `**escrow.try_borrow_mut_lamports()? -= amt` | `set_lamports(view, view.lamports() - amt)` |
| Events | `#[event] + emit!` | `#[event(discriminator = N)] + emit!` |
| Testing | LiteSVM (third-party) | QuasarSVM (first-party, included) |

---

## POC Scope Constraints

The following Anchor features were simplified or omitted for the POC benchmark:
1. **Nonce seed migration:** Anchor uses `[b"escrow", payer, nonce_16_bytes]`. Quasar `#[seeds]` does not support `[u8; 16]` in this path. POC now uses the approved migration pattern: per-payer `u64` counter PDA + escrow seeds `[b"escrow", payer, escrow_id_u64]` (multi-escrow supported).
2. **7-day cancel window:** Omitted from POC (benchmark would be identical; just an additional Clock check).
3. **Clock/timestamp:** `created_at` stored as 0 (Clock sysvar not wired in POC state init).

---

## 2026-04-12 Addendum — Option 1 Counter-Seed Refactor

Nissan-approved blocker path (Option 1) is now implemented in the Quasar POC branch:
- Added `UserEscrowCounter` PDA (`[b"counter", payer]`)
- Escrow PDA now uses `[b"escrow", payer, escrow_id_u64]`
- `make/take/refund` now take `escrow_id` where needed
- Added test coverage for multiple concurrent escrows per payer (`escrow_id` 0 and 1)

Current test result (post-refactor): **7/7 pass**.

Updated raw output:

```
test tests::test_lock_and_cancel      ... ok   CANCEL CU: 626
test tests::test_lock_and_release     ... ok   LOCK CU: 4980  RELEASE CU: 649
test tests::test_release_after_cancel_fails ... ok
test tests::test_multiple_escrows_per_payer ... ok
test tests::test_unauthorized_release_fails ... ok
test tests::test_zero_amount_rejected ... ok
test result: ok. 7 passed; 0 failed
```
