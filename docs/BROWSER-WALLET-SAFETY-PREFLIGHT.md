# Browser wallet safety preflight

This document turns the approved browser Devnet wallet recommendations into default-off contracts only. It does not authorize or perform extension setup, wallet setup, faucet use, signing, simulation, submission, validator startup, mint creation, funding, or settlement observation.

## Source boundaries

Current authority comes from:

- `lib/config/network.ts` and `config/networks/*.json` for RAP network/profile resolution.
- `packages/agent-protocol/src/audd-rail-config.ts` and `packages/agent-protocol/src/payment-records.ts` for AUDD identity, CAIP-2, decimals, mint, grant eligibility, and evidence-environment labels.
- `packages/x402-solana/src/spl-token-observer.ts` for exact SPL `TransferChecked` observation requirements.
- The approved source-check report at `/home/nissan/Projects/Redditech/data/reddi-browser-devnet-wallet-test-plan/report.md` for same-day official-source notes: Solana Devnet/faucet, Anza wallet adapter, Phantom Testnet Mode, Solflare verification gap, AUDD mainnet-only public source, and x402 SVM exact semantics.

## Default state

- Devnet browser-wallet actions are unavailable by default.
- Mainnet browser-wallet actions are unavailable.
- Production funds, production AUDD, Pay.sh production activation, custody, and settlement-finality claims are unavailable.
- Official AUDD Devnet remains unavailable until a future partner-confirmed Devnet mint/test-token mechanism and a separate approval are supplied.
- The Playwright wallet mock stays a Tier 0 UI tool unless explicitly local-only signer preconditions pass.

## New executable guards

```bash
npm run check:browser-wallet:preconditions
npm run check:browser-wallet:devnet-approval -- --approval <approval.json> --now <iso>
npm run check:browser-wallet:tier1-contract
npm run check:browser-wallet:copy-guard
npm run test:browser-wallet:safety
```

All commands are offline. They read JSON/config/env only and never touch a browser, wallet, faucet, RPC, validator, mint, keypair, signature, blockhash, transaction, token balance, or network. `npm run test:browser-wallet:safety` is wired into the RAP package guard workflow with its negative controls so CLI regressions fail hosted CI.

## Single-use Devnet approval schema

The schema is `reddi.browser-wallet.single-use-approval.v1` and is implemented in `packages/agent-protocol/src/browser-wallet-approval.ts`. A record must be exact and single-use:

- `status: "approved"`, `approvalId`, `approver`, `approvedAt`, `expiresAt`.
- `usage.scope: "single-use"`, one approved use, zero consumed uses, nonce, and `fresh-approval-required` reuse policy.
- Exact provider: current allowlist is Phantom only, with exact version, official/source URL, source timestamp, and Devnet support verified from official docs. Phantom is only the current narrowest candidate for a later manual run; it is not installed or selected by this repository change.
- Isolated browser profile identifier, dedicated disposable profile, sync disabled, primary profile false, no automated extension install, delete after run.
- Wallet public key only; no secret material, no production seed import, human-controlled Devnet-only custody.
- Canonical network: `solana-devnet` plus `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, exact HTTPS RPC, optional exact WSS endpoint, never mainnet.
- Exact route/action, manual-human browser-wallet execution, default-off, exactly once.
- Exact program IDs from the resolved network profile; Devnet Quasar is not accepted by this approval checker.
- Human funding source reference and maximum Devnet SOL balance at risk; AI faucet use and auto top-ups must be false.
- Per-action cap, per-session cap, fee cap, `maxActions: 1`.
- Explicit retry policy; disabled retries require `maxRetries: 0`, enabled retries are bounded and count against caps.
- Asset identity: SOL fee-only or the existing gated Devnet USDC lane. Local `AUDD_TEST`/`LOCAL_AUDD_TEST` is Tier 1 only. AUDD on Devnet is blocked by default.
- Evidence destination under the browser-wallet evidence namespace plus redaction policy forbidding private keys, seed phrases, signer arrays, cookies, auth headers, and raw payment payloads.
- Rollback owner and required disconnect/revoke, profile deletion, local-state deletion, redacted evidence preservation, incident suspension, and fresh approval before resume.
- Explicit boundaries: no mainnet, no production, no custody, no settlement finality, no official AUDD Devnet, no live funds, no AI faucet, no Pay.sh production, no automatic top-up.

The checker rejects missing, malformed, expired, contradictory, unknown, mainnet, overly broad, or non-canonical records with sanitized error codes/paths only. Approval timestamps must be ordered (`approvedAt` before `expiresAt`, provider source `retrievedAt` no later than `approvedAt`). Any future partner-confirmed AUDD Devnet path must bind the asset mint, token program, decimals, and Devnet rail identity exactly to the partner-confirmed approval before it can pass manual review.

## Playwright signer hardening

`NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY` is browser-exposed by Next.js whenever it is set. The adapter now refuses before parsing or signing unless all of these are true:

1. effective network profile is `local-surfpool`;
2. effective HTTP RPC is explicit loopback `http://` with a port;
3. effective WS endpoint, when present, is explicit loopback `ws://` with a port.

`next.config.ts` also refuses unsafe build/dev environments before a public signer secret can be bundled. The Playwright web server command runs `scripts/check-browser-wallet-command-preconditions.mjs` before starting Next so a non-local public signer secret is blocked before a bundle is served. Error messages never include env values, endpoint strings, or key material.

## Dormant Tier 1 local browser-harness contract

The built-in contract `DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT` defines future local-only expectations without generating anything:

- `enabledByDefault: false`, `executionState: "dormant-contract-only"`.
- `local-surfpool`, no public CAIP-2, dynamic loopback HTTP/WS, no remote datasource, no startup airdrop, transaction-mode block production.
- Disposable local browser identity, public-key-only evidence, no production seed import, dedicated disposable profile.
- Per-run generated six-decimal SPL test mint labelled `AUDD_TEST` or `LOCAL_AUDD_TEST`; mint address is not part of this contract and must not be committed.
- SPL Token program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, decimals `6`, `grantEligibility=non_eligible`.
- Exact local `TransferChecked` observation contract: one matching transfer, exact mint/token program/decimals/payee/destination owner/amount/signature/instruction index, memo when required.
- Cleanup requires disconnect/revoke, disposable profile deletion, local validator state deletion, key material deletion, evidence redaction, incident suspension, and fresh approval.

This task intentionally does not create a mint, keypair, address, signature, blockhash, transaction, validator state, or token balance.

## Identity and copy invariant

Every quote, policy decision, intent, observation, x402 export, receipt, evidence row, dashboard row, and grant/export row must resolve to one canonical identity: rail environment, RAP network alias, CAIP-2 where public, asset label, mint, token program, decimals, observation source, grant eligibility, approval reference, and receipt reference.

Expected/mock terms must never be described as observed evidence. The executable copy guard rejects official AUDD, grant-eligible, observed settlement, settlement-finality, and controlled-live copy across every current browser-wallet safety row until a future evidence-aware approved path explicitly replaces this contract. Negations are evaluated within the matched copy clause, so a separate `non_eligible` badge cannot suppress an affirmative grant overclaim elsewhere.

## Devnet faucet and funding rule

AI agents must not use the Solana faucet. The approved source report recorded that the current Solana faucet page says AI agents should not use it. A human may fund a dedicated public Devnet wallet only under a separate approval that records funding source and maximum balance without exposing secrets.

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
