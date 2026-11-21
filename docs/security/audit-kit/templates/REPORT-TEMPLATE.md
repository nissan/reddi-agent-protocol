# Security review report: <surface ID and name>

<!--
Fill every section. Keep this file private: it never goes in the repository.
Name it <surface>-<tool>-<commit7>.md, for example S1-codex-a1b2c3d.md.
-->

```yaml
# Machine-readable header. The aggregator parses this block. Keep the keys.
surface: S1            # S1..S7
reviewer: "Codex"      # tool or person
model: ""              # model name if an agent, else blank
commit: "<full sha>"   # the pinned commit you checked out
date: "YYYY-MM-DD"
verdict: GO            # GO | GO_WITH_CONDITIONS | NO_GO
counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
checklist: { pass: 0, fail: 0, na: 0, not_verified: 0 }
gates_failed: []       # checklist IDs marked [gate] that failed or were not verified
prior_findings_rechecked: []   # e.g. ["V1-1: closed", "F-03: reduced"]
```

## 1. Verdict

One paragraph: GO, GO WITH CONDITIONS or NO-GO for this surface at this commit,
and the one or two reasons that decide it.

## 2. Scope and method

- Commit checked out, and anything newer you looked at.
- Files and directories read in full, read in part, and not read.
- Tests and tools run (with versions) and their results.
- Proof-of-concept tests written (attach them, or give their private path).
- Time spent, roughly.

## 3. Findings

| ID | Severity | Title | Location (`file:line`) | Status |
|---|---|---|---|---|
| <S>-<tool>-01 | High | | | Confirmed / Suspected |

### <ID>: <title>

- **Severity:** Critical / High / Medium / Low / Info, with one line on impact and likelihood.
- **Location:** `path/to/file.ext:line` (and others).
- **Failure scenario:** who does what, with which inputs, and what goes wrong. Concrete.
- **Evidence:** how you know (code path, test output, probe). Mark "Suspected" if not proven.
- **Recommendation:** the smallest fix that closes it, and a test that would catch a regression.
- **Launch impact:** blocks launch / fix before raising caps / fix after launch / accept.

(Repeat per finding.)

## 4. Checklist

Copy this surface's section from `CHECKLIST.md` and mark each item Pass, Fail
(finding ID), N/A (reason) or Not verified (reason).

| Item | Result | Note |
|---|---|---|
| S1.1 | Pass | |

## 5. Prior findings re-checked

For each prior finding in your brief: closed, reduced (what is left), or still
open, with evidence.

## 6. Not verified

Everything you could not check, and why. Be specific: these become gaps in the
decision.

## 7. Questions for the owner

Configuration or facts outside the repository that would change a result
(for example, "Is deployment protection on for previews?").
