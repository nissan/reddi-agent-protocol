# Go/No-go rubric

How a set of surface reports becomes one release decision. The aggregator
applies it and drafts the outcome; the owner makes the decision and signs the
[decision record](DECISION-RECORD.md).

## Outcomes

| Outcome | Meaning |
|---|---|
| **GO** | Release as planned. |
| **GO WITH CONDITIONS** | Release as a guarded beta: caps, allowlists or feature flags stay on, named conditions are met before launch, and named follow-ups have owners and dates. |
| **NO-GO** | Do not release. Fix, re-review the fixes, and run the rubric again. |

## Step 1: Is the evidence complete?

A round counts only if all of these hold. If any fails, the outcome is
**NO-GO (incomplete evidence)** until it is fixed.

1. There is a report for every surface S1 to S7, each on the same release
   commit (for S1, the program freeze commit).
2. S1 and S7 each have two independent reports from different tools, models or
   people.
3. Each report has the YAML header, the findings table, the filled checklist
   and a "Not verified" section.
4. Every Critical and High fixed during the round was re-checked at the fix
   commit by a reviewer who did not write the fix.
5. If code changed after a report was written, the change was either reviewed
   or shown not to touch that surface (a `git diff --stat` between the two
   commits, limited to the surface's paths, is enough to show it).

## Step 2: Hard blockers

Any one of these makes the outcome **NO-GO**. No waiver.

- Any open **Critical** on any surface.
- Any open **High** on S1, S4 payment verification, S5 access rules, S6
  custody or keys, or S7. (These are the surfaces where a High means loss of
  funds, keys or user data.)
- Any checklist item marked **[gate]** that failed or was not verified.
- A secret found in the repository or its history that has not been rotated.
- Two S1 or two S7 reviewers disagree on whether a Critical or High is real,
  and the disagreement has not been settled by a test.

## Step 3: Conditions

If there are no hard blockers, these lead to **GO WITH CONDITIONS** (each one
becomes a named condition in the decision record):

- An open **High** on S2 or S3 (not funds or keys), with a compensating control
  live before launch (for example a firewall rule, a disabled route or a
  feature flag) and a fix date within 14 days.
- Any open **Medium**, each with a disposition: fix before launch, fix by a
  date, or accept with a reason. Funds-path Mediums (S1, S4 payment, S7) need
  either a fix or a cap that bounds the loss.
- More than 10% of a surface's non-gate checklist items marked Not verified.
- Any prior accepted risk (see `context/PRIOR-REVIEWS.md`) whose control could
  not be confirmed to exist.

Typical guarded-beta conditions for this protocol:

- Per-escrow caps stay at the V1 values until a later round raises them.
- Each currency has its stop switch tested, and the Token-2022 mint watch is
  running with an alert owner.
- The bug bounty is planned before caps rise.

## Step 4: GO

**GO** needs: complete evidence, no hard blockers, no open High anywhere, every
Medium fixed or accepted with a reason, all gates passed, and the Not verified
items limited to things that do not touch funds, keys or user data.

## Scoring summary (for the aggregator's table)

For each surface, the aggregator fills one row:

| Surface | Reports | Commit OK | C | H | M | L | I | Gates failed | Not verified | Surface outcome |
|---|---|---|---|---|---|---|---|---|---|---|

Surface outcome is the worst outcome any of its open findings or gaps leads to
under steps 1 to 4. The release outcome is the worst surface outcome.

## Duplicates and disagreements

- Two reports describing the same root cause are one finding at the higher
  severity; list both IDs.
- If reviewers disagree on severity, take the higher unless a test or the code
  shows the lower is right; record the disagreement.
- If one reviewer marks a finding and another explicitly checked the same path
  and found it sound, the finding stands until a test settles it.

## After the decision

- Add one row per report to `context/PRIOR-REVIEWS.md` (counts only).
- Post counts, never detail, on the release issue.
- File each condition and follow-up as a private issue or a task with an owner
  and a date.
- Re-run the rubric for any later release that changes S1, S4 payment code, S5
  migrations or S6 custody.
