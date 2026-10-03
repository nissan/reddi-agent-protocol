# Quasar Escrow POC — Decision Memo

> **Historical, superseded 2026-10-02:** Neither this memo nor its 2026-05-08 Quasar cutover posture is current guidance. Quasar is frozen as experimental and retired from product/production critical paths. The recorded devnet deployment is blocked and no redeployment or live claim is authorized. The existing benchmark does not provide a semantics-matched primary Anchor comparison. Stable Anchor `1.1.2` remains authoritative and Anchor v2 remains a default-off alpha pilot. See [`../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).
_Date: 2026-04-11_
_Author: Kit_
_For: Loki / Nissan (Colosseum Frontier submission decision)_

> **Current interpretation (2026-10-03; original dated memo preserved below):** Everything after this block is the original author's 2026-04-11 recommendation and assertion, not current guidance. The unavailable named POC commit and missing pinned raw artifacts prevent independent reproduction here; no measured, semantics-matched Anchor comparator exists, and the POC omitted material behavior. Its historical “parity,” “real gains,” savings, and roadmap conclusions are therefore not established current findings and do not show a general Quasar or Anchor-framework advantage. The original wording remains below solely as dated decision provenance; the 2026-10-02 freeze linked above controls.

---

## Executive Summary

**Recommendation: Keep on roadmap, do not migrate for the current hackathon submission.**

The Quasar POC demonstrates meaningful efficiency gains (35–84% CU reduction, 96% binary size reduction on the hot path). The developer experience is close enough to Anchor that a migration is practical. However, three blockers prevent a safe same-week migration: the nonce seed limitation, a Beta API stability risk, and the depth of our existing Anchor test surface that would need full porting.

---

## What Was Demonstrated

- ✅ Quasar escrow compiles, deploys, and runs: 6/6 tests pass
- ✅ `make` (lock), `take` (release), `refund` (cancel) — full semantic parity
- ✅ Authorization constraints (`has_one = payer`) work correctly
- ✅ Zero-amount guard, double-spend prevention work
- ✅ Binary: 13 KB vs 377 KB (full Anchor build)
- ✅ CU: release/cancel ~80% cheaper than Anchor estimates; lock ~35–50% cheaper

---

## Go / No-Go Analysis

### Arguments for migration (Go)

| Signal | Value |
|---|---|
| Binary size | 96% reduction on hot path — direct cost to the network |
| Release/cancel CU | ~600 CU vs ~3,000–4,000 CU estimated — 5–6× cheaper per transaction |
| Lock CU | ~3,966 CU vs ~6,000–8,000 CU — meaningful but not dramatic |
| Developer UX parity | `#[derive(Accounts)]`, `has_one`, `close`, seeds — all available and familiar |
| First-party testing | QuasarSVM is maintained by Blueshift alongside the SDK; LiteSVM is third-party |
| Narrative value | "Quasar-native from day 1" is a strong Colosseum differentiator |
| No macro magic | Explicit discriminators and typed mutability reduce footgun surface |

### Arguments against migration (No-Go for now)

| Blocker | Severity | Detail |
|---|---|---|
| **Nonce seed limitation** | High | Quasar's `#[seeds]` macro doesn't support `[u8; 16]` array types. Our escrow uses `[b"escrow", payer, nonce_16]` to allow multiple concurrent escrows per payer. POC dropped this to `[b"escrow", payer]`. Full migration requires either a redesigned nonce (u64 counter) or upstream Quasar fix. |
| **Beta status** | Medium | Quasar is explicitly Beta, unaudited, APIs may change. Not a blocker for hackathon but would be for production. |
| **Test surface porting cost** | Medium | We have 30+ Rust tests across phases 2–4b. Each would need API changes (`Context` → `Ctx`, `Result<()>` → `Result<(), ProgramError>`, LiteSVM → QuasarSVM). Estimated 1–2 days additional work. |
| **Registry/reputation complexity** | Low-Medium | The current codebase has `commit_rating`, `reveal_rating`, `attest_quality`, and `delegate_escrow` with complex cross-account updates. These are more complex to port than the pure lamport escrow. |
| **SPL token interop** | Low (for us) | Our escrow is SOL-only. If we ever add token support, Quasar's SPL integration differs from Anchor's (method-chain CPI vs `CpiContext`). Not a current blocker. |

---

## Specific Risk: Nonce Seed

This is the hardest blocker. Our current escrow PDA is:
```
[b"escrow", payer.key(), nonce.as_ref()]
```

The `nonce: [u8; 16]` causes a compile error in Quasar's `#[seeds]` macro (it calls `.to_le_bytes()` which doesn't exist on `[u8; 16]`).

**Workarounds (all viable but require protocol change):**
1. Replace nonce with a `u64` counter stored in a per-payer `UserState` PDA — adds an extra account but clean
2. Hash the nonce to `[u8; 32]` (an `Address`) and use it as an `Address` seed — forward-compatible
3. Use only `u8` nonce (0–255 slots per payer) — too limiting for agent-to-agent payment volume
4. Wait for upstream Quasar fix — `[u8; 16]` is a reasonable seed type; may be added soon

---

## Recommendation

### For the hackathon submission (current)

**Keep Anchor. Ship what's proven.**

The main submission at `reddi-agent-protocol-code` has:
- 30+ passing tests
- DevOps already done (deployed to devnet)
- Phase 3a/3b TypeScript plugins tested
- Phase 4/4b reputation tested
- Historical Phase 5 MagicBlock integration notes (superseded; no current settlement claim)

Migrating now would create regression risk without adding user-facing feature value. The judges can't tell from a live demo whether the program binary is 13 KB or 377 KB.

### Post-hackathon roadmap (Keep on roadmap)

**Priority: Medium** — pursue Quasar migration in Phase 8 or beyond.

The efficiency numbers are real and meaningful. When:
- The nonce seed workaround is chosen (recommend u64 counter)
- Quasar exits Beta
- Time allows a proper test-surface port

...the migration is straightforward. The POC proves it: the escrow logic maps 1:1, the API changes are mechanical, and the gains are measurable.

**Suggested Phase 8 plan:**
1. Replace nonce `[u8; 16]` with u64 counter + `UserEscrowCounter` PDA (1 day)
2. Port escrow hot path (lock/release/cancel) — this POC is 90% of the work
3. Port registry (register_agent etc.) — simpler, no dynamic seeds issue
4. Port tests from LiteSVM to QuasarSVM — mechanical API change
5. Benchmark on devnet, write the "Quasar-native" blog post

---

## Bottom Line

| Question | Answer |
|---|---|
| Does Quasar work for our use case? | **Yes** — POC proves parity |
| Are the efficiency gains real? | **Yes** — CU reductions confirmed, binary 13x smaller |
| Is it safe to migrate now? | **No** — nonce blocker + Beta risk + test porting cost |
| Should we migrate eventually? | **Yes** — post-hackathon Phase 8 |
| Is the main submission at risk? | **No** — parallel repo, zero changes to main path |
