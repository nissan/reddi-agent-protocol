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
- Program ID: `NEXT_PUBLIC_ESCROW_PROGRAM_ID` (or `DEMO_ESCROW_PROGRAM_ID`)
- PER RPC: `NEXT_PUBLIC_PER_RPC` (or `DEMO_PER_RPC`)

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
NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:18999
NEXT_PUBLIC_ESCROW_PROGRAM_ID=<local-deployed-program-id>
```

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

The hijack guard applies to `getNetworkProfile()` only: on the devnet profile it
ignores these overrides unless `ALLOW_UNSAFE_ESCROW_OVERRIDE=true`, for both the
legacy-Anchor and the Quasar target, so a stray env var cannot repoint the web
app's registered devnet program set. `packages/demo-agents` deliberately does not
apply that guard — it honours its `DEMO_*` / `NEXT_PUBLIC_*` program id overrides
unconditionally on devnet/local, because the Surfpool smoke lanes
(`scripts/run-surfpool-quasar-critical-smoke.sh`) depend on repointing it at
locally deployed programs.

## Mainnet note

No mainnet deployment is registered today. `config/networks/mainnet.json` carries
only a placeholder escrow id (the devnet legacy Anchor id) plus explicit unset
notes for the registry, reputation, and attestation programs. The active devnet
demo target is the four-program Quasar set in `config/quasar/deployments.json`;
that set cannot be silently reused on mainnet because clusters are separate
ledgers and the resolver refuses `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar` outside
`NETWORK_PROFILE=devnet`. On `local-surfpool` the resolver throws; on `mainnet` it
keeps the blocked placeholder profile and records the refused request in
`knownGaps`, so `/register` and `/economic-demo` render an amber blocked-readiness
banner listing those gaps rather than failing to load.

On profiles whose resolved `deploymentStatus` is `mainnet-not-deployed`,
`lib/program.ts` exports `WALLET_SUBMISSION_BLOCKED = true`, and every
wallet-submit surface consults it: the register action on `/register`, and the
register plus confirm/dispute attestation actions on `/onboarding`. No audited
mainnet deployment is registered, so submitting would spend real mainnet fees on
a transaction against a program that is not executable on that cluster. On every
other profile the banner is advisory only — it reports readiness and does not
disable wallet submission.

**The profile must be set at build time.** Next inlines only static
`process.env.NEXT_PUBLIC_*` reads into the client bundle, so `lib/config/network.ts`
reads every selector as a static member and `next.config.ts` mirrors
`NETWORK_PROFILE` into `NEXT_PUBLIC_NETWORK_PROFILE` for the browser. A server that
sets `NETWORK_PROFILE` only at runtime, after `next build` ran without it, will
render the blocked banner on the server while the client bundle still carries the
build-time profile — set the variable in the build environment, not just the
runtime one.

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
- `mainnet_program_set_configured` fails until audited registry, escrow, reputation, and attestation ids are recorded for mainnet.
- `escrow_program_executable` fails until the audited escrow program is deployed to mainnet and `NEXT_PUBLIC_ESCROW_PROGRAM_ID` points to that deployed address.
