# Pitch Collateral — Why Specialist Agents Still Matter

> **Superseded by RAP Assurance claim remediation.** This historical pitch note is not current public copy. Use `docs/PUBLIC-CLAIM-BOUNDARY.md`: payments prove transfer; RAP Assurance proves paid work.

Source video: **“Andrej Karpathy on one of AI's weirdest flaws: the car wash problem”** — Sequoia Capital, 2:22  
URL: https://www.youtube.com/watch?v=dbg39yrHT9s

## Core takeaway

Even frontier general-purpose LLMs are **jagged**: they can perform spectacularly in some domains while failing at simple tasks outside the circuits emphasized by training, RL, or the lab’s data distribution. This is the strategic reason specialist agents matter: they give users a way to move from “hope the general model is in-distribution” to “route work through agents with domain context, tools, verification, and repeatable operating boundaries.”

## Useful points extracted from the video

1. **General intelligence is not smooth capability**
   - The model can refactor a 100k-line codebase or find vulnerabilities, yet fail a trivial real-world judgment such as whether to drive to a car wash 50 meters away.
   - Pitch use: “Strong general models are powerful, but their reliability is jagged.”

2. **Capabilities depend on what labs chose to emphasize**
   - Models improve sharply in areas that receive more training/evaluation focus.
   - Code is strong partly because it is economically valuable, heavily represented, and verifiable.
   - Chess improved from GPT-3.5 to GPT-4 not simply because of abstract capability growth, but because a large amount of chess data entered the pretraining mix.
   - Pitch use: “The frontier model’s strengths reflect the lab’s training distribution, not necessarily your application’s workflow.”

3. **There is no complete manual for where a model works**
   - Users must discover which “circuits” their application is in.
   - If the app is outside those circuits, the model struggles unless you add fine-tuning, scaffolding, tools, checks, or domain-specific work.
   - Pitch use: “Enterprises need operational systems around LLMs, not just raw model access.”

4. **Humans still need to stay in the loop when reliability matters**
   - The video frames jaggedness as a reason to treat LLMs as tools and remain close to what they are doing.
   - Pitch use: “Human-triggered, auditable agent workflows are a reliability feature, not a UX compromise.”

5. **Verifiability is the unlock for dependable specialization**
   - The speaker starts from verifiability: domains with clear feedback loops can be trained, tested, and trusted more effectively.
   - Pitch use: “Specialist agents should be evaluated by task outcomes, receipts, attestations, and reputation — not vibes.”

## How this maps to Reddi Agent Protocol

### Problem framing

Raw general-purpose LLMs are powerful but inconsistent. They can be brilliant in one workflow and brittle in the next because their capability surface is shaped by opaque training data and lab priorities.

### Reddi Agent Protocol framing

Reddi Agent Protocol should now be framed as **RAP Assurance for paid specialist work**, not a broad marketplace claim:

- specialist profiles expose which jobs an agent is meant to perform;
- payment gates expose payment-proof references without proving work quality by themselves;
- attestations and reputation inputs create post-job evidence for review;
- Solana/Quasar material is reference or explicitly bounded evidence, not mainnet/live production proof;
- fallback boundaries are labelled honestly so demos do not overclaim.

### Why specialist agents beat “just call GPT-5”

A specialist agent is not merely a smaller prompt around a big model. It is a packaged operating surface:

- **Domain focus:** tuned prompts, schemas, tools, and evaluation loops for one job class.
- **Verifiable outputs:** receipts, signatures, attestations, and replayable artifacts.
- **Economic accountability:** the agent is paid for work and can earn or lose reputation.
- **Routing discipline:** the system chooses the right agent for the job instead of assuming one model is uniformly good at everything.
- **Human control:** the user triggers, reviews, and approves costly or sensitive actions.

## Malatang analogy

We are experimenting with **Malatang** as an analogy, not as the product name. The idea: users choose the ingredients they need, the system assembles them into a coherent bowl, and the value comes from composability plus a repeatable preparation layer. In Reddi Agent Protocol terms, specialist agents are the ingredients, x402-style rails can prove transfer/payment intent, and RAP Assurance provides the receipt/evidence/replay layer that records whether paid work met the agreed terms.

For now, do not rename the product to Malatang. Use it only as a way to explain how specialist-agent composition works.

## Pitch deck copy options

### Slide headline options

- “Frontier LLMs are powerful, but capability is jagged.”
- “Specialist agents turn jagged AI into accountable work.”
- “The future is not one chatbot. It is routed, paid, verifiable agent labor.”

### Short deck paragraph

Frontier models can be brilliant in one domain and unreliable in the next because their strengths reflect opaque training distributions and lab priorities. RAP Assurance wraps paid specialist work with terms, payment-proof references, evidence, attestations, replay, and bounded reputation inputs — turning unpredictable model output into inspectable paid-work records.

### Founder narration

“Karpathy’s car-wash example captures the problem perfectly: the same model that can refactor a massive codebase might still fail a simple practical judgment. That is why our thesis is not ‘one model does everything.’ Our thesis is routed specialist agents: each agent has a job, a price, a receipt, a reputation trail, and verifiable outcomes.”

### One-liner

“Specialist agents are how you productize frontier models when raw model capability is jagged.”

## Suggested placement in deck

Best fit: immediately after the “Why now?” or “Problem” slide.

Suggested sequence:

1. Frontier LLMs unlocked general capability.
2. But capability is jagged and opaque.
3. Work needs specialization, routing, and verification.
4. The Economic Singularity / agent-commerce thesis explains why those specialists also need payment rails: agents increasingly buy APIs, services, data, tools, and other agent work.
5. Reddi Agent Protocol provides RAP Assurance for specialist work, with x402/Solana helpers as adapter primitives rather than payment-facilitator or marketplace claims.

Companion macro framing: `docs/PITCH-ECONOMIC-SINGULARITY-AGENT-COMMERCE-2026-05-08.md`.

## Evidence-safe wording

Use:

- “Inspired by Karpathy’s jagged capability framing.”
- “General-purpose models still need domain scaffolding and verification.”
- “Reddi Agent Protocol provides RAP Assurance for routed, paid, attestable specialist work; payment rails prove transfer, RAP records what the paid work proves.”

Avoid:

- “Karpathy endorses Reddi Agent Protocol.”
- “Specialist agents are always more capable than frontier models.”
- “General-purpose LLMs cannot do specialist work.”

The correct claim is narrower and stronger: **specialist agents make frontier model capability more reliable, accountable, and economically composable.**
