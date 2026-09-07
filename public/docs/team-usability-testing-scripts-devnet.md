<!-- markdownlint-disable MD013 -->

# Team Usability Testing Scripts — Reddi Agent Protocol on Solana Devnet

Use these scripts for moderated team testing of the full Reddi Agent Protocol role loop:

1. Human sets up a **Specialist agent**.
2. Human sets up an **Attestor / judge agent**.
3. Human sets up a **Consumer / orchestrator agent**.
4. Team runs real scenarios that should trigger x402 payment, registry, attestation, escrow release/refund, reputation, and evidence surfaces.

These scripts are written for non-adversarial internal testing. They are not a security audit. Use devnet SOL only.

## Current devnet target

- Network: Solana devnet
- RPC: `https://api.devnet.solana.com`
- Program: `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD`
- Explorer: `https://explorer.solana.com/address/794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD?cluster=devnet`

## Roles and testers

Assign at least three people. One person can play multiple roles, but separate wallets make observations clearer.

| Role | Tester owns | Main surfaces |
| --- | --- | --- |
| Specialist operator | Devnet wallet, local endpoint, ngrok URL | `/testers`, `/register`, `/onboarding`, `/specialist`, `/agents` |
| Attestor operator | Devnet wallet, judging endpoint or shared endpoint | `/testers`, `/register`, `/attestation`, `/manager` |
| Consumer operator | Devnet wallet, planner policy | `/planner`, `/consumer`, `/runs`, `/manager` |
| Moderator | Run sheet, timer, screenshots, handback collection | `/manager`, Explorer, this document |

## Shared preflight for all testers

Moderator reads this aloud before role testing starts.

1. Confirm every wallet is set to **Solana devnet**.
2. Confirm each wallet has at least `0.2 SOL` devnet.
3. Confirm app URL is the same for the whole group.
4. Open `/manager` and record current readiness state.
5. Open `/testers` and confirm the four role cards are visible.
6. Open the Solana Explorer program URL above and confirm it loads on devnet.
7. Create a shared notes doc with one section per tester.

Record:

```text
Session date/time:
App URL:
Program ID:
Specialist tester + wallet:
Attestor tester + wallet:
Consumer tester + wallet:
Moderator:
Baseline /manager status:
```

## Script 0 — Judge proof path smoke test

Goal: a reviewer can verify the public proof trail without accidentally triggering mutable devnet actions.

Tester action:

1. Open `/`.
2. Confirm the homepage shows exactly three walkthrough cards: the Claude Code x402 specialist recording plays, and the economic-demo and registration cards each render a withheld-recording notice instead of a player.
3. Click nav **Start**.
4. Confirm `/start` leads with the one walkthrough that still plays and shows the other three guides as cards, each carrying a withheld-recording notice that says why the capture is missing and where the current copy is.
5. Confirm the one playable recording exposes a captions track in the browser controls or DOM.
6. Click **Open verification guide** or **Open replication guide**.
7. Confirm the app opens `/judge-replication` and not a temporary external preview URL.
8. On `/judge-replication`, copy and run:

```bash
node scripts/judge-replication-check.mjs
```

Expected:

- `/judge-replication` explains all three proof paths.
- The verifier checks public routes, seven recorded devnet transactions, and the Loop 51 agent PDA.
- The route uses stable in-product links; no `here.now` preview URL is needed for judge verification.

Record:

```text
Homepage walkthrough card count (playable / withheld):
/start walkthrough card count (playable / withheld):
Captions present on the playable recording? yes/no
/judge-replication opened? yes/no
Verifier command result:
Friction notes:
```

## Script 0B — Disconnected registration readability

Goal: a specialist builder can understand the registration flow before connecting a wallet.

Tester action:

1. Open `/register` in a browser profile with no wallet connected.
2. Confirm the registration explainer is readable and that the registration walkthrough card renders its withheld-recording notice rather than a player.
3. Confirm wallet connection is presented as Step 1, not as a blocking modal.
4. Do not submit any transaction unless this session is explicitly testing fresh devnet registration.

Expected:

- The page does not hide educational/proof content behind wallet connection.
- The user can read the on-chain registration proof links and the withheld-recording notice before connecting.

Record:

```text
Explainer visible before connect? yes/no
Withheld-recording notice visible before connect? yes/no
Wallet connect blocks page? yes/no
Friction notes:
```

## Script 0C — Safe economic demo verification

Goal: a judge can verify recorded economic proof while fresh devnet mutation stays opt-in.

Tester action:

1. Open `/economic-demo` and `/judge-replication` on mobile and desktop widths.
2. Confirm there is no horizontal scroll on mobile for either route.
3. Confirm the default visible actions are:
   - **Verify recorded proof**
   - **Open replication guide**
   - **Choose your role**
4. Confirm **Run live paid devnet demo** is not visible by default.
5. Expand **Advanced: run fresh devnet actions**.
6. Confirm the warning explains that fresh runs may call hosted endpoints or submit devnet transactions.
7. Collapse the section again unless this session is explicitly testing fresh mutation.

Expected:

- Recorded proof is the primary judge path.
- Mutable/devnet actions are hidden behind the advanced warning disclosure.
- Mobile layout stays within the viewport.

Record:

```text
Mobile horizontal scroll on /economic-demo? yes/no
Mobile horizontal scroll on /judge-replication? yes/no
Safe actions visible by default? yes/no
Live paid action hidden by default? yes/no
Advanced warning clear? yes/no
Friction notes:
```

## Script 1 — Specialist setup and registration

Goal: a human can expose a paid specialist endpoint, prove it fails closed with `402 + x402-request`, register on-chain, and see callable readiness.

### 1A. Prepare specialist endpoint

Tester action:

1. Open `/testers`.
2. Choose either **Ollama specialist** or **OpenOnion specialist**.
3. Follow the written guide for your path.
4. Start the endpoint locally.
5. Expose only the x402 wrapper/gateway over HTTPS with ngrok.
6. Copy the HTTPS endpoint URL.

Moderator observes:

- Tester understood not to expose raw Ollama directly.
- Tester can find the wrapper guide without help.
- Tester can identify their endpoint URL.

### 1B. Endpoint fail-closed probe

Tester action:

```bash
ENDPOINT="https://your-subdomain.ngrok-free.app"

curl -i "$ENDPOINT/healthz"
curl -i "$ENDPOINT/api/tags"
curl -i -X POST "$ENDPOINT/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d '{"model":"tester-specialist","messages":[{"role":"user","content":"ping"}],"max_tokens":16}'
```

Expected:

- `/healthz` returns `200`.
- `/api/tags` or `/v1/models` returns a model list.
- unpaid `/v1/chat/completions` returns `402`.
- response includes `x402-request` header.

Failure notes:

- If the final call returns `200`, mark **critical fail: unpaid bypass**.
- If it returns `402` without `x402-request`, mark **critical fail: malformed challenge**.
- If the endpoint is unreachable, capture tunnel URL + terminal logs.

### 1C. Register specialist

Tester action:

1. Open `/register` or `/onboarding`.
2. Connect wallet on devnet.
3. Enter:
   - Agent name: `Usability Specialist <name>`
   - Endpoint URL: ngrok/wrapper URL
   - Model: `tester-specialist` or actual model
   - Role/type: `Primary`
   - Rate: `0.001 SOL`
   - Privacy tier: `local`
4. Run endpoint probe/healthcheck.
5. Submit registration.
6. Approve wallet transaction.

Expected app response:

- Probe blocks insecure unpaid completions.
- Registration transaction succeeds.
- App gives enough feedback to know whether registration is pending, successful, or failed.

On-chain validation:

1. Copy transaction signature.
2. Open signature in Explorer with `cluster=devnet`.
3. Confirm transaction status is success.
4. Confirm program ID is `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD`.

Post-registration validation:

1. Open `/agents` and find the specialist.
2. Open `/specialist` and verify callable readiness.
3. Open `/manager` and verify Specialist readiness changed or remains explainable.

Record:

```text
Specialist wallet:
Endpoint URL:
Model:
Registration signature:
Explorer URL:
/app route used: /register or /onboarding
Did probe catch x402 correctly? yes/no
Did /agents show specialist? yes/no
Did /specialist show callable readiness? yes/no
Friction notes:
```

## Script 2 — Attestor / judge setup and registration

Goal: a human can register an attestor that can be resolved for verification and appears in readiness/evidence surfaces.

### 2A. Prepare attestor endpoint

Tester action:

1. Reuse the same x402 wrapper pattern as Specialist, or run a separate judging endpoint.
2. Expose endpoint over HTTPS.
3. Confirm unpaid `/v1/chat/completions` returns `402 + x402-request`.

Suggested attestor behavior for test calls:

```text
Input: specialist answer + expected rubric
Output: JSON or text verdict with pass/fail, score, and reason
```

Moderator observes:

- Tester understands attestor is a verifier, not the primary worker.
- Tester can explain what quality signal the attestor will judge.

### 2B. Register attestor

Tester action:

1. Open `/register`.
2. Connect attestor wallet on devnet.
3. Enter:
   - Agent name: `Usability Attestor <name>`
   - Endpoint URL: attestor wrapper URL
   - Model: `tester-attestor` or actual model
   - Role/type: `Attestation` or `Both`
   - Attestation rate: `0.0005 SOL`
   - Privacy tier: `local`
4. Run endpoint probe.
5. Submit registration and approve wallet transaction.

Expected:

- Attestor registration succeeds on devnet.
- `/attestation` shows attestor path/readiness.
- `/manager` reflects attestation readiness or gives actionable missing-state text.

On-chain validation:

- Copy registration signature.
- Confirm successful transaction in Explorer.
- Confirm program ID matches current devnet program.

### 2C. Resolve attestor

Tester or moderator action:

```bash
APP_BASE="https://your-app-url"

curl -sS -X POST "$APP_BASE/api/planner/tools/resolve-attestor" \
  -H 'content-type: application/json' \
  -d '{
    "taskTypeHint": "haiku_quality",
    "minAttestationAccuracy": 0.7,
    "maxPerCallUsd": 0.05
  }'
```

Expected:

- API returns an eligible attestor or clear diagnostics explaining why none is eligible.
- If the newly registered attestor is not selected, diagnostics should be understandable.

Record:

```text
Attestor wallet:
Endpoint URL:
Registration signature:
Explorer URL:
Resolved by /api/planner/tools/resolve-attestor? yes/no
Visible on /attestation? yes/no
Visible/explainable on /manager? yes/no
Friction notes:
```

## Script 3 — Consumer / orchestrator setup

Goal: a human can register a consumer profile, configure planner policy, run paid specialist calls, and inspect receipts/history.

### 3A. Register consumer profile

Tester action:

1. Open `/planner`.
2. Connect consumer wallet on devnet.
3. Configure policy:
   - Max spend: small devnet value
   - Preferred specialist: choose the test specialist if available
   - Require attestation: yes for attested scenarios, no for baseline scenario
   - Privacy mode: local/public according to test
4. Register/update consumer profile through UI if available, or use API:

```bash
APP_BASE="https://your-app-url"

curl -sS -X POST "$APP_BASE/api/planner/tools/register-consumer" \
  -H 'content-type: application/json' \
  -d '{
    "walletAddress": "<your-devnet-consumer-wallet>",
    "preferredIntegration": "tools",
    "metadata": {
      "agentName": "Usability Consumer Agent",
      "framework": "manual-test"
    }
  }'
```

Expected:

- Consumer profile is accepted.
- `/consumer` and/or `/runs` can explain current consumer state.

Record:

```text
Consumer wallet:
Consumer registration method: UI/API
Profile result or signature:
Planner policy:
Friction notes:
```

## Scenario A — Happy path: consumer pays specialist and releases

Goal: validate x402 challenge → payment → retry → specialist response → release/receipt path.

Prerequisites:

- Specialist registered and callable.
- Consumer wallet funded.
- Attestation optional for this baseline.

Steps:

1. Consumer opens `/planner`.
2. Selects the usability specialist or asks planner to resolve one.
3. Prompt:

```text
Reply with exactly: pong
Then write a 3-line haiku about agents trading with trust.
```

1. Submit paid call.
2. Approve any wallet payment/escrow transaction.
3. Wait for specialist answer.
4. Release payment if manual release is required.
5. Open `/runs` and inspect run history.
6. Open `/manager` evidence/readiness.

Expected:

- First unpaid completion probe/challenge is `402 + x402-request`.
- Payment retry succeeds.
- Specialist returns response.
- Receipt includes nonce/payment/specialist wallet details.
- Release status is visible as released/successful.
- Any on-chain transaction signatures open successfully in Explorer.

Record:

```text
Scenario A result: pass/fail
Consumer wallet:
Specialist wallet:
Payment/escrow signature:
Release signature if any:
Planner run ID:
Receipt fields visible? yes/no
/run history visible? yes/no
On-chain program called? yes/no
Friction notes:
```

## Scenario B — Attested release: specialist answer is judged before release

Goal: validate consumer can resolve/use attestor before final release/refund decision.

Prerequisites:

- Specialist registered.
- Attestor registered and resolvable.
- Consumer policy has attestation requirement enabled.

Steps:

1. Consumer opens `/planner`.
2. Enables attestation requirement.
3. Selects or resolves the test specialist.
4. Resolves attestor through UI or API.
5. Prompt:

```text
Write a valid 5-7-5 haiku about Solana escrow.
```

1. Submit paid call.
2. Approve payment/escrow transaction.
3. Confirm specialist response arrives.
4. Trigger attestation/judgement.
5. If attestor verdict passes, release.
6. Open `/attestation`, `/runs`, and `/manager`.

Expected:

- Attestor can be selected/resolved.
- Attestor verdict is visible or explainable.
- Release only happens after pass verdict if policy requires it.
- `/attestation` and `/manager` show evidence/readiness, not raw secrets.

Record:

```text
Scenario B result: pass/fail
Specialist wallet:
Attestor wallet:
Consumer wallet:
Payment/escrow signature:
Attestation result/signature:
Release signature:
Was release gated by attestation? yes/no
Friction notes:
```

## Scenario C — Refund path: specialist or attestor fails quality gate

Goal: validate failed output does not silently release funds and refund/dispute state is explainable.

Prerequisites:

- Specialist endpoint can be forced to return a bad answer, or moderator uses a known failing specialist.
- Attestor/policy is configured to reject bad output.

Steps:

1. Consumer opens `/planner`.
2. Enables attestation requirement.
3. Selects failing specialist or sets prompt likely to fail agreed rubric.
4. Prompt:

```text
Return only the word banana.
```

1. Submit paid call.
2. Approve payment/escrow transaction.
3. Trigger attestation/judgement.
4. Attempt release only if UI allows.
5. Trigger refund/dispute path if available.
6. Open `/runs` and inspect status.

Expected:

- Attestor rejects or policy marks result as failed.
- Funds are not shown as cleanly released on failed quality gate.
- Refund/dispute state is visible and understandable.
- `/runs` preserves enough receipt/audit context for team debugging.

Record:

```text
Scenario C result: pass/fail
Failure type: specialist_bad_output / attestor_reject / endpoint_error / other
Payment/escrow signature:
Refund/dispute signature if any:
Did UI block release? yes/no
Did /runs explain state? yes/no
Friction notes:
```

## Scenario D — Security guardrail: insecure endpoint is blocked

Goal: validate endpoint registration and healthcheck fail closed when a specialist exposes unpaid completions.

Prerequisites:

- A test endpoint that returns `200` from `/v1/chat/completions` without `x402-payment`.

Steps:

1. Specialist tester opens `/register` or `/onboarding`.
2. Enters insecure endpoint URL.
3. Runs probe/healthcheck.
4. Attempts to continue/register.

Expected:

- App blocks progression before on-chain registration.
- Error explicitly says unpaid completion bypass or x402 challenge missing.
- No registration transaction is submitted.

Record:

```text
Scenario D result: pass/fail
Endpoint URL:
Probe response status:
Was registration blocked before wallet tx? yes/no
Error copy understandable? yes/no
Friction notes:
```

## Scenario E — Manager evidence pack review

Goal: validate a team lead/judge can inspect readiness and evidence without seeing private prompts, secrets, or logs.

Steps:

1. Moderator opens `/manager`.
2. Refreshes readiness.
3. Reviews role cards for Specialist, Attestor, Consumer, Agent Manager.
4. Reviews BDD confidence/evidence pack.
5. Clicks `/testers` route evidence link if present.
6. Confirms artifact links point to summaries, not raw private logs.

Expected:

- `/manager` makes next action clear.
- Evidence pack includes BDD sweep, onboarding, attestor, consumer payment, settlement, and volunteer testing surface.
- Privacy note explicitly excludes raw prompts/secrets/private runtime logs.
- `/testers` route link is clickable.

Record:

```text
Scenario E result: pass/fail
Manager status:
Missing evidence if any:
Can click /testers evidence link? yes/no
Any private prompt/secret exposed? yes/no
Friction notes:
```

## Final team handback template

Each tester sends this to the moderator.

```text
Tester name:
Role tested: Specialist / Attestor / Consumer / Moderator
Wallet public key:
Endpoint URL if any:
App URL:
Scenario(s) tested: A / B / C / D / E
Transaction signatures:
Explorer URLs:
Planner run IDs:
What worked:
What failed:
Most confusing step:
Screenshots/logs attached:
Would you know what to do next without help? yes/no
```

## Pass/fail rubric

| Area | Pass | Fail |
| --- | --- | --- |
| Role setup | Tester completes role without moderator taking over | Tester blocked by unclear copy or missing path |
| x402 guardrail | unpaid completions return/block on `402 + x402-request` | unpaid `200` accepted or confusing probe result |
| On-chain write | signatures visible and Explorer success | no signature, wrong program, or unexplained failure |
| Planner paid call | challenge/payment/retry/receipt visible | payment state ambiguous or response not tied to receipt |
| Attestation | verifier can be resolved and verdict affects release/refund | attestor invisible or verdict has no observable effect |
| Evidence | `/manager` summarizes proof without secrets | raw prompt/secret/private logs exposed or evidence missing |
| Recovery | failure states tell tester what to fix | tester cannot tell whether issue is wallet, endpoint, or program |

## Moderator closeout checklist

- [ ] All three roles attempted.
- [ ] At least one specialist registration transaction captured.
- [ ] At least one attestor registration or resolver result captured.
- [ ] At least one consumer paid-call run captured.
- [ ] Scenario A happy path attempted.
- [ ] Scenario B attested release attempted.
- [ ] Scenario C refund/fail path attempted or explicitly blocked by missing fixture.
- [ ] Scenario D insecure endpoint block attempted.
- [ ] Scenario E manager evidence review completed.
- [ ] All handback templates collected.
- [ ] Top 3 usability issues ranked by severity.
- [ ] Any on-chain/program failure includes signature + Explorer URL.
