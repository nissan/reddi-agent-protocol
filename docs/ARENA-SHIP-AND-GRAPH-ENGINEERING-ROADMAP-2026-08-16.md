# 2026-08-16 — Arena ship + graph-engineering adoption roadmap

_Attachment-review planning note. Inputs: the `reddi-arena` codebase snapshot
(zip), its `HANDOFF-PROMPT.md`, the `graph-engineering-project-template` (zip),
`GRAPH-ENGINEERING-OPERATING-MODEL.md`, and `MIGRATION-FROM-REDDI-ARENA.md`.
This note plans; it does not authorize execution of any human-gated item._

_Placement note: this is a cross-repo programme note. Its natural home is the
lab's `research/` convention, but the planning session had read-only access to
`reddiagent-lab`, so it lands here alongside
`docs/AUDIT-READINESS-AND-SIGNUP-ASSESSMENT-2026-08-16.md`. Paths prefixed
`lab:` refer to `nissan/reddiagent-lab`; paths prefixed `arena:` refer to the
`reddi-arena` snapshot._

## Verification run today (2026-08-16)

The uploaded `reddi-arena` tree was verified locally before planning on top of
it:

| Gate | Result |
|---|---|
| `python3 tests/test_arena.py` | **55 passed, 0 failed** |
| `python3 tools/validate_adl.py` | both reference documents PASS, 0 errors |
| `python3 tools/plan_lint.py` | PASS — plan invariants L1–L7 hold |
| template `tools/graph_lint.py` | GRAPH LINT PASS — 3 nodes |

The `nissan/reddi-arena` GitHub repo exists and is **empty**; the snapshot is
the intended initial content per its handoff prompt.

## Where the three repos stand

- **reddiagent-lab** (spec home): 2026-08-31 public launch target,
  substance-first posture. Recent merged lanes: Buzz adapter contract /
  exporter / envelope / threat model (#424–#427). Standing constraints:
  backlog **automation pause** (no new crons/loops, no
  `*_packet`/`*_gate`/`*_handoff`/`*_signoff` scripts without explicit
  re-authorization); mainnet blocked until official audit.
- **reddi-agent-protocol** (this repo — implementation/proof): audit-prep
  hygiene merged (PR #638/#639 — secret purge, config-drift fixes, CI gates;
  597 jest tests green). Quasar four-program devnet set is the demo target.
  Open lanes: job-binding Criticals decision, signup-funnel durable store +
  wallet auth. Human-owed: Jupiter key rotation at developers.jup.ag.
- **reddi-arena** (proof use case / capstone): complete and green locally,
  not yet pushed. Its own `arena:docs/REVISED-RECOMMENDATION.md` already
  scopes what is pre-launch (one tutorial + spec findings) and parks the rest
  (P2–P4) behind the launch. F1/F2 remain struck.

## Roadmap

### Phase 0 — Ship the Arena preview (target: within ~3 days)

Per `arena:HANDOFF-PROMPT.md`, in order:

1. Push the verified tree to `nissan/reddi-arena` `main` (**human gate**: the
   planning session is not authorized to push `main`; needs the operator or a
   session with that grant — write access to `nissan/reddi-arena` was also
   unavailable to this session).
2. Run `arena:github/create-issues.sh` once (36 issues, dependency-ordered,
   with `lane:/phase:/epic:/status:` labels); record issue numbers in
   `arena:spdd/INDEX.md`.
3. Deploy to Railway from the checked-in `Dockerfile`; `railway.json` supplies
   the `/api/health` healthcheck.
4. **Decision needed — persistence:** without a volume, leaderboard + waitlist
   reset on redeploy. Recommendation: attach a Railway volume at `/data` with
   `DATA_DIR=/data` (a leaderboard that resets undermines the reputation
   story the Arena exists to demonstrate). Record the choice in the deploy
   commit message.
5. Verify: `/api/health` ok, `/` landing, `/play` arena, reference `POST
   /api/fight` returns a winner; record the preview URL in `arena:README.md`
   and close the kickoff loop in `arena:spdd/prompt/0001-project-kickoff.md`.

### Phase 1 — Protect the 2026-08-31 launch (now → launch)

The Arena is explicitly **not** on the launch critical path
(`arena:docs/REVISED-RECOMMENDATION.md`). The only Arena work before launch is
its three "ships":

- File **F-007** (price vs `maxAmount` cap — Stable / spec correction against
  `lab:specs/PAYMENT-REPUTATION-EXTENSION-v0.1.md`) and **F-002** (currency
  enum excludes non-monetary units — Experimental) through
  `lab:docs/OPEN-SPEC-REVIEW-INTAKE.md`. (~half a day)
- Attach the **F-001 charge-intent ablation evidence** (passing Level 3 doc
  that still passes with `authority`/`scope`/`purpose`/`requireReceipt`/
  `receiptRef` individually deleted) to the existing v0.3 candidate item, as a
  regression fixture the v0.3 checker can be built against.
- Land `arena:tutorials/vault-duel.md` as **lesson 11** of the lab's learning
  path (Level 1 only, no purse). (2–3 days)

Everything else pre-launch stays on the existing lanes: lab maintainer items
(repo flip / publish v0.2.0-beta release / tranche form, if still outstanding),
this repo's job-binding Criticals decision and signup-funnel durable store, and
the human-owed Jupiter key rotation.

### Phase 2 — Graph-engineering adoption (post-launch, September)

Adopt the template via a **pilot in reddi-arena first** — it is the smallest
repo and already graph-driven (`plan/backlog.yaml` + `plan_lint` +
`generate_prompts`), so the migration is the ten deltas in the template's
`MIGRATION-FROM-REDDI-ARENA.md`, not a rewrite:

1. Reframe: a GitHub issue is an executable **graph node**; the loop runs
   inside the node.
2. Migrate `arena:plan/backlog.yaml` → `planning/graph.yaml` (template
   schema), keeping generated projections and test-backed doneness.
3. Split edge types: `dependsOn` stays the scheduling DAG; add non-blocking
   `informs`/`validates`/`produces`/`conflictsWith`/`supersedes`.
4. Use native GitHub parent/sub-issue + blocked-by relations; text IDs remain
   readable redundancy.
5. Add claim/isolation semantics (READY → CLAIMED = one branch + worktree,
   `node/<ID>-<slug>`), PR-as-evidence-boundary (issue closure never
   establishes doneness), and the rebase + re-verify gate before merge.
6. Add integration-surface collision checks before parallelising
   dependency-independent nodes.
7. Keep volatile GitHub state (PR numbers, worktrees, CI) out of the
   canonical graph.
8. Promote consequential ambiguity into **decision nodes with human gates**
   (topology, not buried questions).
9. Wire the four template prompts (bootstrap / node-executor / supervisor /
   retrospective) into the repo; `tools/graph_lint.py` joins the test gates.
10. Run 3–5 nodes through the full cycle, hold a meta-retrospective, and only
    then promote the template to **reddiagent-lab** and
    **reddi-agent-protocol** (template-candidate rule: promote on repeated
    evidence, not one run).

**Boundary:** adoption is process, not automation. The supervisor/executor
prompts are run inside interactive sessions; no new crons, loops, or
packet/gate/handoff/signoff scripts without explicit re-authorization — the
2026-07-26 automation pause still stands.

### Phase 3 — Post-launch programme (September → Q4)

- **Un-park Arena P2–P4 through the graph:** C-lane (mercenary market:
  discovery, buyer-authority hire engine, dry-run escrow, receipts, judge
  attestation) becomes READY only behind a decision node tied to ADL v0.3
  price-field intake (F-007); D-lane (garage, replay, coach) and E3I/E4I
  (injection containment, abuse handling) follow. F1/F2 remain struck — any
  on-chain projection lane is a **new** decision node requiring explicit
  operator approval, not a resurrection.
- **ADL v0.3 spec cycle** in the lab, seeded by the Arena findings
  (F-001 regression fixtures, F-007 price field, F-002 units).
- **This repo:** priority-matrix items continue (job-binding Criticals,
  signup funnel durable store + wallet auth); mainnet remains blocked until
  official audit.
- **Q4 re-validation:** Alpenglow activation (~Oct 2026) re-validation pass
  per the lab roadmap's 2026-07-26 alignment update.

## Decisions needed from the maintainer

1. **Arena `main` push + issue-graph creation** (Phase 0 steps 1–2) — grant a
   session write access on `nissan/reddi-arena`, or run the two commands
   directly.
2. **Railway persistence** — volume at `/data` (recommended) or ephemeral.
3. **Graph-template pilot approval** — confirm reddi-arena as the pilot repo
   and that adoption stays within the automation-pause boundary.
4. **Standing gates unchanged** — F1/F2 struck, mainnet blocked, AU weight
   formula frozen mid-season (changes go through a v0.2 formula spec).

## Risks

- **Launch-window creep:** the Arena ship and the graph pilot both invite
  scope creep into the 15 remaining pre-launch days. Mitigation: only Phase 0
  + the three Phase 1 ships happen before 2026-08-31; Phase 2 starts after.
- **Ephemeral preview state:** shipping without the volume makes early
  leaderboard players lose standings on every redeploy — bad first impression
  for a reputation-centric demo.
- **Process fork:** running SPDD in the lab while the Arena pilots the graph
  template creates two vocabularies for one methodology. Mitigation: the
  pilot's meta-retrospective explicitly decides promote/adjust/abandon before
  any second repo migrates.
