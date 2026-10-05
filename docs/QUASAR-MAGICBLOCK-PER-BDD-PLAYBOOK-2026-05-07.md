# Quasar-native MagicBlock PER — BDD iterative build playbook

> **Dated historical campaign record — qualification added 2026-10-05; superseded 2026-10-02.** This playbook, including its north star, decisions, phase plans, and commands, is preserved as 2026-05-07 campaign planning, not current guidance or proof. Quasar is frozen, its recorded deployment is blocked, and stable Anchor `1.1.2` remains authoritative. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

_Date:_ 2026-05-07 AEST  
_Issue:_ #253  
_Goal:_ Build a MagicBlock PER-specific Quasar escrow path without mutating the existing reusable Quasar escrow ABI.

## North star

The final MagicBlock proof path must be Quasar-native and must not depend on Anchor-compiled Solana programs. Existing `experiments/quasar-escrow` remains the reusable base escrow rail for future privacy integrations. MagicBlock PER gets its own purpose-built Quasar program/ABI so it can use MagicBlock's exact 8-byte undelegate callback discriminator.

## Explicit decisions

1. **Keep current Quasar escrow stable.** Do not convert `experiments/quasar-escrow` from single-byte discriminators.
2. **Create a PER-specific Quasar escrow program.** New source should live separately, initially under `experiments/quasar-escrow-per/` unless implementation retros reveal a better path.
3. **Use 8-byte discriminators in the PER program.** This accommodates MagicBlock's required callback discriminator `[196, 28, 41, 206, 48, 37, 51, 167]` without a raw-dispatch shim.
4. **Manual MagicBlock CPI only.** Use Quasar explicit CPI, PDA signing, unchecked/remaining accounts, and manual instruction layouts. No Anchor macros or Anchor-compiled final program path.
5. **Devnet tx approval is granted for this workstream.** Devnet signing/txs are allowed when needed to reach the goal, bounded to minimal lamports/test state and captured in artifacts. Mainnet and paid provider actions still require separate approval.
6. **Every phase ends with retrospective + plan refinement.** No silent leapfrogging.

## Phase loop contract

Each phase follows this loop:

1. **Expectation:** record what should become true.
2. **BDD scenario:** add or update a Gherkin scenario or executable guard.
3. **Implementation slice:** smallest meaningful change.
4. **Validation:** run the smallest relevant local checks; devnet txs only when the phase calls for them.
5. **Retrospective:** write expected vs observed, surprises, blocker, safety review, decision.
6. **Plan refinement:** update this file and `STATUS.md` before continuing.
7. **Update:** concise group update after each phase loop.

Retrospective template:

```md
### Retrospective — Phase N

- **Expected:**
- **Observed:**
- **Validation:**
- **What worked:**
- **What failed / surprised us:**
- **Safety / approval review:**
- **Decision:** continue / adjust / block
- **Plan changes for next phase:**
```

## Staged plan

### Phase 0 — Decision lock + BDD harness

**Expectation:** The repo records the PER-specific strategy and has an indexed BDD scenario preventing future drift back to mutating the reusable Quasar escrow ABI.

**BDD scenarios:**

- Existing reusable Quasar escrow remains single-byte/reference-compatible.
- PER escrow is a separate Quasar-native program with 8-byte discriminator policy.
- MagicBlock PER final path forbids Anchor macros/Anchor-compiled Solana program fallback.

**Implementation slice:** This playbook + BDD feature/index update + STATUS update.

**Validation:** `npm run test:bdd:index`, `git diff --check`.

### Phase 1 — PER program scaffold and ABI guard

**Expectation:** A separate `experiments/quasar-escrow-per` crate compiles locally and exposes an 8-byte discriminator map including the MagicBlock undelegate callback.

**Implementation slice:** Copy the minimal escrow state/instructions into a new PER crate, adapt discriminators to 8 bytes, keep existing escrow untouched, and add a script/test that fails if PER discriminator lengths drift.

**Validation:** cargo test/check for new PER crate, full Quasar program test script if cheap enough, discriminator guard.

### Retrospective — Phase 1

- **Expected:** A separate `experiments/quasar-escrow-per` crate compiles locally and exposes an 8-byte discriminator map including the MagicBlock undelegate callback.
- **Observed:** New PER crate is scaffolded separately from `experiments/quasar-escrow`, uses a fresh PER-specific program ID placeholder, keeps make/take/refund behavior via 8-byte discriminators, and adds a minimal `undelegate_callback` entrypoint with MagicBlock's exact discriminator.
- **Validation:** `npm run check:quasar:per-abi` passed; `cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed; `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed 8/8; `npm run test:bdd:index` passed; full `scripts/run-quasar-program-tests.sh` passed for escrow, escrow-per, registry, reputation, and attestation.
- **What worked:** Quasar accepts 8-byte instruction discriminator arrays cleanly. The PER-specific crate can reuse the tested escrow lifecycle without altering the base escrow ABI.
- **What failed / surprised us:** An empty callback `Accounts` struct did not derive required Quasar traits; the callback needs at least a concrete account context. For Phase 1 we used a minimal unchecked mutable `escrow` account and documented that later phases must validate it as the delegated escrow PDA.
- **Safety / approval review:** Local compile/tests only; no signing, deployment, wallet mutation, or devnet txs in Phase 1.
- **Decision:** continue.
- **Plan changes for next phase:** Phase 2 should not add live network behavior yet. First build deterministic MagicBlock CPI layout fixtures and account-meta tests around the PER crate, then wire CPI calls once byte/account parity is proven.

### Phase 2 — MagicBlock layout fixtures and manual CPI codec

**Expectation:** MagicBlock permission/delegation instruction bytes and account metas are generated from deterministic Quasar-native codecs and match known SDK-derived fixtures.

**Implementation slice:** `magicblock/constants.rs`, `magicblock/layout.rs`, `magicblock/cpi.rs` with tests against `artifacts/magicblock-cpi-layout/latest.json` or a regenerated fixture.

**Validation:** fixture generation, Rust unit tests, no Anchor macro imports.

### Retrospective — Phase 2

- **Expected:** MagicBlock permission/delegation instruction bytes and account metas are generated from deterministic Quasar-native codecs and match known SDK-derived fixtures.
- **Observed:** Added `experiments/quasar-escrow-per/src/magicblock/` with constants, no-heap instruction data layout helpers, and static account-meta plans for createPermission, delegatePermission, delegateEscrow, and commitAndUndelegatePermission. Tests pin the SDK fixture data hex and account signer/writable flags.
- **Validation:** `npm run evidence:magicblock:cpi-layout` regenerated the offline SDK fixture; `cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed; `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed 15/15; `npm run check:quasar:per-abi` passed; `git diff --check` passed.
- **What worked:** Separating byte layout and account-meta plans before invoking CPI keeps Phase 2 deterministic and avoids live-network side effects. The existing Anchor-side fixture was useful as a byte/account reference without becoming final runtime code.
- **What failed / surprised us:** The new MagicBlock modules generate dead-code warnings until Phase 3/4 starts using them from CPI builders. This is acceptable for now; don't hide the warnings until the code is either used or intentionally library-exported.
- **Safety / approval review:** Offline fixture generation + local compile/tests only; no signing, deployment, wallet mutation, or devnet txs in Phase 2.
- **Decision:** continue.
- **Plan changes for next phase:** Phase 3 should convert the static plans into concrete local-only validation/builder tests first. If direct `DynCpiCall` integration proves awkward, use a small intermediate builder that produces account/data descriptors before invoking.

### Phase 3 — Local PER lifecycle tests

**Expectation:** Local QuasarSVM/LiteSVM tests can execute the PER program's escrow lifecycle and verify PDA signer/account validation boundaries without live MagicBlock network dependency.

**Implementation slice:** Add local tests for lock/delegate-intent/release/commit/undelegate callback paths using mock or fixture program IDs where direct MagicBlock programs are unavailable locally.

**Validation:** local cargo tests and program test script.

### Retrospective — Phase 3

- **Expected:** Local QuasarSVM tests can execute the PER program's escrow lifecycle and verify the MagicBlock callback dispatch boundary before any live network dependency.
- **Observed:** Existing PER lifecycle tests still pass, and two callback tests now prove the exact MagicBlock undelegate callback discriminator dispatches locally while a mutated discriminator is rejected. This validates the PER ABI boundary without invoking MagicBlock programs yet.
- **Validation:** `cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed; `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed 17/17; `npm run check:quasar:per-abi` passed; `npm run test:bdd:index` passed; `git diff --check` passed.
- **What worked:** The callback test is a cheap guard for the highest-risk compatibility detail: MagicBlock's exact 8-byte callback discriminator.
- **What failed / surprised us:** A first negative test assumed omitting the account payload would fail, but QuasarSVM did not fail that way for this minimal unchecked-account callback. The better local guard is discriminator rejection; account/PDA validation must be added when the callback mutates real escrow state.
- **Safety / approval review:** Local compile/tests only; no signing, deployment, wallet mutation, or devnet txs in Phase 3.
- **Decision:** adjust and continue.
- **Plan changes for next phase:** Insert a CPI builder integration phase before devnet deployment. Phase 4 should turn static MagicBlock layouts/account-meta plans into concrete Quasar-native CPI builders or descriptor builders, with tests for PDA signer seed propagation. Deployment moves to Phase 5.

### Phase 4 — Quasar-native CPI builder integration

**Expectation:** The PER crate can build concrete MagicBlock CPI descriptors/calls from Quasar-native data without Anchor macros, including PDA signer seed intent.

**Implementation slice:** Convert static account-meta plans into callable builder helpers (or descriptor builders if direct `DynCpiCall` requires live `AccountView`s), then test data bytes, account role order/flags, program IDs, and signer-seed metadata.

**Validation:** local Rust tests, SBF build, PER ABI guard.

### Retrospective — Phase 4

- **Expected:** The PER crate can build concrete MagicBlock CPI descriptors/calls from Quasar-native data without Anchor macros, including PDA signer seed intent.
- **Observed:** Added const `CpiDescriptor` builders for createPermission, delegatePermission, delegateEscrow, and commitAndUndelegatePermission. Each descriptor carries the target MagicBlock program role, exact account specs, exact instruction data, and the account role requiring PDA signer seeds. This is the safe intermediate layer before mapping roles to live `AccountView`s and invoking `DynCpiCall`.
- **Validation:** `cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed; `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed 18/18; `npm run check:quasar:per-abi` passed; `git diff --check` passed after trimming a trailing blank line.
- **What worked:** Descriptor builders preserve no-std/const determinism and make signer-seed expectations explicit without needing live MagicBlock accounts or CPI side effects.
- **What failed / surprised us:** Direct `DynCpiCall` construction requires concrete `AccountView`s from the instruction context, so doing that generically before wiring a PER instruction would be artificial. Descriptor-first is the cleaner Quasar-native seam.
- **Safety / approval review:** Local compile/tests only; no signing, deployment, wallet mutation, or devnet txs in Phase 4.
- **Decision:** continue.
- **Plan changes for next phase:** Phase 5 can now prepare deployment, but before sending txs confirm the devnet deploy key/program ID inventory and capture artifact paths. If deploy tooling exposes a program-ID mismatch with the placeholder, update the plan/status before deployment.

### Phase 5 — Devnet deployment prep and bounded deploy

**Expectation:** The PER-specific Quasar program deploys to devnet under a new program ID, recorded separately from the reusable Quasar escrow ID.

**Implementation slice:** build-sbf/deploy script or operator checklist, deployment inventory entry, evidence artifact directory.

**Validation:** read-only executable account check after devnet deploy; tx/deploy signature captured. Devnet approval is already granted for this workstream.

### Retrospective — Phase 5

- **Expected:** The PER-specific Quasar program deploys to devnet under a new program ID, recorded separately from the reusable Quasar escrow ID.
- **Observed:** Generated a fresh PER program keypair and updated the PER crate `declare_id!` to `7ra8FZAHQ6F4SGfJJdjfgLuVnSN8HsGLx5iXq8qxSCpb`. Local SBF build and tests passed with the generated ID. Initial devnet deployment was blocked by payer balance (`0.01630384 SOL` vs `0.18901272 SOL + fee` required) and faucet rate limits. Nissan reminded us the devnet treasury exists; confirmed treasury `d4ST3N4Vkio1Xsg2NaF6Zox7Xq8MdqWihvyip9AHioR` held `4.747355812 SOL`, transferred `0.25 SOL` to the configured payer `3Vmcwra5tfxGwaX3jnpmYybCd7gH4fstJzi1Yci38f94`, and deployed successfully.
- **Validation:** `cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed; `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed 18/18; deploy tx `3qYh7Efdhufy6FLVsqwtWgDz57eHpiXwZBE7RVXxgPa6A36PVn1whRRgjH6tmuX6ebREurdc5k7L8CjwdQHWnzBn`; `solana program show 7ra8FZAHQ6F4SGfJJdjfgLuVnSN8HsGLx5iXq8qxSCpb --url devnet` shows owner `BPFLoaderUpgradeab1e11111111111111111111111`, ProgramData `DhLwhhwWqpGvof1t1Z67BWWasFzSBbaoiSHU4YZJKhCS`, authority `3Vmcwra5tfxGwaX3jnpmYybCd7gH4fstJzi1Yci38f94`, slot `460635750`, data length `26984`, balance `0.18901272 SOL`. Evidence captured under `artifacts/quasar-escrow-per-devnet/20260507-140241/`.
- **What worked:** Deployment path is now proven and funded through the intended devnet treasury; the PER program ID is executable on devnet and separate from the reusable Quasar escrow ID.
- **What failed / surprised us:** I initially forgot to draw down from the configured devnet treasury and tried the public faucet; that wasted time and hit rate limits. Also, Solana deploy failure logs can emit a transient buffer recovery phrase, so raw deploy logs must be redacted before sharing or committing.
- **Safety / approval review:** Devnet transfer/deploy were within Nissan's approval. No mainnet, paid provider, or external environment mutation. Treasury drawdown was `0.25 SOL` devnet only.
- **Decision:** continue.
- **Plan changes for next phase:** Phase 6 can start against deployed PER program `7ra8FZAHQ6F4SGfJJdjfgLuVnSN8HsGLx5iXq8qxSCpb`. Keep using treasury `d4ST3N4Vkio1Xsg2NaF6Zox7Xq8MdqWihvyip9AHioR` for bounded devnet top-ups instead of faucet.

### Phase 6 — Devnet MagicBlock Permission/PER transaction loop

**Expectation:** Devnet txs create permission/delegation state for the PER escrow PDA using Quasar-native CPI and route through the MagicBlock PER/TEE boundary.

**Implementation slice:** bounded smoke script that locks tiny SOL, creates permission/delegation, routes private release/commit/undelegate attempts, and captures all signatures/errors.

**Validation:** evidence pack with tx signatures, RPC readbacks, MagicBlock PER router/TEE request evidence, and explicit success/failure boundary.

### Retrospective — Phase 6

- **Expected:** Devnet txs create permission/delegation state for the PER escrow PDA using Quasar-native CPI and route through the MagicBlock PER/TEE boundary.
- **Observed:** Added `scripts/run-quasar-per-devnet-smoke.mjs` and `npm run smoke:quasar:per-devnet`. The smoke sends real devnet txs to the deployed Quasar PER program: a tiny `QPERLOCK` escrow lock and the exact MagicBlock undelegate callback discriminator. This proves the deployed PER ABI is callable on devnet, the escrow PDA is owned by the Quasar PER program, and the callback entrypoint dispatches live. It does **not** yet create MagicBlock permission/delegation accounts because the deployed program still lacks concrete Quasar instructions that map the CPI descriptors to live `AccountView`s and invoke MagicBlock programs.
- **Validation:** `npm run smoke:quasar:per-devnet` passed against `7ra8FZAHQ6F4SGfJJdjfgLuVnSN8HsGLx5iXq8qxSCpb`; lock tx `4Bk1VLxWqBN98D5qXG3J9Kdma3zgdcKwSDr22QntGBkBLAa9oD6VEAVhdqEmrSYFSqjvpWnQQpmKRfQ7yxvHbiTu`; callback tx `3EEk59Swd262JPYMeEvwKAKTLwqkdyWEcBFm3FFngF17X3RZuWvneHdHoy7n1JPftMWrcUvTswo8dLvYuk1StrNY`; escrow PDA `EyPKcNBFhLA8yb7y3xK5Pmt4dDftzMVRmUQtKoti2cLd`; escrow account owner `7ra8FZ...`, lamports `2579920`, data length `99`. First smoke attempt failed because the script used a timestamp escrow id while the on-chain counter expected `0`; the script now reads the counter PDA and uses the next id automatically.
- **What worked:** The deployed Quasar PER program can run the core lock + callback ABI on public devnet. The smoke is deterministic enough to rerun because it derives the next escrow id from the counter account.
- **What failed / surprised us:** The current Phase 6 expectation was too large for the code state: we had descriptors for MagicBlock CPIs but no exposed Quasar instruction that invokes them. Treating descriptor-only code as ready for full PER lifecycle would overclaim.
- **Safety / approval review:** Devnet-only txs, tiny escrow amount (`0.001 SOL`) plus fees, using the configured funded payer. No mainnet or paid-provider action.
- **Decision:** adjust.
- **Plan changes for next phase:** Insert Phase 6B before final evidence: implement concrete Quasar PER lifecycle instructions (`delegate_per` and `commit_undelegate_per`) that consume remaining/manual accounts, map descriptors to `DynCpiCall`, and invoke MagicBlock with PDA signer seeds. Only after that should we rerun the full MagicBlock Permission/PER transaction loop.

### Phase 6B — On-chain MagicBlock CPI instruction wiring

**Expectation:** The Quasar PER program exposes concrete instructions that invoke MagicBlock Permission/Delegation programs with the descriptor-pinned bytes/accounts and escrow PDA signer seeds.

**Implementation slice:** Add PER-specific `delegate_per` and `commit_undelegate_per` instructions, account contexts for required MagicBlock accounts, descriptor-to-`DynCpiCall` mapping, local tests for account order/seed roles, then rebuild/redeploy.

**Validation:** SBF build, cargo tests, PER ABI guard, devnet deploy/upgrade, then a bounded MagicBlock permission/delegation smoke.

### Retrospective — Phase 6B

- **Expected:** The Quasar PER program exposes concrete instructions that invoke MagicBlock Permission/Delegation programs with descriptor-pinned bytes/accounts and escrow PDA signer seeds.
- **Observed:** Added `delegate_per` and `commit_undelegate_per` Quasar instructions. `delegate_per` builds three `DynCpiCall`s: createPermission, delegatePermission, and delegate escrow. `commit_undelegate_per` builds the commitAndUndelegatePermission CPI. Both derive escrow PDA signer seeds from `[b"escrow", payer, escrow_id, bump]`. Rebuilt and upgraded the deployed devnet PER program.
- **Validation:** `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed 18/18; `cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed; `npm run check:quasar:per-abi` passed with 6 PER instructions; upgrade tx `4PsT7HsPM6RbEnKVEdxFuA1kMJGxz11ozVeQoLvfgW2HT3K5LpNJXPzJMQLEhyrR3cWtPyiteitWwnb1tPxa46VG`; `solana program show` shows slot `460637119`, data length `39200`, balance `0.27403608 SOL`; post-upgrade devnet ABI smoke passed with lock tx `5iEqfrTJWZuLizksmNCh2qEYL4wgv44DLhtVSyxxNmAUFnW9SSVU939N3kN5dNkLhZVg63wzJgjPSUVEHncNEdir` and callback tx `4oasrxXMhvBrLg6c746NSvWkPpmGgfNDnndvrhF2Jxy3UJDRBeoDtWzWyQHR5uC62MGxje97jiwbYxDGraENqCWv`.
- **What worked:** The Quasar-native program now contains actual MagicBlock CPI invocation code, not just byte descriptors. SBF size increased from `26984` to `39200`, and the upgraded program remained callable.
- **What failed / surprised us:** Upgrade required an additional `0.35 SOL` devnet top-up from treasury because the larger program needed `0.27403608 SOL` rent. The first upgrade failure again emitted a transient buffer recovery phrase; it was redacted immediately. We still need a client-side MagicBlock account derivation/smoke to exercise the new CPI instructions against real MagicBlock accounts.
- **Safety / approval review:** Devnet-only upgrade/top-up under existing approval. Treasury drawdown was `0.35 SOL` devnet. No mainnet or paid-provider action.
- **Decision:** continue.
- **Plan changes for next phase:** Insert Phase 6C: derive MagicBlock permission/delegation accounts client-side using SDK/reference helpers, invoke `delegate_per`, inspect success/failure, then invoke/route `commit_undelegate_per`. If MagicBlock rejects an account derivation or owner-program assumption, record the exact boundary and adjust account mapping rather than falling back to Anchor.

### Phase 6C — MagicBlock account derivation and live CPI smoke

**Expectation:** A bounded devnet script can derive/provide the MagicBlock account set for a Quasar escrow PDA and invoke the new `delegate_per` / `commit_undelegate_per` instructions, capturing either successful Permission/PER lifecycle txs or exact MagicBlock rejection logs.

**Implementation slice:** Extend the devnet smoke with MagicBlock SDK/reference PDA derivation, send `delegate_per` against the upgraded Quasar PER program, inspect MagicBlock account readbacks/logs, then attempt `commit_undelegate_per` only if delegation succeeds.

**Validation:** tx signatures or simulation logs, account readbacks, redacted artifacts, ABI guard, and retrospective.

### Retrospective — Phase 6C

- **Expected:** A bounded devnet script can derive/provide the MagicBlock account set for a Quasar escrow PDA and invoke `delegate_per` / `commit_undelegate_per`, proving the Permission/PER lifecycle or capturing exact rejection logs.
- **Observed:** Added `scripts/run-quasar-per-magicblock-cpi-smoke.mjs` and `npm run smoke:quasar:per-magicblock-cpi`. The script derives Permission and Delegation PDAs from the installed MagicBlock SDK, generates a redacted TEE auth token when using `https://devnet-tee.magicblock.app`, locks a tiny Quasar PER escrow, invokes `delegate_per`, reads account owners/data lengths, and attempts `commit_undelegate_per` only after delegation succeeds. Live devnet smoke now proves `delegate_per`: createPermission + delegatePermission + delegated escrow ownership all succeed. The successful delegation tx was `3XAZiUS3ZEeysrrctV7TvmrYdeYDqTgmY2qWULKNRAPr41wTQj6Zsn81hVXdgwCz3xZJ7G3JCTaGuCkv2rgVJcj9`; later reruns also succeeded (for example `5tohE8az8SaUdQPQQ5YCYLYDLGzKuqJFXtkz3VEavM4BhqvmqmCwHEKKA35kpczpYmtMHX71CA34cLty6gsBKkmP`). This observation is superseded by the standard-entrypoint fix in PR #260: after patching Quasar derive, the live smoke proves lock → delegate → TEE private authorization → commit/undelegate. The remaining boundary is not TEE execution; it is private payee lamport settlement, because MagicBlock rejects writable non-delegated payee accounts.
- **Validation:** `node --check scripts/run-quasar-per-magicblock-cpi-smoke.mjs` passed; `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed 18/18; `cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed; `npm run check:quasar:per-abi` passed; `git diff --check` passed. Devnet upgrades succeeded through slot `460639757`; latest PER program data length is `40320`. Evidence artifacts include `artifacts/quasar-per-magicblock-cpi-smoke/20260507-145115-phase6c-borsh-seeds/`, `20260507-145422-phase6c-tee-auth-commit/`, and `20260507-145608-phase6c-commit-public-sim/`.
- **What worked:** The critical MagicBlock delegation semantics are now implemented in Quasar-native code: SDK PDA derivation parity, separate Permission-vs-escrow delegate buffers, SDK-style zero-before-assign owner transfer, and Borsh-encoded escrow seeds excluding bump in the Delegation Program payload while keeping bump only in `invoke_signed`.
- **What failed / surprised us:** The first live attempts exposed three real compatibility defects: `InvalidAccountOwner` until the delegated PDA was assigned to the Delegation Program, illegal owner modification until escrow data was zeroed before ownership transfer, and `TooManySeeds` until the Delegation Program payload carried the same PDA seeds as MagicBlock's Rust CPI helper. After those were fixed, the remaining failure moved to TEE execution of the Quasar wrapper for commit. Direct Permission Program commit on TEE fails with missing escrow signature, confirming the wrapper is still needed.
- **Safety / approval review:** Devnet-only txs and upgrades under existing bounded approval; TEE auth token metadata is redacted; no mainnet, paid-provider, env/Coolify/Vercel, or external posting action. Repeated smokes consumed devnet SOL only.
- **Decision:** adjust and continue, but do not claim settlement.
- **Plan changes for next phase:** Insert Phase 6D to isolate TEE-side Quasar wrapper execution. Compare TEE vs public simulation, verify whether the TEE has the latest upgraded program image, test a minimal no-CPI TEE instruction if needed, and only then retry `commit_undelegate_per`. Keep Phase 7 evidence honest: delegation is proven; commit/settlement is not.

### Phase 6D — TEE wrapper execution isolation

**Expectation:** The remaining commit blocker can be narrowed to either TEE program-image/runtime compatibility, Quasar account validation on delegated accounts, or MagicBlock Permission/Magic Program account requirements.

**Implementation slice:** Add a minimal diagnostic or reuse existing PER instructions to verify the upgraded Quasar PER program executes on TEE after delegation; compare TEE and public simulations; inspect whether TEE is running stale program bytes; then adjust `commit_undelegate_per` account context or routing accordingly.

**Validation:** TEE simulation logs with redacted auth metadata, public-devnet comparison logs, local SBF/tests/ABI guard, and no settlement claim unless commit succeeds.

### Retrospective — Phase 6D loop 1

- **Expected:** If `commit_undelegate_per` was failing because of its account map or CPI body, a minimal Quasar callback on TEE should at least enter the program and fail later/differently.
- **Observed:** Superseded by PR #260. The `0xfffffffffffffff8` access violation was caused by Quasar's generated non-standard two-argument SBF entrypoint being called by MagicBlock TEE through the standard one-pointer Solana ABI. After patching Quasar derive, the delegated Quasar PER program executes inside MagicBlock TEE.
- **Validation:** Public callback sim consumed 41 CU and succeeded; TEE callback sim consumed 1 CU and failed before program logic. Base Quasar escrow comparison: public sim reached program logic (`NotEnoughAccountKeys`, 16 CU), TEE sim failed at instruction start with the same access violation.
- **Toolchain probe:** Built an alternate PER binary with `cargo build-sbf --arch v1` and upgraded devnet program `7ra8FZAHQ6F4SGfJJdjfgLuVnSN8HsGLx5iXq8qxSCpb` at tx `5R9kqL17C42xDBzmaSUUPxUSHyKdf19T5y94L4egRSMtBCCqw6MMXxH4w2M5gCRR3pjCocESkdLnwD1Y38c5Y6Gu`. The TEE access violation persisted, so this is not fixed by simply switching from the default current SBF arch to v1. A Solana 2.1.21/platform-tools v1.43 build probe failed before SBF output because current Quasar dependencies include `wincode-derive 0.4.4` / edition-2024 metadata, which Cargo 1.79 cannot parse.
- **What worked:** The diagnostic separated MagicBlock delegation success from TEE execution failure cleanly and showed the issue affects both PER and base Quasar programs.
- **What failed / surprised us:** Deploying the v1 probe first failed for insufficient payer balance and emitted a transient deploy buffer recovery phrase; the artifact log was redacted, and payer was topped up by `0.4 SOL` devnet from treasury. A test expectation still included the old bump-in-seed-payload byte; tests now pin the corrected MagicBlock Rust CPI payload shape with bump excluded from the Borsh seed vector.
- **Safety / approval review:** Devnet-only upgrade/top-up under existing bounded approval; no settlement claim; no mainnet/paid provider/env mutation. Artifact deploy logs are redacted locally.
- **Decision:** adjust. Treat Phase 6D as Quasar-on-MagicBlock-TEE compatibility isolation, not just commit account-map debugging.
- **Plan changes for next loop:** Try one narrower compatibility fork before stopping: either (a) build/deploy a minimal non-Quasar native no-op program to the same devnet/TEE path to prove TEE can execute locally deployed SBF generally, or (b) if cost/time is constrained, document that MagicBlock TEE currently cannot execute Quasar-compiled programs while public devnet can. Do not spend more devnet SOL on repeated PER smokes until the TEE execution boundary is resolved.

### Retrospective — Phase 6D loop 2

- **Expected:** A tiny non-Quasar native SBF no-op program should tell us whether the TEE can execute freshly deployed non-Anchor/non-Quasar programs at all.
- **Observed:** Built and deployed a minimal native SBF no-op probe at program `gLzmiJdygErz3nKJk5X8mx3nphcVeTVTLdKAuacMeGo` (deploy tx `34yUAesudkeHzEV1MRnrai6M7SXZRLsWJDp5NJvW6ph6Ec144Dkr8uu7bdNMFpYab9jGUpyd2audGzYaN6gvmBZK`). Direct TEE simulation did not reach execution; it failed during MagicBlock cloning with `Cloner error: Failed to clone program ... InvalidAccountData`. This is a different boundary from Quasar PER after delegation: the Quasar program is cloned/present on TEE after MagicBlock delegation but fails at execution start.
- **Validation:** Native probe build/deploy passed; TEE direct sim captured the cloner failure. Local PER gates after fixture correction passed: `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml`, `cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml`, `npm run check:quasar:per-abi`, and `git diff --check`.
- **What worked:** The probe confirmed direct TEE calls to a freshly deployed program are not enough; the program needs a MagicBlock delegation path before it becomes comparable to the Quasar PER case.
- **What failed / surprised us:** The native no-op without delegated state cannot prove general TEE execution because MagicBlock rejects it at clone time. A comparable non-Quasar probe would need to implement delegation support, which starts becoming a parallel MagicBlock integration rather than a cheap diagnostic.
- **Safety / approval review:** Devnet-only tiny native program deploy; no mainnet/paid provider/env mutation. No settlement claim.
- **Decision:** after PR #260, do not describe MagicBlock as a TEE execution failure. Current honest boundary: Quasar PER delegation succeeds on base devnet and the patched Quasar PER program executes inside MagicBlock TEE for private authorization/commit evidence; successful private payee lamport settlement is still not claimed.
- **Plan changes for next phase:** Superseded by PR #260. Focus on packaging evidence honestly and, if time allows, design delegated-payee/private settlement beyond the current TEE private-authorization proof.

### Phase 7 — Final evidence + demo integration guard

**Expectation:** Judge/operator evidence can honestly claim Quasar-native MagicBlock PER only if Phase 6C proves settlement; otherwise it clearly presents the remaining boundary without overstating.

**Implementation slice:** update judge packet, operator checklist, demo evidence generator, and readiness guard.

**Validation:** `npm run check:quasar:submission`, relevant MagicBlock smoke, BDD index, build/lint if UI touched.

### Retrospective — Phase 7 loop 1

- **Expected:** Submission-facing docs should not describe MagicBlock as successful private payee settlement while current evidence proves TEE private authorization/commit rather than non-delegated payee lamport mutation.
- **Observed:** `docs/COLOSSEUM-FINAL-QUASAR-PROOF-MAP-2026-05-06.md` already had an honest boundary, but older narrative collateral still described Anchor as canonical and MagicBlock private settlement as proven. The submission claim-boundary guard also did not scan that older narrative or the final proof map.
- **Validation:** `npm run check:submission:claim-boundaries` passed after expanding the guard to 7 files; `npm run test:bdd:index` passed; `git diff --check` passed.
- **What worked:** Updating the guard first enough to include the stale narrative makes future copy drift cheaper to catch. The current safe claim is crisp: Quasar-native MagicBlock permission/delegation succeeds live, and patched Quasar PER executes inside MagicBlock TEE for private authorization/commit evidence; successful private payee lamport settlement is not claimed.
- **What failed / surprised us:** The stale narrative still framed Anchor as the canonical submission path and said MagicBlock private settlement was proven. That was previously safe historical collateral, but it is now dangerous if reused for judges.
- **Safety / approval review:** Docs and local guard changes only; no signing, deployment, wallet mutation, paid provider, or external posting.
- **Decision:** continue with evidence-boundary packaging, not more live PER spending, unless MagicBlock/Quasar guidance appears or we explicitly choose a native delegated-control probe.
- **Plan changes for next phase:** Keep `check:submission:claim-boundaries` in the pre-recording/submission loop. If more public copy is edited, add it to the guard before trusting it.

## Phase retrospectives

### Retrospective — Phase 0

- **Expected:** The repository should capture Nissan's explicit direction: preserve existing Quasar escrow, build PER separately, use BDD loops, and allow bounded devnet txs.
- **Observed:** The direction is now captured in this playbook, `STATUS.md`, GitHub issue #253, and indexed Bucket M BDD scenarios.
- **Validation:** `npm run test:bdd:index` passed; `git diff --check` passed.
- **What worked:** The BDD feature turns the architectural decision into a drift guard: reusable escrow must stay separate, PER must use 8-byte discriminators, and Anchor fallback is disallowed for final runtime proof.
- **What failed / surprised us:** Creating the GitHub issue initially exposed a shell quoting footgun with Markdown backticks; issue body was repaired using `--body-file` and the learning was logged in `.learnings/2026-05-07-gh-issue-body-backticks.md`.
- **Safety / approval review:** Docs/BDD/GitHub issue only; no signing/deployment/wallet mutation in Phase 0. Devnet tx approval is recorded for later phases only.
- **Decision:** continue.
- **Plan changes for next phase:** Phase 1 should start with a minimal separate crate scaffold and discriminator guard before adding MagicBlock CPI complexity. Keep the old escrow source as a reference, not an edited base.

### Phase 7 — Self-custodied agent vault settlement model

**Expectation:** Instead of mutating arbitrary wallet payees inside MagicBlock TEE, the PER program should support a Quasar-owned agent vault PDA that can be delegated and privately credited, with wallet withdrawal controlled by the agent authority.

**Implementation slice:** Add local-only Quasar vault semantics first: `AgentVault` PDA, `prepare_agent_vault`, `take_to_agent_vault`, and `withdraw_agent_vault`. Keep MagicBlock vault delegation for the next phase.

**Validation:** `cargo build-sbf --manifest-path experiments/quasar-escrow-per/Cargo.toml` passed; `cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml -- --nocapture` passed 21/21; `npm run check:quasar:per-abi` passed with 9 PER instructions; `npm run check:submission:claim-boundaries`, product naming guard, BDD index, and `git diff --check` passed.

**Review / retrospective:** Nissan's vault framing is the right protocol abstraction. The assign-first wallet delegation probe proved direct wallet delegation can work, but it is a heavy UX/security story. Agent vaults keep self-custody at the withdrawal-authority layer while giving MagicBlock a program-owned delegated account to mutate. Current claim remains local vault settlement semantics only; do not claim MagicBlock private vault credit until vault delegation + TEE smoke are implemented.
