# RAP Assurance public claim boundary

This repository's public and contributor-facing claims should use this boundary unless a later audited release note supersedes it.

## Central message

> Payments prove transfer; RAP Assurance proves paid work.

RAP Assurance (Reddi Agent Protocol Assurance) is an open, integration-first receipt and conformance layer for paid MCP/API and agent work. It binds work terms, buyer policy, payment-proof references, evidence references, attestation outcomes, replay metadata, and reputation inputs so builders can verify what happened around a paid workflow.

## What the current repository can claim

- Local/offline SDK and package primitives for receipt envelopes, policy decisions, payment-reference handling, evidence binding, replay fixtures, and conformance checks.
- x402/Solana helpers that parse, gate, and verify explicit proof material; the AUDD/SPL path is currently proof/payment-plan/read-only observation metadata unless a separately approved live rail lands.
- A local-first MCP bridge and demos that disclose dry-run, Surfpool/local, or recorded devnet boundaries before any spend or invocation claim.
- Source-level Solana/Quasar/Anchor reference material and tests, with the recorded Quasar devnet deployment blocked by `config/quasar/deployments.json` and no mainnet readiness claim.

## What public copy must not claim yet

- Do not claim RAP Assurance is a broad agent marketplace, app store, generic agent runtime, hosted runtime, wallet/action toolkit, payment facilitator, custody product, or escrow provider.
- Production readiness, mainnet readiness, live AUDD/Solana settlement, unreviewed deployment, legal/compliance approval, or security audit completion.
- Protocol transaction take-rate or collected treasury fees. The 0.05% / 5 bps figure is planned/product-fixture economics only.
- That payment evidence proves work quality, trust, reputation, settlement finality, or dispute outcome by itself.
- That hosted Reddi/Redditech services are required for the OSS core or are live production services unless a separately approved release says so.

## Executable checks

The boundary is enforced in two halves that share one pattern list (`lib/public-claims/public-claim-boundary-terms.ts`):

| Surface | Check |
|---|---|
| Owned prose and package metadata (README/docs/`package.json`) | `npm run check:claims:public` (`.github/workflows/public-claim-boundary.yml`) |
| First-party rendered copy on 17 gated routes | `e2e/public-claim-boundary.spec.ts` (blocking Playwright funnel lane) |

The DOM half gates exactly these 17 routes: `/`, `/adl`, `/agents`, `/customize`, `/dogfood`, `/economic-demo/public-proof`, `/faq`, `/feedback`, `/judge-replication`, `/mcp-bridge-demo`, `/playbook`, `/spec`, `/start`, `/testers`, `/tour`, `/updates`, `/whitepaper`. On each it scans the rendered DOM with every `data-claim-scope="external"` subtree removed. That marker is applied per field, and only where the value really is text this repository did not author. On a specialist card that is the devnet registrant's `name`, `model`, and task types; both call sites resolve their own fallback before passing those props, so a repository-authored stand-in (`Specialist endpoint`, `Ollama`, the shortened wallet) rides inside the marked span and is not scanned. The card's unmarked copy is, including the `Resource`/`Media type` line and its defaults. On a candidate card it is driven by `importedFields` on `MarketplaceCandidateCardModel`, which the builders take from one declaration — `MARKETPLACE_CANDIDATE_IMPORTED_FIELDS` in `lib/discovery/source-facets.ts`. The hosted-RAP and ARD sources project repository fixture prose, repository constants, and the repository-owned `disclosureLabels` vocabulary, so they declare no imported field at all and none of their copy is hidden; only the Circle x402 / Pay.sh catalog snapshots transcribe third-party text, and only in the `name`, `description`, and tags they populate. Those two snapshots are not committed, so no card marks anything today. The marker is never applied to a whole card, so every render-state banner, source/trust/readiness badge, `Resource`/`Media type` label, `Attested`/`Unverified` badge, downstream-dependency line, and trust-boundary note is scanned.

Three checks hold that in place: `lib/__tests__/marketplace-candidate-provenance.test.ts` asserts the declarations against what the builders emit, with expectations written out rather than read back from the declaration itself, and includes a Circle x402 card built from an injected snapshot so the imported path is covered while the artifact is absent; and two controls in the DOM spec prove both directions — injected text inside an external subtree is not scanned while the identical text in first-party copy is, and the real `MarketplaceCandidateCard` instances on `/agents` are checked against the same declaration, marking nothing where nothing is declared imported (and marking something where it is, once a snapshot is ingested) with every line of their repository-authored copy present in the scanned text.

`/tour` renders one carousel step at a time. The gate does not scan only the first: it clicks each step control in turn, scans after every step, and then asserts the step counter reads the last step, so all of the tour captions are covered without autoplay, timers, or a network call.

`app/` has 45 page routes. The 28 that are not DOM-gated are covered by review rather than by this gate, for these reasons:

| Not gated | Routes |
|---|---|
| Copy sits behind a wallet connection or multi-step flow state | `/register`, `/planner`, `/onboarding`, `/onboarding/intake`, `/attestation`, `/consumer`, `/dashboard`, `/economic-demo`, `/economic-demo/z-picture-demo` |
| Body depends on a live network or API read, so a gate here would put RPC/route latency on a blocking lane | `/leaderboard`, `/runs`, `/audit`, `/demo`, `/circle-x402`, `/orchestrator`, `/specialist`, `/setup`, `/manager`, `/economic-demo/z-picture-proof`, `/economic-demo/z-picture-onchain-proof` |
| Primary body is a third-party, imported, or user-entered record this repository does not author | `/agents/[wallet]`, `/agents/candidates/[id]`, `/manager/discovery`, `/manager/listings`, `/onboarding/profile-editor`, `/onboarding/readiness-gate` |
| Known pattern false positive: enumerates the contract-only flags it declares false, which the shared list reads as an unqualified AUDD claim | `/economic-demo/paid-workflow` |
| Redirect only; renders no copy of its own | `/features` |

`/leaderboard` was gated earlier and was removed: it is `force-dynamic` over a devnet `getProgramAccounts` call that carries no `AbortSignal`, so gating it made a live RPC a blocking-lane dependency.

`e2e/home.spec.ts` runs in the same lane but is a separate literal-copy regression spec: it asserts the central message renders in the hero and footer, and does not consume the shared pattern list.

The static gate carries a negative control: `node scripts/check-public-claim-boundaries.mjs --negative-control` injects every forbidden claim's affirmative example and must exit 1, so a gate that has stopped catching overclaims fails CI.

## Withheld stale captures

Screenshots and recordings that predate this remediation are withheld rather than deleted. `mediaStale` on an onboarding guide (`lib/onboarding/video-guides.ts`) and `imageStale` on a `/tour` step or a `/whitepaper` capture take the asset off every rendered surface. `hasPlayableRecording` is the single question the card body, the duration badge, and the walkthrough heading all ask, so a withheld guide cannot be played, counted, or linked, and the page renders a boundary notice naming the route that carries the current copy instead. `e2e/judge-replication-onboarding.spec.ts` holds that: it derives the playable and withheld tallies from the shipped guide data, asserts they account for every rendered card, and requires each withheld card's notice to say why the recording is missing and where the current copy is.

Withholding does not delete the file. `public/videos/onboarding/economic-proof.mp4`, `register-agent.mp4`, their posters, and the captures under `public/tour/` and `public/whitepaper/` stay in the repository and stay fetchable at their unchanged paths. That is inside this boundary because the surface this document gates is rendered copy and owned prose: an asset that no page renders and no link reaches asserts nothing to a reader of the product, and the recording stays available as evidence of the devnet runs the guides cite. Do not reintroduce a link, embed, or `videoSrc`/`image` reference to a withheld capture without re-recording it against current copy.

One pre-remediation recording is still playable rather than withheld: the "Watch video" modal on `/tour` streams `demo-c-protocol.mp4` from a GitHub release asset this repository does not host. It is qualified instead of removed, the third mode this repository already uses for the historical documents `npm run check:claims:public` requires a disclaimer on. The modal renders the boundary notice above the player and the recording no longer autoplays or preloads, so a visitor reads what the recording predates before any of it runs. The route scan snapshots `/tour` with the modal closed, so a dedicated check in `e2e/public-claim-boundary.spec.ts` opens it: it requires the notice to be visible and to say what the recording predates, requires the player to report `autoplay` false and `preload` `none` and to still be paused at position zero, and scans the modal's own copy for forbidden claims. Any further recording surfaced from the product carries the same obligation: withhold it, or disclose what it predates at the point of playback.

The two pre-remediation volunteer walkthroughs formerly surfaced on `/testers` are withheld: their players and direct public-serving files were removed. The written Ollama and OpenOnion setup guides remain available without presenting unreviewed recordings as current product evidence. What holds that is behavioral, not a search of the page source: the route scan in `e2e/public-claim-boundary.spec.ts` fails any gated route that renders a `<video>` which is not one of the shipped onboarding guides playing under the caption track that guide declares. Both halves read the same declaration — `npm run check:claims:public` derives the caption files it scans from the `captionsSrc` values in `lib/onboarding/video-guides.ts`, and the route scan accepts only a player matching a `videoSrc`/`captionsSrc` pair from that list — so a recording returning to `/testers` under any identifier, public path, or added caption file turns the lane red, and a track pointing at a file the static gate does not open cannot satisfy it.

Deletion is required, not optional, when the asset's own text is scanned prose. The caption track each shipped guide declares is read by `npm run check:claims:public`; `overview.vtt` carried retired wording, so that recording, its poster, its caption track, and the obsolete recorder that could regenerate them were removed outright, and the guide now carries no `videoSrc` at all. `npm run check:claims:public` fails if any of those four paths reappears. Every caption track that remains — `hire-agent-x402.vtt`, `economic-proof.vtt`, and `register-agent.vtt` — is declared by a guide, so it passes that gate and stays in the scanned set, including the two whose recordings are withheld. Adding a guide adds its caption track to the scan; a guide that declares none renders no player the route scan will accept.

## Evidence artifacts that are not committed

`artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md` does not exist in this repository and was deliberately not created during the RAP Assurance claim remediation. `latest` is a generated convenience symlink produced by a local prep run; only the timestamped run directories under `artifacts/economic-demo-submission-prep/` are committed.

The truthful resolution is to cite the newest committed timestamped run, not to author a stand-in file. Docs that reference the `latest` path are labelled as pointing at a generated artifact, and `scripts/check-submission-claim-boundaries.mjs` resolves the newest committed run instead of requiring the symlink. Do not fabricate the missing file to make a guard pass.

## Preferred positioning

Describe RAP Assurance as complementary to payment and agent-discovery standards/products such as x402, MPP/Stripe-style machine payments, AP2, MCP Registry, A2A, AGNTCY/OASF, Pay.sh/PayAI, and Solana/AUDD adapters. Those systems can prove or route payment and discovery; RAP Assurance records the paid-work lifecycle around them.
