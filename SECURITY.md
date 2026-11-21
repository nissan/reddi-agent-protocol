# SECURITY.md

## Reddi Agent Protocol Security Overview (Adevar Labs audit credits submission)

This document summarizes the current threat model and security posture for the Reddi Agent Protocol prior to a full pre-mainnet audit. It is a readiness boundary, not a production-readiness claim: current deployed evidence is devnet-only, and mainnet/live funds remain blocked until the gates in [Known Limitations](#known-limitations-current-phase) are closed. Stable Anchor `1.1.2` is the authoritative source reference; Quasar is frozen historical experimental evidence, not an audit or deployment candidate. See [`docs/QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](docs/QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

## Deployed Program Addresses (Solana devnet)

These addresses are recorded history, not an active demo target: `config/quasar/deployments.json` marks the deployment `submissionReady: false` (client/deployment ABI mismatch), and the client refuses the Quasar target outside `local-surfpool` before instruction building, signer access, or RPC. The retained [`docs/SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md`](docs/SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md) link documents loopback-only historical reproducibility; it is not a promotion path or authorization for a live lane. See [Known Limitations](#known-limitations-current-phase).

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

- x402 helpers use nonces and replay stores where configured, and on-chain reference paths use PDA derivations.
- Replayed payloads are rejected by the local/package replay guards or source-level state checks under test.
- Payment verification enforces one-time semantics only for the explicitly configured verifier or fixture; it is not a settlement-finality claim.

### 3) Double-release prevention

- Successful reference escrow settlement closes the record; attempts to settle that closed account fail.
- Token escrows never persist `Released` or `Cancelled`; clients must retain transaction evidence for the outcome.
- A later lock can reuse the closed PDA, so closure does not provide permanent job-level idempotency.

### 4) Unauthorized release prevention (explicit signer and PDA checks)

- The devnet addresses above are Quasar programs, not Anchor programs; do not rely on Anchor-only `has_one` wording for this trust boundary.
- Quasar escrow release/cancel paths validate the expected signer and PDA seeds/account fields explicitly before moving lamports.
- **Source-level, not yet deployed:** reputation and attestation job-binding paths on current `main` read an owner-checked `quasar-escrow` escrow mirror (`EscrowRef::owners()` pins `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`) rather than trusting caller-supplied parties. This landed in the job-binding series (#642-#645, 2026-08-24/26). The last recorded devnet deployment is `config/quasar/deployments.json` `updatedAt: 2026-05-06`, so the binaries at the addresses above **predate** this binding and the CRITICAL-4 durability change. Per `docs/QUASAR-JOB-BINDING-DESIGN-2026-08-24.md`, the escrow program currently on devnet still accepts an unsigned payee. Read this bullet as a property of the frozen experimental source retained for historical review, not of the deployed devnet programs or a source currently advancing through an audit.
- Mismatched account graphs, signer substitution, or escrow accounts owned by other programs should fail account validation before business logic executes. This remains a source-level observation only: the redeploy contemplated by `docs/QUASAR-C4-DURABLE-JOB-RECORD-DESIGN-2026-08-26.md` was superseded by the experimental freeze and is neither planned nor authorized.

### 5) Cancel-window enforcement

- Cancel actions are bounded by explicit time and state constraints.
- Cancels outside allowed windows fail at program-level checks.
- This blocks griefing where one party attempts late cancellation after service delivery.

## PER (TEE) reference boundary

- MagicBlock PER is not part of V1. The V1 program build (`programs/pinocchio-escrow`, default features) does not answer the two PER instructions (`delegate_escrow`, `release_escrow_per`); they sit behind a `per` build feature that is off by default and never used for a mainnet build. PER is unfinished work planned as a follow-up after the launch (issue #839): in source, the PER release takes no protocol fee and emits no settlement event yet.
- Private Ephemeral Rollup (PER) material is reference evidence and client-side tooling, not a production privacy or settlement guarantee.
- Current public claims must stay bounded to the explicitly labelled local/devnet artifacts and source-level behavior.
- Mainnet, live-funds, arbitrary private-payee settlement, and confidentiality guarantees require separate compatibility qualification, audit, deployment approval, and operational gates.

## x402 Payment Verification Security

### Trusted path

- Local verifier and middleware code validates nonce, policy, and payment-proof references before accepting a paid-work receipt path.
- Rail-specific payment packages remain responsible for validating transfer-specific proofs.
- Hosted or production verifier operation is not claimed by this document.

### Untrusted path assumptions

- Third-party relays/verifiers are treated as potentially adversarial.
- Chain-confirmed transfer evidence, when present, is rail-specific payment proof rather than proof of paid-work quality.
- Clients should treat off-chain 402 responses as hints until the relevant payment verifier and RAP receipt/evidence checks pass.

### Nonce collision handling

- Nonces are expected to be high-entropy and single-use.
- Replay-store protection is scoped to the configured store. Escrow PDA uniqueness lasts only while the record exists: `(payer, nonce)` can be reused after closure on both SOL and token rails. Clients must not use that pair as a globally unique job ID.

## Ratings (commit and reveal) in the V1 program

This section describes the V1 program source (`programs/pinocchio-escrow`). Ratings and judge attestations are part of its one build. It has not been deployed with them and has had no independent security review, so everything below is a property of source under test, not of a deployment. The guide is [`docs/RATINGS-AND-ATTESTATIONS.md`](docs/RATINGS-AND-ATTESTATIONS.md); the interface is the program README.

What the program enforces:

- **Bound to a paid job.** A rating exists only for an escrow the buyer opted in at lock (`open_rating`, same slot as the lock) and that was then paid. A refund or decline closes the rating account.
- **The seller must agree.** A rating opens only if the seller called `accept_rating`, or was itself the authority of the claim or settle. A release by the buyer without that pays as usual and closes the rating account. A seller signature elsewhere in the buyer's transaction does not count, and a seller's claim transaction that also carries the buyer's signature is treated as the buyer's release. So a payer acting alone cannot change the reputation, job counts or accuracy of an agent that signed nothing.
- **Commitments cannot be copied.** Each side commits to `sha256(rating address ‖ its own address ‖ score ‖ salt)`. The rating address and the signer are in the hash, so a commitment taken from the other party or from another job cannot be opened by replaying that reveal. Neither side sees the other's score before both have committed.
- **Withholding costs the one who withholds.** Each phase has a deadline of 1,512,000 slots (about 7 days). After it, anyone may call `expire_rating`. A side that never committed while the other did loses 5.00 points and gains a failed job. A side that committed and then withheld its reveal has the other side's score folded into its record, loses 5.00 points, and its own score is never counted.
- **Every exit of a rated escrow takes the rating account.** Without it the exit is refused (`RatingAccountRequired`, 6033), so a rated escrow cannot be paid or refunded around its rating.

Known limits, stated plainly:

- A score comes from ratings of paid jobs. It is not proof of quality or that the work was done.
- Reputation and judge accuracy are not Sybil-proof. Wallets of one owner can pay, rate and attest each other for the cost of transaction fees, and a job of under 40 lamports pays no protocol fee at all. The program does not weight reputation by the amount paid.
- An agent can deregister and register again (0.01 SOL) to drop a pending score or penalty, because records are updated only if they exist when the rating is finalised. A recently created record should be read as having no history.
- On a fixed-price job the seller can wait to see how the job went before it calls `accept_rating`.
- `expire_rating` can be called by anyone.
- The earlier "CRITICAL-4" finding (griefing by selective non-reveal) was raised against the earlier reputation programs. The penalty rule above is the V1 program's answer to it. It is covered by the program's tests and has not been independently reviewed; do not present it as an audited or mainnet-proven defence.

## Judge attestations in the V1 program

Key risks considered:

- Collusion between a seller, or a buyer, and a judge to inflate quality scores.
- A judge attesting jobs it was not asked to judge.
- A buyer disputing an honest attestation.

What the program enforces, in source:

- Only the one judge the buyer named in `open_rating` can attest, only after the job is paid, and at most once per job. The judge can be neither the buyer nor the seller, must be registered as an attestation agent, and its record must be active.
- A job the seller never agreed to have rated has no rating account after its release, so it cannot be attested.
- Only the buyer of that job confirms or disputes the attestation, once. Confirming raises the judge's accuracy by 10.00 and folds a top score into its reputation; disputing takes 5.00 points.

What it does not do:

- The buyer picks the judge, so a buyer and a judge under one owner can raise the judge's accuracy for the cost of transaction fees.
- A buyer can dispute any attestation of its own job, and the judge has no appeal.
- An attestation carries no amount, and nothing checks the five scores against the work.
- These are source and test semantics, not deployed economic guarantees.

## Known Limitations (Current Phase)

- **Devnet only:** no mainnet deployment is registered. `config/networks/mainnet.json` still contains a placeholder escrow id, and registry/reputation/attestation mainnet ids are unset.
- **Quasar frozen, not pending promotion:** Quasar is retired from current product/production, deployment, submission, audit, and mainnet plans. The historical CRITICAL-4 and judge-nomination gaps remain unresolved; they are preserved as reasons the experiment cannot support readiness, not as an active redeployment backlog.
- **Deployed devnet binaries lag `main`:** `config/quasar/deployments.json` records the last devnet deployment as 2026-05-06, before the job-binding series (#642-#645) and the CRITICAL-4 durability change. Protections described above as source-level are not live on the recorded devnet addresses. No redeployment is planned or authorized under the experimental freeze.
- **Historical audit packet is not current:** `docs/SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md` predates the job-binding series and the experimental freeze. It remains dated provenance, not a pending Quasar auditor-engagement plan. Any future use would require a separate unfreeze decision and a newly scoped, re-frozen packet.
- **Program custody is SOL plus classic SPL Token, in source only:** the legacy Anchor source carries a classic SPL Token escrow rail beside the SOL escrow (see the escrow PDA lifecycle in `docs/PAYMENT-FLOW-ARCHITECTURE.md`); Quasar escrow custody remains lamports/SOL only. The token rail is covered by LiteSVM tests and a loopback local-validator exercise against a clearly labelled local test mint only; no deployment carries it, Token-2022 and transfer hooks are refused, and USDC and AUDD remain proof/payment-plan metadata unless a separately approved devnet or live rail lands.
- **Protocol treasury fee is devnet only:** the planned fee is 2.5% (250 bps) of the actual cost, capped at 0.1 SOL on SOL payments, paid by the metered escrow to the fixed `PROTOCOL_TREASURY` address. Only the devnet program carries it; no mainnet release collects it. The provider reports the tokens used and settles up to the buyer's approved maximum with no on-chain usage proof, so the maximum is the buyer's worst case. The `packages/x402-solana` fee helpers act only when an operator configures a treasury address, and the treasury is never taken from a buyer or a provider.
- **Upgrade authority / custody unresolved:** mainnet upgrade authority ownership, multisig/immutability policy, and compromise procedure are not yet documented or approved.
- **Operational gates unresolved:** paid mainnet RPC/fallback, on-chain monitoring, incident response, safe-harbour/bounty terms, and the historical Jupiter key rotation are still owed before production readiness.

### Token escrow limitations

The classic SPL Token rail accepts mints whose freeze authority can freeze the vault and block both release and refund until thawed; the cancel window cannot override that issuer control. Settlement is payer-only and bound to the exact token accounts recorded at lock, and closure reopens the `(payer, nonce)` PDA. The [token escrow limitations](docs/PAYMENT-FLOW-ARCHITECTURE.md#token-escrow-limitations) section owns the full list, which must be assessed before any separately approved non-local use; none of it is live-rail approval or a recovery guarantee.

## Audit Credit Use

Adevar Labs audit credits are intended for a future pre-mainnet security review covering escrow invariants, replay resistance, access control constraints, attestation/dispute logic, and integration boundaries across x402 and PER paths. No completed external audit is claimed here.

## Responsible Disclosure

If you identify a security issue:

1. Do not publish exploit details publicly before coordinated remediation.
2. Use GitHub's private vulnerability reporting flow for this repository when the **Security** tab offers **Report a vulnerability**.
3. If private vulnerability reporting is unavailable, open a public GitHub issue titled `Security contact request` and include only that you need a private channel. Do not include exploit details, private keys, payloads, logs, screenshots, or reproduction steps in the public issue.
4. Allow reasonable remediation time before disclosure.

Maintainers intend to acknowledge valid reports, prioritize fixes by severity, and coordinate transparent postmortems once patched; this is not an SLA or managed security-service commitment.

Do not open a public GitHub issue with details for exploitable vulnerabilities, private-key exposure, credential leakage, bypassable payment gates, escrow-release flaws, attestation manipulation, replay attacks, or unauthenticated access to private data.

## Secret Handling

The OSS core must not require private operational secrets to run or validate. Keep production values outside the repository and use local environment variables or a secret manager.

Never commit:

- Wallet private keys, seed phrases, signer keypair arrays, or funded key material.
- API keys, bearer tokens, x402 payment headers, auth headers, paid-provider credentials, or raw payment payloads.
- Private deployment URLs when they are required for protocol correctness.
- Private prompts, private user data, raw logs, or unredacted generated evidence.

Examples and fixtures should use placeholders. Generated artifacts must be redacted before publication. If a credential is committed or appears in a public artifact, assume it is compromised, rotate it, and disclose the rotation in the relevant security follow-up without repeating the secret value.
