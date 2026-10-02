# Economic Demo Judge Packet

> **Historical, superseded 2026-10-02:** This hackathon packet is not current guidance. Quasar is frozen as experimental and retired from critical paths, and the recorded devnet deployment is blocked. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

_Date:_ 2026-05-05 AEST
_Status:_ Final Quasar devnet proof packet; live PER/TEE and paid/live provider actions remain approval-gated
_Demo route:_ `/economic-demo`
_Quasar cutover target:_ Quasar-deployed Solana multi-program devnet deployment from `config/quasar/deployments.json`
_Operator checklist:_ `docs/ECONOMIC-DEMO-OPERATOR-CHECKLIST-2026-05-05.md`
_Local-only rehearsal report:_ `artifacts/economic-demo-rehearsal/20260505T091725Z/REHEARSAL-REPORT.md` (ignored; not part of public packet)

_Final proof map:_ `docs/COLOSSEUM-FINAL-QUASAR-PROOF-MAP-2026-05-06.md`

## One-paragraph summary

Reddi Agent Protocol demonstrates an agentic workflow economy where a user request can be routed through an orchestrator, marketplace specialists, attestors, x402-compatible payment challenges, Pay.sh / `reddi-x402` sandbox compatibility evidence, and downstream-disclosure evidence. The current demo is intentionally safe and evidence-bounded: it shows the workflow, public manifest/dependency disclosure, local dry-run evidence pointers, Surfpool/local rehearsal semantics, Pay.sh sandbox charge compatibility, and storyboard-only image planning without making hidden paid calls or claiming production settlement.

Umbra is now implemented as an adapter-contract lane for private x402 payments. The executable adapter artifact is `artifacts/umbra-private-x402/20260507T074334Z/SUMMARY.md`, which proves the SDK-facing receiver-claimable UTXO call path and selective-disclosure receipt shape with dependency-injected mocks. The bounded devnet artifact is `artifacts/umbra-devnet-smoke/20260507T075904Z/SUMMARY.md`, which proves devnet wSOL wrapping, Umbra confidential registration, public-balance-to-encrypted-balance deposit queue/callback, and encrypted-balance query. It is not represented as mainnet/live-production private settlement proof in this packet.

## What to open

- Demo page: `/economic-demo`
- Local evidence anchor: `/economic-demo#local-evidence-artifacts`
- Operator checklist: `docs/ECONOMIC-DEMO-OPERATOR-CHECKLIST-2026-05-05.md`

## Quasar cutover status

Nissan has selected Quasar-compiled Solana programs as the final hackathon demo target. This packet is now refreshed as a **final Quasar devnet proof packet**, not a scoped Anchor-era fallback. The active devnet programs are Escrow `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`, Registry `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`, Reputation `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`, and Attestation `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`. Legacy Anchor is reference only. Nissan approved devnet transactions needed for the Quasar goal; mainnet, paid provider calls, production env/Coolify/Vercel mutation, real image generation, and live MagicBlock PER/TEE claims remain separately approval-gated. Runtime compatibility has zero blocker-status demo-critical paths; the final proof map is `docs/COLOSSEUM-FINAL-QUASAR-PROOF-MAP-2026-05-06.md`.

## What is proven by the current packet

1. **Agentic workflow disclosure exists before purchase.**
   - Public marketplace and manifest work disclose tools, skills, downstream marketplace-agent calls, external MCP servers, non-marketplace services, and disclosure policy.

2. **Paid-response disclosure is part of the protocol contract.**
   - `reddi.downstream-disclosure-ledger.v1` is the expected response evidence for downstream calls.
   - Evidence tooling rejects future live artifacts that omit the required downstream-disclosure ledger.

3. **The economic demo can be presented without fresh spend.**
   - `/economic-demo` loads controlled/local evidence panels without live specialist calls on page load.
   - The local evidence panel points to ignored repo-local artifacts instead of publishing private logs.

4. **Pay.sh / `reddi-x402` sandbox compatibility is proven for the single-recipient charge flow.**
   - Evidence: `artifacts/pay-sh-reddi-x402/20260507T064842Z/SUMMARY.md`.
   - The proven flow is HTTP 402 / MPP challenge → `pay --sandbox curl` → HTTP 200 with Solana payment receipt success.
   - Capped sessions and split payments are extension probes only; Pay.sh 0.16.0 returned `Server returned 402 again after payment` for those variants.

5. **Umbra private x402 adapter contract is implemented, and bounded devnet encrypted-balance deposit evidence is attached; live/mainnet settlement is not claimed.** Umbra private x402 payments are demoed as adapter-contract plus bounded devnet encrypted-balance deposit evidence.
   - Plan/research artifact: `docs/UMBRA-PRIVACY-PAYMENTS-BOUNTY-FIT-2026-05-07.md`.
   - Executable artifact: `artifacts/umbra-private-x402/20260507T074334Z/SUMMARY.md`.
   - Devnet evidence artifact: `artifacts/umbra-devnet-smoke/20260507T075904Z/SUMMARY.md`.
   - Umbra devnet encrypted-balance deposit completed.
   - Implemented role: private settlement adapter contract for Reddi Agent Protocol x402 payments using Umbra encrypted balances / receiver-claimable UTXOs / selective disclosure.
   - Current packet does not claim Umbra mainnet/live-production settlement or Quasar-native Umbra execution.

6. **The picture path is spend-gated.**
   - The Phase 7 picture workflow is storyboard-only.
   - The image-generation adapter remains blocked unless Nissan explicitly approves provider, model, and budget cap.

7. **The Quasar submission/readiness loop is BDD-governed.**
   - Issue #236 and `docs/QUASAR-BDD-ITERATIVE-PLAYBOOK-2026-05-05.md` require each Quasar phase to define expectation, scope, validation, retrospective, safety review, and plan adjustment before scope expands.
   - `npm run check:quasar:submission` verifies runtime compatibility, deployment inventory, and demo-readiness metadata.

## What is local or simulated

- Surfpool transfer semantics are local/offline proof, not production settlement.
- Research workflow evidence is dry-run planning unless a future Phase 6 live run is explicitly approved.
- Picture workflow evidence is storyboard/prompt planning, not real generated image evidence.
- Local ignored evidence artifacts are operator audit pointers, not public artifact dumps.

## What is explicitly not claimed

- No production settlement proof.
- No new Phase 6 controlled live research execution.
- No OpenAI/Fal-generated image proof.
- No new paid provider execution.
- No new signing operation.
- No wallet mutation.
- No devnet transfer.
- No Coolify/env mutation.
- No Pay.sh capped-session or split-payment settlement claim.
- No Pay.sh claim of Umbra private settlement or MagicBlock PER settlement.
- No Umbra SDK mainnet/live-production settlement claim.
- Umbra devnet encrypted-balance deposit completed; no broader SDK claim/withdrawal/receiver-claimable settlement claim.
- No Umbra private settlement execution claim.

## Public proof chain

The current rows below prove the final Quasar devnet cutover loop. Legacy Anchor rows are retained as historical implementation evidence only; Anchor CI alone is insufficient for the hackathon target.

| PR | Purpose | Merge commit | CI/evidence |
| --- | --- | --- | --- |
| #244 | Final Quasar devnet proof: target wiring, builders, read/decode, onboarding/reputation, Quasar-native A→B→C demo-agent path, Surfpool Quasar gate, devnet Reputation upgrade, proof map, and Quasar readiness CI | pending merge | Local gates passed: `npm run test:surfpool:quasar-critical`; full devnet Quasar A→B→C PASS; `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar npm run build`; `npm run check:quasar:submission`; BDD index; `git diff --check` |
| #225 | Compact `/economic-demo` local evidence UI links | `f36d4bb55b7f10bbc5177b3fda189c67f17d7cd3` | PR checks passed; post-merge Anchor run `25359075289` passed |
| #229 | Phase 0 BDD iterative plan + BDD lock + retrospective | `f5499576c11b97b91dcf51d4d148b7d0a7e8302f` | PR checks passed; post-merge Anchor run `25360618730` passed |
| #230 | Phase 1 local submission-prep checker + retrospective | `ee90eafc47d4c15b3ab6ea800a5552a011d6ed59` | PR checks passed; post-merge Anchor run `25361165874` passed |
| #231 | Phase 2 public-safe operator checklist + retrospective | `ffb6cf8d10b49bf7deb5562bf15e4f3a41818a87` | PR checks passed; post-merge Anchor run `25362578258` passed |
| #232 | STATUS refresh after Phase 2 | `58c4684d485bca2c38b40b4c918845236f424fe6` | PR checks passed; post-merge Anchor run `25363200205` passed |
| #233 | Phase 3 local rehearsal retrospective | `fc818240415f33b8b91a010a4e63cd09fc025c4a` | PR checks passed; post-merge Anchor run `25368423458` started at packet creation |

## Local validation commands used during readiness

```bash
npm run check:economic-demo:submission-prep
npm run evidence:pay-sh:reddi-x402 -- artifacts/pay-sh-reddi-x402/20260507T064842Z
npm run build
npx jest --runTestsByPath lib/__tests__/quasar-instructions.test.ts lib/__tests__/quasar-agent-account-decoder.test.ts lib/__tests__/quasar-demo-agent-guard.test.ts --runInBand
npm run check:quasar:submission
npm run test:bdd:index
git diff --check
```

## Recommended submission wording

> Reddi Agent Protocol demonstrates a Quasar-native devnet agent economy: a human-triggered workflow routes through wallet-bearing agents, x402-compatible payment boundaries, Pay.sh / `reddi-x402` sandbox charge compatibility, public Quasar escrow settlement, blind reputation commit/reveal, and attestation. The larger thesis is agent commerce: as agents become buyers of APIs, services, data, tools, and specialist work, they need a machine-native loop for quote → authorize → pay → execute → attest → disclose → settle. The final on-chain proof uses Quasar-compiled Solana programs for Registry, Escrow, Reputation, and Attestation. Surfpool localnet is used as the pre-devnet confidence gate; OpenRouter/30 specialist profiles and x402 evidence show the agent marketplace/payment boundary; Umbra private x402 adapter-contract evidence plus bounded devnet encrypted-balance deposit evidence show the receiver-claimable UTXO/selective-disclosure lane without claiming mainnet/live-production private settlement; Jupiter is wired for cross-token settlement but live swap is not claimed; Pay.sh capped sessions/splits remain probe-only; MagicBlock PER/TEE settlement is explicitly not claimed in the final Quasar path unless separately validated.

## If reviewers ask what comes next

The next stronger proof category requires explicit approval because it changes the risk/spend profile:

1. **Controlled Phase 6 live research run** — requires hosted/devnet call approval and spend cap.
2. **Real image generation** — requires provider/model choice and budget cap for OpenAI or Fal.
3. **Production settlement proof** — requires a separate settlement runbook and explicit signing/wallet/devnet or production-network authorization.

Until those are approved, the honest endpoint is this packet: Quasar-native devnet proof, local Surfpool confidence, transparent ecosystem-product boundaries, and green CI-backed implementation history.
