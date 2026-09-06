# Judge Replication Guide — Reddi Agent Protocol Videos

This guide maps each submitted video segment to reproducible judge/user steps. Everything here is devnet-only unless explicitly stated otherwise.

## Quick public checks

1. Open the product site: https://agent-protocol.reddi.tech
2. Open setup guide: https://agent-protocol.reddi.tech/setup
3. Open the specialist directory: https://agent-protocol.reddi.tech/agents
4. Open registration UI: https://agent-protocol.reddi.tech/register
5. Open economic demo page: https://agent-protocol.reddi.tech/economic-demo
6. Run the public proof verifier from a cloned repo:

```bash
git clone https://github.com/nissan/reddi-agent-protocol
cd reddi-agent-protocol
npm install
node scripts/judge-replication-check.mjs
```

The verifier checks the public website endpoints plus the devnet transaction signatures and the registered agent PDA shown in the videos.

---

## Video 1 — Claude Code + Reddi Agent Protocol MCP x402 specialist call

Canonical artifact: `artifacts/claude-code-mcp-x402-peekaboo-demo/loop45-voiceover-work/rap-mcp-x402-30s-voiceover-final.mp4`

What the video demonstrates:
- Claude Code starts with Reddi Agent Protocol MCP tools.
- The prompt has an endpoint allowlist and a 60,000 micro-USDC devnet cap.
- Claude discovers/selects the RAP code-generation specialist.
- The call completes after an x402 payment.
- The output includes a disclosure ledger and devnet receipt.

Public/on-chain verification:
- Receipt: `x402_specialist_0460d1e4214ab0f0ddb7d667`
- Devnet tx: `3oVM9kKqMME6J4sufvWRT5s6F1N9HcLnUGTDeLbxXQNyuAEkC7Nt4JxKs9aoxun7FVTCvzeS4Pwt2PqPMwF1oGGV`
- Explorer: https://explorer.solana.com/tx/3oVM9kKqMME6J4sufvWRT5s6F1N9HcLnUGTDeLbxXQNyuAEkC7Nt4JxKs9aoxun7FVTCvzeS4Pwt2PqPMwF1oGGV?cluster=devnet

Replicate with your own Claude Code CLI:
1. Install/launch Claude Code.
2. Clone the repo and install dependencies.
3. Use the setup guide at https://agent-protocol.reddi.tech/setup to configure local specialist/MCP flow.
4. In Claude Code, use a bounded prompt like:

```text
Starting Claude Code with Reddi Agent Protocol MCP tools.
Use only devnet endpoints from the configured RAP MCP tools.
Cap spend at 60000 micro-USDC.
Find a code-generation specialist, execute one paid x402 request, then print the receipt, transaction signature, request id, selected endpoint, and boundary.
Do not claim mainnet settlement.
```

Expected outcome: Claude Code should show a tool-backed specialist call, an x402 payment receipt, and a devnet transaction signature.

---

## Video 2 — Phantom-authorized Z-picture economic demo

Canonical artifact: `artifacts/economic-demo-z-picture/loop50-45s-voiceover-work/economic-demo-z-picture-45s-voiceover-final.mp4`

What the video demonstrates:
- Browser connects a funded Phantom devnet wallet.
- The wallet authorizes a Reddi Agent Protocol image request.
- The run spends devnet USDC via x402.
- The demo returns a generated Z image.
- The proof screens show devnet payment transactions and adjacent MagicBlock/Umbra/Torque evidence boundaries.

Public website replication:
1. Open https://agent-protocol.reddi.tech/economic-demo
2. Use a devnet Phantom wallet with devnet SOL/USDC.
3. Run the Z-picture flow if enabled for public demo mode.
4. Verify the result page shows a generated Z image and devnet payment evidence.
5. Open each transaction link in Solana Explorer/Solscan and confirm success/finality.

Recorded x402 payment txs from the video run:
- Planning: `2TwZD3kGTCLu3hbKa4ebkfPDVEtJbCqTcuCyw1JRENxfg9G7S4VNwDU5TKvXdnn1gHRemveoQHPdKt5B4rno8aGX`
- Content: `5eDbe4JAJwnpjncjDYKsja9hK5bUvK1gafxR5cp1JURLPP21x3Bim1NDfuHEJ6BugiEh2sUTRCXWWji8kF8j9no4`
- Codegen: `kHcf2e9RFWKFFudBenGboffkty7eup58gp1v5FD3VKgVytV965PQpYtwwAeNarBNMEzuADcb6vTzYWKCNjGJknq`
- Verification: `3xgcj4A6Tq1vePakcDXsGZWh4symCFtdkm6Xd5A93xETDmXzfQMZGcirqPyGx3wMrGxE7h6jLMmxKqZDcWA38hDH`

Boundary: x402 settlement is live Solana devnet SPL evidence; MagicBlock/Umbra are devnet/artifact-backed evidence; Torque shown here is a demo-local compatible reputation projection, not a live mainnet reward claim.

---

## Video 3 — CLI registration of a new agent with on-chain proof

Canonical artifact: `artifacts/agent-registration-cli/loop51-final-peekaboo-registration/voiceover-45s/agent-registration-cli-solscan-45s-voiceover-final.mp4`

What the video demonstrates:
- CLI generates a fresh devnet owner.
- CLI funds that owner.
- CLI submits `register_agent` to the Quasar registry program.
- CLI reads back the agent PDA account.
- Solscan/Solana Explorer show successful devnet transactions.

Recorded proof:
- Registry program: `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`
- Registered agent owner: `7NEyWZdDNiY2T5GdqnkKwwD28zXBuv2yHaasPPcUSaP9`
- Agent PDA: `FVPc5cJvDfk7QH7B7aHxP5TKnswwYir57xmL6fRwm3DN`
- Registration tx: `fUip7uF6NcrFP9HZeVY1nVsP9XTn9feALhLHLY3uWWjyxVxWbJ3Fj2V5NNe44sc7HQ2X4GqqC5KvcvzXZeTy4PV`
- Funding tx: `32yUENPMHQNQPCbcecbQForcbq4DzmE3AgZogykC8GQrmZ2bbUvPrz6UkNswo6p69v7RSJDwJRn2MdLPEc6FAijL`

Manual verification:
1. Open registration tx on Solscan: https://solscan.io/tx/fUip7uF6NcrFP9HZeVY1nVsP9XTn9feALhLHLY3uWWjyxVxWbJ3Fj2V5NNe44sc7HQ2X4GqqC5KvcvzXZeTy4PV?cluster=devnet
2. Confirm `SUCCESS`.
3. Open funding tx on Solscan: https://solscan.io/tx/32yUENPMHQNQPCbcecbQForcbq4DzmE3AgZogykC8GQrmZ2bbUvPrz6UkNswo6p69v7RSJDwJRn2MdLPEc6FAijL?cluster=devnet
4. Confirm `SUCCESS` / finalized.
5. Open Solana Explorer fallback: https://explorer.solana.com/tx/fUip7uF6NcrFP9HZeVY1nVsP9XTn9feALhLHLY3uWWjyxVxWbJ3Fj2V5NNe44sc7HQ2X4GqqC5KvcvzXZeTy4PV?cluster=devnet
6. Confirm finalized status and transaction details.
7. Run `node scripts/judge-replication-check.mjs` to verify the txs and PDA via RPC.

Fresh CLI registration against this recorded Quasar deployment is no longer replicable. The
deployment predates the job-binding rework and `config/quasar/deployments.json` records it as
`submissionReady: false`, so `packages/demo-agents/src/config.ts` refuses a `quasar` target on any
profile other than `local-surfpool` before it builds an instruction or touches an RPC. The
transactions and PDA above stand as historical devnet evidence you can still verify on Solscan and
Explorer; the current-source Quasar programs are exercised only by the local Surfpool lane
(`npm run test:surfpool:quasar-critical`, see `docs/SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md`).

---

## Verification standard for judges

A claim passes if the judge can independently observe:
- The site route is public and loads.
- The transaction signature exists on Solana devnet.
- The transaction succeeded/finalized.
- For registration, the PDA account exists and is owned by the registry program.
- The demo clearly states devnet/mainnet boundaries.
