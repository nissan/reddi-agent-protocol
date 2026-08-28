# Mainnet & Live Production Readiness Assessment

_Date:_ 2026-08-28 · _Source tree:_ `11311a4` (merge of PR #645) · _Status:_ **NOT READY — 4 blocking gates open**

This assessment answers one question: what stands between the current devnet
build and taking real money on mainnet-beta. Every finding below was verified
against the source tree or a live read-only RPC call at the date above; the
method is stated with each. Nothing here was carried over from an earlier
document without re-checking, because several earlier documents are themselves
part of the finding set.

**Verdict: do not deploy to mainnet.** Four gates are blocking and none can be
closed by a deploy step. Beyond them sit three structural gaps where the
programs do not yet implement the product the protocol describes — these are
build work, not paperwork, and two of them are larger than anything in the
audit backlog.

---

## 1. Blocking gates

### G-1. CRITICAL-4 is open, and CRITICAL-3 was widened five days ago

`docs/QUASAR-C4-DURABLE-JOB-RECORD-DESIGN-2026-08-26.md` records CRITICAL-4 as
**open** after three separate closure arguments were each shown to be wrong.
Two levers survive, both pinned as green tripwires in
`experiments/quasar-reputation/src/tests.rs` that assert the grief *succeeds*:

- **The reveal deadlock.** `BothCommitted` is absorbing — finalisation needs both
  reveals, `expire` refuses anything not `Pending`, and neither party may
  re-commit. One transaction committing 32 bytes with no pre-image kills a
  rating permanently, with the victim paying the rent.
- **The cancelled-escrow penalty.** `expire` penalises non-participation in a
  rating that was opened unilaterally, on a job the payer themselves killed.

Stalling guarantees a 0 reputation change while `expire` costs a fixed −500, so
a rational party stalls on any review below roughly 3/10. On devnet that is a
reputation bug. On mainnet, reputation is what buyers price agents by — it is
the mechanism the marketplace runs on.

PR #645 also **widened CRITICAL-3**. `quasar-attestation::attest` requires a
live escrow and `init`s one attestation per escrow permanently, with no close
instruction in that program. Escrows used to die at settlement, bounding the
squat window to the locked period; they are now immortal, so every escrow that
has ever existed is a permanent squat target. Judge nomination was a follow-on
before that merge and is a prerequisite after it.

_Method: read the tripwires and the design record at `11311a4`._

### G-2. No external audit has been performed, and the handoff packet describes a different system

`config/networks/mainnet.json` states in its own annotation that mainnet is
gated on external audit. That audit has not happened. Worse, the packet
prepared for it is no longer accurate:

- It is **frozen at commit `3561dc5`**, which predates the entire job-binding
  series (#642–#645). The escrow, reputation and attestation programs an auditor
  would read do not match the ones on `main`.
- It names **`experiments/quasar-escrow-per` as the active escrow target** with
  `experiments/quasar-escrow` as legacy reference. The merged job-binding code
  asserts the exact opposite: `EscrowRef::owners()` pins `quasar-escrow`
  (`VYCbMszux…`), and escrow-per (`7ra8FZ…`) is outside the trust boundary
  entirely — its escrows can never back a reputation or attestation record.

An auditor working from the current packet would audit the wrong program and
the wrong trust boundary. Re-freezing it is a prerequisite to engaging anyone,
not a tidy-up afterwards.

_Method: `docs/SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md` §Frozen Handoff
Inputs and §Auditor-Facing Scope, against `experiments/quasar-escrow-ref/src/lib.rs`._

### G-3. `SECURITY.md` describes defences the deployed programs do not have

`SECURITY.md` is the document a grant reviewer or auditor reads first. Its
unauthorized-release section claims:

> Anchor `has_one` / account relationship constraints tie escrow accounts to
> expected authority, payer, and recipient.

The deployed programs are the four **Quasar** programs it lists by address at
the top of the same file. Quasar has no `has_one`. The real defence is explicit
signer and PDA-seed verification, which is a different argument that happens to
also hold — but the document as written asserts a mechanism that is not in the
code. It also predates the job-binding work entirely and so describes none of
it.

_Method: `SECURITY.md` §Threat Model item 4, against
`experiments/quasar-escrow/src/instructions/release.rs`._

### G-4. No mainnet deployment exists, and the mainnet profile cannot express one

A live read-only check against mainnet-beta today:

```
rpc_health   PASS  HTTP 200, result=ok
rpc_slot     PASS  HTTP 200, slot=442295094
program      FAIL  executable=false   (794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD)
```

That program id is a **placeholder** — it is the devnet legacy Anchor id, copied
into `config/networks/mainnet.json` with a note saying it must be replaced. Two
structural problems sit behind it:

- `mainnet.json` carries only `escrowProgramId`. There are no registry,
  reputation or attestation ids, so the four-program Quasar set — the actual
  demo target since the 2026-05-06 cutover — **cannot be expressed on mainnet at
  all**.
- `getNetworkProfile()` in `lib/config/network.ts` forces
  `target = "legacy-anchor"` whenever the profile is not `devnet`. Setting
  `NETWORK_PROFILE=mainnet` therefore silently selects the legacy Anchor
  placeholder rather than the Quasar programs, no matter what else is
  configured.

So "mainnet mode" today does not point at a wrong program — it points at no
program, and it cannot be pointed at the right ones without a schema change.
That failure mode is safe but confusing; it should be an explicit refusal.

_Method: `npm run test:mainnet:readiness` (read-only curl; no wallet, no
signing). Re-run it to reproduce; `artifacts/` is gitignored, so the run
artifact `artifacts/mainnet-readiness/20260828-080009/` is local to that run._

---

## 2. Structural gaps — the programs do not yet implement the product

These are not audit findings. They are places where the protocol as described
has no on-chain implementation, and each is a build project.

### S-1. Escrow is SOL-only. There is no USDC path.

`EscrowAccount.amount` is lamports, and `lock` moves value with
`system_program.transfer`. There is no mint, no token account, no SPL transfer
anywhere in `experiments/quasar-escrow`. The struct's own comment says "POC
keeps it simple".

An agent marketplace settling in SOL exposes both sides to price movement
between lock and release — over a seven-day cancel window, that is not a
rounding error. Every piece of product material describes USDC pricing, and
`lib/economic-demo/fixture.ts` quotes in USDC throughout. **The rail the product
describes does not exist in the program.** Adding SPL support changes the
account struct, the PDA layout, every instruction signature, both TS client
mirrors, and the escrow-ref mirror — and it invalidates any audit performed
before it lands. It belongs *before* the audit, not after.

### S-2. The 0.05% protocol fee has no on-chain implementation.

The 5 bps settlement fee appears only in TypeScript demo and proof surfaces —
`lib/economic-demo/fixture.ts` (`REDDI_PROTOCOL_RAIL_FEE_BPS = 5`) and
`lib/mcp-bridge-demo/surfpool-proof.ts`. One of them states the position
plainly: *"Planned 5 bps protocol rail fee; zero fees collected (real
metering)."*

There is no fee account, no treasury PDA, and no collection step in
`release_escrow`. **The protocol has no revenue mechanism on-chain.** Going live
without one means either launching with no revenue, or retrofitting fee
collection into a settlement path after real money is already flowing through
it. Note the contrast with registry, which *does* collect: `register_agent`
burns a hardcoded `AGENT_REGISTRATION_FEE` of 0.01 SOL to the incinerator. That
is working anti-sybil, not revenue — the value is burned, and being a lamport
constant its real cost floats with the SOL price. On mainnet that wants a
deliberate decision rather than a devnet-era default.

### S-3. No upgrade-authority or key-custody plan exists.

`DEPLOY.md` covers exactly one key: a devnet faucet keypair read from 1Password.
For mainnet the unanswered questions are the ones that decide whether users can
be robbed by whoever holds a laptop:

- Who holds upgrade authority on four programs holding user funds?
- Multisig (Squads or equivalent) or a single key?
- Is any program made immutable, and at what point?
- What is the key-compromise procedure?

None of this is written down anywhere in the repo.

---

## 3. Operational gaps

| Gap | State today | Needed for production |
| --- | --- | --- |
| RPC | `api.mainnet-beta.solana.com` (public, rate-limited, no SLA) | Paid provider with a fallback; public RPC will not carry a marketplace |
| Secrets | Purged Jupiter API key **still live in git history, unrotated** | Rotation (human-owed — the key must be treated as compromised) |
| Monitoring | None for on-chain state | Alerting on failed settlements, stuck escrows, attestation squats |
| Incident response | No runbook | Documented pause/response path, and an on-chain pause if one is wanted — there is no pause instruction today |
| Disclosure | `SECURITY.md` §Responsible Disclosure has a working channel (GitHub private vulnerability reporting) | Adequate as a channel; still missing safe-harbour terms and any bounty, both of which matter once funds are real |
| Support | Waitlist is 0 entries (verified 2026-08-27) | Not a launch blocker — but it does mean beta demand is currently unproven |

---

## 4. Sequenced plan

Ordering matters more than the list. Two rules drive it: **nothing goes to an
auditor until the code is the code we intend to ship**, and **anything that
changes an account layout must land before the audit, not after.**

**Phase 1 — close the protocol design (no deploys).**
1. C-4 design round 4: enumerate the full `RatingState` matrix, give
   `BothCommitted` a deadline with a consequence, make `expire` read the escrow
   it penalises against. Independent review must pass *before* implementation —
   three of the first three arguments were wrong.
2. Judge nomination for C-3 — now a prerequisite, since #645 made the squat
   window unbounded.
3. Decide S-1 (USDC) and S-2 (fee collection). Both change account layouts.

_Exit: C-3 and C-4 tripwires inverted and green; USDC and fee decisions recorded
with an owner._

**Phase 2 — build to the decisions.**
4. Implement C-4 and judge nomination.
5. Implement SPL/USDC escrow if Phase 1 says yes: account struct, all
   instructions, both TS mirrors, `quasar-escrow-ref`, the layout guard.
6. Implement fee collection if Phase 1 says yes.
7. Steps 4–7 of the original job-binding sequence, still outstanding: TS clients
   and `lib/program.ts` mirrors, demo-agents ordering, devnet redeploy in place.

_Exit: full loop green on devnet against the redeployed programs, with the demo
running end to end._

**Phase 3 — make the record true.**
8. Rewrite `SECURITY.md` against the Quasar programs as they then exist (G-3).
9. Re-freeze the audit handoff at the new commit, with the corrected trust
   boundary — `quasar-escrow` active, `escrow-per` outside it (G-2).
10. Extend `config/networks/mainnet.json` to carry all four program ids, and
    make `getNetworkProfile()` either resolve Quasar on mainnet or refuse the
    profile outright rather than silently falling back to legacy Anchor (G-4).

_Exit: `npm run check:solana:audit-handoff` green against the new freeze; a
reader of `SECURITY.md` sees the system that exists._

**Phase 4 — external audit.**
11. Engage an auditor against the re-frozen packet. **Requires Nissan's explicit
    approval** — the handoff boundary reserves auditor selection, spend and any
    external submission to him.
12. Remediate; re-audit changed surfaces.

_Exit: audit report with no unremediated critical or high findings._

**Phase 5 — mainnet, staged.**
13. Key custody first: multisig upgrade authority, documented compromise
    procedure (S-3).
14. Paid RPC, monitoring, incident runbook, disclosure policy.
15. Deploy the four programs to mainnet; record real ids in `mainnet.json`;
    re-run `test:mainnet:readiness` to green.
16. Launch capped — a per-escrow ceiling and an allowlist — and lift the caps
    on evidence, not on schedule.

_Exit: `program_executable` PASS against a real deployment, with caps in force._

---

## 5. What this document does not claim

- It does not claim the audit backlog is otherwise clear. CRITICAL-1 is closed
  by job binding; CRITICAL-2's status should be re-verified against `main` as
  part of Phase 3 rather than inherited from the May remediation log.
- It does not price or schedule the phases. Phase 2 contains at least one
  account-layout migration and is the long pole.
- It does not select an auditor or authorise any spend, deployment, or external
  submission. All of those remain Nissan's to approve.
