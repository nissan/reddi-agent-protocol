# Features Demo — Scene-by-Scene Walkthrough Scripts

> **Superseded by RAP Assurance claim remediation.** The narration cues below are historical, not current public copy. Use `docs/PUBLIC-CLAIM-BOUNDARY.md`: payments prove transfer; RAP Assurance proves paid work — `/agents` is the specialist directory, and settlement/escrow lines here describe the reference model, not deployed behavior.

_Date: 2026-04-22_

Purpose: give demonstrators a deterministic script + shot plan tied to our BDD-backed feature set, with explicit preflight checks to avoid IRL demo failures.

---

## 0) Mandatory preflight (run before **any** recording)

## App + runtime

1. From repo root (`projects/reddi-agent-protocol-code`):

```bash
pnpm build
pnpm dev
```

2. Confirm app is reachable:
- `http://127.0.0.1:3010`

3. If showcasing specialist execution via local model:

```bash
ollama serve
ollama list
```

Ensure at least one model is present (for example `qwen2.5:7b` or equivalent).

4. If using a local specialist endpoint from hosted UI, start a tunnel and verify HTTPS URL:
- ngrok (recommended) / localtunnel (fallback); cloudflared deferred pending RCA
- test URL responds on required paths (`/v1/*`, `/healthz`)

## Wallet preflight

Use separate devnet wallets where possible:
- **Specialist wallet**
- **Attestor wallet**
- **Consumer wallet**

Checklist:
- Wallet extension connected to **Devnet**
- Each wallet funded (recommended buffer: **>= 0.05 SOL** per active demo wallet)
- Registration flow wallet has enough for register tx + retries

## Attestor operator preflight (required for attestation scenes)

Set env var in the same Next.js process:
- `ONBOARDING_ATTEST_OPERATOR_SECRET_KEY` = JSON array of 64 bytes

Verify endpoint before filming:
- `GET /api/onboarding/attestation-operator`
- expect `ready: true`

Reference: `docs/ONBOARDING-ATTESTATION-OPERATOR-SETUP.md`

## Demo integrity checks

- Browser tab is hard-refreshed before each role walkthrough
- No wallet popup pending from prior failed tx
- Explorer tab pre-opened (devnet) for tx proof
- Backup screenshots folder ready for cutaway inserts

---

## 1) Video A — Platform capabilities overview (All roles, 120–180s)

Goal: show the full system surface and where each role fits.

| Scene | Route / Screen | What to show | Narration cue |
|---|---|---|---|
| A1 | `/` | Hero + value proposition | "Reddi Agent Protocol is a trust layer for agent commerce, not just a directory." |
| A2 | `/features` (All roles) | Full catalog list | "Every item here maps to BDD-tested behavior and concrete implementation evidence." |
| A3 | `/features` role dropdown | Switch All -> Specialist -> Attestor -> Consumer | "Potential adopters can immediately filter capabilities by their role." |
| A4 | `/agents` | Marketplace discovery | "Specialists are discoverable with health, attestation, and pricing signals." |
| A5 | `/planner` | Planner-native invocation surface | "Consumers orchestrate resolve, invoke, settlement, and quality signals from one flow." |
| A6 | `/runs` + `/audit` | Run lifecycle and auditability | "Settlement and scoring remain independently auditable." |
| A7 | `/whitepaper` (optional) | Protocol framing | "Mechanism design and economics are documented for technical due diligence." |

Shot notes:
- Capture A2/A3 as smooth dropdown interaction clip.
- Keep A6 ready with fallback screenshots if no fresh run exists.

---

## 2) Video B — Specialist role walkthrough (90–150s)

Goal: prove a specialist can onboard safely and be invoked through paid flow contracts.

| Scene | Route / Screen | What to show | Narration cue |
|---|---|---|---|
| S1 | `/features?role=specialist` | Specialist-filtered feature list | "This is the specialist capability footprint." |
| S2 | `/onboarding` Step flow | Consent + runtime gates | "Onboarding blocks progression until safety and runtime checks pass." |
| S3 | `/register` | Endpoint preflight (safe URL), capability/rate setup | "Registration preflight prevents unsafe endpoints and mismatched contracts." |
| S4 | Wallet popup + tx confirmation | Register tx signed | "Once signed, specialist identity is persisted on-chain." |
| S5 | `/agents` | Newly visible specialist listing | "The specialist becomes discoverable with health and metadata." |
| S6 | `/planner` (consumer-triggered invoke) | Specialist response path | "Invocations are policy-gated and payment-aware." |

Failure-proof notes:
- Have tunnel URL validated before S3.
- Keep one already-registered specialist as fallback if new registration fails live.

---

## 3) Video C — Attestor role walkthrough (90–150s)

Goal: show attestation quality control and schema reliability.

| Scene | Route / Screen | What to show | Narration cue |
|---|---|---|---|
| T1 | `/features?role=attestor` | Attestor-filtered list | "Attestors enforce quality and verification contracts." |
| T2 | `/onboarding` attestation steps | Healthcheck gate + operator status check | "Attestation is blocked until health passes and operator signer is ready." |
| T3 | `/api/onboarding/attestation-operator` (or UI check button) | `ready: true` state | "Operator readiness is explicit and test-backed." |
| T4 | Attestation submit action | Successful attestation result | "Attestation writes structured evidence tied to run lifecycle." |
| T5 | Schema-drift guard evidence (optional terminal/API clip) | rejected malformed payload | "Invalid rubric payloads fail deterministically and do not mutate reputation." |
| T6 | `/audit` | Attestation/audit trail visible | "Every evaluation action is recoverable from audit logs." |

Failure-proof notes:
- Never start this video before operator preflight returns ready.
- Keep one canned successful attestation payload for controlled run.

---

## 4) Video D — Consumer role walkthrough (120–180s)

Goal: show end-to-end orchestration and settlement outcomes.

| Scene | Route / Screen | What to show | Narration cue |
|---|---|---|---|
| C1 | `/features?role=consumer` | Consumer-filtered capabilities | "Consumers get deterministic routing, invoke, and settlement controls." |
| C2 | `/planner` | Resolve specialist by policy | "Policy constraints drive deterministic candidate selection." |
| C3 | `/planner` invoke | Paid call execution | "Invoke enforces budget and payment guardrails before execution." |
| C4 | `/planner` release/dispute tools | Settlement decision | "Settlement transitions are explicit, validated, and auditable." |
| C5 | `/planner` signal | Quality score submission | "Quality signals feed routing and reputation contracts." |
| C6 | `/runs` | Run status + trace | "Each run stores trace and lifecycle metadata for auditability." |
| C7 | `/dogfood` forced pass + forced fail (optional) | released vs refunded | "Escrow outcome is quality-gated and visible end-to-end." |

Failure-proof notes:
- Prepare one known-good prompt and one fallback prompt.
- If live invoke endpoint is unstable, use Dogfood forced pass/fail lane.

---

## 5) Video E — OpenOnion integration walkthrough (90–150s)

Goal: prove external runtime operators can integrate across all three roles.

| Scene | Route / Screen | What to show | Narration cue |
|---|---|---|---|
| O1 | `/features` and filter by role | OpenOnion-tagged capabilities present | "OpenOnion integration is mapped into specialist, attestor, and consumer lanes." |
| O2 | `/register` with integration=openonion context | contract preflight path | "Specialist contract is validated before onboarding is accepted." |
| O3 | Attestor payload validation clip | schema pass/fail behavior | "Attestor schema drift is rejected deterministically." |
| O4 | Consumer failover path | retry exhausted -> refund disposition | "When specialists become unreachable, consumer flow exits safely with refund semantics." |
| O5 | Security guard clip | localhost/private URL rejection | "Hosted onboarding blocks unsafe localhost/private callback targets." |

---

## 6) Recording format template (for every scene)

Use this structure in your shot sheet:

- **Scene ID:**
- **Role:**
- **Route/UI:**
- **Capture type:** screen recording or screenshot
- **Expected success signal:**
- **Fallback asset:** file path if live run fails
- **Voice line (1 sentence):**

---

## 7) Fast “Go / No-Go” checklist before hitting record

- [ ] `pnpm build` passed on current branch
- [ ] App running and reachable on target URL
- [ ] Wallet network = devnet and funded
- [ ] Ollama runtime (if used) healthy and model loaded
- [ ] Tunnel URL healthy (if used)
- [ ] Attestor operator key ready (if filming attestation)
- [ ] Explorer tab ready for tx proof
- [ ] Backup screenshots/video artifacts prepared

If any item fails, pause recording and fix first.
