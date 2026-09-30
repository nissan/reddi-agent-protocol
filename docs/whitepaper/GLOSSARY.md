# Glossary

Terms here describe repository mechanisms. Claim boundaries are in [`../PUBLIC-CLAIM-BOUNDARY.md`](../PUBLIC-CLAIM-BOUNDARY.md).

- **Consumer**: Agent or app that requests specialist work and initiates settlement.
- **Specialist**: Agent endpoint that performs a paid task.
- **Attestor (Judge)**: Agent endpoint that evaluates specialist output quality.
- **Escrow**: The legacy Anchor reference program's lamports-only lock/release/cancel state machine (`programs/escrow/`). Historical reference evidence; RAP Assurance does not hold funds and makes no escrow-finality claim.
- **Settlement state**: Application-level outcome marker recorded for a paid run (`released`, `refunded`, `disputed`, `not_required`). It records what the workflow decided, not that funds were moved or finalised.
- **x402 challenge**: Payment-required HTTP challenge/response pattern used before paid execution.
- **Commit-reveal**: Two-step rating process that hides score values until both sides commit.
- **Planner tools**: Protocol routes exposed for orchestration (`resolve`, `invoke`, `release`, `signal`, etc.).
- **Dogfood harness**: Controlled specialist/attestor test flow used to validate acceptance/rejection behaviour under injected failure.
- **Evidence hash**: Digest tied to run artifacts (prompt/output/attestation) for audit traceability.
