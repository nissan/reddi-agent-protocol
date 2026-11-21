# Security audit kit

A reusable kit for launching independent security reviews of the Reddi Agent
Protocol before a mainnet or production release, and for turning their reports
into one Go/No-go decision.

It is tool-agnostic. The same prompts work in Claude Code, Codex, or any agent
that can read a repository and write a Markdown file. Nothing in this folder
is a finding, an audit result or a readiness claim: it is the preparation for
reviews that have not run yet.

## What is in here

| Path | What it is |
|---|---|
| [`CHECKLIST.md`](CHECKLIST.md) | The security checklist, one section per surface. Auditors tick it; the aggregator reads it. |
| [`AUDITOR-PROFILES.md`](AUDITOR-PROFILES.md) | The skillset and persona to look for (human or agent) for each surface. |
| [`context/`](context/) | The shared context pack every auditor reads first: architecture, threat model, scope and rules, prior reviews. |
| [`prompts/`](prompts/) | One prompt per surface, a common preamble, and the aggregator prompt. |
| [`templates/REPORT-TEMPLATE.md`](templates/REPORT-TEMPLATE.md) | The report every auditor returns, with severities and a machine-readable findings block. |
| [`templates/GO-NO-GO-RUBRIC.md`](templates/GO-NO-GO-RUBRIC.md) | How reports aggregate into GO, GO WITH CONDITIONS, or NO-GO. |
| [`templates/DECISION-RECORD.md`](templates/DECISION-RECORD.md) | The one-page record the owner signs. |
| [`assemble-prompt.sh`](assemble-prompt.sh) | Builds a self-contained prompt for one surface, pinned to a commit. |

## Surfaces

| ID | Surface | Prompt |
|---|---|---|
| S1 | On-chain program (`programs/pinocchio-escrow`, V1 default build) | `prompts/S1-onchain-program.md` |
| S2 | Developer app, sandbox and API routes (root Next.js app) | `prompts/S2-app-sandbox-api.md` |
| S3 | Marketing site (`apps/marketing`) | `prompts/S3-marketing-site.md` |
| S4 | Provider kit, SDK packages and npm supply chain (`packages/*`) | `prompts/S4-provider-kit-sdk-supply-chain.md` |
| S5 | Supabase database, row-level security and wallet sign-in | `prompts/S5-supabase-auth.md` |
| S6 | Infrastructure, keys, custody and CI/CD (Vercel, Squads, 1Password, GitHub Actions, deploy and upgrade authority) | `prompts/S6-infra-keys-custody-cicd.md` |
| S7 | End-to-end payment and economic flows (cross-surface) | `prompts/S7-payment-economic-flows.md` |
| AGG | Aggregator: reads all reports and drafts the Go/No-go | `prompts/AGG-go-no-go-aggregator.md` |

## How to run a review round

1. **Pin the commit.** Pick the release candidate commit on `main` (for the
   program, the freeze commit). Every auditor works from that commit, and every
   report names it. A report on another commit does not count toward the
   decision.
2. **Make a private reports folder.** The repository is public, so reports never
   go in it. Use a private location the owner controls, for example the
   project's shared files under `rap-v1/security/audits/<YYYY-MM-DD>-<commit7>/`.
   Findings are disclosed privately per [`SECURITY.md`](../../../SECURITY.md); only
   counts go on public issues.
3. **Assemble a prompt per surface.**

   ```bash
   docs/security/audit-kit/assemble-prompt.sh S1 <commit> > /tmp/S1-prompt.md
   ```

   The script concatenates the common preamble, the context pack and the
   surface prompt, and fills in the commit. It reads only files in this folder.
4. **Launch one independent session per surface**, ideally two for S1 and S7
   with different tools or models (see the coverage rule in the rubric).

   - Claude Code: start a fresh session in a clean checkout at the commit, and
     paste the assembled prompt, or run `claude -p "$(cat /tmp/S1-prompt.md)"`.
   - Codex: open the repository at the commit and paste the prompt, or run
     `codex exec "$(cat /tmp/S1-prompt.md)"`. Codex also reads `AGENTS.md`.
   - Any other tool: give it read access to a checkout at the commit and the
     assembled prompt. It needs no network, no keys and no wallet.

   Give each auditor a read-only checkout. No auditor session needs, or may be
   given, a private key, a wallet, a funded account, a database password, a
   Vercel token or a 1Password session.
5. **Collect the reports** in the private folder, one file per auditor, named
   `<surface>-<tool>-<commit7>.md` (for example `S1-codex-a1b2c3d.md`).
6. **Fix and re-review.** Each fix is a pull request. A fix to a Critical or
   High is re-checked by an auditor who did not write it, at the new commit.
7. **Aggregate.** Run the aggregator prompt over the folder of reports. It
   drafts the decision with the rubric; it does not make it.
8. **Decide.** The owner fills in [`templates/DECISION-RECORD.md`](templates/DECISION-RECORD.md)
   and keeps it with the reports.

## Rules every auditor follows

These are repeated in the common preamble so each session sees them.

- Read only. Do not deploy, sign, send transactions, spend, call paid or
  production endpoints, change settings, or open pull requests unless the owner
  asks for that in the session.
- Never print, copy or ask for a secret value. If a secret is found in the
  repository or its history, report its location and type only.
- Do not post finding detail on GitHub, in public issues, or anywhere public.
- Say what you did not verify. A gap is not a pass.
- Fail closed. If a check could not run, say so; do not reason around it.

## Keeping the kit current

When a surface changes shape (a new package, a new API route family, a new
on-chain instruction, a new key or authority), update `context/ARCHITECTURE.md`,
the surface's checklist section and its prompt in the same pull request. When a
review round finishes, add one line per report to `context/PRIOR-REVIEWS.md`
(date, surface, tool, commit, verdict, counts, private location), never the
finding detail.
