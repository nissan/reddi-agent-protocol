# Recording / Submission Handoff — 2026-05-07

## Current clean baseline

Use clean `main` at `f3000708` or later.

## Demo entrypoint

- Route: `/economic-demo`
- Final recording packet: `artifacts/final-recording-packet-20260507.md`
- Latest run report: `artifacts/economic-demo-run-report/20260507T084258Z/run-report.json`
- Latest submission prep: `artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md` — generated symlink, not committed. Use the newest committed timestamped run under `artifacts/economic-demo-submission-prep/` (see `docs/PUBLIC-CLAIM-BOUNDARY.md` § Evidence artifacts that are not committed).
- Umbra private-payment plan: `docs/UMBRA-PRIVACY-PAYMENTS-BOUNTY-FIT-2026-05-07.md`
- Umbra private x402 adapter evidence: `artifacts/umbra-private-x402/20260507T074334Z/SUMMARY.md`
- Umbra devnet encrypted-balance deposit evidence: `artifacts/umbra-devnet-smoke/20260507T075904Z/SUMMARY.json`
- Umbra receiver-claimable UTXO devnet-only evidence: `artifacts/umbra-devnet-receiver-claimable-utxo/20260507T092405Z/SUMMARY.md`

## Proven claims to use

- Reddi Agent Protocol is the product name.
- `reddi-x402` is the key user package/payment surface.
- Quasar devnet is the final demo-critical on-chain proof path.
- Pay.sh / `reddi-x402` proves sandbox HTTP 402 → Pay.sh sandbox payment → HTTP 200 Solana receipt compatibility for the single-recipient charge flow.
- Umbra private x402 adapter contract is implemented for receiver-claimable UTXO payments; current evidence proves the SDK-facing call path, selective-disclosure receipt shape, bounded devnet encrypted-balance deposit queue/callback, and a devnet-only receiver-claimable UTXO create→scan→claim path with receiver encrypted-balance update. This is not mainnet/live-production private settlement, Quasar-native Umbra execution, or MagicBlock PER settlement.
- Surfpool/mock-Jupiter proves a no-real-funds swap-shaped local invoke path.
- Jupiter public evidence is quote/build/sign boundary evidence, not a successful devnet swap.
- MagicBlock has live Quasar-native delegation/integration evidence plus bounded AgentVault settlement proof, not arbitrary-wallet/private payee settlement.

## Do not claim

- Standalone “Reddi” as the product name.
- Pay.sh capped-session settlement completed.
- Pay.sh split-payment settlement completed.
- Pay.sh evidence proves Umbra private settlement.
- Pay.sh evidence proves MagicBlock PER settlement.
- Umbra receiver-claimable UTXO evidence proves mainnet/live-production private settlement.
- Umbra private settlement executed.
- Successful public Jupiter devnet swap.
- Live/mainnet Jupiter swap.
- Judge wallet charged.
- Mainnet settlement supported.
- Arbitrary-wallet/private payee MagicBlock PER settlement.

## Final gate set just run

- `npm run check:final-recording` — PASS.

- `npm run check:product:naming` — PASS, 15 files.
- `npm run check:submission:claim-boundaries` — PASS, 7 packet surfaces.
- `npm run check:economic-demo:submission-prep` — PASS, 14 evidence paths.
- `npm run evidence:pay-sh:reddi-x402 -- artifacts/pay-sh-reddi-x402/20260507T064842Z` — PASS.
- `npm run report:economic-demo:run` — PASS with `payShReddix402Compatibility=true`.
- `npm run test:bdd:index` — PASS.
- `npx jest --runTestsByPath lib/__tests__/economic-demo-payment-readiness.test.ts --runInBand` — PASS 2/2.
- `npm run check:quasar:submission` — PASS.
- Refreshed submission prep after generating the latest run report, then reran prep + claim-boundary + naming checks — PASS.

## Recording order

1. Open `/economic-demo` and introduce Reddi Agent Protocol.
2. Show the end-user upfront quote and downstream specialist/attestor payment graph.
3. Open payment readiness and show Pay.sh / `reddi-x402` sandbox compatibility.
4. Show local evidence paths / run report / submission prep.
5. State Quasar devnet is the final on-chain path.
6. State boundaries clearly: Umbra adapter contract + bounded devnet encrypted-balance deposit + devnet-only receiver-claimable UTXO create→scan→claim evidence are evidenced, but live/private production settlement is not executed; Pay.sh sessions/splits probe-only; Jupiter not executed on devnet; MagicBlock bounded AgentVault settlement only; no arbitrary-wallet/private payee settlement.

## Current recommendation

This is ready for recording/submission handoff from the evidence-boundary perspective after final gates rerun. If we want an even stronger packet, the next step is not more copy polishing; it is either approved mainnet/Jupiter execution, Pay.sh maintainer clarification for sessions/splits, refreshing live-hosted all-30 specialist endpoint proof, or extending the proven MagicBlock AgentVault route into delegated-payee/private settlement.
