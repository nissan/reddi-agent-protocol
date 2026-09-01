# Quasar PER Parity Report

_Generated: 2026-04-12 AEST_  
_Phase: 5 — PER path parity_  
_Repo: `reddi-agent-protocol-code`_  
_Baseline: `main` @ `ffe48a8`_

---

## Summary

✅ `delegate_escrow` and `release_escrow_per` are implemented.  
✅ L1 fallback clears PER state in `release_escrow`.  
✅ TypeScript PER client exists in `packages/per-client/` for delegation, TEE release, and fallback.  
✅ Rust and TS test suites are green.

## Parity Matrix

| Behavior | Anchor / intended PER flow | Quasar implementation | Status |
|---|---|---|---|
| Delegate escrow | PER delegation records session key before private settlement | `delegate_escrow` sets `delegated_to_per = true` and stores `per_session_key` | ✅ |
| PER release | Private release uses stored session key and settles funds | `release_escrow_per` checks locked state, delegation flag, and session key, then transfers lamports and clears delegation | ✅ |
| L1 fallback | Standard release must still work when PER is unavailable | `release_escrow` remains valid from delegated state and clears PER fields on success | ✅ |
| Unauthorized access | Only payer can delegate / release | `has_one = payer` + signer checks preserved on both instructions | ✅ |
| Invalid state transitions | Reject double delegation, missing delegation, wrong session key | `AlreadyDelegated`, `NotDelegatedToPer`, `PerSessionKeyMismatch`, `NotLocked` | ✅ |
| Live TEE execution | Requires devnet TEE RPC / private mempool path | Client routes via `PER_DEVNET_RPC`, but LiteSVM cannot execute live TEE | ⚠️ ignored in unit tests |

## Test Results

### Rust
- `cargo test -p escrow --test per -- --nocapture` → **5 passed, 1 ignored**
- Existing escrow suite → **8/8 passed**
- Registry suite → **6/6 passed**
- Reputation suite → **5/5 passed**
- Attestation suite → **5/5 passed**

### TypeScript
- `npm test -- --runInBand` in `packages/per-client` → **6/6 passed**

**Total passing:** 35  
**Ignored:** 1 live TEE integration test

## Deltas / Blockers

- No Rust `ephemeral-rollups-sdk` dependency was added, because the PER client is intentionally handled in TypeScript for Anchor 1.0.0 compatibility.
  - _Snapshot note (superseded): the Anchor 1.0.0 compatibility rationale stopped applying with the Anchor 1.1.2 upgrade. `packages/per-client/README.md` owns the current reason PER stays TypeScript-side; the bullet above is retained as the 2026-04-12 record._
- LiteSVM covers state transitions and fallback behavior, but not the live `devnet-tee.magicblock.app` execution path.
- `release_escrow_per` is a local parity shim for the TEE path, not a full enclave integration test.

## Recommendation

Proceed to integration / cutover gate only after a live devnet TEE smoke confirms `releaseEscrowViaPer` end-to-end. Until then, keep `release_escrow` as the operational fallback.
