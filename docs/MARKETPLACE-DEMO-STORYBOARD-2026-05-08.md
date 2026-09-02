# Marketplace Demo Storyboard — 2026-05-08

> **Superseded by RAP Assurance claim remediation.** This historical storyboard is not current public copy. Use `docs/PUBLIC-CLAIM-BOUNDARY.md`: payments prove transfer; RAP Assurance proves paid work. Remaining “marketplace rail” wording below is archived context, not an active product claim.

## Source packet

Use the readiness harness packet as the source of truth:

```text
artifacts/marketplace-demo-readiness/20260508T114520Z/summary.json
artifacts/marketplace-demo-readiness/20260508T114520Z/marketplace-recording.webm
```

Fresh local Surfpool proof artifacts from the same run:

- RAP MCP Bridge local payment semantics: `artifacts/rap-mcp-bridge-surfpool-local/20260508T114531Z/SUMMARY.md`
- Economic demo local rehearsal: `artifacts/economic-demo-surfpool-rehearsal/20260508T114535Z/SUMMARY.md`
- Onboarding/attestation local smoke: `artifacts/surfpool-onboarding/20260508-214541/SUMMARY.md`

## Core claim

Reddi Agent Protocol lets existing agent systems discover specialist metadata, evaluate quotes/policy, bind payment-proof references, verify evidence, and disclose paid-work receipts without replacing the host framework.

## Video beats

### Beat 1 — Homepage promise

Visual: homepage hero.

Narration:

> Payments prove transfer; RAP Assurance proves paid work. Existing agents can discover specialists, evaluate policy, bind payment-proof and evidence references, and decide what the paid work record supports.

### Beat 2 — Existing agent systems connect through MCP

Visual: click “Connect your agent system” and land on `/mcp-bridge-demo`.

Narration:

> If you already run OpenClaw, Claude Code, Codex, OpenSwarm-style agents, or a custom runtime, you can keep your orchestration stack. The MCP bridge gives those agents a safe quote-first path into specialist discovery.

Boundary line:

> The default mode is dry-run and quote-first. Payment and invocation are gated.

### Beat 3 — Policy before payment

Visual: planner path.

Narration:

> A consumer agent does not just call an endpoint. It resolves candidates by capability, price, evidence posture, privacy mode, and budget policy before any x402 payment is attempted.

### Beat 4 — Specialist monetization path

Visual: `/register`.

Narration:

> Specialist builders can publish capabilities and pricing, add x402-style payment gates, and produce scoped work that can be attached to RAP Assurance receipts.

### Beat 5 — Attestor verification path

Visual: `/attestation`, resolve attestor.

Narration:

> Attestor agents verify outputs, receipts, release criteria, and reputation inputs. That turns paid specialist work into an auditable trail, not a blind API call.

### Beat 6 — Economic demo proof

Visual: `/economic-demo`, money + work graph and boundary copy.

Narration:

> The economic demo ties the story together: one request becomes quoted specialist work, payment evidence, attestation, and a disclosure ledger.

Boundary line:

> This recording is local-first. Surfpool validates the on-chain semantics before any bounded devnet proof. No mainnet execution is claimed.

### Beat 7 — Surfpool proof packet

Visual: terminal/artifact summary.

Narration:

> Before devnet, the readiness harness runs the conversion BDD, captures the recording journey, and proves MCP bridge, economic-demo, and onboarding-attestation flows on a local Surfpool validator.

Show:

```text
npm run demo:marketplace:readiness
```

### Beat 8 — Optional bounded devnet follow-up

Visual: command or runbook, not necessarily executed in the first video.

Narration:

> When the local gates are green, the same harness can opt into a bounded devnet proof. Devnet is explicit; mainnet remains out of scope unless separately approved and proven.

Show:

```text
npm run demo:marketplace:readiness -- --include-devnet
```

## Suggested short script (60–90 seconds)

> Your agent should not need to do every job itself. Reddi Agent Protocol gives existing agent systems an assurance path for specialist work: discover, quote, decide, prove, verify, and disclose.
>
> Here, an operator connects an existing agent system through the MCP bridge. The host can be OpenClaw, Claude Code, Codex, OpenSwarm-style orchestration, or a custom runtime. The default path is quote-first and dry-run safe.
>
> In the planner, the consumer agent applies policy before payment: task type, spend cap, privacy mode, and attestation requirements. No specialist is paid just because it was discovered.
>
> Specialist builders can register their agents, publish capabilities and pricing, and add `reddi-x402` payment gates so other agents can hire them for scoped work.
>
> Attestor agents close the loop. They verify outputs, receipt chains, release criteria, and reputation updates so paid work becomes auditable evidence.
>
> Before recording or touching devnet, we run the full local readiness harness. It checks the conversion BDD, captures this Playwright journey, and proves the MCP bridge, economic-demo, and onboarding-attestation flows on Surfpool local validator.
>
> Once those local gates pass, a bounded devnet proof can be run explicitly. This demo does not claim mainnet execution. It shows the path from existing agent frameworks to paid specialist-agent commerce with safety gates and evidence built in.

## Final recording checklist

- Run `npm run demo:marketplace:readiness`.
- Confirm `summary.json` has `ok: true`.
- Confirm `marketplace-recording.webm` exists and is long enough for narration.
- If devnet proof is desired, rerun with `--include-devnet` only after reviewing local artifacts.
- Build final script from the captured packet and current claim boundaries.

## Hackathon video deliverables

### Video 1 — 3-minute live product demo

Goal: produce a polished 3-minute video that sells the live product to hackathon judges. This is not a slide deck and not a code walkthrough. It should show the published product at:

```text
https://agent-protocol.reddi.tech
```

Required framing:

- Show the live product, not localhost, unless capturing a rehearsal-only fallback.
- Lead with the value proposition: existing agents can hire trusted specialist agents.
- Show real app flows/user journeys: homepage, MCP bridge, planner/consumer path, specialist registration path, attestor path, economic-demo evidence, and bounded devnet proof where approved.
- Use fast-forwards only to compress waiting/transition moments, not to hide important proof steps.
- Target exactly ~3 minutes.
- Sell what has been built in the strongest honest way for hackathon judges.
- Keep claim boundaries explicit: devnet/local evidence, no mainnet claim unless separately approved and proven.

Post-recording process:

1. Capture the live product app flows from `https://agent-protocol.reddi.tech` using `PLAYWRIGHT_BASE_URL=https://agent-protocol.reddi.tech`.
2. Use fast-forward sections to fit the story into ~3 minutes.
3. Draft the narration script from the actual captured footage and artifacts.
4. Generate Jarvis voiceover in chunks with Chatterbox to avoid memory pressure.
5. Clean memory between chunks as safely as macOS allows; do not claim swap can be fully cleared without reboot.
6. Stitch voiceover chunks and video with ffmpeg.
7. Review final cut for pacing, claim boundaries, and judge clarity.

Jarvis/chunking requirement:

- Split narration by beat/sentence.
- Generate each chunk as a separate process using the configured Jarvis voice.
- Save per-chunk WAV and logs.
- Run memory/swap telemetry before and after chunks.
- Use `/usr/bin/purge` opportunistically between chunks.
- Concatenate with short pauses, then mux into final video.

### Video 2 — separate team/founder intro

This is separate from the product demo video. Nothing fancy is required. The judges want to understand how we think and communicate.

Goal: introduce ourselves, tell judges what we are building, and explain why we are the right people to build it.

Suggested structure:

1. Who we are.
2. What problem we saw: agents are getting powerful, but paid specialist-agent work lacks trusted marketplace rails.
3. What we built: Reddi Agent Protocol for discovery, x402 payment gates, receipts, attestations, reputation, and evidence trails.
4. Why we are the right team: we care about honest proof, local-first validation, explicit boundaries, and making agent commerce safe enough for real builders.
5. Close with why this matters for the hackathon ecosystem.

Tone: clear, direct, human, confident. No hype that outruns proof.
