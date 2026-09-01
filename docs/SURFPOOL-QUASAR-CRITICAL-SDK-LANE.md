# Surfpool SDK critical validation lane

RAP's critical local Surfpool lanes use the supported `@solana/surfpool` SDK lifecycle instead of `surfpool start` subprocesses. The SDK path starts an in-process `Surfnet` with dynamic loopback RPC/WS endpoints, offline mode, no startup airdrop, and transaction-mode block production:

```js
Surfnet.startWithConfig({ offline: true, airdropSol: 0, blockProductionMode: "transaction" })
```

## Safety boundary

- Local Surfnet only: no remote datasource, mainnet/testnet/devnet RPC, wallet files, upgrade authority, live funds, custody, Docker, sudo, or installed Surfpool source changes.
- The lane refuses configured RPC/PER/datasource URLs unless they are explicit `http://` or `ws://` loopback endpoints with ports before it creates run directories, builds SBF artifacts, or starts the SDK.
- Agent keypairs are generated in-process for the local run, funded by SDK cheatcodes, passed only to child demo processes via environment variables, and redacted from evidence.
- Per-run Surfpool runtime state, SBF output directories, temporary files, and child-process `TMPDIR` live under `.tmp/surfpool-sdk-critical-smoke/<run-id>` and are removed during cleanup. `CARGO_TARGET_DIR` defaults to `.tmp/surfpool-sdk-cargo-target/<target>` so CI/local repeats can reuse compiled dependencies without reusing validator state, key material, or deployed program output. The runner has an overall timeout (`RAP_SURFPOOL_CRITICAL_TIMEOUT_MS`, default 20 minutes), child-process kill escalation, and bounded RPC/WS port-closure checks.
- Generated evidence under `artifacts/` uses repository-relative paths and records no ambient environment dump.
- Step output is redacted line-by-line before it reaches stdout or the log, so a secret split across two pipe chunks is still matched. If a hostile child emits a single unbroken line longer than 1,000,000 characters, the runner replaces that entire unterminated record with an oversized-line marker until its newline/carriage-return terminator arrives; it never force-flushes arbitrary raw fragments.
- The evidence log receives every byte a step emits. Only the in-memory buffer the assertions run against is bounded: it keeps a deterministic head and a sliding tail, and when it drops anything in between it says so inline with the omitted character and chunk counts. The front is never silently discarded.

## Evidence selection

Each target publishes an `accepted-evidence.json` receipt next to its per-run directories, written atomically (temp file + rename) and **only after the run passes**. The receipt records the target, `PASS` status, run id, timestamp, provenance command, and the repository-relative artifact paths.

The run completes cleanup, writes all PASS log lines, writes and flushes `SUMMARY.md`, flushes every cited artifact, computes the source fingerprint, and then publishes the receipt as the final fallible commit point. Publication refuses to cite an artifact that does not exist, so a crash mid-publish leaves the previously accepted receipt intact.

Every receipt is bound to two things beyond its own contents:

- **Freshness.** `ACCEPTED_EVIDENCE_MAX_AGE_MS` (14 days, owned by `scripts/lib/surfpool-evidence-manifest.mjs`) is enforced by every consumer. A caller may tighten the window but cannot widen or disable it.
- **Sources.** The receipt records a SHA-256 fingerprint of the repository paths the lane's result depends on (the Quasar or Anchor program sources, the demo client, the lane runner and its libraries, Quasar assertion scripts and the inputs they scan/read, the deployment/runtime compatibility inventories and their listed demo-critical paths, package manifests/locks, and the pinned toolchain baseline). Readers recompute it, so editing any of those invalidates prior evidence and the lane must be re-run.
- **Artifacts.** The receipt also records a SHA-256 content hash for every cited artifact. Readers recompute those hashes after containment checks, so a PASS log or summary edited after publication is refused rather than cited.

Consumers such as `scripts/generate-economic-demo-submission-prep.mjs` read that receipt and validate target, status, provenance, freshness, source fingerprint, artifact hashes, the bound evidence root, and that every cited artifact still exists inside that root (symlinked escapes are refused). Failed runs keep their own directory for debugging but never publish a receipt, so a `Status: FAIL` summary cannot displace or be cited in place of accepted evidence. Run ids are random UUIDs and are deliberately *not* used for chronological selection.

## Commands

```bash
npm run test:surfpool:lane-regressions   # sdk-lifecycle + evidence-manifest + lane-boundaries
npm run test:surfpool:critical
npm run test:surfpool:quasar-critical
```

`test:surfpool:critical` deploys the legacy Anchor escrow reference locally through SDK cheatcodes and runs the demo-agent public settlement plus PER-unreachable fallback boundary against the dynamic local RPC.

Quasar is refused outside this lane. `packages/demo-agents/src/config.ts` throws before any transaction construction, signer access, or RPC call when the Quasar target is requested on the `devnet` or `mainnet` profile, or on `local-surfpool` with a missing, malformed, duplicated, or non-loopback configuration — it never silently downgrades to `legacy-anchor`.

`test:surfpool:quasar-critical` builds the four Quasar programs without patching `declare_id!`, deploys those local binaries to their explicit Quasar program IDs through SDK cheatcodes, runs the demo-agent public settlement/reputation/attestation path, and asserts the MagicBlock PER/TEE request fails closed rather than becoming a final Quasar claim.

## Hosted CI

The `Surfpool Quasar Critical SDK` workflow runs the lane regressions (SDK lifecycle, evidence receipts, lane boundaries), the Quasar target-gate and web-refusal suites, and the Quasar critical smoke on Ubuntu with Node 24, Rust 1.89, and Agave/Solana CLI v3.1.13. Hosted runs set `RAP_SURFPOOL_CRITICAL_TIMEOUT_MS=2400000` inside a 50-minute smoke step and a 90-minute job, leaving shutdown margin for cleanup, port-closure waits, FAIL summaries, and artifact upload. CI caches npm, Cargo registry/git data, the Solana install cache, and `.tmp/surfpool-sdk-cargo-target`; it intentionally does not run live RPC, devnet funding, wallet-backed deployment, or MagicBlock PER/TEE validation. The Quasar lane remains experimental local validation and does not imply deployment, security, submission, grant, or production readiness beyond the checked local assertions.

## Known limitation: the recorded Quasar devnet deployment

The Quasar devnet programs recorded in `config/quasar/deployments.json` predate the 2026-08 job-binding rework and no longer match the in-repo client, which encodes the current `experiments/quasar-*` sources. `config/quasar/deployments.json` therefore records `submissionReady: false` with explicit ABI, PDA-derivation, commitment-pre-image, and lock-signer known gaps, and its historical `devnet-full-flow-demo` PASS is marked superseded and not reproducible.

No redeploy is claimed or performed. The only retained Quasar evidence is this local-surfpool lane, run against locally built current-source programs on a loopback Surfnet.

## Quasar ABI: current sources vs the recorded deployment

These are two separate facts and the split matters:

- **Repository sources and clients are on the post-job-binding ABI.** `lib/quasar/instruction-builders.ts`, `lib/quasar/instructions.ts`, `packages/demo-agents/src/demo.ts`, and the `packages/agent-protocol` intent metadata all encode the current `experiments/quasar-*` contract: `commit(commitment, role)`, `reveal(score, salt)`, `attest(scores)`, `expire`/`confirm`/`dispute` with no arguments, rating and attestation PDAs seeded on the escrow address, and the `sha256(score || salt || escrow_address || program_id)` commitment pre-image. There is no caller-supplied `job_id`, `consumer_pk`, or `specialist_pk` anywhere.
- **The recorded devnet deployment is pre-binding and unusable.** It is not compatible with the ABI above and is not usable from any surface; see the section above. Nothing here implies devnet usability.

**Web Quasar reputation and attestation are not implemented, and refuse.** A Quasar escrow address is
not derivable: `experiments/quasar-escrow/src/instructions/lock.rs` requires `escrow_id == counter.next_id`,
a sequential per-payer counter assigned at lock time, so the only real escrow is the PDA a successful
lock created. The onboarding flow never locks a Quasar escrow, so it has no verified lock record, and
`lib/onboarding/quasar-escrow-binding.ts` refuses with a canonical reason before any instruction is
constructed, any signer is touched, or any RPC call is made. The wizard's confirm and dispute actions
are disabled and show that reason rather than building against an escrow that does not exist. Nothing
is derived from a job id, no client-supplied address is trusted, and no escrow is synthesized.

The web Quasar route additionally stays blocked on the configured devnet profile: `lib/config/network.ts`
yields the Quasar target only there, and `assertProgramTargetUsable()` refuses it because the recorded
deployment is not submission-ready. Current-source Quasar is exercised by the local-surfpool lane with
four explicit loopback program IDs.
