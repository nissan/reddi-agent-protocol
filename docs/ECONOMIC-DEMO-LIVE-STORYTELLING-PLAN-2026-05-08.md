# Economic Demo Live Storytelling Plan — 2026-05-08

> **Historical plan.** This file predates current RAP Assurance claim remediation and is not current public copy or approval to run hosted/live/devnet payments. Use `docs/PUBLIC-CLAIM-BOUNDARY.md`: payments prove transfer; RAP Assurance proves paid work.

## Why this exists

Nissan flagged that `/economic-demo` feels cluttered and hard to decode at a glance. The current page is evidence-rich but not story-led: it mixes historical artifacts, dry-run panels, balances, Surfpool rehearsal, Pay.sh readiness, Umbra, Torque, OpenRouter, wallet state, and final recording notes without a single obvious “watch this happen live” spine.

This plan is the next activity set after PR #280 / current bounty gap-closure work is complete.

## Honest current diagnosis

### Has UX reviewed this page?

No specific Belle/UX review of `/economic-demo` was found in memory before this plan. Belle has now been dispatched for a focused UX/story review, and this plan should be updated with her implementation-ready brief before coding.

### Why the current wallet connect feels wrong

If the page is only showing a snapshot of a prior transaction/evidence flow, wallet connection is not necessary and creates cognitive dissonance:

- Judge asks: “What will happen if I connect?”
- Current answer appears to be: “Mostly nothing; we show old evidence.”
- That makes the demo feel less live, not more live.

Wallet connection should appear only when the user can do one of these:

1. sign/authorize a bounded devnet action,
2. personalize a quote/request with their wallet identity,
3. verify a live receipt or balance delta tied to their address,
4. intentionally enter an approval-gated paid/devnet mode.

If none of those are true, the page should default to a no-wallet judge mode.

### Why “snapshot evidence” is not enough

Snapshot evidence is useful as backup, but it should not be the main hero interaction. The judge-facing proof should be:

> Type/select a request → send to a specialist workflow → receive live outputs → see fresh evidence bundle rendered → optionally inspect prior artifacts.

The current page reverses that: artifacts first, story second.

## Target demo story

One sentence (superseded wording):

> “Ask Reddi Agent Protocol for an output; it discovers specialist agents, quotes the work, records payment/evidence boundaries, and returns a bounded receipt/evidence record you can inspect.”

## Proposed page modes

### Mode A — Judge live demo, no wallet required by default

Purpose: prove this is not fake without forcing wallet friction.

Flow:

1. Select a safe template prompt:
   - “Generate a landing page for a paid-work assurance demo.”
   - “Analyze this product idea and produce implementation tasks.”
   - “Write and verify a concise launch brief.”
2. Click **Run live specialist workflow**.
3. Backend executes a bounded hosted workflow against exact allowlisted Coolify specialist endpoints.
4. UI streams or polls run status:
   - request accepted,
   - specialist selected,
   - unpaid x402 challenge observed,
   - controlled/devnet payment evidence attached depending on mode,
   - specialist output returned,
   - attestor verdict returned,
   - evidence bundle generated.
5. UI renders the actual returned output and evidence cards.

No wallet is required if using controlled demo receipts / unpaid challenge proof / server-side pre-funded devnet lane.

### Mode B — Devnet proof mode, wallet optional/explicit

Purpose: prove real devnet movement when desired.

Two sub-options:

1. **Treasury/server-funded devnet demo**
   - No judge wallet required.
   - Server uses approved devnet treasury/demo signer only.
   - UI clearly labels: “server-funded devnet proof; no user funds.”
   - Best for recording reliability.

2. **Judge wallet devnet participation**
   - Wallet connect appears only after choosing “Use my devnet wallet.”
   - Requires cap, network, recipient, exact action, and confirmation screen.
   - Useful for interactivity, risky for judging because wallet setup can derail.

Recommendation: ship treasury/server-funded devnet mode first; keep judge wallet optional.

### Mode C — Evidence archive / proof appendix

Purpose: keep all current artifacts without cluttering the main story.

Move historical proof into collapsible sections:

- Quasar program readiness,
- MagicBlock AgentVault settlement,
- Pay.sh / `reddi-x402`,
- Umbra devnet-only private-payment evidence,
- Torque reputation ranking,
- OpenRouter all-30 hosted endpoint inventory,
- Jupiter boundary/simulation.

This makes artifacts support the live story instead of replacing it.

## Information architecture for the redesigned page

### 1. Hero: “Run a live paid-agent workflow”

- One paragraph only.
- Status pills: Quasar ready, 30 hosted specialists, x402 challenge, devnet evidence, attestation.
- Primary CTA: **Run live demo**.
- Secondary CTA: **Inspect previous evidence**.

### 2. Prompt/template panel

- Template dropdown + editable prompt.
- Keep templates safe, bounded, and deterministic enough for demo timing.
- Show selected specialist chain before run:
  - planner → content/code/research → verifier/attestor.

### 3. Quote and approval boundary

- Show a quote card before execution:
  - estimated calls,
  - max downstream calls,
  - payment mode: controlled demo / server-funded devnet / user-wallet devnet,
  - exact endpoints allowlisted,
  - what is and is not being claimed.

### 4. Live run timeline

A vertical “receipt trail”:

1. prompt hash created,
2. specialist discovery from 30-profile manifest,
3. endpoint challenge returned `402`,
4. payment/evidence mode satisfied,
5. output returned `200`,
6. attestor verdict generated,
7. evidence pack written.

Each step gets:

- status,
- timestamp,
- endpoint/profile,
- tx/signature or challenge nonce when applicable,
- disclosure ledger link.

### 5. Rendered output

This is the most important missing piece.

Show the returned artifact as the hero proof:

- final generated webpage / plan / copy / code,
- specialist outputs with expandable raw responses,
- attestor verdict,
- downloadable evidence JSON.

If the output is a webpage/code artifact, render it in an iframe/preview panel.

### 6. Evidence drawer

Collapsed by default:

- latest run JSON,
- disclosure ledger,
- devnet signatures,
- hosted endpoint challenge evidence,
- historical artifacts.

### 7. Wallet panel only when needed

No global wallet button as the first interaction.

Show wallet connect only inside the selected mode:

- hidden in no-wallet judge demo,
- optional for user-wallet devnet mode,
- disabled/irrelevant for historical evidence viewing.

## Technical implementation plan

### Phase 0 — Finish current PR/task

- Let PR #280 settle or merge.
- Do not mix UX/live workflow changes into the bounty gap closure PR.

### Phase 1 — Belle UX brief + page audit

Deliverables:

- Belle implementation-ready UX brief.
- Current `/economic-demo` component inventory:
  - keep,
  - move to appendix,
  - delete/deprioritize,
  - convert to live timeline.

Acceptance criteria:

- One wireframe/story arc agreed before implementation.
- Wallet-connect rule documented.

### Phase 2 — Add a live run API, no wallet required

New likely route:

- `POST /api/economic-demo/live-run`

Inputs:

- `templateId`,
- optional prompt override,
- `mode: "hosted_challenge_demo" | "server_funded_devnet"` initially,
- `maxDownstreamCalls`,
- `clientRunNonce`.

Outputs:

- `runId`,
- selected specialists,
- quote,
- run timeline,
- final outputs,
- evidence pack path/hash.

Safety requirements:

- exact allowlist of specialist endpoint origins,
- strict prompt length and template allowlist,
- no arbitrary URLs,
- no private payloads by default,
- no user-supplied payment receipts,
- no mainnet,
- bounded downstream call count,
- clear controlled-demo vs devnet labels.

### Phase 3 — Hosted endpoint proof mode

Use the 30 Coolify endpoints we already have.

Minimum live proof:

- fetch/select from local 30-profile manifest,
- call exact hosted specialists,
- observe unpaid x402 challenge,
- satisfy in controlled demo mode or server-funded devnet mode,
- return actual model/specialist output,
- produce disclosure ledger and evidence pack.

This directly answers “are we faking it?” because the UI renders fresh run output and fresh evidence.

### Phase 4 — Server-funded devnet payment proof

Use approved devnet treasury/demo wallet, not judge wallet by default.

Deliverables:

- preflight balance check,
- cap-bounded transfer/payment route,
- Solana explorer signature rendered in timeline,
- post-run balance/receipt verification,
- fail-closed if devnet RPC/payment verification fails.

Important boundary:

- This proves devnet workflow/payment evidence, not mainnet settlement.

### Phase 5 — Redesign `/economic-demo` UI

Implementation approach:

- Replace current “everything at once” layout with a guided three-tab structure:
  1. **Run live demo**
  2. **Inspect latest run**
  3. **Evidence archive**
- Move long proof cards into collapsible drawers.
- Put rendered output and timeline above artifacts.
- Make wallet connect contextual, not global.

### Phase 6 — QA + recording rehearsal

Validation gates:

- targeted route tests for `live-run`,
- page/unit tests for wallet-hidden default state,
- e2e test: select template → run → output rendered → evidence timeline complete,
- product naming check,
- submission claim-boundary check,
- no secret leakage scan in evidence JSON,
- manual recording rehearsal with a cold page load.

## Key open questions

1. Do we want the first live UX PR to use controlled demo receipts only, or include server-funded devnet in the same PR?
   - Recommendation: controlled hosted live output first, server-funded devnet second.

2. Should the demo output be a webpage/code preview, a research brief, or a marketplace plan?
   - Recommendation: webpage/code preview because the judge can see a tangible generated artifact.

3. Should judge wallet participation be available at all for the submission?
   - Recommendation: optional advanced mode only. Do not require it for the main recording.

4. Which specialist chain should be canonical?
   - Recommendation: planning → content/code → verification, because we already have endpoint and evidence lineage.

## Recommended next activities after current task work

1. Incorporate Belle’s UX brief into this plan.
2. Open a new PR/issue: “Redesign `/economic-demo` around live run storytelling.”
3. Implement `POST /api/economic-demo/live-run` in controlled hosted mode.
4. Redesign the page around prompt → quote → live timeline → rendered output → evidence drawer.
5. Add server-funded devnet evidence mode as a second PR.
6. Rehearse recording and cut any remaining clutter.

## Non-negotiable claim boundaries

- No mainnet payment claim.
- No production paid settlement claim unless actually verified.
- No user wallet requirement unless the user is signing a bounded devnet action.
- No hidden arbitrary endpoint calls.
- No private prompt/payload storage in public evidence artifacts.
- No “live” label for historical snapshots; call those “evidence archive.”

## Belle UX review incorporation

Belle confirmed the core problem: the page is evidence-rich but judge-hostile. The current UX gives too many equal-weight CTAs and makes historical evidence feel like the product. Her recommended story spine is now the implementation target:

> Prompt → quote/approval boundary → specialist endpoint challenge → controlled/devnet evidence → attested returned output → evidence drawer.

### UX decisions adopted

1. **No wallet by default.** Wallet connect should be hidden unless the user explicitly chooses a user-funded devnet mode. It should not appear for historical artifacts, controlled demo receipts, unpaid x402 challenge proof, server-funded devnet proof, or archive browsing.
2. **One primary CTA.** Replace the current multi-button evidence cockpit with a single “Run demo” action and a secondary “Open evidence archive.”
3. **Rendered output is the hero proof.** The main judge payoff should be the returned webpage/plan/code/attestation output, not artifact links.
4. **Live language must be precise.** Historical snapshots become “Evidence archive.” “Live” is reserved for fresh API run state or freshly fetched endpoint/challenge evidence.
5. **Proof lanes must be labelled.** Controlled hosted workflow, server-funded devnet proof, and historical archive need separate lane labels so we do not overclaim production settlement.

### Belle-recommended smallest clean PR

1. Add no-wallet default “Run demo” page layout.
2. Reframe existing `webpage-live-workflow` evidence into:
   - quote card,
   - timeline,
   - rendered output panel,
   - evidence drawer.
3. Move current proof panels into collapsed archive.
4. Hide wallet connect unless `user_devnet_wallet` mode is selected.
5. Add tests asserting:
   - wallet button is not visible in default judge mode,
   - primary CTA is unique,
   - evidence archive is collapsed by default,
   - controlled/historical lanes are not labelled as production settlement,
   - rendered output appears above raw artifact links.

### Final next-activity sequence

After PR #280/current task work is complete:

1. **PR A — UX restructure using existing evidence only**
   - No new payment path.
   - No live spend.
   - Convert the page to the Belle IA: hero → prompt/template → quote → timeline → rendered output → archive.
   - Hide wallet by default.

2. **PR B — Fresh hosted live-run API**
   - Add `POST /api/economic-demo/live-run` for controlled hosted workflow.
   - Use exact allowlisted Coolify specialist endpoints.
   - Return fresh output and evidence bundle.
   - Still no production settlement claim.

3. **PR C — Server-funded devnet proof lane**
   - Use approved devnet treasury/demo signer.
   - Show tx signatures, caps, receipt verification, and fail-closed status.
   - Keep judge wallet optional.

4. **PR D — Recording rehearsal + clutter cut**
   - Run cold-page-load rehearsal.
   - Remove any remaining “debug cockpit” content from the default viewport.
   - Keep appendix/evidence drawer for judges who want proof depth.
