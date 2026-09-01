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
- Step output is redacted line-by-line before it reaches stdout or the log, so a secret split across two pipe chunks is still matched. Redaction is line-oriented: a single unbroken line longer than 1,000,000 characters is force-flushed and a value straddling that boundary would not be matched. No lane step produces such a line today.
- The evidence log receives every byte a step emits. Only the in-memory buffer the assertions run against is bounded: it keeps a deterministic head and a sliding tail, and when it drops anything in between it says so inline with the omitted character and chunk counts. The front is never silently discarded.

## Evidence selection

Each target publishes an `accepted-evidence.json` receipt next to its per-run directories, written atomically (temp file + rename) and **only after the run passes**. The receipt records the target, `PASS` status, run id, timestamp, provenance command, and the repository-relative artifact paths.

Consumers such as `scripts/generate-economic-demo-submission-prep.mjs` read that receipt and validate target, status, provenance, and that every cited artifact still exists. Failed runs keep their own directory for debugging but never publish a receipt, so a `Status: FAIL` summary cannot displace or be cited in place of accepted evidence. Run ids are random UUIDs and are deliberately *not* used for chronological selection.

## Commands

```bash
npm run test:surfpool:sdk-lifecycle
npm run test:surfpool:critical
npm run test:surfpool:quasar-critical
```

`test:surfpool:critical` deploys the legacy Anchor escrow reference locally through SDK cheatcodes and runs the demo-agent public settlement plus PER-unreachable fallback boundary against the dynamic local RPC.

Quasar is refused outside this lane. `packages/demo-agents/src/config.ts` throws before any transaction construction, signer access, or RPC call when the Quasar target is requested on the `devnet` or `mainnet` profile, or on `local-surfpool` with a missing, malformed, duplicated, or non-loopback configuration — it never silently downgrades to `legacy-anchor`.

`test:surfpool:quasar-critical` builds the four Quasar programs without patching `declare_id!`, deploys those local binaries to their explicit Quasar program IDs through SDK cheatcodes, runs the demo-agent public settlement/reputation/attestation path, and asserts the MagicBlock PER/TEE request fails closed rather than becoming a final Quasar claim.

## Hosted CI

The `Surfpool Quasar Critical SDK` workflow runs the SDK lifecycle regressions and the Quasar critical smoke on Ubuntu with Node 24, Rust 1.89, and Agave/Solana CLI v3.1.13. CI intentionally does not run live RPC, devnet funding, wallet-backed deployment, or MagicBlock PER/TEE validation. The Quasar lane remains experimental local validation and does not imply deployment, security, submission, grant, or production readiness beyond the checked local assertions.

## Known limitation: the recorded Quasar devnet deployment

The Quasar devnet programs recorded in `config/quasar/deployments.json` predate the 2026-08 job-binding rework and no longer match the in-repo client, which encodes the current `experiments/quasar-*` sources. `config/quasar/deployments.json` therefore records `submissionReady: false` with explicit ABI, PDA-derivation, commitment-pre-image, and lock-signer known gaps, and its historical `devnet-full-flow-demo` PASS is marked superseded and not reproducible.

No redeploy is claimed or performed. The only retained Quasar evidence is this local-surfpool lane, run against locally built current-source programs on a loopback Surfnet.
