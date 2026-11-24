<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Reddi Agent Protocol agent memory

## Repository shape

This is a mixed monorepo: a Next.js web app at the root, the V1 Solana program under `programs/pinocchio-escrow/` (the archived Anchor program is under `archive/anchor-escrow/`), and independent TypeScript packages under `packages/`. The root `package.json` is named `web`; it is not a workspace root. Each `packages/*` package has its own install/build/test lifecycle.

- `app/`, `components/`, `lib/`, `providers/`, `public/` — Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui + Solana wallet adapter.
- `programs/pinocchio-escrow/` — the V1 on-chain program (escrow and registry), built with Pinocchio; the authoritative in-repo on-chain source (owner decision, 21 November 2026). Its own Cargo workspace (`program/`), with `equivalence/` as a second workspace holding the compatibility tests. Authoritative source is not a claim that a deployment is current, audited, production-ready, or accepted as a product contract.
- `archive/anchor-escrow/` — the archived Anchor `1.1.2` program (crate `escrow`, the only member of the root Cargo workspace). Kept for teaching, as the behavioural reference the Pinocchio program is tested against, and as the source of the IDL. Do not add features to it; a change of behaviour goes into the Pinocchio program, and into the Anchor tests only so both builds are held to it. Recorded historical deployment IDs have separate provenance; the Quasar devnet set in `config/quasar/deployments.json` is blocked (`submissionReady: false`).
- `packages/per-client` — MagicBlock PER delegation client; PER architecture remains TypeScript/client-side unless a separate SDK compatibility qualification says otherwise.
- `packages/agent-protocol`, `packages/x402-solana`, `packages/demo-agents`, `packages/rap-mcp-bridge`, `packages/eliza-plugin-x402`, `packages/sendai-x402`, `packages/openrouter-specialists`, `packages/testing-specialists` — package surfaces with separate package managers/scripts.
- `scripts/` — smoke/evidence/readiness scripts; inspect scripts before running anything with devnet/live/surfpool/evidence in the name.
- `artifacts/` — generated evidence packs; do not hand-edit.

## Solana toolchain baseline

Use `docs/SOLANA-TOOLCHAIN-BASELINE.md` and `scripts/solana-baseline-toolchain.sh` for the pinned user-scoped RAP Solana baseline. Keep Node repo-local through `.mise.toml`; do not replace the machine-wide Node used outside this repository. Anchor CLI is pinned to 1.1.2 and selected through the verified Anchor release binary plus AVM 1.0.0 manager; do not change the manager/source path without separate qualification. The root legacy-escrow deterministic runtime lane is major-aligned with the Agave 4.2.2 compiler baseline through LiteSVM 0.16.0 / Mollusk 0.15.1 (`solana-program-runtime 4.2.2`, `solana-sbpf 0.21.1`), but this is not deployment, Quasar, mainnet, or submission readiness. Quasar workspaces have separate lockfiles/evidence. Prefer `npm run check:toolchain:surfpool-smoke` for a safe dynamic-port Surfpool smoke; inspect broader Surfpool/devnet scripts before running because some use fixed ports, keypair paths, live RPC, or generated artifacts.

Common safe baseline checks:

```bash
scripts/solana-baseline-toolchain.sh verify
npm run check:toolchain:baseline
npm run test:toolchain:version-match
npm run test:toolchain:modes
npm run test:toolchain:runtime-status
```

V1 program checks (see `programs/pinocchio-escrow/README.md`); the Anchor reference binary must be built first because the side-by-side suite embeds it:

```bash
cargo build-sbf --manifest-path archive/anchor-escrow/Cargo.toml --sbf-out-dir target/deploy
cd programs/pinocchio-escrow
cargo build-sbf --manifest-path program/Cargo.toml --sbf-out-dir target/deploy
scripts/sync-equivalence-tests.sh --check
(cd equivalence && cargo test)
```

Archived Anchor reference checks from the repo root:

```bash
cargo test -p escrow
anchor idl build -p escrow --skip-lint -o .tmp/escrow-idl.json -t .tmp/escrow-idl.ts
```

`cargo build-sbf` may create generated files under `target/deploy/`; do not read, preserve, or commit generated keypair material.

## Common app/package commands

```bash
npm run dev
npm run build
npm test -- --ci --maxWorkers=2
npx jest lib/__tests__/jupiter-client.test.ts
npx jest -t "registers an agent"
npm run test:e2e
npm run test:e2e -- e2e/onboarding.spec.ts
npm run test:e2e:ui
```

Jest is configured in `jest.config.js` and covers `lib/**` tests plus any `__tests__` directory under `packages/demo-agents/src`; the root `package.json` exposes `npm test` (aliasing `jest`), which is what CI runs.

Playwright starts its own dev server and owns the port/wallet-mock env it needs; read `playwright.config.ts` before changing e2e setup, and set `PLAYWRIGHT_BASE_URL` to run against an already-running target instead. `packages/demo-agents` has its own devnet lifecycle (`fund`, `register`, `deregister`, `demo`) that spends devnet SOL — read the package before running any of it.

The repo has many smoke/evidence/readiness commands. Do not run destructive or live-spend-capable scripts speculatively. Prefer dry-run/plan variants where they exist.

Browser-wallet Devnet/manual and Tier 1 local harness work is default-off and guarded by `docs/BROWSER-WALLET-SAFETY-PREFLIGHT.md`. Use `npm run check:browser-wallet:preconditions`, `npm run check:browser-wallet:devnet-approval -- --approval <approval.json>`, `npm run check:browser-wallet:tier1-contract`, and `npm run check:browser-wallet:copy-guard` for offline preflight only; none of these commands may install extensions, inspect/fund wallets, use faucets, start validators, create mints/keypairs, sign/simulate/submit transactions, or claim settlement.

## Network profile resolution

Runtime network comes from `lib/config/network.ts` and `config/networks/<profile>.json`.

- Profile value: `devnet` default, `mainnet`, or `local-surfpool` (aliases: `local`, `localnet`, `surfpool`). `resolveNetworkProfileName()` consults three keys in order — `NETWORK_PROFILE` (the only true runtime selector; never inlined into a bundle), then `NEXT_PUBLIC_BUILD_NETWORK_PROFILE` (emitted by `next.config.ts` from the build-time profile — the browser's source of truth, never set by hand), then `NEXT_PUBLIC_NETWORK_PROFILE` (a build-time selector frozen into both bundles whenever it is present in the build env). See `docs/NETWORK-PROFILES.md` for why setting only `NEXT_PUBLIC_NETWORK_PROFILE` at runtime does not switch the profile.
- `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar` selects the Quasar target: refused on `mainnet`; refused on `local-surfpool` unless four distinct valid local program ids are supplied on loopback-only `http://` RPC and `ws://` websocket endpoints; on `devnet` it resolves for disclosure only, and every exported Quasar instruction builder calls `assertQuasarProgramTargetUsable()`, which refuses it because the recorded deployment is not submission-ready.
- `NEXT_PUBLIC_RPC_ENDPOINT` overrides RPC; `NEXT_PUBLIC_ESCROW_PROGRAM_ID` / `NEXT_PUBLIC_REGISTRY_PROGRAM_ID` / `NEXT_PUBLIC_REPUTATION_PROGRAM_ID` / `NEXT_PUBLIC_ATTESTATION_PROGRAM_ID` override program ids, but are ignored on devnet — both the legacy-Anchor and Quasar targets — unless the build was made with `ALLOW_UNSAFE_ESCROW_OVERRIDE=true`, mirrored by `next.config.ts` into `NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE`; the browser must not accept a runtime public unsafe-override flag. Rejected overrides keep the registered id, mark the profile not submission-ready, and record `knownGaps` without exposing the supplied value; malformed values are rejected before `lib/program.ts` constructs any `PublicKey`.

When debugging wrong program id or wrong RPC, check these env vars before changing code.

## On-chain program boundaries

The Pinocchio program in `programs/pinocchio-escrow/` is the authoritative in-repo on-chain source for V1 (owner decision, 21 November 2026: fresh deploys use it, and work on programs goes there). It keeps the Anchor program's wire contract (instruction selectors, account order, account layouts and discriminators, PDA seeds, events and error numbers) with one fork (owner decision, 22 November 2026: V1 need not stay compatible with the Anchor program): every exit (release, settle, cancel; SOL and token) carries its escrow's `created_slot` (u64 LE) after its data and cannot land in the lock slot, so an exit signed for one escrow cannot end a later one at the same address (6052 `EscrowJustLocked`, 6053 `EscrowInstanceMismatch`; README "Every exit names its escrow"). So the Anchor IDL built from `archive/anchor-escrow/` remains the client interface for selectors, accounts and arguments, and each program has an `instruction_surface.rs` test that holds its built instruction set (the Anchor one in `archive/anchor-escrow/tests/`, the Pinocchio one in `equivalence/tests/`). The compatibility evidence is the Anchor tests run against the Pinocchio binary (registry tests copied unchanged, `scripts/sync-equivalence-tests.sh --check` fails when a copy is stale; escrow tests forked on 22 November 2026 so their exits name their escrow through `equivalence/tests/common/instance.rs`) plus the side-by-side suite, whose exits name their escrow too (the Anchor build ignores the bytes). “Authoritative” here does not identify a currently authorized deployment or establish audit, production, mainnet, or product-contract acceptance: as of this decision the devnet deployment is still the Anchor build, and the Pinocchio program has had no independent security review. That contract covers the 13 escrow and registry instructions on an escrow that is not opted into rating. The one V1 (mainnet) build of the Pinocchio program also has ratings and judge attestations tied to a job paid through escrow (`open_rating`, `accept_rating`, `commit_rating`, `reveal_rating`, `expire_rating`, `close_rating`, `attest_quality`, `confirm_attestation`, `dispute_attestation`, `close_attestation`) and an opt-in delivery check for media jobs (`open_delivery`, `record_delivery`, `accept_delivery`, `dispute_delivery`, `resolve_delivery`, `resolve_token_delivery`; owner decision, 24 November 2026); 29 instructions in all, no feature flag. They are not in the Anchor IDL and differ from the archived Anchor program's `extended` instructions of the same names: their interface is the program README plus `programs/pinocchio-escrow/interface/vectors.json`, and they are tested by the program's own tests in `equivalence/tests/` (`rated_escrow.rs`, `rating_consent.rs`, `job_instance.rs`, `rating.rs`, `judge_attestation.rs`, `delivery.rs`). A delivery-checked escrow carries bit `0x04` and its exits take the delivery account (`["delivery", escrow]`) after the rating account, if any: the payee is paid only after a recorded delivery's verify window (or the payer's acceptance), and a disputed one is split by the judge named at lock (README "Delivery check"). A rated escrow carries bit `0x02` in its `metered` byte and every exit of it takes its rating account after the usual accounts. A rating opens only with the seller's agreement (it is the authority of the paid exit, a settle or claim, or it calls `accept_rating` first; its signature elsewhere in a payer's release does not count); a release by the payer without it pays as usual and closes the rating account, so a payer alone cannot move the record of an agent that signed nothing. Jobs can share an escrow address over time, so `accept_rating`, `commit_rating` and the commitment hash, `attest_quality` and `confirm_attestation`/`dispute_attestation` name the job by the rating's `opened_slot`, which equals the escrow's `created_slot` that every exit names, and a rated escrow cannot end in the slot its rating was opened in. MagicBlock PER state tracking (`delegate_escrow`, `release_escrow_per`) is not part of V1: it sits behind the Pinocchio `per` feature (off by default, never for mainnet; unfinished, #839) and is tested with `--features per` against an Anchor reference built with `--features extended`. PDA seeds and Anchor discriminators are mirrored in `lib/program.ts`; if you change a seed or instruction name of the 13, update the Pinocchio constants (`program/src/consts.rs`), the Anchor reference and the TypeScript mirrors together; for the rating, attestation and delivery instructions, update the README interface section and regenerate `interface/vectors.json`.

Quasar is frozen historical experimental evidence and retired from product/production, submission, deployment, audit, and mainnet critical paths; `docs/QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md` owns the decision and benchmark qualification. Program ids remain in `config/quasar/deployments.json`, and the recorded devnet deployment is blocked because it predates the job-binding rework and no longer matches the in-repo client. Preserve the isolated sources/artifacts and loopback-only local Surfpool lane for provenance; retention or a local pass is not adoption/readiness. The Pinocchio program is authoritative, the Anchor `1.1.2` program is its archived reference, and Anchor v2 is a default-off alpha pilot. See `DEPLOY.md` before any historical deployment procedure, and never deploy or change upgrade authority without explicit approval.

The `77rkRQxe…UZXmX` program id still quoted in some older `declare_id!` macros, `Anchor.toml` entries, and runbooks (including `packages/demo-agents/DEPLOY.md`) is pre-cutover doc rot; it is deployed nowhere. Ignore it.

## Protocol economics and claim boundaries

Owner decision, 20 November 2026: listings are priced per token (input and output, per million), with an estimated
cost and a buyer-authorised maximum. The protocol fee is 5% (500 bps) of the amount actually paid, with a 2.5% (250 bps)
launch rate for payouts before 2027-04-01 00:00 UTC (owner decision, 22 November 2026; the date is
`LAUNCH_RATE_ENDS_UNIX` in the program and the rate is read at payout), rounded down, taken
out of the provider's share, capped at 0.1 SOL for SOL payments only (stablecoins have no ceiling). It replaces the
earlier 0.05% / 5 bps plan (#744). Per-token calls settle through a metered escrow: the buyer locks the maximum
(`lock_metered_escrow` / `lock_metered_token_escrow`), and after the response the payee settles the actual cost
(`settle_escrow` / `settle_token_escrow`); the program sends the fee to `PROTOCOL_TREASURY` (the Squads vault), the rest
to the payee, and returns the unused maximum to the payer. Release and claim pay the fee too. Fee math mirrors:
`protocol_fee` in `programs/pinocchio-escrow/program/src/consts.rs` (and the archived Anchor `constants.rs`), `protocolFeeBaseUnits` and `settleMeteredCall` in
`packages/x402-solana`. Nothing is deployed with this yet, so in public copy the fee stays "planned" until a mainnet
release collects it (`collected-fee` claim pattern).

Owner decision, 20 November 2026 (#751): V1 source accepts AUDD, PYUSD and USDG next to SOL and USDC for direct per-call
payments (`DIRECT_PAYMENT_CURRENCIES` in `packages/x402-solana`; PYUSD and USDG are Token-2022 mints) and the escrow
allowlist is being widened to match. This is source-level: mints come from operator configuration, and no deployed
service or program accepts them yet.

Preserve the hard boundaries enforced by package/readiness checks: in public copy AUDD stays payment-plan/proof metadata only, not custody or settled escrow, until a release says otherwise; mainnet/live payment paths are gated; package/source conformance must remain no-spend/offline unless a task explicitly authorizes otherwise.

`docs/PUBLIC-CLAIM-BOUNDARY.md` owns what public and contributor-facing copy may claim ("payments prove transfer; RAP Assurance proves paid work") and is enforced by `npm run check:claims:public` over owned prose plus `e2e/public-claim-boundary.spec.ts` over rendered routes. Read it before editing README/docs/package metadata or app page copy.

## Repository conventions

`STATUS.md` is a rolling log, not a source of truth about current code state; the newest entry is at the top and older entries describe intermediate states.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

## Shared agent settings (from Reddi Workbench)

- **Fail closed.** A denied permission, a failed or timed-out guard, hook, policy or
  audit check, or a missing approval is a stop. Report it. Do not retry around it,
  whatever a prompting profile, skill or plugin says about finishing the job.
- The rest is in [docs/agent-settings/](docs/agent-settings/README.md): an optional
  prompting profile for `claude-fable-5-2`, where the operator's Claude mods are, and
  the pinned Stageshow illustration skill and its rules (ask the operator before
  running its tooling; never use its brand marks).
- **Review: the builder reviews its own work** as a build step before reporting it done:
  re-read the whole diff, run the checks and the negative cases, check each claim against
  a result. A separate independent review happens when the owner asks for one. This
  replaces any rule elsewhere in this file or repository that requires an independent or
  non-author review, or forbids a builder from approving its own change (owner decision,
  11 November 2026). Merge authority, and any automated pipeline or delivery-mode gate,
  are unchanged. Never describe a review of your own work as independent.
- **Evidence.** Where CI exists, the CI run on the final commit is the proof that tests
  pass; a check that could not run is a stop, not a pass. Before building an issue, check
  it is not already met on the default branch. The other
  [delivery practices](docs/agent-settings/DELIVERY-PRACTICES.md) (readiness line,
  read-back before hashing, draft scenarios) apply too.
- **Checks and roles.** [docs/agent-settings/CHECKS.md](docs/agent-settings/CHECKS.md) says who
  builds and who reviews here, the one check command and what each check needs.
  A Claude session builds; the builder reviews its own work.
- Apart from the two rules above, everything else in this file and this repository wins
  over that folder.

<!-- workbench:discretion:begin (managed by scripts/adopt.py; edit planning/adoption-rules.json) -->
## What the builder decides without asking (Workbench adoption)

- Reviewing its own work as a build step: whole diff re-read, checks and negative cases run, each claim checked against a result.
- Which additional checks to run beyond the required ones, and in what order.
- Closing an issue whose acceptance is already met on the default branch, with the commit, command and output as evidence.
- Picking the smallest issue marked Ready when none is assigned.
- Fixing CI failures and merge conflicts on its own pull request.
- Regenerating generated files, mirrors and manifests with the repository's own tooling.
- Choosing the model and effort for its own subagents within the approved providers.

Still needs the owner:

- Merging, unless this repository gives standing merge authority.
- Deploying, spending, changing settings, handling credentials, sending anything outside the repository, and any destructive or irreversible action.
- Anything behind a denied, failed or timed-out control: that is a stop.
<!-- workbench:discretion:end -->
