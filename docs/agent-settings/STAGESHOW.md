# Stageshow · illustrated product demos

[Stageshow](https://benji.org/stageshow) is an agent skill by Benji Taylor for building
faux product UI: a still or a short animated demo, as a React component, that the agent
films and checks. Use it for illustrations in a README, a pitch page or a landing page.
**A demo is an illustration, never evidence that the product works.**

This repository's own design, brand and evidence rules win over this page.

## The pin

| | |
|---|---|
| Upstream | [benjitaylor/skills](https://github.com/benjitaylor/skills), folder `stageshow` |
| Commit | `299140fafd08df55a9c234e610c3f64af3f45531` (Stageshow 1.1.1) |
| `SKILL.md` sha256 | `e4df76406d63644d5051d79855c3f7931d48fdbe9aec15b3d5c12a2601aa2de6` |
| Content sha256 | `46e4dbb843ca04ce6720f1158d0fca0f3b47a6faafbe9f5c03643bd6d464cc29` over 372 files |
| Licence | MIT for the skill's source. Its bundled app icons and brand marks stay under their owners' terms. |
| Review | Read once by the integration's own author in Reddi Workbench (`docs/stageshow/SECURITY-REVIEW.md`). Not an independent review. The 125 npm packages its tooling installs were not reviewed. |

Use only this commit. A newer one needs a new review in Reddi Workbench first.

## Install (not vendored)

The skill bundles other companies' marks, so it is never committed. `.gitignore` here
excludes `.claude/skills/stageshow/`. From a checkout of Reddi Workbench:

```sh
python3 /path/to/reddi-workbench/scripts/stageshow.py install --dest "$PWD/.claude/skills/stageshow"
python3 /path/to/reddi-workbench/scripts/stageshow.py check --installed --dest "$PWD/.claude/skills/stageshow"
```

The script clones the pinned commit, checks the hashes, copies regular files only and
runs nothing it downloads.

## Rules

1. **A demo is an illustration.** It is never acceptance proof, runtime evidence or
   usability evidence. A passing rehearsal says only that the animation is well made.
2. **Label it.** Every published demo carries a visible "Illustration, not the shipping
   product" line.
3. **No brand assets.** Do not use the skill's bundled brand marks or app icons, and do
   not start from its product studies (Figma, Slack, Gmail and the rest). A named
   third party appears as plain text with no mark and no lettered tile. This overrides
   the skill's own brand guidance.
4. **Copy only the kit a demo imports.** Never the whole `kit/` folder, never
   `kit/brands/` or `assets/app-icons.ts`. Keep the skill's `LICENSE` beside the copy.
5. **Fictional people and data only.** No real names, emails, keys, customer data or
   confidential detail.
6. **Tell the true story.** Show what the product really does or is planned to do; a
   blocked action stays blocked.
7. **Ask before running the skill's tooling.** `npm install`, the playground and the
   filming scripts install and run third-party code. Each needs the operator's explicit
   go-ahead in that session. Reading the skill and writing a component need none.
8. **Review it like code**, under this repository's usual rules.
