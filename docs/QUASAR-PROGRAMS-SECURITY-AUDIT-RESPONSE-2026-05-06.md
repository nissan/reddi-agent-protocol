# Quasar Programs — Audit Response

> **Dated audit-response record — superseded for current applicability 2026-10-02.** The immediate-fix claims and open architectural blockers below are preserved unchanged as 2026-05-06 history; they do not establish present closure, a current audit, deployment authority, or readiness. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

_Date:_ 2026-05-06 AEST  
_Primary audit:_ `docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`  
_Remediation log:_ `docs/QUASAR-PROGRAMS-SECURITY-REMEDIATION-2026-05-06.md`

## Executive response

We accepted the audit findings. The immediate safe hardening items have been implemented, regression-tested, and pushed to PR #244. The architectural findings around job-binding, canonical registry state, payee dispute/claim flow, and reputation-laundering policy remain open and are explicitly treated as mainnet-readiness blockers.

## Follow-up observations response

| Observation | Response | Proof / artifact |
|---|---|---|
| N1 Low: escrow cancel window used 2 slots/sec while reputation expiry uses 2.5 slots/sec | Fixed. `CANCEL_WINDOW_SLOTS` now equals `1_512_000`, matching the reputation expiry window. | `experiments/quasar-escrow/src/state.rs`; `test_audit_cancel_before_window_rejected`; escrow happy cancel path warps past `CANCEL_WINDOW_SLOTS`. |
| N2 Info: commitment hash binds to `crate::ID`; changing `declare_id!` invalidates in-flight commits | Documented as an operational/client-SDK migration rule. Clients must compute commitments against the exact target program ID and drain/settle open ratings before program-ID migration. | This response doc + remediation log follow-up notes. |
| N3 Info: participant-only expiry is defense-in-depth, not full CRITICAL-4 closure | Confirmed. The response continues to mark job-binding as open. | Remediation log “Still open / requires design work.” |
| N4 Info: self-confirmation guard is partial defense-in-depth, not full CRITICAL-2 closure | Confirmed. Full closure requires attestations bound to real job/escrow accounts with consumer derived from that binding. | Remediation log “Still open / requires design work.” |

## Current proof set

Regression tests added against the audit response:

- `experiments/quasar-escrow/src/tests.rs::test_audit_cancel_before_window_rejected`
- `experiments/quasar-attestation/src/tests.rs::test_audit_self_confirmation_attest_rejected`
- `experiments/quasar-reputation/src/tests.rs::test_audit_zero_commitment_rejected`
- `experiments/quasar-reputation/src/tests.rs::test_audit_cross_job_commitment_reuse_rejected`
- `experiments/quasar-reputation/src/tests.rs::test_audit_expire_third_party_rejected`

Validation command:

```bash
PATH="$HOME/.cargo/bin:$PATH" bash scripts/run-quasar-program-tests.sh
npm run check:quasar:critical-success
npm run test:bdd:index
git diff --check
```

Latest local result after N1 patch: PASS — escrow 8/8, registry 10/10, reputation 14/14, attestation 14/14; `check:quasar:critical-success` PASS; BDD index PASS; `git diff --check` PASS.

## Non-closure statement

Do not claim the Quasar programs are mainnet-ready yet. The demo-critical Quasar path is valid for the scoped Colosseum proof, but mainnet readiness still requires:

1. canonical job/escrow binding for rating and attestation PDAs,
2. canonical registry state or merged programs,
3. payee dispute/claim or attestation-driven release,
4. reputation laundering policy,
5. re-review after those architectural changes.
