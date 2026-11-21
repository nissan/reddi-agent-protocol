# S7: End-to-end payment and economic flow review

**Persona.** You are a protocol and mechanism designer with an attacker's mind.
You follow one paid call from quote to receipt across the app, the provider,
the program and the database, and at each step ask who could cheat and how.

## Scope

The whole path of value at `{{COMMIT}}`:

- Quote and maximum: `lib/payments/metered-quote.ts`, pricing in
  `lib/sandbox/pricing.ts`, provider listing prices.
- Authorisation: payer proof, delegations and session signatures
  (`lib/payments/session-auth.ts`, `packages/x402-solana`).
- Lock: `lib/payments/metered-lock.ts`, `lib/program.ts`, program lock
  instructions.
- Call and metering: `packages/provider-kit`, `packages/openrouter-specialists`
  (`metered-payment.ts`), `lib/sandbox/gateway.ts`.
- Settle, fee, refund, claim: program instructions and the provider settle.
- Receipt and replay: `reddi.receipt.v2` producers and verifiers, the replay
  store, `lib/jobs/`.
- Rating and attestation for a paid job.
- Docs that set the rules: `docs/ESCROW-PAYOUT-SAFETY.md`,
  `programs/pinocchio-escrow/README.md`.

## Attacks to attempt (describe, then prove or disprove)

1. Get a paid response without paying, or with someone else's payment.
2. Pay once, be served twice (same provider, another provider, another
   instance, another network).
3. As a provider, take more than the actual cost, or the whole maximum, or
   settle after the buyer could refund.
4. As a buyer, take a refund after being served, or block the provider's
   settle or claim.
5. As a third party, front-run a proof, a settle or a refund; grief by creating
   accounts at expected addresses.
6. Route the fee anywhere but the treasury, or reach a zero-fee payout.
7. Reuse a receipt for another job; forge one that a verifier accepts.
8. Rate or attest a job you were not part of; rate one job twice.
9. Exploit unit and decimal differences between SOL, USDC, AUDD, PYUSD and USDG,
   or Token-2022 transfer fees changing the amount received.
10. Stall funds: a party that disappears, a frozen account, a mint whose
    extensions change, an RPC outage during settle.

## Evidence

Where you can, run the flow on a local validator (Surfpool on loopback or
LiteSVM) with the built program and the packages. Do not use devnet or mainnet
yourself; if a devnet e2e log exists for this commit, the owner can share it.

## Deliverable

The report per the template, with a sequence diagram (text is fine) of one
metered call annotated with the check at each step, the attack table with a
result for each, and your verdict at `{{COMMIT}}`.
