# Landing Page + Economic Demo Messaging Plan — 2026-05-08

> **Superseded by RAP Assurance claim remediation.** This historical plan is not current public copy. Use `docs/PUBLIC-CLAIM-BOUNDARY.md` and the current landing page instead: payments prove transfer; RAP Assurance proves paid work.

## Goal

Reframe the public Reddi Agent Protocol experience around the prosumer/builder job-to-be-done: agents should be able to discover specialists, bind payment-proof references, verify evidence, and produce bounded reputation inputs.

The site should convert three audiences:

1. **Existing agent-system users** — OpenClaw, Claude/MCP, OpenSwarm-style systems, ElizaOS, local/custom agents that need external specialist capability.
2. **Specialist builders** — teams or prosumers running useful agents who can integrate `reddi-x402`, publish capability/rate metadata, and earn from marketplace work.
3. **Attestor/consumer agents** — agents that verify outputs, receipt chains, and release criteria, or consume specialists under policy.

## Positioning

Primary frame:

> Payments prove transfer. RAP Assurance proves paid work.

Supporting frame:

> Reddi Agent Protocol is an assurance layer for paid MCP/API and agent work: discovery metadata, x402/payment-proof references, receipts, evidence, attestations, replay, and bounded reputation inputs for existing agent systems.

Core verbs:

> Discover. Decide. Prove.

## Implementation slices

### Slice 1 — Homepage conversion hierarchy

- Replace abstract hero emphasis with concrete agent-commerce promise.
- Make `/economic-demo` the primary CTA.
- Add explicit secondary CTAs for `Register a specialist` and `Connect your agent system`.
- Surface MCP/existing agent system support above the fold.
- Move sponsor proof lower and rename it as proof, not the story.
- Replace “Volunteer testers wanted” with “Devnet participants wanted”.
- Add role cards: run agents, build specialists, verify work.

### Slice 2 — Economic demo as lighthouse story

- Rename demo hero from operator/audit framing to “watch an agent hire specialists”.
- Put the narrative loop first: prompt → quote → x402 payment → specialists → attestation → evidence.
- Add visible participation CTAs: specialist, attestor, consumer agent.
- Add a simple money/work graph before dense evidence.
- Keep boundary honesty, but consolidate it instead of repeating operator warnings above the story.

### Slice 3 — BDD conversion gates

Before any final demo recording, add and run BDD-style Playwright checks for the four role journeys:

- `/register` — specialist builder understands x402-style gating, capability metadata, and bounded evidence/reputation inputs before any wallet registration.
- `/planner` — consumer-agent operator sees existing-agent-system framing, policy-before-payment, receipts-after-work, and cannot discover specialists without a task prompt.
- `/mcp-bridge-demo` — MCP adopter sees the bridge as the existing-agent-system integration path, with links to planner and economic demo plus local-first proof artifacts.
- `/attestation` — attestor sees output validation, receipt inspection, reputation protection, and can resolve an attestor candidate against mocked planner APIs.

Command:

```bash
npm run test:e2e:marketplace-conversion -- --project=chromium
```

### Slice 4 — Surfpool local validator rehearsal

Before any devnet recording, prove the on-chain parts locally in Surfpool so the demo has a deterministic safety gate:

- Register/listing path: specialist registration PDA/instruction construction and registry state expectations.
- Consumer/planner path: quote/terms hash, payment-intent semantics, receipt/disclosure-ledger export.
- MCP bridge path: quote-only governance first, then local payment semantics only after dry-run assertions pass.
- Attestor path: attestation/reputation update semantics and release/verification boundary.

Commands already available for the first rehearsal layer:

```bash
npm run smoke:rap-mcp-bridge:surfpool-local
npm run smoke:economic-demo:surfpool
npm run test:surfpool:onboarding
```

If any Surfpool lane fails, stop and fix locally before touching devnet.

### Slice 5 — Bounded devnet proof + recorded collateral

After BDD and Surfpool pass, run one final bounded devnet proof and record the user-facing journey for onboarding/hackathon collateral:

1. Run the devnet proof with explicit spend caps and no mainnet/Jupiter execution claims.
2. Capture the browser journey with Playwright video or Peekaboo:
   - homepage → `/mcp-bridge-demo`
   - planner/consumer policy path
   - specialist `/register` path
   - attestor `/attestation` path
   - `/economic-demo` final proof/evidence lane
3. Save recording artifacts under `artifacts/final-recording-*/` with command logs and claim-boundary notes.
4. Build the narration script from the recorded flow, not from aspirational copy.

### Slice 6 — Framework onboarding documentation

Add user docs for existing agent frameworks:

- OpenClaw skill/playbook setup for the Reddi Agent Protocol MCP bridge.
- OpenSwarm AGENTS/instructions patch for quote-first paid specialists.
- Claude Code / Claude Desktop MCP config.
- Codex / custom agent setup where MCP or HTTP wrappers are available.
- `reddi-x402` package usage for specialist payment gates and consumer-agent spend delegation.
- Wallet delegation guidance: consumer wallet remains owner, agent receives a bounded delegate/session authority with explicit caps, expiry, allowed specialists/networks, and receipt logging.

## Guardrails

- Keep product name as **Reddi Agent Protocol** and package as **`reddi-x402`**.
- Do not claim mainnet settlement.
- Do not claim reliable Jupiter devnet swap execution; keep it labelled as boundary/simulation unless mainnet is explicitly approved.
- Do not trigger paid live runs from page load.
- Keep `/economic-demo` default lane no-wallet unless user explicitly chooses bounded devnet/live mode.
