# Release records

One JSON file per deployed build of the V1 escrow program. A record is the input
to `scripts/check-escrow-deployment.mjs`, the read-only check that the program on
a cluster is the build of record and that the right key controls it.

| Field | Meaning |
|---|---|
| `network` | `mainnet` or `devnet`. The check refuses an RPC whose genesis hash is not this network's. |
| `variant` | `mainnet` (default features) or `devnet` (`--features devnet`): which `escrow-verifiable-build.yml` matrix entry built it. |
| `commit` | The commit the build came from (the freeze commit for mainnet). |
| `programId` | The program address. |
| `size` | Size of the `.so` in bytes. |
| `sha256` | `sha256sum` of the `.so` file. |
| `executableHash` | `solana-verify get-executable-hash` of the `.so`: the sha256 with trailing zero bytes removed. This is the hash the workflow records as `hash`, and what `solana-verify get-program-hash` prints for the deployed program. |
| `upgradeAuthority` | The authority the program must have. On mainnet, the Squads **vault** `5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe`. |
| `forbiddenAuthorities` | Addresses that must never be the authority, such as the Squads multisig account (not the vault) and the deployer. |
| `buildRun` | The `escrow-verifiable-build.yml` run whose artifact is the build. |
| `image`, `imageDigest` | The build image by tag and by digest. |
| `deployedSlot` | The slot of the deploy or upgrade, once known. |
| `deployer` | Optional. The deployer address; the check scans its loader buffers when `--deployer` is not given. It must also be listed under `forbiddenAuthorities`. Set it on mainnet at deploy, so the weekly watch checks buffers too. |

The check reads the program and its ProgramData account and passes only if:
the cluster is right; the program is executable and owned by the upgradeable
loader; the first `size` bytes after the 45-byte ProgramData header have the
recorded `sha256` and every byte after them is zero; the trimmed hash equals
`executableHash`; and the upgrade authority is `upgradeAuthority` and not
forbidden; and no loader buffer is left with the deployer (`--deployer`) as its
authority. Without `--deployer` or a `deployer` in the record, that last line
fails rather than being skipped.
Every record must carry its provenance: `variant` equal to `network`, the full
40-character `commit`, a `buildRun` URL of this repository's
`escrow-verifiable-build.yml`, and the `image`; a mainnet record must also give
`imageDigest` (`sha256:<64 hex>`). The check refuses a record missing any of them.
A mainnet record must name the V1 escrow program `DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu` as `programId` and the Squads vault as `upgradeAuthority` and list at
least the multisig account and the deployer under `forbiddenAuthorities`; the
`--deployer` address must be one of them. The genesis hash and the accounts come
from one RPC, so on launch day run the check against two independent providers.

```bash
node scripts/check-escrow-deployment.mjs --record config/releases/<record>.json \
  [--url <rpc>] [--deployer <address>] [--json]
```

It prints only the RPC host. Exit 0: verified. Exit 1: a check failed. Exit 2:
the record or the RPC could not be used, so nothing was decided.

`v1-devnet-b71a91e.json` is the devnet upgrade of 21 November 2026.

The program was frozen at `45e9547` on 23 November 2026 (run 45124021410, both
variants; the program tree last changed in `4c2d343`). `v1-devnet-45e9547.json`
is the devnet build of the freeze, deployed in slot 525663342 on 24 November 2026 (the devnet
upgrade). Its mainnet record was withdrawn on 24 November 2026, unused: the
program was reopened for the delivery check and must not be deployed to mainnet
from `45e9547`. File sizes and `sha256` were read from the run's artifacts; the
executable hashes also appear in the run's job logs.

The delivery-check build was first cut at `63d4719` (#1049, run 45329015381). Its
records were replaced unused on 24 November 2026 when the refund timing of a
delivered fixed-price escrow changed (#1074); nothing was deployed from `63d4719`.

The delivery-check build of record is `9c34fac` (#1074, merged 24 November 2026;
run 45336688889, both variants, same image digest). `v1-devnet-9c34fac.json` is
its devnet build, deployed in slot 525720300 on 24 November 2026 (the devnet
upgrade; read back and checked with `check-escrow-deployment.mjs`, every line ok). Its mainnet
record was withdrawn unused on 24 November 2026 when the pooled Budget was
added to V1; nothing was deployed to mainnet from `9c34fac`.

The pooled-Budget build of record is `64543ff` (#1111 and the review fixes in
#1116, merged 24 November 2026; run 45379413394, both variants, same image
digest; the binary-of-record job passed). `v1-devnet-64543ff.json` is its devnet
build, not deployed yet (`deployedSlot` null; devnet still runs `9c34fac`).
`v1-mainnet-64543ff.json` is the mainnet build of record: it lists the devnet
deployer as forbidden, and is refused by the check until the Squads multisig
account and the mainnet deployer are added at deploy; the check must pass
against it after the upgrade authority moves to the vault. Sizes, `sha256` and
executable hashes were read from the run's job logs; the countersign step in
docs/MAINNET-LAUNCH-RUNBOOK.md §1 re-reads them from the artifacts. If a later
program change lands before the deploy, these records are replaced by a new
pair. Budgets stay off on mainnet until the relay spender-key custody and payer
alert review is done (#1119).

The 9c34fac and 64543ff records carry `minimumPackages`: `@redditech/x402-solana` 0.1.3 and
`@redditech/provider-kit` 0.3.1, the first versions that refuse a
delivery-checked escrow (flag bit `0x04`). A seller on an older version would
serve one and not be paid, so those versions are published, and named in the
launch notes, before this build is deployed anywhere with real value.

The devnet sandbox and the try page read the devnet records too
(`lib/sandbox/deployment.ts`): the latest record with a `deployedSlot` is the
build they settle against, and they take a paid call only while the program's
ProgramData says it was last deployed in that slot. The build's exit encoding
is looked up by `executableHash` there, so a new devnet record needs a line in
that file as well. Filling in `deployedSlot` after a devnet upgrade is what
moves the sandbox to the new build; until then paid calls are paused.

`.github/workflows/escrow-deployment-watch.yml` runs the check weekly against the
mainnet record named in its `MAINNET_RECORD`, once that record has a
`deployedSlot`, and alerts the owner through a `deployment-watch` issue. Point it
at the new record in the pull request that records an upgrade.
