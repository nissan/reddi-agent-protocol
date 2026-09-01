# Network Profiles

This project supports configuration-first network switching using `NETWORK_PROFILE`.

## Supported profiles

- `local-surfpool`
- `devnet` (default)
- `mainnet`

Profile definitions live in:
- `config/networks/local-surfpool.json`
- `config/networks/devnet.json`
- `config/networks/mainnet.json`

## Resolution order

Runtime values are resolved from profile defaults, then optional env overrides:

- RPC: `NEXT_PUBLIC_RPC_ENDPOINT` (or `DEMO_DEVNET_RPC` in demo scripts)
- Program IDs, one variable per program: `NEXT_PUBLIC_ESCROW_PROGRAM_ID`,
  `NEXT_PUBLIC_REGISTRY_PROGRAM_ID`, `NEXT_PUBLIC_REPUTATION_PROGRAM_ID`,
  `NEXT_PUBLIC_ATTESTATION_PROGRAM_ID` (or the matching `DEMO_*_PROGRAM_ID` in demo
  scripts). Each is validated and guarded — see [Mainnet](#mainnet-currently-blocked)
  below; an unset one falls back to the registered id for the resolved target.
- PER RPC: `NEXT_PUBLIC_PER_RPC` (or `DEMO_PER_RPC`)

The profile *name* itself resolves from a different, three-key order — see
[Mainnet note](#mainnet-note).

Resolver module:
- `lib/config/network.ts`

Explorer URL helpers:
- `lib/config/explorer.ts`

## Examples

### Devnet (default)
```bash
NETWORK_PROFILE=devnet
```

### Local Surfpool
```bash
NETWORK_PROFILE=local-surfpool
NEXT_PUBLIC_DEMO_PROGRAM_TARGET=legacy-anchor
NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:18999
NEXT_PUBLIC_ESCROW_PROGRAM_ID=<local-deployed-program-id>
```

No Quasar deployment is registered for this profile. Leaving
`NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar` set (as `.env.example` ships it) does not
break the app — the resolver refuses the request, keeps the legacy Anchor target,
marks the profile not submission-ready, and records the refusal in `knownGaps`.

### Mainnet (currently blocked)
```bash
NETWORK_PROFILE=mainnet
NEXT_PUBLIC_RPC_ENDPOINT=<mainnet-rpc>
NEXT_PUBLIC_ESCROW_PROGRAM_ID=<audited-mainnet-escrow-program-id>
NEXT_PUBLIC_REGISTRY_PROGRAM_ID=<audited-mainnet-registry-program-id>
NEXT_PUBLIC_REPUTATION_PROGRAM_ID=<audited-mainnet-reputation-program-id>
NEXT_PUBLIC_ATTESTATION_PROGRAM_ID=<audited-mainnet-attestation-program-id>
NEXT_PUBLIC_PER_RPC=<mainnet-tee-endpoint>
```

All four program id variables are read by `getNetworkProfile()`, by
`npm run test:mainnet:readiness`, and by `packages/demo-agents` on its devnet/local
profiles — demo-agents refuses `NETWORK_PROFILE=mainnet` outright, so it never
reads them in the mainnet context above.

Every override is validated before it is used. A value that does not base58-decode
to exactly 32 bytes — i.e. one `new PublicKey()` would reject — is discarded on
every profile: `getNetworkProfile()` keeps the registered id, marks the profile not
submission-ready, and records the rejection in `knownGaps`, so a mistyped id
surfaces as the amber blocked-readiness banner instead of throwing out of
`lib/program.ts` at module scope and 500-ing every page.

The hijack guard applies to `getNetworkProfile()` only: on the devnet profile it
ignores these overrides unless the build was made with
`ALLOW_UNSAFE_ESCROW_OVERRIDE=true`, for both the legacy-Anchor and the Quasar
target, so a stray env var cannot repoint the web app's registered devnet program
set. A discarded override is not silent: the resolver records it in `knownGaps`,
the readiness panels list it, and the selected browser profile becomes
non-submission-ready until the override is removed or the build-time unsafe flag
is set. `next.config.ts` mirrors that explicit server setting
into `NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE`, and the resolver consumes
that immutable build mirror on both server and client whenever it is present. The
browser does not accept a freely changeable runtime public unsafe-override flag;
plain `ALLOW_UNSAFE_ESCROW_OVERRIDE` is only a fallback for non-Next tooling and
unit tests when no build mirror exists. `packages/demo-agents` deliberately uses
a separate local evidence-runner contract because the Surfpool smoke lanes
(`scripts/run-surfpool-quasar-critical-smoke.sh`) depend on repointing it at
locally deployed programs. Two module-init refusals apply there, both naming the
offending labels and neither falling back to a registered id:

- On **every** profile and target, any supplied `DEMO_*_PROGRAM_ID` /
  `NEXT_PUBLIC_*_PROGRAM_ID` that is not a valid 32-byte Solana public key is
  refused, so a typo is attributed to its variable instead of surfacing later as
  an `Invalid public key input` from whichever script used it first.
- It has no registered Quasar inventory outside devnet, so selecting the Quasar
  target on `local-surfpool` additionally requires all four ids
  (`DEMO_ESCROW_PROGRAM_ID`, `DEMO_REGISTRY_PROGRAM_ID`,
  `DEMO_REPUTATION_PROGRAM_ID`, `DEMO_ATTESTATION_PROGRAM_ID`) to be supplied.

## Mainnet note

No mainnet deployment is registered today. `config/networks/mainnet.json` carries
only a placeholder escrow id (the devnet legacy Anchor id) plus explicit unset
notes for the registry, reputation, and attestation programs. The active devnet
demo target is the four-program Quasar set in `config/quasar/deployments.json`;
that set cannot be silently reused on mainnet because clusters are separate
ledgers and the resolver refuses `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar` outside
`NETWORK_PROFILE=devnet`. On both `local-surfpool` and `mainnet` the resolver
refuses the request, keeps that profile's own legacy Anchor program id, marks it
not submission-ready, and records the refusal in `knownGaps` — so `/register`,
`/onboarding`, and `/economic-demo` render an amber readiness panel listing those
gaps rather than failing to load. Those panels render whenever `knownGaps` is
non-empty, including on profiles that remain submission-ready.

On profiles whose resolved program set is not submission-ready, `lib/program.ts`
exports `SUBMISSION_BLOCKED = true`, and every transaction-signing surface
consults it — browser and server alike, because the cost it prevents is the same
on both. This includes the undeployed mainnet profile, refused Quasar targets on
non-devnet profiles, and malformed program-id overrides that were rejected before
`PublicKey` construction. In the browser: the register action on `/register`, and
the register plus confirm/dispute attestation actions on `/onboarding`. On the
server, where an operator keypair signs without a wallet prompt:
`submitOnchainOnboardingAttestation` (behind `/api/onboarding/attestation`) throws,
`commitReputationRating` / `revealReputationRating` (behind the planner
feedback and reveal routes) return `ok: false` with the blocked reason, and the
armed live-paid devnet lane `runEconomicDemoLivePaidDevnet` (behind
`/api/economic-demo/live-run` and `/api/economic-demo/z-picture-run`) returns a
`status: "blocked"` envelope — all of them before signer use, transaction
construction, or RPC submission. No audited mainnet
deployment is registered, so submitting there would spend real mainnet fees on a
transaction against a program that is not executable on that cluster. On profiles
that are submission-ready the banner is advisory only — it reports readiness and
does not disable submission.

**Set the profile in the build environment, not just the runtime one.** Next
inlines every `NEXT_PUBLIC_*` variable present in the build environment as a
literal, and it does so for the server compilation as well as the client one. Only
`NETWORK_PROFILE` — which is not `NEXT_PUBLIC_`-prefixed and is therefore never
inlined — behaves as a true runtime selector.

`resolveNetworkProfileName()` consults, in order:

1. `NETWORK_PROFILE` — runtime selector, server-side only. Always wins on the
   server; never reaches the browser.
2. `NEXT_PUBLIC_BUILD_NETWORK_PROFILE` — emitted by `next.config.ts` from whatever
   profile resolved at build time. This is the browser's source of truth.
3. `NEXT_PUBLIC_NETWORK_PROFILE` — a *build-time* selector. If it is set in the
   build environment its value is frozen into both bundles; setting it only at
   runtime works solely when the build had no profile at all. It is consulted last
   so a stale build-time value cannot beat the mirror.

`next.config.ts` resolves the mirror with the same precedence
(`NETWORK_PROFILE` before `NEXT_PUBLIC_NETWORK_PROFILE`), so the browser and the
server agree on which profile the build was configured for.

Consequence when `next build` ran with a different profile than the runtime
`NETWORK_PROFILE`: the server resolves the runtime profile and renders the blocked
banner, while the client bundle still carries the build-time profile, so the
browser-side gate reflects the build. Build with the profile you intend to serve so
the gate holds on both sides.

Mainnet switching requires explicit approval **after** external audit,
upgrade-authority/key-control decisions, audited mainnet deployments, and all
four program ids are recorded for the target cluster.

## Read-only readiness check

Run a read-only mainnet deployment probe before cutover; this is not a production readiness claim:

```bash
NETWORK_PROFILE=mainnet npm run test:mainnet:readiness
```

Artifacts are written to:
- `artifacts/mainnet-readiness/<timestamp>/SUMMARY.md`
- `artifacts/mainnet-readiness/<timestamp>/result.json`

Current expected blockers before first mainnet deploy:
- `mainnet_program_set_configured` fails until audited registry, escrow, reputation, and attestation ids are recorded for mainnet — each must base58-decode to 32 bytes, the same validity test the resolver applies, and none of the four may be the known placeholder id — and until `mainnetDeploymentStatusNote` is cleared from `config/networks/mainnet.json`.
- `escrow_program_executable` fails until the audited escrow program is deployed to mainnet and `NEXT_PUBLIC_ESCROW_PROGRAM_ID` points to that deployed address.
