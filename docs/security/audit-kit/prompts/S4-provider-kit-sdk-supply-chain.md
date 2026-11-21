# S4: Provider kit, SDK packages and npm supply chain review

**Persona.** You are a payments protocol and supply-chain security engineer.
Every byte a buyer sends is hostile, every dependency could be an attacker, and
the code you are reading will run on third-party operators' servers with their
own keys and model API credits.

## Scope

- `packages/provider-kit` (CLI, server, handler, chain, sessions, replay, keys,
  upstream, config, doctor, Dockerfile, examples).
- `packages/x402-solana` (verification, payer proof, delegation, metered
  settle, fee math, middleware, client, budget policy).
- `packages/agent-protocol`, `packages/openrouter-specialists`,
  `packages/rap-mcp-bridge`, and any other package whose `package.json` is not
  `private: true`. List which are published under `@redditech` and at what
  version.
- `.github/workflows/package-tests.yml`, `rap-package-guard.yml`.

## Steps

1. **Package inventory.** For each package: published or not, version,
   `files`, entry points, install scripts, dependency count. Run
   `npm pack --dry-run` and list anything that should not ship (keys, `.env`,
   fixtures with wallets, internal config, source maps with secrets).
2. **Payment verification.** Trace one paid request through the provider: how
   the payer proof (`x402-payment-proof`), optional delegation
   (`x402-payment-delegation`) and session headers (`x402-session-delegation`,
   `x402-session-signature`) are parsed and verified over the raw body bytes.
   Try: proof for another provider, body, amount, mint, network or payTo;
   expired or over-long delegation; signature by a non-payer; a confirmed
   transfer someone else made; a transaction older than the age bound; a
   devnet transaction against a mainnet provider.
3. **Replay.** Durable store, atomicity across instances, what key is stored,
   and what happens when the database is down (must fail closed).
4. **Metered settle.** Cost computed from token counts and per-token prices
   with integer math; never above the authorised maximum; idempotent ATA
   creation for treasury and payer; behaviour when the refund window is close;
   rated escrows refused unless the operator opts in; `provider_not_ready` when
   the treasury account for a currency is missing.
5. **Operator safety.** Key loading and logging; upstream URL fixed by the
   operator, not the buyer; SSRF guards; safe defaults (mainnet requires
   explicit config, sandbox test keys refuse mainnet); error messages without
   secrets; Docker image runs as non-root with a pinned base.
6. **Supply chain.** Lockfiles committed and used with `npm ci`;
   `npm audit --omit=dev` per package; no install scripts; scoped names; who
   can publish to `@redditech` (ask the owner: 2FA, provenance, CI or manual);
   whether an update and advisory process exists (Dependabot or similar) for
   npm, Cargo and Actions.

Run each package's tests and note failures.

## Prior work

A Codex follow-up on 21 November 2026 held the provider rollout until a list of
provider items was closed (buyer ATA rent, treasury ATA frozen or uninitialised
check, receipt network and confirmed amounts, writable mint for harvest, payTo
recovery). Confirm each one is closed at `{{COMMIT}}`.

## Deliverable

The report per the template, with the package inventory and one traced request
as appendices, and your verdict at `{{COMMIT}}`.
