# SECURITY.md

## Reddi Agent Protocol Security Overview (Adevar Labs audit credits submission)

This document summarizes the current threat model and security posture for the Reddi Agent Protocol prior to a full pre-mainnet audit. It is a readiness boundary, not a production-readiness claim: current deployed evidence is devnet-only, and mainnet/live funds remain blocked until the gates in [Known Limitations](#known-limitations-current-phase) are closed.

## Deployed Program Addresses (Solana devnet)

- Escrow Program: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`
- Registry Program: `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`
- Reputation Program: `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`
- Attestation Program: `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`

## Threat Model

### 1) Escrow re-entrancy and multi-step release safety

- Solana CPI execution model avoids EVM-style fallback re-entrancy, but escrow logic is still guarded by strict state-machine transitions.
- Release and cancel paths require expected escrow status and signer checks before token movement.
- State is updated atomically within instruction execution, reducing partial-write and re-entry style abuse.

### 2) Replay attack protection (nonce + PDA uniqueness)

- x402 and settlement flows use nonces, and request identity is bound to unique PDA derivations.
- Replayed payloads fail because nonce/PDA combinations are consumed or already initialized.
- Payment verification enforces one-time semantics for challenge-response settlement attempts.

### 3) Double-release prevention

- Escrow accounts have terminal states.
- A successful release marks escrow complete, and subsequent release instructions fail due to state mismatch.
- Idempotency is enforced by account state transition rules, not client trust.

### 4) Unauthorized release prevention (explicit signer and PDA checks)

- The active devnet addresses above are Quasar programs, not Anchor programs; do not rely on Anchor-only `has_one` wording for this trust boundary.
- Quasar escrow release/cancel paths validate the expected signer and PDA seeds/account fields explicitly before moving lamports.
- Reputation and attestation job-binding paths read an owner-checked `quasar-escrow` escrow mirror (`EscrowRef::owners()` pins `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`) rather than trusting caller-supplied parties.
- Mismatched account graphs, signer substitution, or escrow accounts owned by other programs should fail account validation before business logic executes.

### 5) Cancel-window enforcement

- Cancel actions are bounded by explicit time and state constraints.
- Cancels outside allowed windows fail at program-level checks.
- This blocks griefing where one party attempts late cancellation after service delivery.

## PER (TEE) Privacy Guarantees and L1 Fallback

- Private Ephemeral Rollup (PER) mode executes settlement in a TEE-backed environment to reduce data exposure and metadata leakage.
- If TEE/PER availability degrades, protocol supports L1 fallback so settlement guarantees remain live.
- Security model: confidentiality improves in PER mode; integrity remains anchored by on-chain verification and fallback paths.

## x402 Payment Verification Security

### Trusted path

- Verifier and settlement middleware are controlled by protocol services.
- Nonce issuance, signature checks, and payment proofs are validated before releasing compute access.

### Untrusted path assumptions

- Third-party relays/verifiers are treated as potentially adversarial.
- On-chain escrow constraints remain final source of truth.
- Clients should treat off-chain 402 responses as hints until chain-confirmed.

### Nonce collision handling

- Nonces are expected to be high-entropy and single-use.
- Collision or reuse attempts are rejected by replay guards and PDA uniqueness assumptions.

## Blind Commit-Reveal Rating Security Properties

- Ratings are committed as hash commitments first, then revealed later with salt.
- This mitigates front-running and score-copying during the commit phase.
- Delayed reveal reduces strategic retaliation and vote-manipulation pressure.
- Expiry/penalty paths are intended to discourage selective non-reveal behavior, but CRITICAL-4 remains open; current docs must not present this as a closed mainnet-ready defense.

## Attestation Judge Dispute Resolution Attack Surface

Key risks considered:

- Collusion between specialist and judge to inflate quality scores.
- Spam disputes to force reviewer exhaustion.
- Selective confirmation timing to bias outcomes.

Current mitigations:

- On-chain attestation records and dispute states are auditable.
- Reputation penalties and attestation-accuracy adjustments create economic disincentives for dishonest judging.
- Dispute paths are explicit state transitions, reducing ambiguous off-chain arbitration.

## Known Limitations (Current Phase)

- **Devnet only:** no mainnet deployment is registered. `config/networks/mainnet.json` still contains a placeholder escrow id, and registry/reputation/attestation mainnet ids are unset.
- **Quasar readiness gates open:** CRITICAL-4 remains open in `docs/QUASAR-C4-DURABLE-JOB-RECORD-DESIGN-2026-08-26.md`, and the attestation-squat boundary widened when escrows became durable; judge nomination remains unresolved before mainnet.
- **Audit packet needs refresh:** `docs/SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md` predates the job-binding series and must be re-frozen before external auditor engagement.
- **SOL-only program custody:** current Quasar/Anchor escrow custody is lamports/SOL only. USDC and AUDD are proof/payment-plan metadata unless a separately approved SPL custody workstream lands.
- **No on-chain protocol treasury fee:** 0.05% / 5 bps protocol-fee examples are fixture or demo semantics only; no deployed release path currently collects that fee on-chain.
- **Upgrade authority / custody unresolved:** mainnet upgrade authority ownership, multisig/immutability policy, and compromise procedure are not yet documented or approved.
- **Operational gates unresolved:** paid mainnet RPC/fallback, on-chain monitoring, incident response, safe-harbour/bounty terms, and the historical Jupiter key rotation are still owed before production readiness.

## Audit Credit Use

Adevar Labs audit credits will be used to fund a pre-mainnet security review covering escrow invariants, replay resistance, access control constraints, attestation/dispute logic, and integration boundaries across x402 and PER paths.

## Responsible Disclosure

If you identify a security issue:

1. Do not publish exploit details publicly before coordinated remediation.
2. Use GitHub's private vulnerability reporting flow for this repository when the **Security** tab offers **Report a vulnerability**.
3. If private vulnerability reporting is unavailable, open a public GitHub issue titled `Security contact request` and include only that you need a private channel. Do not include exploit details, private keys, payloads, logs, screenshots, or reproduction steps in the public issue.
4. Allow reasonable remediation time before disclosure.

We will acknowledge valid reports, prioritize fixes by severity, and coordinate transparent postmortems once patched.

Do not open a public GitHub issue with details for exploitable vulnerabilities, private-key exposure, credential leakage, bypassable payment gates, escrow-release flaws, attestation manipulation, replay attacks, or unauthenticated access to private data.

## Secret Handling

The OSS core must not require private operational secrets to run or validate. Keep production values outside the repository and use local environment variables or a secret manager.

Never commit:

- Wallet private keys, seed phrases, signer keypair arrays, or funded key material.
- API keys, bearer tokens, x402 payment headers, auth headers, paid-provider credentials, or raw payment payloads.
- Private deployment URLs when they are required for protocol correctness.
- Private prompts, private user data, raw logs, or unredacted generated evidence.

Examples and fixtures should use placeholders. Generated artifacts must be redacted before publication. If a credential is committed or appears in a public artifact, assume it is compromised, rotate it, and disclose the rotation in the relevant security follow-up without repeating the secret value.
