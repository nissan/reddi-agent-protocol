# Surfpool SDK critical validation lane

RAP's critical local Surfpool lanes use the supported `@solana/surfpool` SDK lifecycle instead of `surfpool start` subprocesses. The SDK path starts an in-process `Surfnet` with dynamic loopback RPC/WS endpoints, offline mode, no startup airdrop, and transaction-mode block production:

```js
Surfnet.startWithConfig({ offline: true, airdropSol: 0, blockProductionMode: "transaction" })
```

## Safety boundary

- Local Surfnet only: no remote datasource, mainnet/testnet/devnet RPC, wallet files, upgrade authority, live funds, custody, Docker, sudo, or installed Surfpool source changes.
- The lane refuses configured RPC/PER/datasource URLs unless they are explicit `http://` or `ws://` loopback endpoints with ports before it creates run directories, builds SBF artifacts, or starts the SDK.
- Agent keypairs are generated in-process for the local run, funded by SDK cheatcodes, passed only to child demo processes via environment variables, and redacted from evidence.
- Per-run SBF outputs, Cargo targets, temporary files, and child-process `TMPDIR` live under `.tmp/surfpool-sdk-critical-smoke/<run-id>` and are removed during cleanup; the runner has an overall timeout (`RAP_SURFPOOL_CRITICAL_TIMEOUT_MS`, default 20 minutes), child-process kill escalation, and bounded RPC/WS port-closure checks.
- Generated evidence under `artifacts/` uses repository-relative paths and records no ambient environment dump.

## Commands

```bash
npm run test:surfpool:sdk-lifecycle
npm run test:surfpool:critical
npm run test:surfpool:quasar-critical
```

`test:surfpool:critical` deploys the legacy Anchor escrow reference locally through SDK cheatcodes and runs the demo-agent public settlement plus PER-unreachable fallback boundary against the dynamic local RPC.

`test:surfpool:quasar-critical` builds the four Quasar programs without patching `declare_id!`, deploys those local binaries to their explicit Quasar program IDs through SDK cheatcodes, runs the demo-agent public settlement/reputation/attestation path, and asserts the MagicBlock PER/TEE request fails closed rather than becoming a final Quasar claim.

## Hosted CI

The `Surfpool Quasar Critical SDK` workflow runs the SDK lifecycle regressions and the Quasar critical smoke on Ubuntu with Node 24, Rust 1.89, and Agave/Solana CLI v3.1.13. CI intentionally does not run live RPC, devnet funding, wallet-backed deployment, or MagicBlock PER/TEE validation. The Quasar lane remains experimental local validation and does not imply deployment, security, submission, grant, or production readiness beyond the checked local assertions.
