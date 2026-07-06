# Crosswalk: Airwallex Issuing `authorization_controls` ↔ `reddi.buyer-authority-policy.v1`

Issue: #581 (follow-up 3 of 3 from the #541 Airwallex assessment; rail-neutrality epic #338; seller-wrapper roadmap #375; buyer-authority lineage #548 → #549, landed via PRs #555–#557).

Research source: `research/AIRWALLEX-RAP-INTEGRATION-ASSESSMENT-2026-07-06.md` (in the project workspace repo, not this code repo) and the #541 summary comment.

## Purpose

Airwallex Issuing exposes per-card `authorization_controls` — spend limits, merchant restrictions, currency rules, expiry — enforced by the issuer inside a regulated card network. `BuyerAuthorityPolicy` v1 (`packages/agent-protocol/src/buyer-authority-policy.ts`, schema `reddi.buyer-authority-policy.v1`) expresses the same *category* of constraint for agent payments: what a buyer agent is allowed to spend, with whom, on which rails, until when, under whose approval.

This document maps the two vocabularies field by field. The point is a **portability proof**: the RAP buyer-authority contract generalizes to a real regulated fiat issuing surface without any schema change and without any implementation commitment. It is the same exercise the AP2 work (#563, PR #571) performed for an authorization-layer protocol — Airwallex is the mirror image (regulated settlement surface without an open authorization protocol), so the crosswalk runs in the opposite direction: from a settlement-side control surface back onto the RAP policy schema.

## Boundary (read first)

- **Docs only.** This crosswalk carries **no implementation commitment**. No fixture, adapter, rail row, or schema change is introduced by this document.
- **No Airwallex account, signup, sandbox/demo credential, API call, partnership contact, or spend** was made. All Airwallex behavioural descriptions are paraphrased from public documentation and are **unverified against a live API**. Every Airwallex field name below should be read as `(unverified — Airwallex docs, confirm field name/shape)`.
- **No proprietary content is reproduced.** Field names and one-line semantics only; no Airwallex documentation text, examples, or payloads are copied.
- **No custody, Merchant-of-Record, money-transmission, or settlement-finality claim.** RAP is a protocol layer above rails. An Airwallex issuing relationship (account, KYB, cards, limits) belongs to the card-holding business, never to RAP.
- Anything executable (issuing a card, setting a control, querying remaining limits) sits behind account + KYB + API credentials and is **rejected/deferred** per #541 §9 — it would require an explicitly operator-approved external-action workstream.

## Semantic framing: two different enforcement points

| Dimension | Airwallex `authorization_controls` | `BuyerAuthorityPolicy` v1 |
|---|---|---|
| Layer | Card-side **pre-authorization** control: evaluated by the issuer when a merchant submits an authorization on the card network | Agent-side **pre-invocation** control: evaluated by the buyer's own runtime *before* any paid request is emitted |
| Enforcement point | After the buyer-side actor has already attempted the payment; the network declines it | Before the attempt exists; a denied evaluation means no request, no payment intent, nothing on any rail |
| Enforcer | Airwallex (regulated issuer/processor) | The buyer agent runtime executing `evaluateBuyerAuthorityPolicy()` — pure function, no network |
| Failure semantics | Authorization declined; decline reason surfaced through issuer APIs | Fail-closed `reasonCodes` (e.g. `spend_cap_exceeded`, `seller_not_allowlisted`, `policy_expired`) + audit notes |
| Trust model | The cardholder trusts the issuer to enforce controls | The operator trusts the policy gate; the policy itself is validated as static, non-secret, no-live (`validateBuyerAuthorityPolicy()` rejects credential material, live-payment flags, custody/finality claims) |
| Scope of money movement | Real funds on a regulated card rail | **None.** v1 policies are hard-pinned `allowLivePayment: false`, `forbidCustody: true`, `forbidSettlementFinality: true` |

The two are **complementary, not equivalent**: an agent operating a (hypothetical, out-of-scope) issued card would want *both* — the RAP policy gate deciding whether to attempt a spend at all, and issuer-side controls as the regulated backstop if the agent misbehaves. That layering — same constraint vocabulary enforced independently at two points — is exactly why the crosswalk is worth documenting.

## Field-by-field crosswalk

Verdict legend: ✅ maps cleanly · 🟡 maps partially · ❌ no RAP equivalent (or no Airwallex equivalent).

| # | Airwallex issuing concept *(all names unverified — public docs)* | `BuyerAuthorityPolicy` v1 field | Verdict | Notes |
|---|---|---|---|---|
| 1 | `authorization_controls.transaction_limits.intervals` with `PER_TRANSACTION` interval | `spendCaps[]` with `window: 'per_request'` + `maxAmountUnits` | ✅ | Same shape: a per-attempt ceiling in minor units. This is the strongest one-to-one correspondence in the crosswalk. |
| 2 | Cumulative transaction-limit intervals (daily / weekly / monthly style windows) | `spendCaps[]` with `window: 'daily' \| 'monthly'` | 🟡 | The v1 schema *declares* daily/monthly windows, but the reference evaluator only enforces `per_request` caps (`policySpendCap()` filters on `window === 'per_request'`); cumulative enforcement needs spend-history state the pure evaluator deliberately does not hold. There is also no weekly window in v1. Expressiveness is present; enforcement parity is not — #338 note, no schema change. |
| 3 | Per-limit currency on a transaction limit | `spendCaps[].asset` + `allowedCurrencies` | 🟡 | Structural match, but `BuyerAuthorityAsset` is a **closed union** `'SOL' \| 'USDC' \| 'AUDD'`. Fiat currency codes (the entire Airwallex issuing domain) cannot be expressed in v1. This is the one real schema pressure found in #541 §4; recommended handling is to keep v1 frozen and put fiat assets in a draft namespace until #338 decides. |
| 4 | Allowed transaction currencies on the card | `allowedCurrencies[]` | 🟡 | Same intent (currency allowlist), same closed-union limitation as row 3. |
| 5 | Merchant restrictions — allow/block by merchant category (MCC-style), brand, or specific merchant | `sellerAllowlist.sellerIds` / `sellerAllowlist.endpointIds` | 🟡 | RAP allowlists **specific identities** (seller ids + endpoint ids). It has no category/taxonomy tier, so "block all merchants in category X" has **no RAP equivalent** — identity allowlisting is strictly narrower (and fail-closed: anything not listed is denied). Category-level controls are an expressiveness gap to record on #338, not to solve here. |
| 6 | Card expiry / validity end | `expiresAt` | ✅ | Direct analogue: past the timestamp, every evaluation denies with `policy_expired`. |
| 7 | Time-window rules (activity windows narrower than card validity) | `expiresAt` only | 🟡 | v1 has a single expiry instant — no start-time, recurrence, or time-of-day windows. Partial by construction. |
| 8 | Card status (active / frozen / blocked) | `mode: 'allow' \| 'deny' \| 'approval-required'` | ✅ | Freezing a card ≈ flipping `mode` to `'deny'` (reason code `policy_denied`); the approval-required mode has a rough analogue in step-up flows but maps better to row 9. |
| 9 | Step-up / secondary review before high-value spend *(no single public field; closest is issuer-side review posture)* | `operatorApproval` (`required`, `approvalState`, `thresholdAmountUnits`) + `spendCaps[].approvalRequiredAboveUnits` | ✅ | RAP's explicit human-in-the-loop gate above a threshold is a first-class policy field; on the issuing side this is issuer/product behaviour rather than a caller-set control. Maps cleanly in *intent*, with RAP the more explicit surface. |
| 10 | Remaining-limit query (introspect how much of a limit is left) | — | ❌ | No RAP equivalent. v1 evaluation is stateless per request; there is no accumulator to introspect. Follows directly from row 2. |
| 11 | Which network/rail the card transacts on (card network is fixed by the product) | `allowedRails[]` (asset × network × `supportStates`) | ❌ (RAP-only) | RAP is rail-neutral, so the policy must say *which* rails and which **support states** (`fixture`/`dry-run`/`proof-metadata-only`/`devnet-gated`; `live-gated` is rejected in v1) are permitted. A single-rail card product has nothing to configure here. |
| 12 | Receipt / evidence requirements | `receiptEvidence` (`receiptRequired`, `evidenceRequired`, `evidenceArchiveRequired`) | ❌ (RAP-only) | Card rails emit statements/webhooks regardless; the *policy-level obligation* to present and archive receipt evidence before an invocation counts as satisfied is a RAP concept with no issuing-control counterpart. |
| 13 | Refund / failure semantics | `refundFailurePolicy` (`failureMode`, `refundMode`, `operatorReviewRequired`) | ❌ (RAP-only, with a caution) | Issuing controls do not express refund posture — refunds/chargebacks are lifecycle events, not pre-set controls. Caution from #541 §4.6: on a card rail `failureMode: 'no_charge_on_failure'` is **not guaranteeable** (auth/capture nuances), so any future fiat-rail policy fixture should exercise `manual_review_required`. |
| 14 | Custody / money movement (the issuer necessarily holds and moves funds) | `supportStateConstraints` (`allowLivePayment: false`, `forbidCustody: true`, `forbidSettlementFinality: true`) | ❌ (deliberate inversion) | This is where the two surfaces are *opposites by design*: Airwallex issuing exists to move real money; v1 policies structurally **forbid** live payment, custody, and settlement-finality claims, and the validator denies any policy that relaxes them. The inversion is the boundary, not a gap. |
| 15 | API credentials / secrets to manage controls | — (rejected content) | ❌ (deliberate) | RAP policies must be static and non-secret: `validateBuyerAuthorityPolicy()` denies credential-like material (`policy_contains_credentials`), wallet/RPC/provider references, and transfer instructions. The management-plane credential model of an issuing API has no legitimate representation inside a policy document. |

## Summary: clean / partial / none

- **Maps cleanly (✅):** per-transaction spend ceiling → `spendCaps` `per_request`; card expiry → `expiresAt`; card freeze/block → `mode: 'deny'`; above-threshold step-up → `operatorApproval` + `approvalRequiredAboveUnits`. The core "how much, until when, on/off, with sign-off above X" vocabulary is fully expressible in v1 **unchanged** — which is the portability claim this document exists to make.
- **Maps partially (🟡):** cumulative daily/monthly windows (declared in schema, not enforced by the stateless reference evaluator; no weekly window); currency controls (blocked by the closed `SOL|USDC|AUDD` asset union — fiat codes need a draft namespace or a #338-decided v1.1 union extension); merchant controls (RAP has identity allowlists, no category taxonomy); time windows (single expiry instant only).
- **No equivalent (❌):** remaining-limit introspection (Airwallex-only); rail/support-state permissions, receipt-evidence obligations, and refund/failure posture (RAP-only); custody/live-payment (deliberately inverted — a control surface on one side, a structural prohibition on the other).

### Gaps recorded for #338 (no schema change in this document)

1. **Closed asset union vs fiat currency codes** — the single real schema pressure (also #541 §4.1).
2. **Merchant-category controls have no RAP equivalent** — `sellerAllowlist` is identity-level only.
3. **Cumulative-window enforcement** — `daily`/`monthly` caps are expressible but the pure evaluator enforces only `per_request`; cross-request state is a separate design decision.
4. **No remaining-limit introspection** — consequence of (3).
5. (Adjacent, tracked from #541, out of scope here): card receipts are revocable (refund/dispute), which receipt v1 cannot yet represent.

## Non-goals

- **No integration commitment.** This crosswalk does not schedule, imply, or design an Airwallex integration. Fixture-level follow-ups (#579-lineage rail fixtures, webhook-receipt normalization) are tracked separately and carry the same boundary.
- **No account, no credentials, no API calls, no partnership contact, no spend** — now or as a consequence of this document. Any executable path requires explicit operator (Nissan) approval per #541 §9.
- **No custody, MoR, money-transmission, or settlement-finality claims.** RAP is neither Merchant of Record nor processor on any fiat rail; issuing relationships belong to the account-holding business.
- **No proprietary reproduction.** Airwallex field names are referenced descriptively and flagged unverified; consult Airwallex's own documentation for authoritative shapes.
- **No schema change.** `reddi.buyer-authority-policy.v1` stays frozen; every identified gap routes to #338 as a note.

## Related work

- #581 — this task; #541 — Airwallex ↔ RAP integration assessment (research artifact `AIRWALLEX-RAP-INTEGRATION-ASSESSMENT-2026-07-06.md` + summary comment).
- #338 — rail-neutrality epic (gap notes above land there); #375 — seller-wrapper / payment-plan roadmap.
- #548 → #549 — buyer-authority policy lineage; contract landed via PRs #555–#557 in `packages/agent-protocol/src/buyer-authority-policy.ts`.
- #563 / PR #571 — AP2 mandate ingestion: the precedent for mapping an external authorization vocabulary onto RAP contracts fixture-first, fail-closed, with unverified field names flagged.
- PR #572 (`docs/conformance/framework-template-comparison.md`) — the comparison-doc structure this document follows.
- `docs/AUDD-SOL-USDC-RAIL-PARITY-MATRIX-2026-06-24.md` — the existing rail-parity matrix that `allowedRails` rows here refer back to.
