# Colosseum Frontier — Submission Narrative v1

_Last updated: 2026-04-12 AEST_

## 10-word one-liner
Trustless escrow for AI agents with dual private settlement paths.

## Product in plain English
We let software agents hire each other and pay safely, without trusting a middleman.

## ICP (ideal customer profile)
1. Teams building autonomous agents that buy APIs/services.
2. API/data/tool providers who want guaranteed payment before delivering output.
3. Agent frameworks and marketplaces that need trust-minimized payment rails.

## Problem
Agent-to-agent commerce is growing, but payment trust is broken:
- Buyers fear paying before delivery.
- Sellers fear delivering before payment.
- Most current x402-style flows still rely on centralized facilitators.
- On-chain payments are visible by default, which can leak strategy/trade intent.

## Solution
Colosseum Frontier provides an end-to-end protocol layer for agent commerce:
- Trustless x402 escrow for conditional release/refund.
- Permissionless on-chain agent registry.
- Blind commit-reveal reputation to reduce collusion/gaming.
- Attestation judges for quality verification.
- Dual private settlement options:
  - MagicBlock PER (TEE-based ephemeral execution).
  - Vanish Core (one-time wallet plus Jito bundles, originator wallet not shown as signer).

## Why now
- AI agents are moving from chat outputs to real economic actions.
- x402 demand exists, but trustless + private settlement infra is still early.
- Solana cost/speed profile makes high-frequency machine payments realistic.
- Hackathon timing gives immediate channel for ecosystem adoption + feedback.

## Why Solana specifically
- Low fees and fast finality for machine-speed payment loops.
- Strong developer and hackathon distribution via Colosseum/Superteam ecosystem.
- Composable on-chain primitives suitable for escrow + reputation + attestations.

## Positioning statement (judge-facing)
Think of this as Stripe Connect escrow for AI-agent commerce, rebuilt as trust-minimized programmable rails on Solana with dual private settlement so developers can choose their trust model.

## What makes this investable (not just a demo)
1. Clear pain with growing demand (agent payments).
2. Multi-sided network potential (buyers, sellers, frameworks).
3. Defensibility from integrations, liquidity, and reputation data loops.
4. Monetization path through take-rate + platform/API fees.
5. Open-source technical credibility with on-chain verifiability.

## Key claims we must evidence in submission
- Live end-to-end payment loop works (demo + tx links).
- Real user demand exists (interviews/letters/usage intent).
- Differentiation is meaningful vs centralized facilitator models.
- Revenue path to $1M ARR is coherent and defensible.
- Phase 8 integration path includes Vanish Core private swap execution in `@redditech/eliza-plugin-x402` (pending API key onboarding).
