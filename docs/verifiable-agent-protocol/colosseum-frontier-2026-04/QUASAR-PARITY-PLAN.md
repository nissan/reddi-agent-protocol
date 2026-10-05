# Quasar Full Parity Plan (Fork-Only)

> **Dated historical plan — superseded 2026-10-02.** This fork, parity, and cutover plan is preserved as April 2026 planning, not a current roadmap or promotion path. Quasar is frozen and stable Anchor `1.1.2` remains authoritative. See [`../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

_Last updated: 2026-04-12 AEST_

## Non-negotiable isolation rule
- **All Quasar work stays in a fork repo, never in a branch on `nissan/reddi-agent-protocol`.**
- Canonical submission repo remains Anchor-first until formal cutover.
- Allowed pattern: `fork repo` + feature branches inside that fork + PRs inside fork.
- Disallowed pattern: Quasar feature branches in the canonical repo.

## Repos
- Canonical: `https://github.com/nissan/reddi-agent-protocol` (Anchor, submission path)
- Quasar fork workspace: `https://github.com/reddinft/reddi-agent-protocol-parallel`

## Goal
Reach functional parity in Quasar for all user-facing on-chain flows, then decide cutover based on QA + benchmarks.

## Phases
1. **Escrow parity baseline** (done)
   - lock/release/cancel + multi-escrow-per-payer via `u64` counter seed
   - QuasarSVM: 7/7 passing

2. **Registry parity**
   - `register_agent`, `update_agent`, `deregister_agent`
   - Match auth and state invariants from Anchor path

3. **Reputation parity**
   - `commit_rating`, `reveal_rating`, `expire_rating`
   - Preserve penalties, expiry, and commit/reveal semantics

4. **Attestation parity**
   - `attest_quality`, `confirm_attestation`, `dispute_attestation`
   - Preserve dispute/confirmation behavior

5. **PER path parity**
   - Port delegation/private settlement flow (or documented shim)
   - Preserve fallback and failure handling semantics

6. **Test parity gate**
   - Port equivalent test coverage to QuasarSVM
   - Green gates for escrow + registry + reputation + attestation + PER

7. **Integration parity**
   - Validate demo script + TS integrations (Eliza/SendAI/frontend instruction builders)
   - Program IDs/config clearly separated by environment

8. **Cutover decision**
   - Benchmark report (CU, binary size, reliability)
   - Oli QA signoff
   - Decision: keep fork as R&D, or promote Quasar to canonical

## Exit criteria (parity achieved)
- All current Anchor user-facing flows run on Quasar with equivalent behavior.
- Equivalent critical tests pass in Quasar.
- End-to-end demo loop runs against Quasar path.
- No regressions or contamination of canonical repo during parity build.

## Operating cadence
- Build only in fork.
- Weekly parity diff against canonical features.
- Keep a migration ledger (`done`, `in-progress`, `blocked`) in this project folder.