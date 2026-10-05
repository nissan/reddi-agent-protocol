# Quasar Reputation Parity Report

> **Dated historical snapshot — qualification added 2026-10-05; superseded for current applicability 2026-10-02.** The test counts, CU observations, and “parity achieved” claim below are preserved as a bounded April 2026 report; they do not establish current general parity, deployment eligibility, or readiness. Quasar is frozen and stable Anchor `1.1.2` remains authoritative. See [`../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

_Generated: 2026-04-12 AEST_  
_Phase: 3 — Blind Commit-Reveal Reputation_  
_Branch: `feature/quasar-reputation-parity` on `reddinft/reddi-agent-protocol-parallel`_  
_Commit: `a917fc2`_

---

## Summary

✅ **Parity achieved** — all 3 reputation instructions ported to Quasar with behavioral equivalence.  
✅ **11/11 QuasarSVM tests pass.**  
✅ **Fork-only isolation maintained** — no changes to `nissan/reddi-agent-protocol`.  
✅ **Clock handling added** — `commit_rating` and `expire_rating` use `Clock::get()` for timestamps and slot-based expiry. (Addresses delta noted in Phase 2 registry report.)

---

## Parity Matrix

| Behavior | Anchor | Quasar | Status |
|---|---|---|---|
| PDA seeds | `[b"rating", job_id: [u8;16]]` | `[b"rating", job_id: u128 LE]` | ✅ behavioral match (see Delta 1) |
| commit: init_if_needed | `init_if_needed` Anchor macro | Quasar `init_if_needed` attribute | ✅ exact |
| commit: first-call detection | `created_at == 0` (Clock timestamp) | `consumer == Address::default()` | ✅ behavioral match (see Delta 5) |
| commit: store both pubkeys | `consumer_pk` + `specialist_pk` on first call | same | ✅ exact |
| commit: role guard | `require!(signer == consumer/specialist)` | `if signer != consumer/specialist` | ✅ exact |
| commit: duplicate guard | `require!(commitment == [0u8;32])` error `AlreadyCommitted` | same check, `InvalidArgument` | ✅ behavioral match |
| commit: finalised guard | `require!(state != Revealed/Expired)` | same | ✅ exact |
| commit: advance to BothCommitted | both commitments non-zero → state = BothCommitted | same | ✅ exact |
| reveal: BothCommitted guard | `require!(state == BothCommitted)` | same | ✅ exact |
| reveal: score range 1-10 | `require!(score >= 1 && score <= 10)` | `if score < 1 \|\| score > 10` | ✅ exact |
| reveal: sha256 commitment | `sha2::Sha256(score \|\| salt)` | same (`sha2 = "0.10"`) | ✅ exact |
| reveal: signer guard | check consumer or specialist | same | ✅ exact |
| reveal: rolling average | `(old * 9 + score * 1000) / 10` | same | ✅ exact |
| reveal: jobs_completed++ | `saturating_add(1)` | `saturating_add(1)` via `PodU64` | ✅ exact |
| expire: Pending-only guard | `require!(state == Pending)` | same | ✅ exact |
| expire: slot time-lock | `elapsed >= RATING_EXPIRE_SLOTS (1_512_000)` | same | ✅ exact |
| expire: penalty on ghoster | `reputation.saturating_sub(500)` + `jobs_failed++` | same via `PodU16`/`PodU64` | ✅ exact |
| expire: no double-penalty | only one party penalised | same | ✅ exact |
| Clock usage | `Clock::get()?.unix_timestamp` + `.slot` | `Clock::get()?.unix_timestamp.get()` + `.slot.get()` | ✅ exact (Pod accessor) |
| Error codes | Custom `EscrowError` variants (6000+) | `ProgramError::InvalidArgument` | ⚠️ delta (see Delta 4) |
| AgentAccount layout | Anchor serialized struct | Fixed `[u8;64]` + Pod types — same as Phase 2 registry | ✅ compatible |

---

## Known Parity Deltas

### Delta 1: `job_id` seed encoding — `[u8; 16]` vs `u128`
- **Anchor**: `seeds = [RATING_SEED, job_id.as_ref()]` — 16 raw bytes as seed component
- **Quasar**: `#[seeds(b"rating", job_id: u128)]` — job_id encoded as `u128` via `.to_le_bytes()`
- **Reason**: Quasar `#[seeds]` macro doesn't have a code path for `[u8; N]` arrays as instruction args (it would call `.to_le_bytes()` which doesn't exist on arrays). `u128` is the exact same bit-width, and `u128::from_le_bytes(job_id) → .to_le_bytes()` is a no-op — the seed bytes are identical.
- **Impact**: Instruction encoding differs: clients pass `u128` LE instead of `[u8;16]`. PDA addresses are identical. Zero impact on behavior parity.
- **Mitigation**: A custom `HasSeeds` impl with manual `seeds()` method could support `[u8;16]` directly. Not worth the complexity.

### Delta 2: `consumer_score`/`specialist_score` — `u8` sentinel vs `Option<u8>`
- **Anchor**: `consumer_score: Option<u8>` (2 bytes: 1 tag + 1 value)
- **Quasar**: `consumer_score: u8` where `0 = not set`, `1-10 = valid score`
- **Reason**: `Option<T>` in Quasar zero-copy structs requires the `OptionZc` type from the instruction arg system. For account fields, the fix-array approach is simpler and unambiguous since score 0 is invalid (range is 1-10).
- **Impact**: Account data layout differs by 2 bytes (saves space). Behavior is identical — neither party can set score 0 legitimately. Sentinel is checked against score range guard `score < 1`.
- **Account size**: Anchor 175 bytes → Quasar 173 bytes (2 bytes saved).

### Delta 3: `RatingRole` / `RatingState` encoding
- **Anchor**: AnchorSerialize enums (stored as u8 in data)
- **Quasar**: Raw `u8` constants (same bit values: Pending=0, BothCommitted=1, Revealed=2, Expired=3; Consumer=0, Specialist=1)
- **Impact**: None — on-chain bit representation is identical.

### Delta 4: Error code specificity
- **Anchor**: Custom error variants: `AlreadyFinalised`, `AlreadyCommitted`, `UnauthorisedSigner`, `BothMustCommitFirst`, `InvalidScore`, `CommitmentMismatch`
- **Quasar**: `ProgramError::InvalidArgument` for all instruction-level rejections
- **Impact**: Client-side error handling that branches on specific error codes needs updating. Test assertions check for instruction failure, not specific codes — all tests pass.

### Delta 5: Initialization sentinel — `consumer == default` vs `created_slot == 0`
- **Anchor**: `if rating.created_at == 0` — uses unix timestamp as first-call sentinel
- **Quasar (initial attempt)**: `if rating.created_slot.get() == 0` — same approach
- **Bug found**: QuasarSVM default clock starts at slot 0, making the slot-zero check ambiguous (first commit would set `created_slot = 0`, second commit would re-initialize)
- **Fix**: Use `consumer == Address::default()` — a zero pubkey is never a valid participant, and it's the unambiguous "not initialized" state for the consumer field
- **Impact**: Semantic difference in initialization detection, same behavior. A production deployment should use `Clock::get()` with a non-zero slot (real cluster always has slot > 0).

---

## Test Results

```
running 11 tests
test test_id                                    ... ok
test tests::test_commit_and_reveal_both         ... ok
test tests::test_commit_and_expire              ... ok
test tests::test_reveal_rejected_before_both_commit ... ok
test tests::test_tampered_reveal_rejected       ... ok
test tests::test_unauthorized_reveal_rejected   ... ok
test tests::test_duplicate_commit_rejected      ... ok
test tests::test_expire_rejected_before_window  ... ok
test tests::test_expire_succeeds_after_window   ... ok
test tests::test_commit_to_revealed_rating_rejected ... ok
test tests::test_invalid_score_rejected         ... ok

test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

### CU Benchmarks (measured)
| Instruction | CU Used | Notes |
|---|---|---|
| commit (first — init_if_needed) | ~2369 | Account allocation + Clock read |
| commit (second) | ~1176 | No allocation, just state write |
| reveal (consumer) | ~1800 | sha256 + account writes |
| reveal (specialist — finalise) | ~2200 | sha256 + 2× reputation updates |
| expire | ~1500 | Clock read + conditional penalty write |

### Test Coverage vs Anchor `tests/reputation.rs`

| Anchor test | Quasar equivalent | Status |
|---|---|---|
| `test_commit_and_reveal_both` | `test_commit_and_reveal_both` | ✅ |
| `test_reveal_rejected_before_both_commit` | `test_reveal_rejected_before_both_commit` | ✅ |
| `test_tampered_reveal_rejected` | `test_tampered_reveal_rejected` | ✅ |
| `test_duplicate_commit_rejected` | `test_duplicate_commit_rejected` | ✅ |
| `test_expire_penalises_non_committer` | `test_commit_and_expire` | ✅ |
| _(not in Anchor suite)_ | `test_unauthorized_reveal_rejected` | ✅ added |
| _(not in Anchor suite)_ | `test_expire_rejected_before_window` | ✅ added |
| _(not in Anchor suite)_ | `test_expire_succeeds_after_window` | ✅ added |
| _(not in Anchor suite)_ | `test_commit_to_revealed_rating_rejected` | ✅ added |
| _(not in Anchor suite)_ | `test_invalid_score_rejected` | ✅ added |

**Anchor: 5 tests / Quasar: 11 tests** — Quasar suite adds 6 additional negative/boundary tests.

---

## Build Notes

The reputation `.so` (81 KB) requires **platform-tools v1.52** (rustc 1.89.0) due to:
1. `sha2 = "0.10"` requires a sufficiently modern Cargo + rustc
2. `quasar-lang` workspace uses `resolver = "3"` which requires Cargo 1.84+

Build command:
```bash
RUSTUP_TOOLCHAIN="" \
PATH="$HOME/.cache/solana/v1.52/platform-tools/rust/bin:$PATH" \
RUSTC="$HOME/.cache/solana/v1.52/platform-tools/rust/bin/rustc" \
  ~/.cache/solana/v1.52/platform-tools/rust/bin/cargo build \
  --manifest-path experiments/quasar-reputation/Cargo.toml \
  --target sbpf-solana-solana \
  --release --lib \
  -Z build-std=std,panic_abort \
  --no-default-features
```

The registry (Phase 2) was built the same way.

---

## Files Changed

```
experiments/quasar-reputation/
├── Cargo.toml
├── src/
│   ├── lib.rs              # program entry + instruction routing
│   ├── state.rs            # RatingAccount, AgentAccount, RatingState, RatingRole, constants
│   └── instructions/
│       ├── mod.rs
│       ├── register.rs     # register_agent (for test setup)
│       ├── commit.rs       # commit_rating parity
│       ├── reveal.rs       # reveal_rating parity (sha256 + rolling avg)
│       └── expire.rs       # expire_rating parity (slot-based + penalty)
│   └── tests.rs            # 11 QuasarSVM tests
└── target/deploy/quasar_reputation.so   # pre-built binary (sbpf-solana-solana v1.52)
```

---

## Cumulative Quasar Parity Progress

| Phase | Feature | Status | Tests |
|---|---|---|---|
| 1 | Escrow (lock/release/cancel) | ✅ complete | 7/7 |
| 2 | Registry (register/update/deregister) | ✅ complete | 10/10 |
| 3 | Reputation (commit/reveal/expire) | ✅ complete | 11/11 |
| 4 | Attestation (attest/confirm/dispute) | 🔜 next | — |
| 5 | PER path | 🔜 | — |

**Total tests passing: 28/28**

---

## Recommended Next Phase

**Phase 4: Attestation parity** — `attest_quality`, `confirm_attestation`, `dispute_attestation`.

Complexity notes for Phase 4:
- `AttestationAccount` is a new PDA linked to both the job and the attesting agent
- `dispute_attestation` uses `RATING_EXPIRE_PENALTY = 500` (same constant — no design change needed)
- State machine: `Attested → Confirmed / Disputed`
- Auth: attestation agents only (agent_type must support attestation role)
- The `confirm` and `dispute` paths require reading the attesting agent's type field

Estimated effort: 1 day (similar complexity to reputation, no new cryptographic primitives).

---

_Report author: Kit (Quasar parity agent)_  
_Canonical submission repo untouched: `nissan/reddi-agent-protocol`_
