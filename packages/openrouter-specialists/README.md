# @redditech/openrouter-specialists

Shared runtime fixtures for Reddi Agent Protocol specialist demos backed by OpenRouter.

These fixtures support RAP Assurance evidence and testing. They are not production marketplace infrastructure, a payment facilitator, custody path, or a hosted runtime claim.

Iteration 3 includes the default attestor path: `verification-validation-agent` is both a `specialist` and `attestor`, can evaluate specialist outputs plus receipt chains, and returns a structured `reddi.attestation.v1` deterministic local release/refund/dispute recommendation.

Iteration 4 starts agent-to-agent composability in dry-run mode: consumer-capable specialists can return a deterministic specialist delegation plan without performing downstream x402 negotiation or spending devnet SOL.

Iteration 4.5 hardens dry-run discovery with a manifest-backed discovery adapter and a no-spend deployment readiness report. It still does not deploy, fund wallets, inspect secrets, sign transactions, or execute live downstream x402 calls.

Iteration 5b adds signer-safe wallet provenance, devnet-only funding helpers, and idempotent devnet registration helpers for the first five specialists. These tools load signer keypairs from environment variables only, derive public keys, and write public-only artifacts. They fail closed when signer env is absent and reject non-devnet RPC endpoints.

## Safety defaults

- No private keys are stored here.
- Wallet values are public devnet addresses only; Iteration 2 replaces static profile values with a public wallet manifest and balance verifier.
- Iteration 5b signer tooling loads keypairs from env only and writes public keys, env var names, balances, PDAs, and transaction signatures only — never secret key bytes.
- Funding and registration scripts are devnet-only and fail before sending transactions if pointed at a non-devnet RPC endpoint.
- `OPENROUTER_MOCK` must be explicitly set to `1` or `true` to use mock mode.
- If mock mode is disabled, `OPENROUTER_API_KEY` is required before an OpenRouter client can be created.
- Demo payment headers are accepted only when `ALLOW_DEMO_X402_PAYMENT=1` or `true`.
- `ENABLE_AGENT_TO_AGENT_CALLS` defaults to disabled. Iteration 4 supports dry-run delegation plans only; live delegation requests fail closed with `live_delegation_not_implemented` until a later guarded live-call iteration.
- Caller-controlled strings such as `paid:` or JSON containing `signature` are not treated as payment proof.
- Until real x402 settlement verification is wired, production deployments should leave `ALLOW_DEMO_X402_PAYMENT` unset and fail closed on unpaid requests.
- Attestation verdicts are recommendations only: `release`, `refund`, and `dispute` are policy outputs for a caller-controlled settlement path, not proof that this package paid, refunded, held, or settled funds.

## Attestation mode

Use the attestor profile (`SPECIALIST_PROFILE_ID=verification-validation-agent`) with either route shape:

- `POST /v1/attestations`
- `POST /v1/chat/completions` with `metadata.mode="attestation"` and `metadata.attestation`

Minimal request body:

```json
{
  "mode": "attestation",
  "subjectProfileId": "planning-agent",
  "specialistOutput": "Specialist output to review...",
  "receiptChain": [
    { "id": "receipt-1", "type": "x402-payment", "status": "satisfied", "amount": "0.03", "currency": "USDC" }
  ],
  "domain": "general operations"
}
```

Response body includes `verdictSource="deterministic_local_evaluator"`, `verdict.schemaVersion`, `score`, `checks`, `summary`, `recommendedAction`, regulated-domain caveats when relevant, and explicit release/refund/dispute semantics. The runtime still sends an attestation prompt envelope through the configured OpenRouter/mock client for auditability and future LLM attestor parsing, but the returned settlement recommendation is currently produced by the deterministic local evaluator. A future live-LLM attestor must parse and validate upstream `reddi.attestation.v1` output and fail closed/dispute on malformed output.

## Dry-run specialist delegation mode

Use a consumer-capable profile such as `planning-agent` with `POST /v1/chat/completions`, a satisfied x402 payment, and `metadata.mode="delegation_plan"`.

Minimal request body:

```json
{
  "messages": [
    { "role": "user", "content": "Plan a launch that needs document evidence extraction and code implementation." }
  ],
  "metadata": {
    "mode": "delegation_plan",
    "delegation": {
      "requiredCapabilities": ["document-analysis", "code-generation"],
      "maxCandidates": 3
    }
  }
}
```

Response body includes `object="reddi.delegation.plan"`, deterministic candidate ranking by capability match, price, evidence/reputation inputs, and freshness, estimated cost, required attestor, and guardrails. `downstreamCallsExecuted` is always `0` in this iteration. No signer/private-key material is used and no downstream paid call is attempted.

The dry-run planner can use the public wallet manifest as a discovery source. Malformed manifest candidates are excluded with explicit reasons in `discoveryDiagnostics`; they are not silently ranked.

## Iteration 5b wallet provenance, funding, and registration

### Signer env format

Signer material must come from environment variables. Do not write these values to files or commit them.

Bulk env, keyed by profile ID:

```bash
export OPENROUTER_SPECIALIST_SIGNER_KEYPAIRS_JSON='{
  "planning-agent": [64, byte, secret, key, ...],
  "document-intelligence-agent": {"secretKey": [64, byte, secret, key, ...]}
}'
```

Or per-profile env vars:

```bash
export OPENROUTER_SPECIALIST_PLANNING_AGENT_SIGNER_KEYPAIR_JSON='[64, byte, secret, key, ...]'
export OPENROUTER_SPECIALIST_DOCUMENT_INTELLIGENCE_AGENT_SIGNER_KEYPAIR_JSON='{"secretKey":[64, byte, secret, key, ...]}'
export OPENROUTER_SPECIALIST_VERIFICATION_VALIDATION_AGENT_SIGNER_KEYPAIR_JSON='[64, byte, secret, key, ...]'
export OPENROUTER_SPECIALIST_CODE_GENERATION_AGENT_SIGNER_KEYPAIR_JSON='[64, byte, secret, key, ...]'
export OPENROUTER_SPECIALIST_CONVERSATIONAL_AGENT_SIGNER_KEYPAIR_JSON='[64, byte, secret, key, ...]'
```

Supported JSON material shapes are a 64-byte secret-key array, `{ "secretKey": [...] }`, `{ "privateKey": [...] }`, or `{ "keypair": [...] }`. The scripts derive public keys from the signer and never persist the secret-key array.

### Render and verify a signer-backed public manifest

```bash
npm run wallet:render-signer-manifest
npm run wallet:verify-signer-provenance -- artifacts/signer-wallet-manifest.json
```

The rendered manifest contains `profileId`, `displayName`, derived `publicKey`, and `signerProvenance.sourceEnv` only. It is safe to publish after review. The existing static `public/wallet-manifest.json` remains public-only; use `--require-signer-provenance` when gating a signer-backed replacement.

### Request devnet airdrops

```bash
WALLET_MANIFEST_PATH=artifacts/signer-wallet-manifest.json \
AIRDROP_ARTIFACT_OUT=artifacts/devnet-airdrop-report.json \
npm run wallet:airdrop-devnet
```

Defaults: `SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com`, `AIRDROP_MAX_ATTEMPTS=3`, exponential backoff, and a public-only artifact containing profile IDs, public keys, balances, requested lamports, and tx signatures. Faucet rate limits are expected; failures are recorded without leaking signer material.

### Register the first five specialists on devnet

```bash
REGISTRATION_ARTIFACT_OUT=artifacts/devnet-registration-report.json \
npm run wallet:register-devnet
```

Registration requires signer env for all first-five profiles. It checks the agent PDA before sending, skips already-registered specialists, refuses to register underfunded signers, and writes a public-only artifact with owner public keys, PDAs, balances, status, and tx signatures. Program ID defaults to the devnet escrow program and can be overridden with `OPENROUTER_SPECIALIST_ESCROW_PROGRAM_ID` or `DEMO_ESCROW_PROGRAM_ID`.

Guardrails: devnet only, no mainnet RPC, no committed private keys, no OpenRouter/live downstream calls.

## Deployment readiness preflight

Generate a public-data-only readiness report:

```bash
npm run deployment:readiness
```

Optional environment inputs:

- `PUBLIC_BASE_URL` — planned specialist endpoint base URL.
- `FUNDED_PROFILE_IDS` — comma-separated profile IDs already funded/approved.
- `DEPLOYED_PROFILE_IDS` — comma-separated profile IDs already deployed/approved.
- `READINESS_OUT` — output path, default `artifacts/deployment-readiness.json`.

The report is expected to be `blocked` before approval/funding/deployment. It reports missing endpoints, funding, and Coolify deployment as blockers while preserving guardrails: public metadata only, no private keys/signers, no devnet SOL spend, no deployment, and no live downstream x402 calls.

## Validation

```bash
npm test
```

From repo root:

```bash
docker build -f packages/openrouter-specialists/Dockerfile -t reddi-openrouter-specialists:iter1 .
```

## Replay store

The runtime remembers each payment it has accepted so the same receipt cannot buy a second
answer. `src/replay-store.ts` picks the store at start-up:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set: the durable store, which calls the
  `replay_check_and_store` database function. It survives restarts and is shared by every
  instance. If the database cannot answer, the request gets a 503 and nothing is served.
- Neither set: the in-memory store, which forgets on restart. With
  `ALLOW_REAL_X402_PAYMENT` on, the server refuses to start on it unless
  `ALLOW_MEMORY_REPLAY_STORE=1` is set, which is for local development only.

The service key is a server secret. Supply it through the host's secret store; never commit it.

## Provider receipt header

`handleRuntimeRequest` accepts an optional `signProviderReceipt` function. When it is given, a delivered `/v1/chat/completions` call that was paid with a real, verified payment returns an `x-reddi-provider-receipt` header: base64url JSON of a signed `reddi.receipt.v2` receipt naming this profile's wallet, the configured model, the SHA-256 of the request and response bodies and the payment: transaction, currency, configured mint, listed price and protocol fee in smallest units, and the payer when the payment named one. No header is sent when the mint for the listed currency is not configured. `signReddiReceiptV2` from `@redditech/agent-protocol` produces the signed receipt.

The runtime itself never reads a signing key. The server entry point (`src/server.ts`) builds the signer at start through `src/provider-signer.ts`:

- `PROVIDER_RECEIPT_KEYPAIR_PATH` names a Solana keypair file (a JSON array of 64 bytes) for this profile's wallet. The key is read from that file once; it is never taken from an environment variable, logged or returned.
- The file must be readable by its owner only (`chmod 600`) and its public key must be the profile's wallet. Otherwise the server refuses to start.
- With `ALLOW_REAL_X402_PAYMENT` on and demo payments off, the server refuses to start without the file, so it never takes a real payment it cannot issue a receipt for.
- With demo payments allowed and no file set, the server starts and issues no receipts.

The keypair file is a secret. Mount it from the host's secret store; never commit it or bake it into an image. This is source-level: no deployed specialist has been given a key, so none issues receipts today. Receipts name `solana-devnet`; the mainnet network setting is a separate, owner-approved change. Nothing is issued while demo payments are allowed, and a signer failure leaves the answer untouched. The model in the receipt is the one the runtime is configured to call: a declaration, not proof of which model ran.

## Metered (per-token) payment

A provider can take per-token payment through the metered token escrow (#794). It is offered only when the operator sets all of:

- a per-token price. Every profile carries one (`meteredPrice`; the mid tier, $3 per million input and $15 per million output tokens in USDC with at most 2,000 output tokens a call, unless the profile sets its own). `X402_INPUT_PER_MILLION` and `X402_OUTPUT_PER_MILLION`, plus optional `X402_MAX_OUTPUT_TOKENS` (default 1,000), override it;
- `X402_ESCROW_PROGRAM_ID`: the escrow program the buyer locks in;
- the mint for the profile's currency (`X402_USDC_MINT` or `X402_USDC_DEVNET_MINT`, and so on);
- `ALLOW_REAL_X402_PAYMENT`, and a `settleMeteredEscrow` function in `RuntimeDeps` that signs the settle transaction (the settle alone, provider wallet as fee payer; the lock is refused up front if the provider's, the treasury's or the buyer's token account could not receive) with the provider wallet's key, sends it and returns the confirmed signature. The runtime never reads the key.

A 402 then carries a `metered` block: the price, the output limit, the estimate for this request and the least a lock may hold. The buyer locks at least that with `lock_metered_token_escrow`, payable to the provider's associated token account, and presents `{ "settlement": "metered-escrow", "escrow", "payer", "nonce" }` (nonce: the 16-byte escrow nonce as 32 hex characters). The runtime reads the lock back from the chain and refuses it unless it is on the configured program, at the address the payer and nonce give, still locked, metered, in the configured mint, payable to this provider and at least the estimate. One lock pays for one call.

After the model answers, the runtime takes the token counts from the model's `usage` (or estimates them from the text when there is none), settles that cost with `settle_token_escrow`, never more than the lock, and only then returns the answer. The program pays 2.5% of the cost to the protocol treasury, the rest to the provider, and returns the unused maximum to the buyer. If the settle fails the answer is withheld and nothing is charged; the buyer can cancel the lock once the cancel window opens. The receipt, when a receipt signer is configured, is a `reddi.receipt.v2` with `settlement: "metered-escrow"`, the settle transaction and the token counts, maximum and refund. The token counts are the provider's report; the maximum is the buyer's worst case.

`src/server.ts` does not supply `settleMeteredEscrow` yet, so a deployed server offers only per-call payment until an operator wires one.
