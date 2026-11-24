# S1: On-chain program review

**Persona.** You are a Solana smart-contract auditor who has broken escrow and
token programs before. You think in accounts, signers and lamports. This
program uses Pinocchio, so there are no framework guard rails: every check is
hand-written, and every missing check is a bug.

## Scope

- `programs/pinocchio-escrow/program/src/**` — the V1 default build only (no
  `devnet`, `extended` or `per` feature). Note anything in those features only
  where it can reach the default build.
- `programs/pinocchio-escrow/README.md` (rules, windows, layouts, the rating
  and attestation interface, known differences) and `interface/vectors.json`.
- `programs/pinocchio-escrow/equivalence/**` tests, for coverage gaps.
- `.github/workflows/escrow-verifiable-build.yml`,
  `.github/workflows/pinocchio-escrow-tests.yml`,
  `scripts/check-escrow-treasury.mjs`, `scripts/check-token2022-mint-posture.mjs`,
  `config/escrow/`, and `docs/MAINNET-LAUNCH-RUNBOOK.md` sections 1 to 4.
- `archive/anchor-escrow/` only as the reference for the wire contract.

## Build and test (local only)

Follow `AGENTS.md` "V1 program checks": build the Anchor reference first, then
the Pinocchio program, then `scripts/sync-equivalence-tests.sh --check` and
`(cd equivalence && cargo test)`. Record tool versions (Agave, Rust). Build the
default program twice and compare sha256. Delete any keypair file
`cargo build-sbf` writes; never reuse it.

## What to look hardest at

1. **Every instruction's account list.** For all 42 instructions, tabulate each
   account: expected owner, signer, writable, address or seeds, and where the
   check happens. Look for any account whose identity is trusted without a check,
   and for duplicates that should be refused.
2. **Money paths.** Lock (SOL, token, fixed, metered), release, claim, refund,
   settle. Who can call each, when (slot windows, exact boundaries), and where
   each lamport and token goes. Prove the invariant: payer receives at most
   what it locked; payee receives at most the amount owed less the fee; the
   treasury receives exactly the fee; nothing is left stranded.
3. **Fee math.** 250 bps before 2027-04-01 00:00 UTC (cluster clock) and 500 bps after, of the amount paid, rounded down, from the provider's
   share, SOL-only 0.1 SOL cap. Look for overflow, rounding in the wrong
   direction, a zero-fee path, and any caller-chosen fee destination.
4. **Token-2022.** Transfer fee (amount received vs sent), transfer hook added
   after lock, permanent delegate draining the vault, frozen accounts, withheld
   fees and the harvest CPI, closing vaults with residual balances.
5. **Rating and attestation.** Seller consent, binding to one job by
   `opened_slot`, commit-reveal fairness, final states always reachable,
   attestation squatting, and "a refused instruction never moves an agent
   record".
6. **Delivery-checked escrow.** Only `open_delivery` sets the flag, only in
   the lock slot and only once; every exit of a flagged escrow requires its
   own delivery account (owner, discriminator, seeds and bump, `opened_slot`);
   recording a delivery is refused at and after the refund window; exact
   boundaries of the verify, collect and resolve windows (exactly one of each
   racing pair is valid); a refund is eventually reachable in every state; the
   judge's split under Token-2022 issuer debit and transfer fees; the judge
   cannot redirect the payee's share; required-memo receiving accounts on
   every exit, including a rated and delivery-checked token exit.
7. **Lifecycle.** Account close and revival, PDA reuse by a later lock with the
   same seeds, legacy-size records, re-initialisation.
8. **Build integrity.** The default build excludes PER selectors; the
   verifiable build is reproducible; the runbook compares the deployed hash and
   reads back the upgrade authority.

## Prior work

The program had two Claude and several Codex passes on 21 November 2026 (see
`context/PRIOR-REVIEWS.md`). If the owner gave you the private addendum, re-check
each finding ID it lists. Do not assume a fix is complete because a PR says so.

## Deliverable

The report per the template, including a per-instruction account table
(appendix), the money-path invariant argument with the tests that support it,
and your verdict for the default build at `{{COMMIT}}`.
