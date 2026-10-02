# Anchor v2 pilot hosted-CI safety audit — 2026-10-02

## Status

This is a post-incident record for PR [#668](https://github.com/nissan/reddi-agent-protocol/pull/668), head `8bcdbda65e6dc55984e6c87002569ebc6cb123ce`. Its first hosted run was green, but it is **not accepted as safe pilot validation**. The pilot's root `package.json` entry matched existing broad workflow path filters and caused prohibited Surfpool execution. Green status did not waive the pilot's no-key-generation, no-validator, no-signing, no-transaction, and no-deployment boundary.

The completed run was audited read-only from authenticated GitHub logs and the exact checked-in scripts. No job was rerun and no artifact, secret value, private key, or credential was downloaded or inspected.

## Trigger and run

- Workflow: `Surfpool Quasar Critical SDK`
- GitHub Actions run: [36958637393](https://github.com/nissan/reddi-agent-protocol/actions/runs/36958637393)
- Job: `surfpool-quasar-critical-sdk` (`110687143822`)
- Result: `success`
- Triggering path: the pilot added a root `package.json` script, and `.github/workflows/surfpool-quasar-critical-sdk.yml` includes `package.json` in its pull-request path filter.
- The workflow was existing repository behavior; the pilot did not modify the Surfpool workflow or its safeguards.

## What actually ran

The authenticated log records these workflow commands:

1. `npm ci`
2. Rust `1.98.0` setup and Cargo cache restore
3. `sh -c "$(curl -sSfL https://release.anza.xyz/v4.2.2/install)"`
4. `npm run test:surfpool:sdk-lifecycle`
5. `npm run test:surfpool:evidence-manifest`
6. `npm run test:surfpool:lane-boundaries`
7. `npm run test:quasar:runtime-compatibility`
8. a six-file Quasar refusal/config Jest allowlist
9. `npm run test:surfpool:quasar-critical`
10. `actions/upload-artifact@v4`

The final smoke invokes `scripts/run-surfpool-quasar-critical-smoke.sh`, which executes `scripts/run-surfpool-sdk-critical-smoke.mjs --target quasar`. Source inspection and logs establish that it:

- built four Quasar SBF programs;
- started an SDK Surfnet instance;
- exposed only dynamic loopback endpoints, recorded as `http://127.0.0.1:40207/` and `ws://127.0.0.1:44371/` for this run;
- deployed the four programs into that local Surfnet;
- called `Keypair.generate()` three times and passed the resulting secret-key bytes to child processes through per-process environment variables;
- funded the three generated public keys with five synthetic SOL each through `surfnet.fundSolMany`;
- registered agents and ran escrow, settlement, reputation commit/reveal, and attestation transactions against the loopback RPC;
- emitted local-only transaction signatures for those operations;
- exercised the Quasar PER request as an expected fail-closed case;
- stopped Surfnet and confirmed its dynamic RPC/WS ports were closed; and
- removed the isolated per-run runtime directory while retaining the reusable hosted build cache.

This activity was valid for the existing Surfpool lane's own contract, but prohibited for this pilot.

## External access, value, credentials, and persistence

### Confirmed

- Runtime Solana RPC and websocket destinations were loopback-only. Explorer links in the log used `cluster=custom` with the same loopback RPC.
- The Jupiter endpoint was the fail-closed sentinel `http://127.0.0.1:1`; the log says `JUPITER_API_KEY not set`.
- Funding was synthetic local Surfnet state, not devnet/mainnet SOL or live funds.
- No external Solana RPC, faucet, mainnet endpoint, partner service, or live-value movement appears in the log or the invoked runtime configuration.
- Network access still occurred for normal hosted setup: GitHub checkout/actions, npm dependencies, Rust/toolchain setup, and the Anza CLI download.
- GitHub's checkout credential was present in masked runner configuration as normal workflow infrastructure. No secret value was printed.
- Three evidence files totaling 8,092 bytes were uploaded as artifact `11207386107`; GitHub retained the workflow log. The runner also reported a cache hit and did not save a new cache.
- The uploaded run evidence and accepted-evidence receipt belong to the completed hosted run only. They are not committed pilot evidence and do not authorize or validate the Anchor v2 pilot.

### Bounded uncertainty

The uploaded artifact was intentionally not downloaded because the audit was forbidden from accessing potential secret or key material. Script inspection shows evidence redaction and per-run cleanup, and the log exposes public keys and transaction signatures but no private-key bytes. Therefore this audit found no evidence of persisted private keys, while not claiming byte-for-byte inspection of the hosted artifact or runner after destruction.

## Other hosted checks on the same head

The same head also ran the always-on Jest and Playwright workflows plus path-selected static/conformance workflows. Their authenticated logs show fixture/unit/UI commands. A repository search over the executed Jest test roots found no `Keypair.generate`, secret-key import, transaction signing, transaction submission, faucet, or RPC-construction calls. The Playwright lane used its documented mocked/local UI suite. These checks did not start the Surfpool lane; `package.json` caused that additional path-selected job.

## Corrective boundary

The correction:

1. removes the unnecessary root `package.json` entry;
2. keeps full binary/IDL/Mollusk evidence generation as a direct, explicit local command at `scripts/run-anchor-v2-update-agent-pilot.sh`;
3. adds a dedicated hosted workflow limited to syntax, formatting, clippy, and host-native generated-client compatibility; and
4. does not invoke SBF compilation, IDL generation, Mollusk execution, Surfpool, LiteSVM, a validator, wallet/key generation, signing, transaction construction/submission, deployment, or funds.

No existing Surfpool workflow, safeguard, trigger policy, or security control is disabled or weakened.
