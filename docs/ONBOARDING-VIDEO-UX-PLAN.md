# Onboarding Video + UX Plan — Reddi Agent Protocol

> **Superseded by RAP Assurance claim remediation.** This historical video plan is not current public copy. Use `docs/PUBLIC-CLAIM-BOUNDARY.md`: payments prove transfer; RAP Assurance proves paid work.

Purpose: turn the proof videos and judge replication guide into a guided onboarding path for website visitors, builders, specialists, and judges.

Core framing: **these are proof walkthroughs, not ads**. Each video should show what happened, what can be replicated, and the devnet/mainnet boundary.

---

## Recommended video set

### 1. Start Here — Website Tour + Setup Guide

**Target user:** first-time visitor, judge, developer, or agent builder.
**Goal:** explain what Reddi Agent Protocol is and route users to the right path.

**Length:** 60–75s.
**Capture:** scripted Playwright. No wallet/private desktop required.

**Voiceover draft (~45s):**

> Payments prove transfer; RAP Assurance proves paid work.
> The flow is simple: discover a specialist, evaluate policy, bind payment-proof and evidence references, verify the work, then produce bounded reputation inputs.
> On the homepage, start with the three paths: connect your agent system, register a specialist, or try the economic demo.
> If you run local compute, the setup guide walks you through exposing Ollama, defining tools and skills, testing the endpoint, and following the currently gated devnet/local registration path.
> If you’re judging the proof, open the economic demo and replication guide.
> This is devnet evidence, not a mainnet settlement claim.
> Start with the path that matches what you are: consumer, specialist, or verifier.

**Visual beats:**

| Time | Scene |
|---|---|
| 0–6s | Homepage hero; freeze on headline. |
| 6–14s | Highlight CTAs: connect agent system, register specialist, economic demo. |
| 14–24s | Scroll discover → pay → verify section. |
| 24–42s | `/setup` tabs: Connect → Tools → Skills → Test. |
| 42–52s | `/register` overview; show wallet/register form without implying live tx. |
| 52–65s | `/economic-demo` proof panels + replication CTA. |

**CTA:** `Choose your path: consumer, specialist, or verifier.`

**Script to create:** `scripts/record-onboarding-overview-playwright.mjs`

---

### 2. Hire an Agent — Claude Code + RAP MCP x402

**Target user:** agent/tooling developer using Claude Code, MCP, OpenClaw, or custom orchestration.
**Goal:** show that an agent can discover and call a paid specialist under policy.

**Length:** 35–45s.
**Capture:** reuse Loop 45 proof, optionally prepend 8–12s Playwright marketplace framing.

**Canonical asset:**

`artifacts/claude-code-mcp-x402-peekaboo-demo/loop45-voiceover-work/rap-mcp-x402-30s-voiceover-final.mp4`

**Voiceover draft:**

> This is Claude Code starting with Reddi Agent Protocol MCP tools.
> Before anything runs, the boundary is visible: devnet only, exact endpoint allowlist, and a sixty-thousand micro-USDC cap.
> Claude discovers specialists, selects the RAP code-generation endpoint, and executes one x402-gated request.
> The important part is not the prompt. It is the receipt trail.
> The output shows the selected endpoint, request id, payment receipt, Solana devnet transaction, and disclosure ledger tying the payment to the result.
> Bounded spend. Visible proof. No mainnet claim.

**Visual beats:**

| Time | Scene |
|---|---|
| 0–6s | Terminal launch: “Starting Claude Code with Reddi Agent Protocol MCP tools…” |
| 6–12s | Freeze on policy boundary: allowlist + 60,000 micro-USDC cap. |
| 12–20s | Claude discovers/selects specialist. |
| 20–28s | x402 request execution. |
| 28–40s | Freeze on receipt, tx signature, disclosure ledger. |

**Proof links:**

- Receipt: `x402_specialist_0460d1e4214ab0f0ddb7d667`
- Devnet tx: `3oVM9kKqMME6J4sufvWRT5s6F1N9HcLnUGTDeLbxXQNyuAEkC7Nt4JxKs9aoxun7FVTCvzeS4Pwt2PqPMwF1oGGV`

**CTA:** `Connect your agent system` → `/setup#mcp-video`

**Script to create if adding web intro:** `scripts/record-orchestrator-onboarding-playwright.mjs`

---

### 3. Economic Proof — Phantom Z-picture Paid Workflow

**Target user:** judge, investor, protocol reviewer, or developer asking whether payment actually happens.
**Goal:** show wallet authorization, x402 devnet spend, generated output, and clear adjacent proof boundaries.

**Length:** 45–60s.
**Capture:** reuse Loop 50 by default. Live Phantom recapture only with explicit approval because it touches wallet UX/devnet balances.

**Canonical asset:**

`artifacts/economic-demo-z-picture/loop50-45s-voiceover-work/economic-demo-z-picture-45s-voiceover-final.mp4`

**Voiceover draft:**

> This demo starts in the browser with a funded Phantom devnet wallet.
> The wallet authorizes the Reddi Agent Protocol run. Then the workflow spends devnet USDC through x402 across four specialist steps: planning, content, code generation, and verification.
> The visible result is deliberately simple: generate a Z picture. The proof is what matters.
> The run records point-one-three USDC spent, the generated image, and four finalized Solana devnet payment transactions.
> MagicBlock and Umbra appear as adjacent devnet or artifact-backed evidence. Torque is shown as a demo-local reputation projection.
> That boundary matters. This is proof, not overclaiming.

**Visual beats:**

| Time | Scene |
|---|---|
| 0–7s | Phantom connected + Z result panel. |
| 7–15s | Show spend: `0.130000 USDC`. |
| 15–25s | Payment txs in Explorer/Solscan; freeze on success/finalized. |
| 25–34s | MagicBlock PER evidence. |
| 34–40s | Umbra create/claim evidence. |
| 40–45s | Torque boundary panel + end card. |

**Boundary language:**

- Phantom signs browser authorization.
- x402 settlement is Solana devnet SPL evidence.
- MagicBlock/Umbra are devnet or artifact-backed proof.
- Torque is demo-local compatible reputation projection, not live mainnet rewards.

**CTA:** `Run controlled demo` → `/economic-demo#video-guide`

---

### 4. Register an Agent — CLI Registration + On-chain Proof

**Target user:** specialist builder or judge verifying permissionless onboarding.
**Goal:** prove a new agent can be registered from the CLI and independently verified on Solana devnet.

**Length:** 45–60s.
**Capture:** hybrid. Use Playwright for `/register` intro and reuse Loop 51 for CLI proof. Do not rerun CLI registration unless explicitly approved.

**Canonical asset:**

`artifacts/agent-registration-cli/loop51-final-peekaboo-registration/voiceover-45s/agent-registration-cli-solscan-45s-voiceover-final.mp4`

**Voiceover draft:**

> This is the specialist side of Reddi Agent Protocol.
> The CLI creates a fresh devnet owner, funds it, submits `register_agent` to the Quasar registry program, and reads the agent PDA back from chain.
> The terminal shows the owner, the agent PDA, funding transaction, registration transaction, account length, and lamports.
> Then the proof moves out of the CLI. Solscan and Solana Explorer show the registration and funding transactions as successful and finalized.
> The claim is narrow on purpose: devnet CLI registration with public transaction proof.
> No approval gate. No private index. Register, verify, inspect.

**Visual beats:**

| Time | Scene |
|---|---|
| 0–5s | CLI launch / command context. |
| 5–12s | Freeze on owner, agent PDA, funding tx, registration tx. |
| 12–20s | Browser opens Solscan registration tx. |
| 20–28s | Freeze on `SUCCESS`. |
| 28–35s | Solscan funding tx / finalized proof. |
| 35–42s | Solana Explorer details / finalized state. |
| 42–45s | End card: “Register a specialist”. |

**Proof links:**

- Registry program: `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`
- Agent PDA: `FVPc5cJvDfk7QH7B7aHxP5TKnswwYir57xmL6fRwm3DN`
- Registration tx: `fUip7uF6NcrFP9HZeVY1nVsP9XTn9feALhLHLY3uWWjyxVxWbJ3Fj2V5NNe44sc7HQ2X4GqqC5KvcvzXZeTy4PV`
- Funding tx: `32yUENPMHQNQPCbcecbQForcbq4DzmE3AgZogykC8GQrmZ2bbUvPrz6UkNswo6p69v7RSJDwJRn2MdLPEc6FAijL`

**CTA:** `Register a specialist` → `/register#video-guide`

**Script to create for web intro:** `scripts/record-agent-registration-onboarding.mjs`

---

## Optional full onboarding cut

Create one stitched 2.5–3 minute overview:

| Time | Segment |
|---|---|
| 0:00–0:45 | Website overview / choose your path. |
| 0:45–1:15 | Hire/pay proof from Loop 45. |
| 1:15–2:00 | Economic proof from Loop 50. |
| 2:00–2:45 | Registration proof from Loop 51. |
| 2:45–3:00 | Judge replication CTA. |

Output: `public/videos/onboarding-full.mp4`

---

## UX/UI placement

### Shared data model

Create `lib/onboarding/video-guides.ts`:

```ts
export const onboardingVideos = [
  {
    id: "overview",
    title: "Start using Reddi Agent Protocol",
    eyebrow: "Start here",
    duration: "60s",
    route: "/start",
    videoSrc: "/videos/onboarding-overview.mp4",
    posterSrc: "/videos/posters/onboarding-overview.jpg",
    boundary: "Devnet proof walkthrough",
    primaryCta: { label: "Choose your path", href: "/start" },
    secondaryCta: { label: "Verify the proof", href: "/start#verify" },
  },
  {
    id: "mcp-x402",
    title: "Claude Code pays a RAP specialist",
    eyebrow: "Hire agents",
    duration: "30s",
    route: "/setup#mcp-video",
    videoSrc: "/videos/onboarding-hire-agent-x402.mp4",
    posterSrc: "/videos/posters/onboarding-hire-agent-x402.jpg",
    boundary: "Solana devnet only",
  },
  {
    id: "economic-proof",
    title: "Run the paid economic demo",
    eyebrow: "Verify payment",
    duration: "45s",
    route: "/economic-demo#video-guide",
    videoSrc: "/videos/onboarding-economic-proof.mp4",
    posterSrc: "/videos/posters/onboarding-economic-proof.jpg",
    boundary: "Devnet settlement + demo-local reputation",
  },
  {
    id: "register-agent",
    title: "Register an agent on-chain",
    eyebrow: "Build specialists",
    duration: "45s",
    route: "/register#video-guide",
    videoSrc: "/videos/onboarding-register-agent.mp4",
    posterSrc: "/videos/posters/onboarding-register-agent.jpg",
    boundary: "Devnet registry proof",
  },
];
```

### Shared components

Create:

- `components/onboarding/OnboardingVideoCard.tsx`
- `components/onboarding/OnboardingVideoGrid.tsx`
- optionally `components/onboarding/ProofChips.tsx`

`OnboardingVideoCard` props:

- `title`
- `eyebrow`
- `description`
- `videoSrc`
- `posterSrc`
- `duration`
- `primaryCta`
- `secondaryCta`
- `proofLinks[]`
- `boundaryLabel`
- `layout?: "stacked" | "horizontal"`

Design:

- 16:9 video thumbnail.
- Rounded border `border-white/10`.
- Play overlay.
- Devnet boundary badge always visible.
- Compact proof chips below body copy.
- Mobile: thumbnail first, then copy/CTA.
- Desktop: horizontal card available for contextual embeds.

---

## Page modifications

### Homepage `/`

Placement: immediately after hero CTAs, before stats.

Section title:

> Start with the 3 proof videos

Cards:

1. Claude Code pays a RAP specialist → `/setup#mcp-video`
2. Run the economic demo → `/economic-demo#video-guide`
3. Register an agent on-chain → `/register#video-guide`

Why: users currently have to infer the path. The video row gives a visual ladder.

### New `/start` page

Recommended route: `/start`.

Page structure:

1. Hero: `Start using Reddi Agent Protocol in 3 videos`
2. Four cards:
   - Website overview
   - Use RAP from Claude Code
   - Run the paid economic demo
   - Register your own specialist
3. Pick-your-role CTA row:
   - `I run agents` → `/setup`
   - `I build specialists` → `/register`
   - `I want proof` → `/economic-demo`
4. Replication block:
   - Link to judge replication page/guide.
   - Command: `node scripts/judge-replication-check.mjs`

Add nav link:

- Desktop primary nav or `More`: `Start`
- Mobile: near top, above Marketplace.

### Setup `/setup`

Placement: top of page below header, before tabs.

Anchor: `#mcp-video`

Module title:

> Video guide: Claude Code + RAP MCP x402 specialist call

Body:

> See Claude Code discover a specialist, execute one bounded devnet x402 payment, and print the receipt/disclosure ledger.

CTAs:

- `Copy Claude prompt`
- `Open replication guide`

Also add a “Watch before configuring” chip inside the Connect tab.

### Marketplace `/agents`

Placement: above filters, below page header.

Module title:

> How marketplace discovery works

Use the Claude/MCP video here. Marketplace users need to understand discover → select → paid call before browsing cards.

CTAs:

- `Connect your agent system`
- `Register a specialist`

Empty/loading fallback:

> New here? Watch the 30s marketplace call before choosing a specialist.

### Register `/register`

Placement: after page header / benefit cards, before wallet connection steps.

Anchor: `#video-guide`

Module title:

> Video guide: register a specialist on-chain

Body:

> Watch a fresh devnet agent registration: owner funding, registry transaction, PDA readback, and Explorer proof.

CTAs:

- `Start guided setup`
- `Open CLI replication steps`

Wallet-step helper copy:

> Prefer CLI first? Watch the 45s registration proof, then return here to register with your wallet.

### Economic demo `/economic-demo`

Placement: hero/proof area, before funded devnet proof card.

Anchor: `#video-guide`

Module title:

> Video guide: Phantom-authorized paid workflow

Body:

> See a wallet-authorized Z-picture run spend devnet USDC through x402, return output, and verify the payment evidence.

CTAs:

- `Run controlled demo`
- `Verify recorded txs`

Desktop side-card near evidence archive:

> Watching proof? Start with the 45s video.

---

## Capture and production scripts

Create:

1. `scripts/record-onboarding-overview-playwright.mjs`
   - captures public pages only.
   - outputs screenshots, MP4, contact sheet.
   - no wallet, no private desktop.

2. `scripts/record-orchestrator-onboarding-playwright.mjs`
   - captures marketplace/setup/demo framing.
   - stitches with Loop 45 proof.

3. `scripts/record-agent-registration-onboarding.mjs`
   - captures `/register` intro only.
   - stitches with Loop 51 proof.
   - does **not** rerun registration by default.

4. `scripts/build-onboarding-video-bundle.mjs` or `.sh`
   - copies/compresses canonical videos to `public/videos/`.
   - generates posters with ffmpeg.
   - optionally stitches `onboarding-full.mp4`.

Recommended public video outputs:

- `public/videos/onboarding-overview.mp4`
- `public/videos/onboarding-hire-agent-x402.mp4`
- `public/videos/onboarding-register-agent.mp4`
- `public/videos/onboarding-economic-proof.mp4`
- `public/videos/onboarding-full.mp4` optional
- `public/videos/posters/*.jpg`

If final MP4s are too large for the repo/Vercel build, host them via GitHub Releases or Vercel Blob and reference external URLs.

---

## Implementation priority

1. Add `/start` hub and shared video card components.
2. Copy/compress existing Loop 45/50/51 videos into `public/videos/` and generate posters.
3. Add contextual modules to `/setup`, `/register`, `/economic-demo`.
4. Add homepage video row.
5. Add marketplace helper module.
6. Produce the new Playwright website overview video.
7. Optional: stitch full 2.5–3 minute onboarding compilation.

---

## Acceptance checks

- `npm run lint` passes for changed app/components files.
- `/start` loads and all videos render with posters.
- `/`, `/setup`, `/agents`, `/register`, `/economic-demo` include contextual video modules.
- Every video card has a devnet/proof boundary badge.
- All CTA links work.
- `node scripts/judge-replication-check.mjs` still passes.
- MP4 sizes are acceptable for hosting path chosen.
