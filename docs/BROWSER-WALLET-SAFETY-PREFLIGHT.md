# Browser wallet safety preflight

This document turns the approved browser Devnet wallet recommendations into default-off contracts only. It does not authorize or perform extension setup, wallet setup, faucet use, signing, simulation, submission, validator startup, mint creation, funding, or settlement observation.

## Source boundaries

Current authority comes from:

- `lib/config/network.ts` and `config/networks/*.json` for RAP network/profile resolution.
- `packages/agent-protocol/src/audd-rail-config.ts` and `packages/agent-protocol/src/payment-records.ts` for AUDD identity, CAIP-2, decimals, mint, grant eligibility, and evidence-environment labels.
- `packages/x402-solana/src/spl-token-observer.ts` for exact SPL `TransferChecked` observation requirements.
- An unarchived local note (`reddi-browser-devnet-wallet-test-plan/report.md`, outside this repository and not resolvable by reviewers or CI) recorded the same-day official-source survey behind these notes: Solana Devnet/faucet, Anza wallet adapter, Phantom Testnet Mode, Solflare verification gap, AUDD mainnet-only public source, and x402 SVM exact semantics. Treat it as background only: it is not archived evidence and no guard below reads it. Every boundary the guards enforce is stated inline in this document and implemented against the in-repo sources listed above, so the contract stands without it.

## Default state

- Devnet browser-wallet actions are unavailable by default.
- Mainnet browser-wallet actions are unavailable.
- Production funds, production AUDD, Pay.sh production activation, custody, and settlement-finality claims are unavailable.
- Official AUDD Devnet remains unavailable until a future partner-confirmed Devnet mint/test-token mechanism and a separate approval are supplied.
- The Playwright wallet mock stays a Tier 0 UI tool unless explicitly local-only signer preconditions pass.

## New executable guards

```bash
npm run check:browser-wallet:preconditions
npm run check:browser-wallet:devnet-approval -- --approval <approval.json> [--now <iso>] [--allow-future-partner-confirmed-audd-devnet]
npm run check:browser-wallet:tier1-contract [-- --contract <contract.json>]
npm run check:browser-wallet:copy-guard [-- [--row <row.json>]... [--negative-control]]
npm run test:browser-wallet:safety
```

The direct `node scripts/check-browser-wallet-*.mjs` checkers are designed as offline, built-in-only guard paths: they read supplied JSON/config/process-env metadata and never touch a browser, wallet, faucet, RPC, validator, mint, keypair, signature, blockhash, transaction, token balance, or network. The listed `npm run` aliases invoke those checkers, but this contract does not characterize package-manager housekeeping, update checks, dependency acquisition, or hosted workflow transport as offline; use the already-installed repository toolchain and normal hosted-check policy. Each checker also fails closed on its own inputs rather than falling back to a default: JSON that parses to a non-object, a `--now` flag supplied without one real canonical UTC ISO-8601 calendar instant, a `--contract` flag supplied without a path, and a `--row` flag supplied without a path are all blockers, never a silent fallback to wall-clock time, to the built-in dormant contract, or to the default fixture rows. The source CLIs check for Node 22.18.0 or newer plus native TypeScript stripping and `module.registerHooks` before loading TypeScript; this is a minimum capability guard, not a replacement for the repository-local exact Node 24.20.0 pin in `.mise.toml`. `npm run test:browser-wallet:safety` is wired into the RAP package guard workflow with its negative controls so CLI regressions fail hosted CI.

## Single-use Devnet approval schema

The schema is `reddi.browser-wallet.single-use-approval.v1` and is implemented in `packages/agent-protocol/src/browser-wallet-approval.ts`. A record must be exact and single-use:

- `status: "approved"`, `approvalId`, `approver`, `approvedAt`, `expiresAt`.
- `usage.scope: "single-use"`, one approved use, zero consumed uses, nonce, and `fresh-approval-required` reuse policy. This is static review metadata only: the repository has no durable issuance/consumption owner and validation does not consume a record or prove it has not previously been presented.
- Exact provider: current allowlist is Phantom only, with exact version, official/source URL, source timestamp, and Devnet support verified from official docs. Phantom is only the current narrowest candidate for a later manual run; it is not installed or selected by this repository change.
- Isolated browser profile identifier, dedicated disposable profile, sync disabled, primary profile false, no automated extension install, delete after run.
- Wallet public key only; no secret material, no production seed import, human-controlled Devnet-only custody.
- Canonical network: `solana-devnet` plus `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, exact HTTPS RPC and optional exact WSS endpoint with no credentials, query, or fragment, both bound to the caller-trusted Devnet endpoints (the checker supplies the committed Devnet profile RPC endpoints), never mainnet.
- Exact route/action, manual-human browser-wallet execution, default-off, and `exactOnce: true` as static requested-action metadata (not durable consumption proof).
- Exact program IDs from the resolved network profile; the checker supplies the committed Devnet profile IDs as trusted validation context and rejects self-asserted or mismatched IDs. The stable legacy profile currently registers only `escrowProgramId`, so the authoritative resolver aliases registry, reputation, and attestation to that ID; the checker consumes that same resolver and fails closed if distinct profile IDs replace the alias. Devnet Quasar is not accepted.
- Human funding source reference and maximum Devnet SOL balance at risk; AI faucet use and auto top-ups must be false.
- Per-action cap, per-session cap, fee cap, `maxActions: 1`.
- Explicit retry policy; disabled retries require `maxRetries: 0`, enabled retries are bounded and count against caps.
- Asset identity: SOL fee-only or the existing gated Devnet USDC lane, whose mint must equal `CANONICAL_DEVNET_USDC_MINT` in `packages/agent-protocol/src/browser-wallet-approval.ts`. An official Solana mainnet mint (AUDD or USDC) is rejected on every asset path, including a future partner-confirmed AUDD Devnet mint. Local `AUDD_TEST`/`LOCAL_AUDD_TEST` is Tier 1 only. AUDD on Devnet is blocked by default.
- Evidence destination under the browser-wallet evidence namespace plus redaction policy forbidding private keys, seed phrases, signer arrays, cookies, auth headers, and raw payment payloads.
- Rollback owner and required disconnect/revoke, profile deletion, local-state deletion, redacted evidence preservation, incident suspension, and fresh approval before resume.
- Explicit boundaries: no mainnet, no production, no custody, no settlement finality, no official AUDD Devnet, no live funds, no AI faucet, no Pay.sh production, no automatic top-up.

The checker rejects missing, malformed, expired, future-dated, contradictory, unknown, mainnet, overly broad, or non-canonical records with sanitized error codes/paths only. Approval and evaluation timestamps use canonical UTC ISO-8601; timestamps must be ordered (`approvedAt` no later than evaluation time and before `expiresAt`, provider source `retrievedAt` no later than `approvedAt`). No maximum approval lifetime or durable consumption mechanism is defined here; those remain human-policy prerequisites before any future action. Any future partner-confirmed AUDD Devnet path must bind the asset mint, token program, decimals, source evidence, and Devnet rail identity to independently supplied trusted context and a separate approval; record fields cannot attest themselves. The current CLI deliberately supplies no such future identity, so its default-off future flag cannot make official AUDD Devnet available today.

## Playwright signer hardening

`NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY` is browser-exposed by Next.js whenever it is set. The adapter now refuses before parsing or signing unless all of these are true:

1. effective network profile is `local-surfpool`;
2. effective HTTP RPC is explicit loopback `http://` with a port;
3. effective WS endpoint, when present, is explicit loopback `ws://` with a port.

`sendTransaction` additionally refuses, before parsing the signer, unless the submitting `Connection.rpcEndpoint` is loopback `http://` and canonically identical to that effective HTTP RPC. The adapter validates its configured WS endpoint, but the wallet-adapter `sendTransaction` interface supplies no caller WS endpoint, so no caller-WS equality claim is made. A configured signer is still parsed and cached by `connect` after the configured profile/HTTP/WS preflight; this lane does not move or redefine that existing public-key behavior.

`next.config.ts` also refuses unsafe build/dev environments before a public signer secret can be bundled. When Playwright starts its configured web server, that command runs `scripts/check-browser-wallet-command-preconditions.mjs` before Next so a non-local public signer secret is blocked before a bundle is served. The command trims blank profile/endpoint overrides consistently with runtime resolution, but it reads only its process environment; it does not load `.env*`. `PLAYWRIGHT_BASE_URL` and reuse of an already-running server can bypass this startup command, so independently started/attached servers are not claimed as pre-start checked and must rely on their own build-time and runtime guards. All layers decide loopback with the shared predicate in `lib/config/loopback-endpoint.ts` and resolve the effective profile with the shared resolver in `lib/config/network-profile-name.ts`, which `lib/config/network.ts` also uses. Error messages never include env values, endpoint strings, or key material.

## Dormant Tier 1 local browser-harness contract

The built-in contract `DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT` defines future local-only expectations without generating anything:

- `enabledByDefault: false`, `executionState: "dormant-contract-only"`.
- `local-surfpool`, no public CAIP-2, dynamic loopback HTTP/WS, no remote datasource, no startup airdrop, transaction-mode block production.
- Disposable local browser identity, public-key-only evidence, no production seed import, dedicated disposable profile.
- Per-run generated six-decimal SPL test mint labelled `AUDD_TEST` or `LOCAL_AUDD_TEST`; mint address is not part of this contract and must not be committed.
- SPL Token program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, decimals `6`, `grantEligibility=non_eligible`.
- Exact local `TransferChecked` observation contract: one matching transfer and a closed required-field identifier set for mint/token program/decimals/payee/destination owner/amount/memo/signature/instruction index. Prohibited actions are likewise a closed identifier set; explanatory prose is rendered from those IDs rather than accepted as authority.
- Cleanup requires disconnect/revoke, disposable profile deletion, local validator state deletion, key material deletion, evidence redaction, incident suspension, and fresh approval.

This task intentionally does not create a mint, keypair, address, signature, blockhash, transaction, validator state, or token balance.

## Identity and copy invariant

Every quote, policy decision, intent, observation, x402 export, receipt, evidence row, dashboard row, and grant/export row must resolve to one canonical identity: rail environment, RAP network alias, CAIP-2 where public, asset label, mint, token program, decimals, observation source, grant eligibility, approval reference, and receipt reference. The committed local copy-guard fixture uses the existing wrapped-SOL address only as a synthetic valid-public-key shape; it is not an actual six-decimal AUDD mint and proves no mint creation, transaction observation, or asset identity.

Expected/mock terms must never be described as observed evidence. The executable copy guard rejects official AUDD, grant-eligible, observed settlement, settlement-finality, and controlled-live copy across every current browser-wallet safety row until a future evidence-aware approved path explicitly replaces this contract. Each positive occurrence is evaluated independently, so a separate negation or `non_eligible` badge cannot suppress a later affirmative overclaim. Reserved AUDD/USDC derivatives, normalization-changing labels/copy, Unicode default-ignorables, format/surrogate characters, non-ASCII letters/numbers/combining marks, and controls other than tab/newline/carriage-return fail closed rather than acquiring trusted identity through normalization; normalization-stable punctuation remains allowed. The guard accepts only non-live rail environments (`deterministic-fixture`, `local-test-mint`, `devnet-unverified`); `controlled-live` and `mainnet-gated` rows are rejected outright, so no row can skip these structural boundaries. Every accepted rail is bound to its canonical network alias, CAIP-2 identity, mint form, SPL Token program, six decimals, and maximum truthful observation source; concrete local/Devnet mints must be 32-byte Solana public keys, while the deterministic fixture keeps its explicit sentinel. Any row that names an official Solana mainnet mint (AUDD or USDC) or the Solana mainnet-beta CAIP-2 chain identity is rejected regardless of its rail environment or asset label. Observation strength is bounded twice: a rail environment caps its `observationSource` (`deterministic-fixture` at `parsed-transaction-fixture`, `local-test-mint` at `local-validator`, `devnet-unverified` at `expected-only`), and a receipt may never claim more observation than its row's `observationSource` provides. Parsed deterministic-fixture x402 exports use `fixture-observed`; the unqualified `observed` state is refused for fixtures.

## Devnet faucet and funding rule

AI agents must not use the Solana faucet. The unarchived source note recorded that the current Solana faucet page says AI agents should not use it; this rule is enforced here regardless of that note. A human may fund a dedicated public Devnet wallet only under a separate approval that records funding source and maximum balance without exposing secrets.

## Suspension and rollback

Suspend immediately on provider/version/source drift, wrong network/RPC, mainnet display, wrong public key, wrong program ID, wrong payee/recipient, wrong mint/token program/decimals/amount/memo, cap drift, unexpected retry/top-up/faucet use, secret leakage, or any copy/evidence upgrade of fixture/local/unverified Devnet rows.

Rollback steps:

1. Stop browser/app/test processes owned by the run.
2. Preserve only redacted approval, prompt screenshots, logs, and verifier output.
3. Disconnect and revoke the dApp from the wallet.
4. Delete the disposable browser profile.
5. Delete Tier 1 local validator/runtime state and any local disposable key material.
6. Mark downstream publication, trust, reputation, and grant claims blocked.
7. Require a fresh single-use approval before resuming.
