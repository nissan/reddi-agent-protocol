# V1 program (Pinocchio)

The Reddi Agent Protocol on-chain program: escrow and registry, built with
[Pinocchio](https://github.com/anza-xyz/pinocchio).

**Status.** This is the V1 program source (owner decision, 21 November 2026).
It replaces the Anchor program, which is archived in `archive/anchor-escrow/`
and kept as the behavioural reference this program is tested against. It has
not been deployed and has not had an independent security review. The program
on devnet today is still the Anchor build (`DEPLOY.md`). Nothing in this
directory deploys, creates keys or signs anything.

## What it is

One program. The default build has the 13 instructions of V1:

| Area | Instructions |
|---|---|
| SOL escrow | `lock_escrow`, `lock_metered_escrow`, `release_escrow`, `settle_escrow`, `cancel_escrow` |
| Token escrow (USDC, AUDD, PYUSD, USDG) | `lock_token_escrow`, `lock_metered_token_escrow`, `release_token_escrow`, `settle_token_escrow`, `cancel_token_escrow` |
| Registry | `register_agent`, `update_agent`, `deregister_agent` |

Who may end an escrow, for SOL and tokens alike:

| Call | Who | When | Pays |
|---|---|---|---|
| Release | Payer | Any time | The whole locked amount, less the fee |
| Release (claim) | Payee | After the claim window (about 7 days) | The whole locked amount, less the fee |
| Settle | Payee only | Any time, metered escrows only | The amount the payee names, at most the maximum, less the fee; the rest returns to the payer |
| Cancel (decline) | Payee | Any time | Everything back to the payer, no fee |
| Cancel (refund) | Payer | After the cancel window (about 3 days) | Everything back to the payer, no fee |

The payer never chooses a smaller payout: a payer who signs a settle is
refused. A lock is not a payment until one of these calls ends it.

The `extended` feature adds the eight instructions that are not part of V1,
as the Anchor program's `extended` feature does. The mainnet build does not
include them.

| Area | Instructions (`--features extended`) |
|---|---|
| Ratings | `commit_rating`, `reveal_rating`, `expire_rating` |
| Attestations | `attest_quality`, `confirm_attestation`, `dispute_attestation` |
| PER tracking | `delegate_escrow`, `release_escrow_per` |

It is not a line-by-line port. The goal is the same outcome for every
transaction, built the way a Pinocchio program is built:

- **No framework, no heap.** `no_std`, `no_allocator!`, a single `match` on the
  instruction selector. Nothing allocates, including error reporting and
  events (events are assembled in a stack buffer).
- **Zero-copy account records.** Each record is a `repr(C)`, alignment-1
  struct read and written in place (`program/src/state.rs`), instead of being
  deserialised into an owned value and serialised back.
- **Explicit checks, one place each.** Signer, writable, owner, derived-address
  and token-account checks are small shared functions
  (`program/src/checks.rs`, `program/src/token.rs`). The settlement
  instructions of the token escrow share one validated `Open` value and one
  `drain` routine, so release, claim, settle, refund and decline differ only
  in who may call them and how the vault is split.
- **One token path for both token programs.** Classic SPL Token and Token-2022
  accounts are parsed by the same reader; transfers go through
  `TransferChecked` to whichever program the escrow's mint belongs to.
- **Overflow checks on, panics impossible by construction** in the instruction
  paths: arithmetic is checked or bounded by an earlier `require`.

## The contract it keeps

The program is a drop-in for the Anchor one at the wire level, so the existing
clients, IDL, tests and scripts work against it unchanged:

- the same 8-byte instruction selectors and argument encoding;
- the same accounts in the same order;
- the same derived addresses (`escrow`, `token-escrow`, `token-vault`, `agent`,
  and in the extended build `rating` and `attestation` seeds);
- the same account layouts, including the 8-byte account discriminators, so
  `program.account.*.fetch` and `lib/program.ts` read them;
- the same events, byte for byte, on the `Program data:` log channel;
- the same error numbers: 6000+ for program errors and Anchor's framework
  numbers (2000s, 3000s) for account failures, each with a log line in the
  shape Anchor clients parse;
- the same program id declaration and fee rules (2.5% of the amount paid,
  rounded down, from the payee's share, capped at 0.1 SOL for SOL only, paid to
  the Squads vault).

## Evidence of equivalence

Two layers, both in `equivalence/` (its own workspace, so the test harness's
dependencies stay out of the program's lockfile):

1. **The Anchor program's own tests, unchanged.**
   `scripts/sync-equivalence-tests.sh` copies the tests in
   `archive/anchor-escrow/tests/`, changing only the path of the binary they
   load. `--check` fails if a copy is stale. All 69 default-build tests pass
   against the Pinocchio binary, and so do the 15 extended-build tests
   (`reputation.rs`, `attestation.rs`, `per.rs`).
2. **A side-by-side suite** (`equivalence/tests/differential.rs`). It runs the
   same transaction against the Anchor binary and the Pinocchio binary in two
   simulators with identical state, and requires the same result, the same
   error, the same error log line, the same events, the same inner instructions
   and the same bytes and lamports in every account either transaction touched.
   Default build: 333 transactions across SOL, classic SPL Token (USDC, AUDD)
   and Token-2022 (PYUSD, USDG) escrows, the registry, malformed input, wrong
   and duplicated accounts, uninitialised token accounts, mints off the
   allowlist, transfer fees, and issuer actions on Token-2022 vaults. Extended
   build: 181 more across ratings, attestations and PER tracking, including
   the lines the PER instructions log and ordinary release, settle and refund
   of a delegated escrow.

The suite was checked against deliberate faults (fee set to 251 bps; in the
extended build a wrong penalty, a rating folded into the wrong party, and a
changed log line): each made it fail, and it passed again when the fault was
removed.

Not run: `scripts/devnet-escrow-e2e.cjs`. It needs a deployed program, and
nothing was deployed. It would need only its `PROGRAM`, `PROGRAM_DATA`,
`PROGRAM_LEN` and `PROGRAM_SHA256` constants pointed at a deployment of this
build; the account offsets and error names it checks are the same.

## Size, rent and compute

Local builds, Agave 4.2.2 toolchain, mainnet variant (no features). Build paths
are embedded in the Anchor binary, so its size moves by a few dozen bytes with
the checkout path:

| | Anchor | Pinocchio | Change |
|---|---|---|---|
| Program size | 337,656 bytes | 58,480 bytes | 83% smaller |
| Rent at 6,960 lamports per byte | 2.3524 SOL | 0.4094 SOL | 1.9431 SOL less |
| Rent at 5,080 lamports per byte | 1.7170 SOL | 0.2988 SOL | 1.4182 SOL less |
| Extended build size (not for mainnet) | 488,352 bytes | 88,624 bytes | 82% smaller |

Rent is for the program account (36 bytes) plus the program data account (45
bytes of header plus the binary), each with the 128-byte account overhead:
`(size + 337) × rate`. 6,960 lamports per byte is the long-standing rate.
Devnet's RPC reported 5,080 when this was measured; mainnet's RPC could not be
reached from the build environment, so check the current mainnet rate
(`solana rent <bytes>`) before relying on a figure. Rent is a deposit that
comes back if the program is closed. A deploy also needs the same amount
again, briefly, for the upload buffer. A program data account can be given
room to grow, which costs rent for the extra room.

Compute units for successful calls, from the side-by-side suite:

| Call | Anchor | Pinocchio |
|---|---|---|
| SOL lock | 9,743 | 5,098 |
| SOL release | 5,890 | 1,322 |
| USDC or AUDD lock | 25,331 | 14,946 |
| USDC or AUDD release | 25,551 | 13,682 |
| USDC or AUDD settle at actual cost | 27,446 | 14,876 |
| PYUSD lock | 32,510 | 22,187 |
| PYUSD settle at actual cost | 36,753 | 24,264 |
| Register agent | 15,527 | 10,774 |
| Update agent | 4,368 | 407 |
| Deregister agent | 3,864 | 298 |
| Commit rating (first) | 8,538 | 3,846 |
| Reveal rating (second, finalises) | 18,330 | 6,813 |
| Attest quality | 9,504 | 5,413 |
| Confirm attestation | 7,448 | 4,184 |
| Delegate escrow | 7,771 | 8,025 |
| Release via PER | 6,815 | 5,336 |

Most of what remains in the token rows is the token program's own work. The
last six rows are the extended build. Delegating costs slightly more here:
almost all of it is printing two addresses in the log line.

## Known differences

- No `Program log: Instruction: <Name>` line. Explorers that label
  instructions from that line show the selector instead.
- Error log lines say `AnchorError occurred.` and never
  `AnchorError thrown in <file>` or `caused by account: <name>`. The error
  name, number and message are the same.
- When one transaction breaks several rules at once, the first rule reported
  follows Anchor's order for every combination the tests cover. It is not
  guaranteed for every possible combination. The transaction is refused either
  way.
- Anchor's check that the program runs at its declared id
  (`DeclaredProgramIdMismatch`) has no counterpart. Derived addresses use the
  id the runtime passes in.
- The Anchor token types also reject malformed optional fields inside a token
  account. The token programs never write such an account, so this is not
  reproduced.
- Compute use is lower, so a transaction sized to fail on Anchor's compute use
  would behave differently.
- A rating record whose stored size or rent was wrong would get Anchor's space
  or rent-exemption error; here it gets none. The program only ever creates
  that record at the right size with full rent.

Behaviour kept on purpose because the Anchor program has it, and worth a
decision before the extended build is ever deployed:

- `release_escrow_per` pays the payee the whole locked amount. It takes no
  protocol fee and emits no settlement event, unlike `release_escrow`.
- `expire_rating` can be called by anyone, not only the two parties.
- A rating created while the cluster clock reads Unix time zero records its
  parties again on the next commitment. A real cluster never reports time
  zero.

## Build and test

Needs Rust 1.98.0 and the Agave 4.2.2 tools (`docs/SOLANA-TOOLCHAIN-BASELINE.md`).
From the repository root:

```bash
# Anchor reference binary, used by the side-by-side suite
cargo build-sbf --manifest-path archive/anchor-escrow/Cargo.toml

cd programs/pinocchio-escrow
cargo build-sbf --manifest-path program/Cargo.toml --sbf-out-dir target/deploy
cargo test -p pinocchio-escrow                 # unit tests
scripts/sync-equivalence-tests.sh --check      # copied tests are current
(cd equivalence && cargo test -- --nocapture)  # Anchor tests + side by side, prints compute
```

The extended build is tested the same way with `--features extended` on every
command, including the Anchor reference build. Each build overwrites the
binary of the other variant, so rebuild both programs when switching.

`cargo build-sbf` writes a throwaway keypair file next to each binary. It is
not used; delete it and never commit it (`target/` is ignored).

`--features devnet` also accepts devnet USDC, as the Anchor `devnet` feature
does. Never use it for a mainnet build.

CI runs all of the above (`.github/workflows/pinocchio-escrow-tests.yml`) on
changes to this directory or to the Anchor reference. The container
(verifiable) build is `.github/workflows/escrow-verifiable-build.yml`: it
builds this program with `solana-verify` and records the size and hash of the
mainnet and devnet variants. When an Anchor test changes, run
`scripts/sync-equivalence-tests.sh` to bring the copies up to date.

## Changing behaviour

The Anchor tests are the specification. To change what the program does,
change the Anchor test (and the Anchor reference, so the side-by-side suite
still has something to compare with), regenerate the copies, then change this
program until both layers pass. The IDL built from the Anchor crate stays the
client interface while the wire contract is the same.

## Before it is deployed

These are owner decisions and release steps, not something this directory does:

1. An independent security review of this program. The Anchor program's
   reviews do not carry over; the checks Anchor generates are written by hand
   here.
2. A devnet deploy, approved by the owner, and a run of
   `scripts/devnet-escrow-e2e.cjs` against it.
3. A container (verifiable) build for mainnet, as for the Anchor program.
4. On mainnet, a first deploy under a program id that has never been deployed
   there. The rent saving exists only if this build is what gets deployed
   first. Upgrading an
   already deployed Anchor program in place keeps its larger program data
   account and its rent, and a closed program's id cannot be deployed to
   again, so switching after an Anchor mainnet deploy means a new program id
   and moving clients to it.

The program id is the same on devnet and mainnet by design:
`DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu`. It is deployed on devnet and
has never been deployed on mainnet, so `declare_id!` needs no change for the
mainnet build and the mainnet deploy under it is still a first deploy.
