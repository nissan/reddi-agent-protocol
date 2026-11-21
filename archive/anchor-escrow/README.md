# Anchor escrow (archived)

This is the Anchor `1.1.2` program the protocol was first built with: escrow,
registry and, behind the `extended` feature, rating, attestation and PER.

**Archived on 21 November 2026 (owner decision).** The V1 program is now the
Pinocchio program in `programs/pinocchio-escrow/`. New program work goes there.

It is kept, and still builds and passes its tests in CI, for three reasons:

- **Reference.** The Pinocchio program is tested against it. The tests in
  `tests/` are copied and run unchanged against the Pinocchio binary, and a
  side-by-side suite replays the same transactions on both builds.
- **Interface.** The Pinocchio program keeps this program's wire contract, so
  the IDL built from this crate is still the client interface.
- **Teaching.** It shows the same program written with a framework.

The build that is on devnet as of the archive date came from this source
(`DEPLOY.md`). Do not add features here. A change of behaviour is made in the
tests here first, mirrored in this reference, and then implemented in the
Pinocchio program.

```bash
cargo build-sbf --manifest-path archive/anchor-escrow/Cargo.toml --sbf-out-dir target/deploy
cargo test -p escrow
```
