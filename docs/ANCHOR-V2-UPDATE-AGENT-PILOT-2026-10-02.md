# Anchor v2 `update_agent` pilot — 2026-10-02

## Decision and boundary

This is a **default-off, non-production alpha evaluation** of exactly one existing non-custodial instruction: `update_agent`. The authoritative RAP Anchor lane remains `programs/escrow/` on Anchor `1.1.2`. Nothing here changes product/runtime selection, Quasar, custody, AUDD semantics, external-operator authority, receipt/evidence semantics, controlled-live blocks, RPC configuration, deployment state, or submission readiness.

The pilot does not create wallets or keys, sign or construct transactions, contact an RPC, simulate a transaction, deploy, or use funds. Its local runtime evidence is one instruction-level Mollusk invocation with fixed public addresses and signer **account metadata** only. It is not authorization or evidence for production, audit readiness, mainnet, deployment, transactions, full feature coverage, or runtime parity.

## Official source and release check

The following current official sources were reviewed directly before implementation:

- <https://v2.anchor-lang.com/docs/> described “Anchor v2 alpha” and linked the evaluation path.
- <https://v2.anchor-lang.com/docs/v2/reference/alpha-limitations/> said v2 is alpha, unaudited, not on crates.io, and subject to API breaks between commits. It also said Rust crates come from the `anchor-next` git branch and no stable v2 TypeScript package is published.
- <https://v2.anchor-lang.com/docs/v2/get-started/migrating-from-v1/> documented `&mut Context<T>`, `Address`, `BorshAccount<T>` for variable-length state, explicit `address` constraints in place of `has_one`, and LiteSVM through `anchor_v2_testing::svm()`.
- GitHub release metadata from `solana-foundation/anchor` showed `v1.2.0` as a stable, non-prerelease release published `2026-09-04T18:46:47Z`; that is a v1 release and does **not** make v2 final.
- The official docs' `anchor-next` source was pinned at `otter-sec/anchor` commit `917b27754a6175cbe41d558f00ec7895390e1819` (commit timestamp `2026-10-01T11:33:46Z`). Its Cargo package version is `2.0.0-rc.1`, while the official documentation still classifies the release as alpha.

Anchor v2 is therefore not final enough for adoption or production comparison. It is final enough only for the explicitly approved, isolated alpha pilot because the source is commit-pinned, the stable lane remains authoritative, and all output is local and reversible.

## Why `update_agent`

`programs/escrow/src/instructions/update_agent.rs` changes only registry metadata (`rate_lamports`, `min_reputation`, and `active`) after validating the canonical `[b"agent", owner]` PDA and owner authority. It does not move value, create an account, invoke a wallet, touch an RPC, or alter receipt/payment state. The pilot mirrors this one instruction and the existing `AgentAccount` Borsh layout under:

- `pilots/anchor-v2-update-agent/programs/stable/` — isolated Anchor `1.1.2` comparator;
- `pilots/anchor-v2-update-agent/programs/alpha/` — commit-pinned Anchor v2 alpha port.

Both declare the existing program ID solely to preserve discriminator, PDA, account-owner, and client-wire compatibility in local evidence. Neither is a deployment artifact or deployment candidate.

## Reproduce

After activating the repository-pinned toolchain, run the explicit opt-in command:

```bash
./scripts/run-anchor-v2-update-agent-pilot.sh
```

The runner:

1. requires Cargo `1.98.0`, `cargo-build-sbf 4.1.0`, and Anchor CLI `1.1.2`;
2. compiles both isolated programs with platform-tools `v1.54`, SBF v3, and locked dependencies;
3. pre-creates directory sentinels at both expected `*-keypair.json` paths and fails if any keypair file appears;
4. generates stable and alpha JSON/TypeScript IDL types with the compile-only `anchor idl build` path and `/dev/null` as a non-wallet sentinel;
5. checks both isolated generated Rust clients directly against the authoritative `programs/escrow` instruction bytes, account metas, program ID, and account discriminator;
6. invokes each binary directly through Mollusk `0.15.1`, without a transaction or signature; and
7. writes machine-readable output to `.tmp/anchor-v2-update-agent-pilot/evidence.json`.

The full evidence command is absent from default builds/tests and no workflow invokes it automatically. A dedicated hosted check runs only shell/Node syntax checks, formatting, clippy, and the host-native generated-client compatibility test. It does not run `cargo build-sbf`, IDL generation, Mollusk, a validator, key generation, signing, deployment, or transaction code.

## Observed evidence

The verified local run on 2026-10-02 produced:

| Evidence | Stable Anchor 1.1.2 | Anchor v2 alpha | Exact scope |
|---|---:|---:|---|
| SBF v3 binary size | 94,624 bytes | 12,944 bytes | isolated one-instruction programs built together; alpha was 86.32% smaller |
| Mollusk compute units | 4,310 | 1,281 | one successful `update_agent` instruction under Mollusk's all-enabled default feature profile; alpha used 70.28% fewer CU |
| Deterministic state result | pass | pass | both accepted stable canonical account bytes and changed only the three expected fields |
| Instruction discriminator/args/metas | canonical | equivalent | generated Rust builders emitted the same wire data and account privileges |
| Generated IDL wire/account/type contract | canonical | equivalent | program address, discriminators, arguments, account order/privileges, account discriminator, and types matched |

The evidence JSON includes SHA-256 values for both binaries. Sizes, hashes, and CU values are observations, not frozen expectations; the runner recomputes them instead of projecting them across compiler/runtime changes.

### Dated interpretation update — 2026-10-05

The 2026-10-02 size and CU values above are preserved historical observations, but their build profiles were asymmetric:

| Profile input | Stable Anchor 1.1.2 | Anchor v2 alpha |
|---|---|---|
| Pilot crate default features | empty (`default = []`) | `no-log-ix-name` |
| Instruction-name logging | enabled | suppressed by `no-log-ix-name` |
| `anchor-lang` dependency defaults | Anchor 1.1.2's empty default feature set | disabled with `default-features = false` |
| Explicit `anchor-lang` dependency features | none | `alloc` only |
| Alpha `guardrails` | not applicable to Anchor 1.1.2 | not enabled, although it is part of the pinned alpha's upstream default set |

Both binaries were measured as built; they were not built under a symmetric logging/default-feature profile. Framework generation, implementation, and enabled features are therefore confounders. The smaller binary and lower CU observations must not be attributed solely to the Anchor version. No binary or runtime evidence was regenerated for this interpretation update.

The machine evidence also has narrower provenance than the summary labels alone suggest. Binary sizes and SHA-256 values come from the generated SBF files, and CU values come from the runtime log. The compatibility, TypeScript-generation, and deterministic-behavior labels are fixed values emitted after preceding checks: the comparator does not consume separate generated-client or runtime result artifacts, does not take the generated TypeScript paths as inputs, and does not directly compare the alpha account discriminator with the authoritative `programs/escrow` discriminator. Those executable evidence improvements remain tracked in [#669](https://github.com/nissan/reddi-agent-protocol/issues/669); this dated disclosure does not claim they have landed.

The generated `.ts` files are IDL type outputs only. Their historical labels are not proof of a usable Anchor v2 TypeScript runtime client, signing client, or transaction path. Likewise, the keypair safety check uses pre-created sentinels at the two expected SBF output paths and scans the pilot output directory for matching files. It does not inspect toolchain or dependency caches, prove the whole dependency closure incapable of signing, or establish a general key-material audit.

The 2026-10-02 description called the SBF and IDL compilation locked. In the current runner, `--locked` is present on the two Cargo test invocations but not on `cargo build-sbf` or either underlying `anchor idl build` Cargo invocation; [#665](https://github.com/nissan/reddi-agent-protocol/issues/665) tracks locked builds and executable lockfile byte-identity evidence. Even where used, `--locked` freezes dependency resolution; it does not mean offline. Cargo git/registry dependencies or the selected platform tools can still be acquired when absent. Such tool acquisition is distinct from, and does not authorize, a Solana RPC connection, wallet use, signing, simulation, transaction submission, or deployment.

Finally, both isolated programs reuse the canonical production program ID only so locally compiled bytes, discriminators, PDA derivation, account ownership, and generated interfaces can be compared. The outputs are not authorized or release-qualified deployment artifacts, and they are not evidence of a deployed upgrade. This qualification boundary is not a claim that a loader could never deploy otherwise valid compiled bytes under separate authority; the pilot neither grants nor evaluates such authority or a deployment path.

### Client limitation observed

The stable generated IDL includes PDA derivation metadata for `agent`; the alpha generated IDL omits that hint for the stored-bump constraint. The alpha generated Rust client still produces equivalent bytes and metas when supplied the canonical agent PDA explicitly. This is recorded as a compatibility limitation, not parity. The alpha TypeScript output is only a generated IDL type; a v2 TypeScript runtime was `not_evaluated` because the official alpha limitations say no stable v2 TypeScript package is published.

## Runtime-profile limits

Compute was observed only because Mollusk exposes an instruction-level meter without requiring transaction construction or signing. This pilot uses the existing Mollusk `0.15.1` / `solana-program-runtime 4.2.2` lane and makes no claim about LiteSVM's separately pinned mainnet-activated profile. LiteSVM execution was intentionally not added because the current local harness constructs and signs transactions, which is outside this task's authority. The pilot does not compare Mollusk values to LiteSVM, devnet, mainnet, or deployed execution.

This documentation update is only a partial disposition. Instruction-level authorization rejection cases remain in [#666](https://github.com/nissan/reddi-agent-protocol/issues/666), exact serialized success-state and account-metadata checks remain in [#667](https://github.com/nissan/reddi-agent-protocol/issues/667), and fresh evidence under an explicitly recorded profile remains in [#670](https://github.com/nissan/reddi-agent-protocol/issues/670). Immutable action identity for the dedicated static workflow remains the policy decision tracked in [#672](https://github.com/nissan/reddi-agent-protocol/issues/672); no action pin or repository-wide policy is selected here.

No generated binary, IDL, TypeScript type, or `.tmp` evidence file is committed as a release artifact. The source, lockfiles, checks, and runner are tracked; rerunning is the evidence procedure and deleting `pilots/anchor-v2-update-agent/`, its dedicated workflow, and `scripts/run-anchor-v2-update-agent-pilot.sh` cleanly removes the pilot.

The first PR head accidentally coupled this pilot to root `package.json`, which triggered an existing hosted Surfpool lane outside the pilot's authority. That completed run is not pilot evidence and is documented, rather than erased, in [`ANCHOR-V2-PILOT-HOSTED-CI-SAFETY-AUDIT-2026-10-02.md`](./ANCHOR-V2-PILOT-HOSTED-CI-SAFETY-AUDIT-2026-10-02.md).
