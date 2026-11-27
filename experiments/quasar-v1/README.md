# V1 program in Quasar: a size and rent study

This is a study, not a release path. V1 ships the Pinocchio programs (owner
decision, 21 November 2026). Nothing here is deployed, audited or wired into the
app, and it does not touch `programs/escrow`.

The question was: if the current V1 program were written in Quasar, what would it
cost in rent to deploy, next to Anchor and Pinocchio?

## Result

Same toolchain for all three (Agave 4.2.2, `cargo build-sbf` 4.1.0, platform-tools v1.54).
Rent is `(program bytes + 337) x lamports per byte`: the program data account
(45-byte header) plus the 36-byte program account, each with 128 bytes of overhead.

| Build | Program size | Rent at 6,960 lamports/byte | Rent at 5,080 lamports/byte |
|---|---|---|---|
| Anchor 1.1.2 (`programs/escrow`) | 337,664 bytes | 2.3525 SOL | 1.7170 SOL |
| Quasar, this crate, `opt-level = "z"` | 92,904 bytes | 0.6490 SOL | 0.4737 SOL |
| Quasar, this crate, `opt-level = 3` (Quasar's default) | 93,944 bytes | 0.6562 SOL | 0.4789 SOL |
| Pinocchio 0.12 (`experiments/pinocchio-escrow`) | 57,968 bytes | 0.4058 SOL | 0.2962 SOL |

5,080 is what devnet RPC reported on 21 November 2026. 6,960 is the long-standing
rate. Mainnet RPC is not reachable from the build environment, so the mainnet rate
was not read.

Quasar comes out about 72% smaller than Anchor and about 60% larger than
Pinocchio. Most of the Quasar binary (about 46 KB of 93 KB) is the account
parsing and checking code its macros generate once per instruction; Quasar
optimises for compute units, not size.

## What was built

One program with the same 13 instructions as the default Anchor build: SOL
escrow, token escrow (USDC, AUDD, PYUSD, USDG) and the agent registry. Same
rules, caps, windows, allowlist, 2.5% fee and SOL fee ceiling, same PDA seeds,
and the same custom error codes (6000 upwards).

Framework: upstream Quasar at commit `b0de7db` (13 July 2026), pinned by `rev`.
The copy vendored under `third_party/quasar` is from May 2026 and its API is older.

## Evidence

`anchor-tests/` runs the Anchor program's own four V1 test files against the
Quasar binary: 65 tests, all pass at both optimisation levels. The files are
copied by `anchor-tests/sync-tests.sh`; a small stand-in crate encodes
instructions and decodes accounts in the Quasar format so the tests run as written.

`anchor-tests/adjust-tests.patch` holds the only assertion changes, 8 tests. In
every one the transaction is refused in both builds and only the framework's
name for the refusal differs:

- A wrong PDA or owner returns Quasar's `Custom(3002)` or `Custom(3005)` where Anchor returns `ConstraintSeeds` or `ConstraintHasOne`.
- A missing signature is `MissingRequiredSignature`, not `AccountNotSigner`.
- Quasar returns the same custom code but does not log the error name.
- Passing the system program in the token program slot is refused as a repeated account before the program id is checked.

```bash
cargo build-sbf --manifest-path experiments/quasar-v1/Cargo.toml
cd experiments/quasar-v1/anchor-tests && ./sync-tests.sh && cargo test
```

Delete the `*-keypair.json` that `cargo build-sbf` writes.

## Where it is not the same as the Anchor program

Outcomes match; the wire format does not. It is written the way Quasar wants
programs written, so unlike the Pinocchio rebuild it is not a drop-in replacement:

- Instruction discriminators are one byte (0 to 12), not Anchor's 8-byte hashes.
- Accounts are fixed zero-copy layouts with a one-byte discriminator: 141, 196 and 138 bytes against Anchor's 150, 203 and 150. Escrow status and agent type are stored as a byte.
- `register_agent` takes the model string last, with a one-byte length (so at most 255 bytes on the wire; over 64 is still `ModelTooLong`).
- Events have Quasar's layout: `mint` is the all-zero address for SOL (Quasar events cannot hold an option), and `outcome` is a u64.
- When several things are wrong at once, the first error reported can differ, because Quasar checks accounts in its own order.

Clients, the IDL and `lib/program.ts` would all need regenerating to use it.

## Not done

No deploy, no devnet run, no security review, no side-by-side comparison of
events or logs, no compute-unit comparison. Quasar's alternative
`sbpf-linker` toolchain was not tried; all three builds use `cargo build-sbf`.

## Trade-offs

- Maturity: Quasar is still version 0.0.0 and marked beta. Its README and security policy say it is unaudited and should not hold real funds. The last upstream commit seen was 13 July 2026.
- Pinocchio is maintained by Anza and is in production use; it is a library, so every check is written by hand.
- Anchor is the most widely used and reviewed, with the largest binary.
- Quasar keeps Anchor-style account declarations, which is less hand-written checking code to review than Pinocchio, but the checks then live in an unaudited macro.
