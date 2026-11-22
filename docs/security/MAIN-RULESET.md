# Ruleset for `main`

`main` has no branch protection or ruleset today, so anyone with write access,
or a token with write access, can push to it, force-push it or delete it, and a
pull request can merge with failing checks. `docs/security/main-ruleset.json` is
a ruleset that closes that. Applying it is a repository settings change, so the
owner applies it; agents do not.

## What it enforces

| Rule | Effect |
|---|---|
| `deletion` | `main` cannot be deleted. |
| `non_fast_forward` | No force-push to `main`. |
| `pull_request` | Every change reaches `main` through a pull request, merged by squash. |
| `required_status_checks` | The PR cannot merge until `Jest lib/** suites` and `Signup/onboarding funnel specs` pass. |
| `bypass_actors: []` | Nobody bypasses it, including the owner. |

Only the two checks that run on every pull request are required. The others
(program equivalence, verifiable build, packages, claims, Quasar guards) are
path-filtered: GitHub waits forever for a required check that never starts, so
requiring them would block every PR that does not touch their paths. They still
run and must still be green before a merge under the standing rule that a
failed check is a stop.

## Why no bypass and no required approval, for now

Agent sessions open, push and merge pull requests with the owner's own GitHub
login. GitHub treats them as the owner. So:

- A bypass for the owner (or for admins) is also a bypass for every agent
  session, which would leave the checks unenforced for most merges. In an
  emergency the owner can set the ruleset to `disabled` in Settings, Rules, and
  back to `active` afterwards; GitHub records both.
- A required approval, or a required code-owner review, cannot be met: GitHub
  does not let the author approve their own pull request, and every pull request
  is authored by the owner's login.

`.github/CODEOWNERS` names the owner on the paths where a change can move funds,
change what is deployed, or expose keys or user data (programs, CI, config and
release records, payments, RPC proxy, Supabase and auth, dependency manifests).
Today it documents those paths and gets the owner requested on pull requests
from anyone else. It becomes a real second key once agent sessions act under
their own GitHub identity (for example the Claude GitHub App, or a separate bot
account with write access): then set `require_code_owner_review` to `true` and
`required_approving_review_count` to `1`, so a change to those paths needs the
owner's approval.

## Applying it

In the GitHub UI: Settings, Rules, Rulesets, New branch ruleset, and match the
table above. Or with the GitHub CLI, signed in as the owner:

```bash
gh api -X POST repos/nissan/reddi-agent-protocol/rulesets --input docs/security/main-ruleset.json
```

Then check it: `gh api repos/nissan/reddi-agent-protocol/rules/branches/main`
lists the four rules. A direct `git push origin main` from any clone is then
refused.

The same settings round (S6-claude-10) should also turn on secret scanning,
push protection and Dependabot security updates in Settings, Code security.
