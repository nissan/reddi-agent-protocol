# Release decision record

<!-- Private. One per release decision. Keep it with the reports. -->

- **Release:** <name, e.g. V1 mainnet guarded beta>
- **Release commit:** <sha> **Program freeze commit:** <sha>
- **Program build of record:** sha256 <hash>, <bytes> bytes, from <workflow run link>
- **Date:**
- **Decision:** GO / GO WITH CONDITIONS / NO-GO
- **Decided by:** <owner>

## Evidence

| Surface | Reports (tool, commit) | Outcome | Open C/H/M |
|---|---|---|---|
| S1 On-chain program | | | |
| S2 App, sandbox, API | | | |
| S3 Marketing site | | | |
| S4 Provider kit, SDK, supply chain | | | |
| S5 Supabase and auth | | | |
| S6 Infra, keys, custody, CI/CD | | | |
| S7 Payment and economic flows | | | |

Aggregator draft: <private path>

## Launch gates

| Gate | Result | Evidence |
|---|---|---|
| S1.1–S1.3 build and hash | | |
| S2.6–S2.7 network and bundle | | |
| S4.1, S4.12 verifier and package contents | | |
| S5.1 RLS on every table | | |
| S6.1–S6.2 upgrade authority and treasury | | |
| S6.6 no secrets in history | | |
| S7.1 no service without payment | | |

## Conditions (GO WITH CONDITIONS only)

| # | Condition | Must be true by | Owner | Done |
|---|---|---|---|---|

## Accepted risks

| Finding ID(s) | Severity | Why accepted | Bound on loss | Review again by |
|---|---|---|---|---|

## Follow-ups after launch

| Finding ID(s) | Fix | Owner | Due |
|---|---|---|---|

## Sign-off

I have read the aggregator draft and the reports it cites, and I make the
decision above.

<owner name>, <date>
