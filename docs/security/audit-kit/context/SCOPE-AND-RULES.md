# Scope and rules of engagement

## In scope

Everything at the pinned commit on `main` that ships in the release:

- `programs/pinocchio-escrow/` default (V1) build and its build pipeline.
- The root Next.js app (`app/`, `components/`, `lib/`, `providers/`,
  `config/`, `next.config.ts`, `vercel.json`).
- `apps/marketing/`.
- Packages that are published or run by providers: `packages/provider-kit`,
  `packages/x402-solana`, `packages/agent-protocol`,
  `packages/openrouter-specialists`, `packages/rap-mcp-bridge`, and any other
  package whose `package.json` is not `private: true`.
- `supabase/migrations/` and every server path that reads or writes the
  database.
- `.github/workflows/`, `scripts/` that the launch runbook calls, and the
  runbooks themselves (`docs/MAINNET-LAUNCH-RUNBOOK.md`, `docs/MAINNET-RPC.md`,
  `DEPLOY.md`, `docs/ESCROW-PAYOUT-SAFETY.md`).
- Configuration that is not in the repository but that the owner can show on
  request (Vercel settings, Squads settings, GitHub settings). Ask; do not log
  in.

## Out of scope

See the last section of [`THREAT-MODEL.md`](THREAT-MODEL.md). Also out of scope:
`archive/`, `experiments/`, `pilots/`, `third_party/`, `artifacts/`, and the
historical audit documents under `docs/` (read them for context only).

## Rules

1. **Read only.** No deploys, transactions, signatures, spending, faucet use,
   writes to any database, settings changes, emails, pull requests, issues or
   comments, unless the owner asks in your session. Local tests and local
   validators (LiteSVM, Mollusk, Surfpool on loopback) are fine.
2. **No secrets.** You need none. Never ask for one, print one or copy one. If
   you find a secret in the tree or the history, report the path, line and type
   only, and mark it Critical.
3. **No public detail.** The repository is public. Write your report to the
   private folder the owner gave you, never into the repository. Counts may go
   on public issues; detail may not.
4. **Pin the commit.** Check out the commit you were given and say so at the top
   of the report. If you looked at anything newer, say what.
5. **Evidence or it did not happen.** Every finding names `file:line`, a
   concrete failure scenario, and how you know (read, test, probe). Say
   "suspected" when you did not prove it.
6. **Fail closed.** A test that would not run, a tool you could not install, a
   file you could not read: list it under "Not verified". It is not a pass.
7. **Independence.** Do not read other auditors' reports for this round before
   you finish yours. Prior rounds' public summaries in `PRIOR-REVIEWS.md` are
   fine; use them to check fixes, not to limit your search.
8. **Proof-of-concept tests** go in a scratch directory outside the
   repository, or in a branch you do not push. Attach them to the report.

## Severity scale

| Severity | Meaning | Examples |
|---|---|---|
| Critical | Direct loss or theft of funds or keys, or control of the program, treasury or a production system, by an unprivileged actor, with no unusual preconditions. | Anyone can settle someone else's escrow to themselves; service role key in the client bundle; upgrade authority left on a hot key. |
| High | Loss of funds or keys under realistic conditions, a bypass of payment or authorisation, or a permanent freeze of funds; or full compromise of user data. | Buyer can underpay a metered call; RLS lets any signed-in user read all receipts; refund can be blocked forever. |
| Medium | Limited or conditional loss, temporary freeze, integrity damage to reputation or accounting, or a control that only holds by operator discipline. | Provider must remember a flag to avoid a griefing case; rating replay across jobs; SSRF limited to public hosts. |
| Low | Defence-in-depth gaps, minor leaks, hard-to-exploit issues. | Missing security headers; verbose errors; long-lived delegation allowed but not default. |
| Info | Observations, documentation drift, hardening ideas. | Doc says one window rule, code does another but safer. |

Rate on impact and likelihood together. If unsure between two levels, pick the
higher and say why.
