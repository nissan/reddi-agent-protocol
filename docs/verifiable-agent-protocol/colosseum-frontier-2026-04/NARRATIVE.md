# Narrative Strategy — Colosseum Frontier (Quasar Variant)

> **Historical, superseded 2026-10-02:** This file preserves hackathon-era narrative and must not be used as current product, submission, deployment, or readiness copy. Quasar is frozen as experimental and retired from critical paths; the recorded devnet deployment is blocked. Stable Anchor `1.1.2` is authoritative and Anchor v2 remains a default-off alpha pilot. See [`../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](../../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md). All “ships now,” “canonical,” “final,” and performance statements below describe the superseded 2026 hackathon posture only.

**Phase 2 — Pitch-Flow Playbook**
_Audience: Colosseum Frontier hackathon judges (primary), investors / technical evaluators (secondary)_
_Time limit: 180 seconds_
_Date: 2026-04-12_
_Official X profile: [@reddiagent](https://x.com/reddiagent)_

---

## One-Sentence Core Pitch

> **Reddi Agent Protocol is the trustless commerce layer for AI agents — shipping Quasar-native escrow, registry, reputation, and attestation on Solana devnet, with privacy and x402-compatible payment lanes presented through explicit evidence boundaries.**

---

## Narrative Arc (180s structure)

```
0:00–0:30  Why now + pain
0:30–1:00  Solution promise
1:00–2:00  Technical mechanism + Quasar proof
2:00–2:30  Verified outcomes
2:30–3:00  Ask
```

---

## 1. Why Now

**The window is open — and it is closing fast.**

Agent-to-agent commerce is moving from prototype to real economic action. x402 proved that AI agents will pay for services. MCPay proved judges reward this category. But every live x402 implementation still hands the trust problem to a centralised facilitator.

The timing is specific: Solana's fee profile makes machine-speed payments viable right now. The developer tooling — ElizaOS, SendAI — is shipping agent commerce primitives this quarter. The first protocol to deliver trustless, verified, private agent commerce on this stack will own the infrastructure layer.

We are that protocol.

---

## 2. Pain + Cost of Inaction

**Two agents meet. Neither trusts the other. Commerce stalls.**

- The buyer won't pay before delivery. The seller won't deliver before payment. So nothing clears.
- MCPay and x402-style flows move money, but they rely on the facilitator to enforce delivery. Remove the facilitator, and you're back to counterparty risk.
- On-chain payments are visible by default — any agent with a trade strategy leaks intent at execution time.
- Without reputation and attestation, every new agent interaction starts from zero trust.

The cost of inaction: agent commerce stays small, fragile, and centralised. That is not the internet of agents that anyone is building toward.

---

## 3. Solution Promise

**We built the complete trust stack. Not another payment wrapper.**

Colosseum Frontier ships five interlocking layers:

1. **Trustless x402 escrow** — conditional release or refund, no facilitator required.
2. **Permissionless on-chain agent registry** — any agent can register, update, and be discovered.
3. **Blind commit-reveal reputation** — scores that resist gaming and collusion.
4. **Attestation judges** — quality verification on delivery, not just payment confirmation.
5. **MagicBlock PER boundary** — Quasar-native MagicBlock permission/delegation succeeds live, and patched Quasar PER proves bounded AgentVault settlement through MagicBlock TEE; arbitrary-wallet/private payee lamport settlement is not claimed.

Think Stripe Connect escrow, rebuilt as programmable trust rails on Solana, with privacy-aware settlement. That is what we are shipping today.

---

## 4. Technical Mechanism

### What ships now (Quasar — canonical submission)

The live submission path now targets Quasar-compiled Solana programs for all demo-critical on-chain modules:

- Escrow, registry, reputation, and attestation are deployed on devnet as Quasar programs.
- The A→B→C demo flow completes with Quasar escrow settlement, reputation, and attestation.
- ElizaOS/SendAI/x402-compatible adapters remain supporting distribution and payment-boundary evidence.
- MagicBlock PER is presented honestly as successful Quasar-native permission/delegation plus bounded Quasar-owned AgentVault settlement, not as arbitrary-wallet/private payee settlement.

**This is the submission path. It is Quasar-native for the critical proof and explicit about unsupported settlement claims.**

### Quasar receipts

The question: can we prove the critical execution path gets materially leaner while remaining honest about privacy-rail boundaries?

The answer is yes — with receipts.

**Parity validated across four modules (41/41 QuasarSVM tests):**
- Escrow: 7/7 — lock, release, cancel, all authorization and edge cases
- Registry: 10/10 — register, update, deregister
- Reputation: 11/11 — commit rating, reveal rating, expire rating
- Attestation: 13/13 — attest quality, confirm, dispute

**Measured hot-path efficiency gains:**

| Instruction | Anchor (estimated) | Quasar (measured) | Savings |
|---|---|---|---|
| Lock escrow | ~6,000–8,000 CU | **4,980 CU** | ~35–50% |
| Release escrow | ~3,000–4,000 CU | **649 CU** | ~80–84% |
| Cancel escrow | ~2,500–3,500 CU | **626 CU** | ~76–83% |

**Binary footprint:** 13 KB Quasar hot path vs 377 KB full Anchor build.

The release and cancel savings are structural: Quasar's `set_lamports` eliminates a System Program CPI on the hot path. This is not a benchmark trick. It is a different execution model with real per-transaction cost implications at scale.

**What remains on the Quasar side:** MagicBlock PER now proves the bounded Quasar-owned AgentVault settlement route, but broad private-payee settlement is not complete. We do not claim end-to-end arbitrary-wallet/private payee lamport settlement.

**The disciplined call:** we keep the final proof Quasar-native and boundary-labeled rather than falling back to Anchor or overclaiming a privacy rail that has not settled.

---

## 5. Proof

| Claim | Evidence |
|---|---|
| Quasar critical protocol path works end-to-end | Devnet A→B→C completes across Quasar escrow, registry, reputation, and attestation |
| ElizaOS + SendAI integration present | Adapter evidence remains supporting distribution, not the final on-chain proof |
| Quasar escrow, registry, reputation, attestation readiness | Quasar deployment inventory + critical success guard + devnet evidence |
| Hot-path CU reduction is real | Measured via QuasarSVM `compute_units_consumed`; release 649 CU, cancel 626 CU |
| Binary reduction is real | 13 KB Quasar POC vs 377 KB full Anchor build (hot path only, documented scope) |
| Submission path is scoped and stable | Final critical proof uses Quasar devnet programs; privacy rails are boundary-labeled rather than overclaimed |
| MagicBlock PER boundary is precise | Bounded Quasar-owned AgentVault settlement is proven; delegated-payee/private settlement remains a separate next step |

---

## 6. Ask

**What we are asking judges to believe:**

This is not a hackathon wrapper. This is the infrastructure layer that agent commerce needs to scale beyond centralised facilitators. We have shipped the scoped Quasar-native proof path, validated supporting payment/privacy boundaries, and documented exactly what remains unsupported.

**If you are scoring on technical credibility:** Quasar devnet execution plus measured CU reductions give you a concrete signal that the efficiency roadmap is real, not aspirational.

**If you are scoring on execution discipline:** we made the harder call — shipped the Quasar critical path while refusing to overclaim MagicBlock PER settlement or Jupiter devnet execution.

**What comes next:** extend the proven MagicBlock AgentVault route into delegated-payee/private settlement, expand privacy rails beyond bounded evidence, and harden the production Reddi Agent Protocol launch path.

The ask: **recognise Reddi Agent Protocol as the category winner for trustless agent commerce infrastructure on Solana.**

---

## Positioning Rules (enforced)

| Do say | Don't say |
|---|---|
| Quasar is the final critical on-chain proof path | "Anchor is the final demo path" |
| MagicBlock delegation + bounded AgentVault settlement succeed live; private arbitrary-wallet payee settlement is not claimed | "MagicBlock PER settlement succeeded" |
| Jupiter has quote/build/sign and local invoke evidence | "Jupiter devnet swap succeeded" |
| Umbra adapter + devnet encrypted-balance deposit evidence | "Umbra production/private settlement completed" |
| Measured CU gains: release 649, cancel 626 | Inflated or unqualified CU claims |
| Binary comparison is hot-path-only, documented | "13x smaller program" without scope context |

---

## Objection Handling

**"Is this just another payment wrapper with a new framework attached?"**
No. The differentiator is the full trust stack — escrow + blind reputation + attestations — not Quasar by itself. Quasar is the performance evidence. The product story is the five-layer protocol.

**"Why should we care about Quasar specifically?"**
Because the critical proof path now runs Quasar-native, and the supporting evidence shows why that matters for agent-commerce throughput and cost.

**"Are you introducing submission risk by talking about a Beta framework?"**
Only if we hide the boundaries — which we do not. The documented decision is Quasar for the critical proof path, with MagicBlock/Jupiter/Umbra claims scoped to the evidence actually produced.

**"Is the privacy story fully proven on Quasar?"**
Not yet, and we say so clearly. Quasar-native MagicBlock permission/delegation succeeds live, and patched Quasar PER proves bounded AgentVault settlement through MagicBlock TEE, but successful arbitrary-wallet/private payee lamport settlement is not claimed.

---

_Narrative refreshed: 2026-05-08_
_Next step: use this only with current claim-boundary guard passing._
