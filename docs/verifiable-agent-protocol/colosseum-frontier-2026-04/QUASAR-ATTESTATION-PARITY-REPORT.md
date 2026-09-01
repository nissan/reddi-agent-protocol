# Quasar Attestation Parity Report

_Generated: 2026-04-12 AEST_  
_Phase: 4 — Attestation Judges_  
_Branch: `feature/quasar-attestation-parity` on `reddinft/reddi-agent-protocol-parallel`_  
_Commit: `bba6c82`_

---

## Summary

✅ **Parity achieved** — all 3 attestation instructions ported to Quasar with behavioral equivalence.  
✅ **13/13 QuasarSVM tests pass** (5 Anchor-parity + 8 additional state invariant tests).  
✅ **Fork-only isolation maintained** — no changes to `nissan/reddi-agent-protocol`.  
✅ **Clock handling** — `attest_quality` uses `Clock::get()` for `created_at` timestamp.

---

## Parity Matrix

| Behavior | Anchor | Quasar | Status |
|---|---|---|---|
| PDA seeds (attestation) | `[b"attestation", job_id: [u8;16]]` | `[b"attestation", job_id: u128 LE]` | ✅ behavioral match (see Delta 1) |
| PDA seeds (agent) | `[b"agent", owner]` | `[b"agent", owner]` | ✅ exact |
| attest: init dedup | `init` constraint (one-per-job) | `init` constraint | ✅ exact |
| attest: agent_type guard | `require!(Attestation \|\| Both)` → `NotAttestationAgent` | `if !is_attestation_eligible()` → `InvalidArgument` | ✅ behavioral match |
| attest: score range 1-10 | `require!((1..=10).contains(&s))` → `AttestationScoreOutOfRange` | `if !(1..=10).contains(&s)` → `InvalidArgument` | ✅ behavioral match |
| attest: confirmed init | `confirmed = None` | `confirmed = 0` (Pending sentinel) | ✅ behavioral match (see Delta 2) |
| attest: created_at | `Clock::get()?.unix_timestamp` | `Clock::get()?.unix_timestamp.get()` | ✅ exact (Pod accessor) |
| confirm: consumer guard | `require!(consumer.key() == attestation.consumer)` → `UnauthorisedSigner` | `if consumer != attestation.consumer` → `InvalidArgument` | ✅ behavioral match |
| confirm: double-resolve guard | `require!(confirmed.is_none())` → `AttestationAlreadyResolved` | `if is_resolved()` → `InvalidArgument` | ✅ behavioral match |
| confirm: set confirmed=true | `confirmed = Some(true)` | `confirmed = 1` (Confirmed sentinel) | ✅ behavioral match |
| confirm: accuracy reward | `attestation_accuracy += CONFIRM_WEIGHT (1000), min(10_000)` | same | ✅ exact |
| confirm: rep rolling avg | `(old * 9 + 10_000) / 10` | same | ✅ exact |
| dispute: consumer guard | same as confirm | same | ✅ behavioral match |
| dispute: double-resolve guard | same as confirm | same | ✅ behavioral match |
| dispute: set confirmed=false | `confirmed = Some(false)` | `confirmed = 2` (Disputed sentinel) | ✅ behavioral match |
| dispute: rep penalty | `reputation_score.saturating_sub(RATING_EXPIRE_PENALTY)` | same via PodU16 | ✅ exact |
| Error codes | Custom `EscrowError` variants (6000+) | `ProgramError::InvalidArgument` (stdlib) | ⚠️ delta (see Delta 3) |
| AgentAccount layout | Anchor AnchorSerialize struct | Fixed Pod layout + `attestation_accuracy: u16` field | ✅ behavioral match (see Delta 4) |

---

## Known Parity Deltas

### Delta 1: `job_id` seed encoding — `[u8; 16]` vs `u128`
- **Anchor**: `seeds = [ATTESTATION_SEED, job_id.as_ref()]` — 16 raw bytes as seed component
- **Quasar**: `#[seeds(b"attestation", job_id: u128)]` — job_id encoded as `u128` via `.to_le_bytes()`
- **Reason**: Quasar `#[seeds]` macro handles `u128` natively. `u128::from_le_bytes(job_id)` → `.to_le_bytes()` is a no-op — the seed bytes are identical.
- **Impact**: Instruction encoding differs; PDA addresses are identical. Zero behavioral impact.

### Delta 2: `confirmed` encoding — `Option<bool>` vs `u8` sentinel
- **Anchor**: `confirmed: Option<bool>` — 2 bytes: 1 tag + 1 value (None=0x00, Some(true)=0x01 0x01, Some(false)=0x01 0x00)
- **Quasar**: `confirmed: u8` — 1 byte: 0=Pending, 1=Confirmed, 2=Disputed
- **Reason**: `Option<T>` in zero-copy Quasar account structs requires `OptionZc` wrapper, adding complexity without gain. The 3-state sentinel is unambiguous and saves 1 byte per account.
- **Impact**: Account data layout differs by 1 byte. Behavior is identical. Client-side deserialization needs to handle sentinel if cross-program compatibility is required.

### Delta 3: Error code specificity
- **Anchor**: Custom variants: `NotAttestationAgent`, `AttestationScoreOutOfRange`, `UnauthorisedSigner`, `AttestationAlreadyResolved`
- **Quasar**: `ProgramError::InvalidArgument` for all instruction-level rejections
- **Impact**: Client-side error handling that branches on specific codes needs updating. Tests check for instruction failure, not specific codes — all tests pass.

### Delta 4: `attestation_accuracy: u16` field extension
- **Anchor**: `AgentAccount` has `attestation_accuracy: u16` at the end of the struct
- **Quasar**: Same field added after `bump` in the `AgentAccount` layout (between `bump: u8` and `_pad4: [u8; 4]`)
- **Reason**: The quasar-reputation AgentAccount (Phase 3) did not include this field. The attestation module extends the layout — any future consolidation of programs needs to align layouts.
- **Impact**: The quasar-attestation AgentAccount is NOT byte-compatible with quasar-reputation AgentAccount (different account size). Each program defines its own AgentAccount layout. Not a concern for this parity-test build.
- **Note**: When programs are consolidated, the AgentAccount should include `attestation_accuracy: u16` from the start. This is the correct final layout.

---

## Test Results

```
running 13 tests
test test_id ... ok
test tests::test_confirm_increases_judge_accuracy ... ok
test tests::test_dispute_penalises_judge ... ok
test tests::test_non_attestation_agent_rejected ... ok
test tests::test_non_consumer_confirm_rejected ... ok
test tests::test_duplicate_attestation_rejected ... ok
test tests::test_non_consumer_dispute_rejected ... ok
test tests::test_double_confirm_rejected ... ok
test tests::test_double_dispute_rejected ... ok
test tests::test_dispute_after_confirm_rejected ... ok
test tests::test_confirm_after_dispute_rejected ... ok
test tests::test_score_zero_rejected ... ok
test tests::test_score_eleven_rejected ... ok

test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

### Test Coverage vs Anchor `tests/attestation.rs`

| Anchor test | Quasar equivalent | Status |
|---|---|---|
| `test_confirm_increases_judge_accuracy` | `test_confirm_increases_judge_accuracy` | ✅ |
| `test_dispute_penalises_judge` | `test_dispute_penalises_judge` | ✅ |
| `test_non_attestation_agent_rejected` | `test_non_attestation_agent_rejected` | ✅ |
| `test_non_consumer_confirm_rejected` | `test_non_consumer_confirm_rejected` | ✅ |
| `test_duplicate_attestation_rejected` | `test_duplicate_attestation_rejected` | ✅ |
| _(not in Anchor suite)_ | `test_non_consumer_dispute_rejected` | ✅ added |
| _(not in Anchor suite)_ | `test_double_confirm_rejected` | ✅ added |
| _(not in Anchor suite)_ | `test_double_dispute_rejected` | ✅ added |
| _(not in Anchor suite)_ | `test_dispute_after_confirm_rejected` | ✅ added |
| _(not in Anchor suite)_ | `test_confirm_after_dispute_rejected` | ✅ added |
| _(not in Anchor suite)_ | `test_score_zero_rejected` | ✅ added |
| _(not in Anchor suite)_ | `test_score_eleven_rejected` | ✅ added |

**Anchor: 5 tests / Quasar: 12 tests** (+ 1 auto-generated `test_id`) — Quasar suite adds 7 additional negative/boundary/invalid-transition tests.

### Observed Behavior (verify correctness)
- `confirm`: accuracy 0 → 1000 (+ATTESTATION_CONFIRM_WEIGHT), rep 0 → 1000 (rolling avg with score=10) ✅
- `dispute`: rep remains 0 after `saturating_sub(500)` on a 0 rep judge ✅ (floors at 0, correct)

---

## Binary Stats

| Metric | Value |
|---|---|
| Binary size | 20 KB (sbpf-solana-solana, platform-tools v1.52) |
| Compare | Anchor escrow.so ~377 KB |
| Build time | ~1.2s (cached deps) |

---

## Files Changed

```
experiments/quasar-attestation/
├── Cargo.toml
├── src/
│   ├── lib.rs              # program entry + instruction routing (discs 0-3)
│   ├── state.rs            # AgentAccount (+ attestation_accuracy), AttestationAccount, AttestationStatus, constants
│   └── instructions/
│       ├── mod.rs
│       ├── register.rs     # register_agent (test support)
│       ├── attest.rs       # attest_quality parity
│       ├── confirm.rs      # confirm_attestation parity
│       └── dispute.rs      # dispute_attestation parity
│   └── tests.rs            # 13 QuasarSVM tests
└── target/deploy/quasar_attestation.so   # pre-built binary
```

---

## Cumulative Quasar Parity Progress

| Phase | Feature | Status | Tests |
|---|---|---|---|
| 1 | Escrow (lock/release/cancel) | ✅ complete | 7/7 |
| 2 | Registry (register/update/deregister) | ✅ complete | 10/10 |
| 3 | Reputation (commit/reveal/expire) | ✅ complete | 11/11 |
| 4 | Attestation (attest/confirm/dispute) | ✅ complete | 13/13 |
| 5 | PER path | 🔜 next | — |

**Total tests passing: 41/41**

---

## Recommended Next Phase

**Phase 5: PER path parity** — `delegate_escrow`, `release_escrow_per`.

Complexity notes for Phase 5:
- `delegate_escrow` marks an escrow as delegated to a MagicBlock PER session, storing a `per_session_key`
- `release_escrow_per` allows release by the PER session key (not the original payer)
- The Anchor implementation uses a TypeScript shim (`packages/per-client/`) since the Rust SDK was incompatible with Anchor 1.0.0 — in Quasar this may be simpler to port natively
  - _Snapshot note (superseded): the Anchor 1.0.0 incompatibility rationale stopped applying with the Anchor 1.1.2 upgrade. `packages/per-client/README.md` owns the current reason PER stays TypeScript-side; the bullet above is retained as the 2026-04-12 record._
- Key question: does Quasar's CPI model support MagicBlock delegation flows? May need investigation.
- Alternatively, Phase 5 could be documented as a "shim delta" if the TEE delegation model doesn't translate to Quasar's execution environment

Estimated effort: 1 day (if Quasar supports delegation semantics) or 2-3 hours (if documented as shim delta).

---

_Report author: Kit (Quasar parity agent)_  
_Canonical submission repo untouched: `nissan/reddi-agent-protocol`_
