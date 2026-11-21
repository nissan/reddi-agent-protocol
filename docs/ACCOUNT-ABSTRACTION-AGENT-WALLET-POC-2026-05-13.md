# Account-Abstracted Agent Wallet POC — Research + Plan

_Date: 2026-05-13 AEST_
_Project: Reddi Agent Protocol_

## Goal

Make RAP usable by a non-crypto agent operator, e.g. someone running an agent in `pi.dev`, who installs a RAP MCP client and wants their agent to discover and consume specialist agents.

Current friction: the user needs a crypto wallet, long addresses, funding flow, gas/fees, and signing UX.

Target UX:

1. User installs RAP MCP client in their agent runtime.
2. User logs in with email/passkey.
3. User tops up a wallet by card or familiar payment flow.
4. User grants their agent a bounded spending policy.
5. Agent can discover specialists, get quotes, and pay for approved calls without the user manually signing every transaction.
6. User can revoke, cap, inspect, and recover the wallet without understanding private keys.

## Working definition: what “account abstraction” means here

For RAP, account abstraction is not just “hide seed phrases.” It means **separating user identity, wallet custody, funding, and delegated agent authority**:

- **Human account:** email/passkey/social login + recovery.
- **Funding rail:** card/bank/USDC top-up into a wallet or spending balance.
- **Wallet/account:** holds funds and signs payments.
- **Agent signer:** scoped permission to spend from that account under user-defined constraints.
- **Policy engine:** enforces per-call, per-day, recipient/source, network, and workflow limits.
- **Audit trail:** every agent payment maps to an MCP tool call, quote, x402/receipt, and settlement signature.

On EVM, “true AA” usually means ERC-4337/EIP-7702 smart accounts with bundlers/paymasters/session keys. On Solana, this is less standardized: much of the practical product surface is embedded wallets + sponsored fees + delegated signers + optional program-level guardrails.

## Current RAP context

Relevant current state:

- RAP has a merged Circle x402 source adapter preview with metadata-only discovery and dry-run quote preview.
- RAP MCP bridge devnet proof is passing.
- Local Surfpool simulator lanes are passing for critical A→B→C, onboarding wrapper, and Jupiter invoke flows.
- Existing memory from March research said Turnkey was v1 viable for Solana-first managed wallets and Jupiter composable swap work; full smart accounts were parked for v2.

## Research findings

### 1. Turnkey — strongest low-level delegated signer candidate

Turnkey’s agentic wallet docs are very aligned with the RAP need: AI agents get delegated access, private keys stay in secure enclaves, policy engine checks signing requests before signatures are produced, and agent credentials can be scoped by recipient, contract, function selector, chain, and value limits.

Important points:

- Secure enclave signing; agent never receives the private key.
- Delegated Access user starts with zero permissions.
- Policies can require agent-only approval for low-risk operations, human or multi-party approval for high-risk actions.
- Multichain support including EVM and Solana.
- Good fit for: RAP-controlled server-side signing gateway, agent scoped keys, auditability, POC speed.

Risk/gap:

- Policy enforcement is provider-side/enclave-side, not fully onchain for Solana EOAs.
- Need to verify current pricing/signature limits and production terms.
- Card top-up is not Turnkey’s main product; pair with Stripe/Crossmint/Circle/onramp.

Source: https://docs.turnkey.com/products/embedded-wallets/features/agentic-wallets

### 2. Privy — strongest user-login embedded wallet UX candidate

Privy supports email/social/passkey style onboarding, Solana embedded wallets, and delegated signers. Their docs explicitly allow a user to delegate a Solana or Ethereum embedded wallet so a server can sign on their behalf without the server seeing the private key.

Important points:

- Solana embedded wallet creation with email login.
- Delegated server signer flow supports `chainType: 'ethereum' | 'solana'`.
- Privy + Stripe onramp recipe exists: Stripe handles payment processing, KYC, crypto delivery; Privy wallet receives funds.

Risk/gap:

- Stripe embedded crypto onramp is private beta / requires approval.
- Privy delegated signing is powerful; RAP must wrap it in our own explicit spend policy/audit layer.
- Need to confirm whether policy enforcement is sufficiently granular for autonomous agents or if we need app-side policy plus backend custody controls.

Sources:
- https://docs.privy.io/recipes/solana/getting-started-with-privy-and-solana
- https://docs.privy.io/wallets/using-wallets/signers
- https://docs.privy.io/wallets/using-wallets/signers/delegate-wallet
- https://docs.privy.io/recipes/stripe-headless-onramp

### 3. Circle Wallets — useful USDC/Solana infra, but Solana AA is EOA-only

Circle Wallets support Solana wallets and Gas Station, but their Solana docs explicitly say Solana wallet creation supports EOA only; Smart Contract Account account type is for ERC-4337 and not supported on Solana.

Important points:

- Solana wallet creation supports `SOL` / `SOL-DEVNET`.
- Gas Station can sponsor fees on Solana using fee payer mechanics.
- Good for USDC-native flows, especially if RAP leans into Circle x402/Circle for Agents.

Risk/gap:

- Not true Solana account abstraction; no Solana SCA account type.
- Need separate delegated-agent policy and signing architecture.
- Circle product/API access and terms may constrain public self-serve POC.

Source: https://developers.circle.com/wallets/wallets-on-solana

### 4. Crossmint — most product-complete for agent payments if accessible

Crossmint’s agent docs directly target the use case: agents paying with cards or stablecoins under spending rules controlled by users, x402 support, PCI-compliant card vaulting/tokenization, wallets/onramps, and agent-oriented payment flows.

Important points:

- Purpose-built agent payment infra.
- Supports cards and stablecoin wallets.
- Mentions x402 and machine-to-machine payment flows.
- Could be the fastest “wow demo” if API access is straightforward.

Risk/gap:

- May be more closed/commercial/contact-sales than low-level infra.
- Need to validate chains, USDC route, Australia/user geography, sandbox limits, and ability to plug into RAP receipts rather than becoming the whole payment layer.

Sources:
- https://docs.crossmint.com/agents/overview
- https://www.crossmint.com/learn/agent-wallets-compared

### 5. Coinbase CDP / Agentic Wallets — closest public benchmark to RAP MCP wallet UX

Coinbase Agentic Wallet / Payments MCP appears directly aimed at the target UX: install an MCP server, sign in/fund a wallet, discover x402 services, and let the agent pay only for allowed x402 services under user limits.

Important points:

- Very close to target UX: MCP-compatible install, wallet status/balance tools, service discovery, x402 payment tools.
- Strong x402 ecosystem gravity.
- Search snippets indicate MCP agents can discover/pay for x402 services but cannot send to arbitrary addresses or change limits; the wallet UI owns sign-in, funding, browsing services, and limit changes.
- Good benchmark and possible integration path for Base-based RAP consumer flows.

Risk/gap:

- Need direct official-doc implementation check and access/availability validation.
- Likely Base/EVM-first for the cleanest gasless/session-cap story, though docs snippets show network filters including Solana for x402 Bazaar listing.
- Could become competitor/partner/source adapter rather than wallet backend.

Sources found via search:
- https://www.coinbase.com/developer-platform/products/agentic-wallets
- https://docs.cdp.coinbase.com/agentic-wallet/welcome
- https://docs.cdp.coinbase.com/agentic-wallet/mcp/quickstart
- https://docs.cdp.coinbase.com/agentic-wallet/mcp/mcp-tools/overview
- https://docs.cdp.coinbase.com/agentic-wallet/mcp/faq

### 6. Pay.sh — Solana-first agent API payments, highly relevant as consumer rail and benchmark

Pay.sh is directly relevant if RAP stays Solana-first. It is a Solana Foundation + Google Cloud gateway for agent/API payments using stablecoins on Solana, with x402 and MPP support, a live provider catalog, CLI, MCP server, and wallet top-up flow.

Important points:

- Designed for exactly the agent/API payment pattern: discover API endpoints, see pricing, pay per request, receive response.
- Solana announcement says Pay.sh links a Solana wallet to agent interfaces including Gemini, Claude Code, Codex, Openclaw, Hermes, etc.
- Pay.sh docs expose a local MCP server via `pay mcp` with tools for discovery, endpoint lookup, paid HTTP calls, balance checks, and provider validation.
- `pay setup` creates a wallet in local secure storage where available: macOS Keychain, GNOME Keyring, Windows Hello, and 1Password.
- `pay topup` supports the top-up flow; Solana launch material says credit card or stablecoin funding can complete in roughly 60 seconds.
- Live catalog snapshot showed 72 providers and public registry/discovery endpoints.
- Pay.sh is open source: `solana-foundation/pay`; services registry: `solana-foundation/pay-skills`.

Where it fits RAP:

- **Best Solana-first benchmark:** Pay.sh is closer to the immediate Solana/MCP/x402 target than ERC-4337 stacks.
- **Potential consumer adapter:** RAP MCP could interoperate with or wrap `pay mcp` for generic paid API calls while RAP handles specialist reputation, attestation, and routing.
- **Potential provider channel:** RAP specialists could publish into Pay.sh/pay-skills as payment-ready APIs, making RAP specialists discoverable through the wider Solana agent economy.
- **Potential source adapter:** RAP could ingest Pay.sh catalog metadata into RAP marketplace discovery, similar to the Circle x402 source-adapter preview.

Risk/gap:

- Pay.sh solves paid API discovery/payment, not necessarily user-friendly account abstraction/recovery by email. Wallet appears local secure-storage based rather than email/passkey account recovery.
- Agent delegation policy depth needs validation. Docs emphasize local wallet approval and not exposing private keys, but we still need RAP-level caps, allowlists, receipt binding, and revoke UX.
- Need to test card top-up availability, geography, KYC, and whether it works in Australia.
- Need to inspect exact payment receipt format, x402/MPP headers, and how to bind Pay.sh receipts into RAP attestation/reputation.

Sources:
- https://pay.sh
- https://pay.sh/docs/get-started/install/index.md
- https://pay.sh/docs/pay-for-apis/mcp/index.md
- https://pay.sh/.well-known/mcp/server-card.json
- https://pay.sh/api/catalog
- https://solana.com/news/solana-foundation-launches-pay-sh-in-collaboration-with-google-cloud

### 7. EVM ERC-4337/EIP-7702 smart accounts — best “real AA” semantics, but chain-shift cost

EVM smart accounts provide the cleanest version of autonomous-agent safety: session keys, paymasters, batched calls, spending limits, allowlisted contracts, revocation, social recovery, and gas abstraction.

Good candidates to evaluate next: Alchemy Account Kit, ZeroDev/KERNEL, Biconomy, Safe{Core}, Coinbase smart wallets, thirdweb, Openfort.

Risk/gap:

- RAP’s current proof path and reputation/escrow demos are Solana-oriented.
- A chain shift to Base/EVM may speed x402 wallet UX but fragments proof artifacts unless we design RAP as chain-agnostic settlement with Solana and Base adapters.

## Recommended POC architecture

### POC principle

Do **not** start by trying to build a general-purpose crypto wallet. Build a RAP Agent Wallet Adapter with provider-pluggable backends and a narrow policy envelope for specialist-agent consumption.

### Recommended v0 stack

Primary path:

- **Login/wallet UX:** Privy or Turnkey Embedded Wallets.
- **Delegated signer:** Turnkey agentic wallet if we want stronger policy primitives; Privy delegated signer if we want fastest consumer login UX.
- **Funding:** start with devnet/testnet faucet + manual USDC fixture; then add Stripe onramp or Crossmint sandbox once provider access is confirmed.
- **RAP integration:** MCP client calls RAP wallet gateway, not raw provider SDK.
- **Settlement:** keep Solana devnet for continuity; optionally add Base/x402 route as a parallel adapter after POC.

Updated recommendation after broader provider scan and Pay.sh review:

1. **Best Solana-first POC:** Pay.sh integration + RAP policy/receipt wrapper. Pay.sh already has Solana stablecoin payments, x402/MPP, MCP tooling, paid API discovery, local secure wallet setup, and top-up flow. It is the most relevant Solana-native benchmark and likely the fastest proof that a Pi/OpenClaw/Codex-style agent can pay for services on Solana.
2. **Best Solana wallet onboarding complement:** Privy Solana embedded/delegated wallet or Crossmint Solana smart/MPC wallet. This addresses the part Pay.sh may not fully solve: email/passkey recovery and branded user onboarding.
3. **Best policy/signing core:** Turnkey. Strong for granular delegated signing and enclave-enforced policies across EVM/Solana, but needs a separate top-up/onramp layer.
4. **Best all-in-one “maybe buy this” candidate:** Crossmint. Its agent payments docs already cover cards, stablecoin wallets, spending rules, x402, and agent payment flows.
5. **Best full account-abstraction POC if/when EVM track matters:** Privy login + ZeroDev Kernel smart account on Base Sepolia/Base. This gives the cleanest ERC-4337/EIP-7702 semantics, but it is no longer the primary recommendation while RAP is Solana-first.

If we only build one first while staying Solana-focused: **Pay.sh source/consumer integration + RAP policy wrapper**. In parallel, test whether **Pay.sh top-up + local secure wallet** is sufficient for user onboarding, or whether we still need Privy/Crossmint for email/passkey recovery.

## Proposed user flow

### Human onboarding

1. User installs RAP MCP client:
   ```bash
   npx @redditech/rap-mcp install
   ```
2. CLI opens browser/device-code auth:
   ```text
   Log in to Reddi Agent Protocol: https://app.reddi.tech/device?code=ABCD-EFGH
   ```
3. User signs in by email/passkey.
4. RAP creates or links an embedded wallet.
5. User tops up:
   - POC: devnet faucet / test USDC.
   - Pilot: Stripe/Crossmint/Circle onramp to USDC.
6. User grants agent budget:
   ```text
   Allow this agent to spend up to $5/day, max $0.25/call, only on RAP-listed specialists, require attestor receipt.
   ```

### Agent consumption

1. Agent calls MCP tool: `rap.discover_specialists({ taskType })`.
2. RAP returns ranked specialists and quote envelopes.
3. Agent calls: `rap.quote({ specialistId, inputShape })`.
4. If quote fits policy, MCP wallet adapter signs/pays automatically.
5. RAP invokes specialist with x402/payment proof.
6. RAP stores receipt: quote, policy check, wallet signature, settlement tx, specialist response hash, attestation.
7. User can inspect spend log or revoke the agent.

## Security model for the POC

Minimum policy envelope:

- Per-call max spend.
- Daily/weekly spend cap.
- Allowed networks: devnet first; mainnet disabled by default.
- Allowed recipients: RAP registry specialists only.
- Allowed payment type: x402 specialist consumption only.
- Required quote before payment.
- Required receipt after payment.
- Human confirmation above threshold.
- One-click revoke agent signer.
- Full audit log surfaced in UI and MCP.

Important: never give the LLM a private key, seed phrase, raw provider API secret, unrestricted wallet credential, or unbounded signer.

## Implementation slices

### Slice 0 — provider evaluation spike (0.5–1 day)

Create `docs/AGENT-WALLET-PROVIDER-MATRIX.md` with live signup/API access status for:

- Turnkey
- Privy
- Circle Wallets
- Crossmint
- Coinbase CDP Agentic Wallets
- Alchemy Account Kit / ZeroDev if Base route is considered

Decision gate: choose `provider=turnkey|privy|crossmint` for the first POC.

### Slice 1 — RAP wallet abstraction interfaces (1 day)

Add provider-neutral interfaces:

- `createUserWallet(userRef)`
- `getWalletStatus(userRef)`
- `createAgentDelegation(walletRef, policy)`
- `revokeAgentDelegation(delegationId)`
- `quotePayment(intent)`
- `signAndPay(intent, delegationId)`
- `listWalletEvents(userRef)`

### Slice 2 — MCP client UX (1 day)

Add MCP tools:

- `rap.wallet.status`
- `rap.wallet.login_url`
- `rap.wallet.topup_url`
- `rap.wallet.create_delegation`
- `rap.wallet.revoke_delegation`
- `rap.wallet.spend_log`

Agent-facing tools should not expose raw wallet provider details.

### Slice 3 — Devnet payment POC (1–2 days)

Use existing RAP devnet proof path:

- email/user identity maps to wallet ref
- wallet receives devnet funds/test USDC
- user delegates a $/call cap
- pi.dev agent discovers a specialist via MCP
- agent consumes specialist through RAP with delegated signing
- record full receipt + tx signature

### Slice 4 — Card top-up pilot (provider-dependent)

Options:

- **Crossmint wallet + Crossmint Onramp** — strongest all-in-one path if API/product access is straightforward; supports agent-oriented cards/stablecoins/x402 positioning.
- **Privy wallet + Coinbase Onramp or MoonPay/Transak/Ramp** — likely easiest consumer wallet UX with partner onramp flexibility.
- **Privy + Stripe crypto onramp** — attractive compliance/Link UX, but Stripe crypto onramp access can be private-beta/application-gated and network support must be confirmed.
- **Turnkey wallet + Coinbase/Crossmint/Transak onramp** — stronger policy/security core, more integration work.
- **Circle Wallets/Gas Station** — useful for USDC rails and Solana fee sponsorship, but not a consumer card onramp by itself and Solana wallet type is EOA-only.

Default funding target for first Solana-focused POC: **Solana USDC via Pay.sh/top-up if accessible**, with RAP-side budget/policy limits and receipt binding. If Pay.sh top-up or wallet recovery is insufficient, pair Pay.sh payment/discovery rails with Privy/Crossmint onboarding wallets.

Do not promise public card top-up until KYC/geography/provider approval is verified, especially Australia coverage and supported USDC networks.

## Open questions

1. Is the first public settlement rail Solana USDC, Base USDC, or chain-agnostic?
2. Do we want RAP to custody/operate wallet infra, or only broker provider-backed non-custodial wallets?
3. Is the first user persona a hobbyist Pi agent user, a developer with API keys, or a business/team account?
4. Should the agent signer live in provider infra, local pi.dev, or RAP-hosted gateway?
5. What is the maximum acceptable autonomous spend for a demo account?
6. Which jurisdictions must the card top-up support first? Australia matters for Nissan; US often matters for Stripe/Coinbase/Crossmint demos.

## Recommendation

Build a **RAP Agent Wallet POC** with a provider-neutral adapter and a narrow user story:

> “Install RAP MCP in pi.dev, sign in with email, receive a devnet/test wallet, grant your agent $5/day permission, and let it discover + pay a specialist with a receipt.”

For the first implementation, use **Turnkey if policy/delegated signing is the priority**; use **Privy if consumer login UX is the priority**. Keep **Crossmint** as the serious “buy instead of build” candidate because its agent payment docs already match card + stablecoin + x402 flows.

Do not describe Solana Circle Wallets as “account abstraction” in the strict ERC-4337 sense. Circle can help with Solana wallets and gas sponsorship, but their Solana support is EOA-only.
