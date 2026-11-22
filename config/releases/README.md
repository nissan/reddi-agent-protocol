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

The check reads the program and its ProgramData account and passes only if:
the cluster is right; the program is executable and owned by the upgradeable
loader; the first `size` bytes after the 45-byte ProgramData header have the
recorded `sha256` and every byte after them is zero; the trimmed hash equals
`executableHash`; and the upgrade authority is `upgradeAuthority` and not
forbidden. With `--deployer <address>` it also fails if a loader buffer is left
with the deployer as its authority.

```bash
node scripts/check-escrow-deployment.mjs --record config/releases/<record>.json \
  [--url <rpc>] [--deployer <address>] [--json]
```

It prints only the RPC host. Exit 0: verified. Exit 1: a check failed. Exit 2:
the record or the RPC could not be used, so nothing was decided.

`v1-devnet-b71a91e.json` is the devnet upgrade of 21 November 2026. The mainnet
record is added at the freeze, from that commit's workflow run, and the check
must pass against it after the upgrade authority moves to the vault.
