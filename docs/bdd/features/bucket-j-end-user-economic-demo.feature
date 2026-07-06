Feature: End-user economic workflow demo

  Background:
    Given the Reddi Agent Protocol marketplace is running on Solana devnet
    And live downstream specialist calls are disabled unless explicit spend gates are enabled
    And demo artifacts must not expose private keys, signer material, provider API keys, or payment secrets
    And autonomous specialists and attestors may act as consumer agents only when their manifest discloses downstream marketplace delegation


  Scenario: User funds a run budget before the orchestrator calls downstream agents
    Given the user opens /economic-demo and connects a wallet
    And the selected activity has a quoted downstream agent budget
    And the quote includes downstream specialist fees, attestor fees, Jupiter swap allowance when needed, and orchestrator markup
    When the user approves the upfront demo payment
    Then the payment is recorded as the user-to-orchestrator funding edge
    And the orchestrator budget ledger shows gross revenue, reserved downstream budget, retained markup, and remaining refundable balance
    And downstream specialists are paid only from the funded run budget
    And the final output includes the user payment receipt, downstream payment receipts, and budget reconciliation

  Scenario: User can pay the upfront demo fee in USDC
    Given the activity quote is denominated in USDC
    And the connected user wallet has sufficient USDC on the selected network
    When the user chooses USDC payment
    Then the demo records a USDC payment receipt from user wallet to orchestrator wallet or escrow
    And no Jupiter swap is required
    And the orchestrator can spend the received budget on downstream agent calls
    And the communication-flow visualization links the user payment to every downstream paid edge it funds

  Scenario: User can pay the upfront demo fee in SOL through Jupiter swap proof
    Given the activity quote is denominated in USDC
    And the connected user wallet chooses SOL payment
    When the demo requests a Jupiter quote and executes the approved swap path
    Then the evidence records the Jupiter quote, route, input SOL amount, output USDC amount, slippage guard, and swap signature or fail-closed reason
    And the resulting USDC budget or equivalent settlement record funds the orchestrator run budget
    And the page distinguishes swap cost, downstream agent fees, and orchestrator markup
    And if the quote expires, slippage exceeds the cap, or output is insufficient, no downstream agent call is executed

  Scenario: SOL payment path shows conversion before downstream agent payments
    Given the user does not initially hold the USDC budget required by downstream agents
    And the user chooses to fund the run with SOL
    When the economic demo visualises the Jupiter conversion lane
    Then it shows SOL entering Jupiter and USDC funding the orchestrator run budget
    And it shows a swap receipt transaction address or explicit fail-closed swap status
    And downstream specialist and attestor payments are shown only after the converted USDC budget exists
    And the run report distinguishes local Surfpool swap proof, live quote proof, and future live swap receipt proof

  Scenario: Live Jupiter quote proof is not described as an executed swap
    Given the economic demo fetches a public Jupiter SOL to USDC quote
    When the quote proof artifact records input SOL, output USDC, slippage, and route legs
    Then the artifact states that no swap transaction was requested
    And it states that no wallet signing, transfer, or mutation occurred
    And judge materials may claim route availability only
    And judge materials must not claim an executed Jupiter swap without a swap signature receipt

  Scenario: Devnet USDC receipt verification is separate from payment execution
    Given the live payment gate has explicit confirmation, network, asset, cap, payer, and recipient inputs
    And a devnet transaction signature is supplied for verification
    When the devnet USDC receipt verifier checks the transaction on Solana RPC
    Then it accepts only a USDC SPL-token transfer to the declared recipient within the approved cap
    And it rejects missing signatures, mainnet routes, wrong assets, missing recipients, and over-cap transfers
    And it does not sign, submit, swap, transfer, or mutate a wallet

  Scenario: Pay.sh devnet paid-run approval record fails closed before execution
    Given a Pay.sh/devnet paid-run approval record is supplied for review under #502, #476, #471, #338, and #334
    When the approval validator compares the approval, request, receipt, and verifier artifacts
    Then it requires environment, asset, payer, recipient/payee, endpoint, cap, retry policy, exact command, evidence path, rollback owner, and expiry
    And it rejects missing or expired approval records
    And it rejects payer, payee, endpoint, network, asset, cap, receipt, and verifier mismatches
    And it rejects auto-pay or default-live ambiguity
    And passing validation does not authorize execution without Nissan approval
    And no payment execution, Pay.sh setup, wallet setup, wallet top-up, RPC call, provider call, hosted write, catalog submission, trust mutation, reputation mutation, mainnet activation, production activation, or default auto-pay occurs
    And the behavior is covered by "scripts/test-pay-sh-devnet-approval-validator.mjs"

  Scenario: Upfront evidence pack preserves proof hierarchy boundaries
    Given local Surfpool evidence, live Jupiter quote proof, and devnet USDC receipt verification artifacts may exist
    When the upfront payment evidence pack is generated
    Then it aggregates the latest public-safe proof statuses
    And it fails closed if local upfront funding, budget reconciliation, or attached Jupiter quote coverage is invalid
    And it labels quote-only proof separately from executed swap receipts
    And it labels blocked devnet receipt verification separately from verified devnet USDC receipts

  Scenario: Consumer-agent proof shows funded orchestration and downstream purchasing
    Given the orchestrator has received the upfront run budget
    When it hires downstream marketplace agents to fulfill the request
    Then the page shows the communication path user to orchestrator to specialists to attestor to user result
    And the page shows the payment path user to orchestrator, orchestrator to specialists, orchestrator to attestors, and retained markup
    And every downstream call includes x402 challenge or receipt evidence and a downstream-disclosure ledger entry
    And the final budget reconciliation proves the orchestrator acted as both paid provider and consumer agent

  Scenario: Run report shows attestation, payment receipts, and reputation commit-reveal
    Given the orchestrator has purchased specialist work from the funded run budget
    And attestors validate the specialist outputs, receipt chain, disclosure ledger, and release criteria
    When the economic demo run report is shown
    Then it tells the story of every specialist call, validation, payment, and returned result
    And it lists payment receipt transaction addresses or explicit fail-closed receipt status for each paid edge
    And it shows which attestor validated which specialist output and the attestation receipt
    And it shows reputation scores before commit, the committed score, and after reveal
    And reputation changes are not represented as final until the reveal receipt is present or explicitly marked fixture-only

  Scenario: Playwright recording proves the visible economic demo flow
    Given deterministic economic demo fixture mode is enabled for Playwright
    When the Playwright test records the wallet connect, quote, payment choice, communication graph, payment graph, evidence ledger, and final result panels
    Then the test saves screenshot, video, and trace artifacts under artifacts/playwright-economic-demo
    And it asserts the upfront quote, user payment edge, downstream payment edges, Jupiter swap panel, wallet deltas, disclosure ledger, and final output are visible
    And the deterministic recording performs no real signing, swap, transfer, paid provider call, hosted specialist call, or wallet mutation

  Scenario: Static fixture explains the economic workflow without spending
    Given the user opens /economic-demo
    When they select the webpage, research article, or picture scenario
    Then the page shows the end-user request
    And it shows the orchestrator, downstream specialists, and attestors
    And it shows payload summaries flowing between participants
    And it shows planned x402 amounts and receipt placeholders
    And it shows starting balances, ending balances, and wallet deltas
    And it performs zero wallet mutations

  Scenario: Image generation stays disabled until explicitly enabled
    Given ENABLE_ECONOMIC_DEMO_IMAGE_GENERATION is not true
    When a caller posts to /api/economic-demo/image
    Then the response is 403
    And the error is image_generation_disabled
    And no OpenAI or Fal.ai generation request is made

  Scenario: Picture workflow uses OpenAI first and Fal.ai fallback when enabled
    Given ENABLE_ECONOMIC_DEMO_IMAGE_GENERATION is true
    And OpenAI image generation or Fal.ai is configured
    When the picture scenario requests an image
    Then the request goes through the economic demo image adapter
    And the provider and model are recorded
    And the generated image is available to the workflow
    And vision validation and verification attestation can be attached afterward

  Scenario: Picture workflow dry-run produces a storyboard without hidden image spend
    Given picture workflow planning is in storyboard dry-run mode
    And ENABLE_ECONOMIC_DEMO_IMAGE_GENERATION is not true
    When the picture storyboard graph is proposed
    Then it includes visual brief, blocked image adapter, storyboard validation, and release attestation edges
    And the blocked image adapter edge has downstream-disclosure ledger expectation reddi.downstream-disclosure-ledger.v1
    And the storyboard frames include positive prompts, negative prompts, and evidence caveats
    And imageGenerationExecuted is 0
    And no OpenAI request, Fal.ai request, paid provider request, signing operation, wallet mutation, or devnet transfer occurs

  Scenario: Dry-run orchestration builds a real planned economic graph
    Given dry-run marketplace delegation is enabled
    When the user submits an end-user scenario
    Then the orchestrator returns selected specialist candidates
    And every edge includes endpoint, wallet, price, capability, and required attestors
    And downstreamCallsExecuted is 0
    And the ledger is marked planned rather than paid

  Scenario: Surfpool dress rehearsal proves local SOL transfer semantics
    Given a Surfpool local validator is running with deterministic funded test wallets
    And end-user, orchestrator, specialist, and attestor wallets are available locally
    When the economic demo workflow runs against the local validator
    Then SOL transfers occur for approved specialist consumption edges
    And the before and after balances match the expected edge ledger
    And transaction signatures or local validator receipts are recorded
    And a non-allowlisted or over-budget edge produces zero balance delta
    And no devnet or mainnet wallet is mutated

  Scenario: One live specialist edge is bounded and reviewable
    Given live demo mode is explicitly approved for one devnet edge
    And the endpoint allowlist contains exactly one specialist endpoint
    And max downstream calls is 1
    And the lamport cap is set for the one edge
    When the orchestrator executes the approved edge
    Then it captures an x402 receipt or fail-closed reason
    And it captures before and after balances for payer and payee
    And it does not retry automatically

  Scenario: Public marketplace pages show agent manifest tools, skills, and dependencies
    Given a marketplace specialist or attestor may call other agents or external MCP services while fulfilling its role
    When a user opens /agents or /agents/:wallet
    Then the public marketplace shows manifest tools and skills for the agent
    And the detail page lists marketplace agents it may call
    And the detail page lists external MCP servers it may use
    And the detail page lists non-marketplace agents or services it may leverage
    And the disclosure is visible before the user invokes the agent

  Scenario: Agent manifests disclose downstream marketplace delegation
    Given a marketplace specialist or attestor may call other agents while fulfilling its role
    When a consumer agent reads /.well-known/reddi-agent.json
    Then the manifest declares that downstream marketplace calls may occur
    And it lists expected downstream capability categories, tools, skills, external MCP servers, non-marketplace agent calls, budget policy, attestor expectations, and payload-disclosure policy
    And the consumer agent can reject the agent before purchase if the disclosure is unacceptable

  Scenario: Downstream calls return transparent disclosure without exposing proprietary value-add
    Given an autonomous specialist calls another marketplace agent during execution
    When it returns its result to the consumer agent
    Then the response includes a downstream-disclosure ledger
    And the ledger identifies each called agent, endpoint or wallet, payload summary or hash, x402 amount and receipt or challenge state, and attestor links
    And any obfuscated returned details include an explicit moat_protection reason
    And called-agent identity, payload class, payment evidence, and attestation chain are not hidden

  Scenario: Multi-edge demo returns output, disclosure ledger, and economic impact
    Given multi-edge demo mode is explicitly approved
    When the webpage or research article workflow completes
    Then the final output is shown to the user
    And attestor guidance is shown
    And each downstream call has a reddi.downstream-disclosure-ledger.v1 entry
    And each participating wallet has a start balance, end balance, and delta
    And a bounded evidence artifact is produced

  Scenario: Research workflow dry-run declares evidence and disclosure before live calls
    Given research workflow planning is in dry-run mode
    And public hosted specialist manifests expose dependency disclosure parity
    When the research article workflow graph is proposed
    Then it lists retrieval, research synthesis, content drafting, explainability, and verification edges
    And each planned edge declares payload class, citation or evidence caveats, attestor criteria, and refund or dispute behavior
    And each planned edge has a downstream-disclosure ledger expectation with x402 state planned
    And downstreamCallsExecuted is 0
    And no paid provider request, signing operation, wallet mutation, or devnet transfer occurs

  Scenario: Public local no-spend quickstart links proof contracts without live claims
    Given the ARD no-spend package quickstart runs from local fixtures
    When the Discover Decide Prove example emits its JSON output
    Then it includes receipt, EvidenceArchive, receipt/evidence binding, attestation draft, reputation update, AUDD dry-run preflight, source diagnostics, and rail-neutral proof-chain refs
    And it links the public proof page data contract and paid workflow proof UI fixture pack schema versions
    And it labels the output as fixture zero-spend, planned dry-run, simulated, devnet proof metadata, live-gated, and production/live disabled
    And policy denial, malformed challenge, missing evidence, missing payment setup, unsupported rail/network, and unsafe metadata states fail closed
    And no hosted service, paid provider request, signing operation, wallet mutation, RPC call, SPL transfer, Quasar custody claim, settlement-finality proof, trust or reputation mutation, marketplace publication, or live payment occurs
    And the behavior is covered by "packages/agent-protocol/tests/ard-no-spend-demo.test.ts"

  Scenario: Public proof page data contract exposes rail-neutral evidence without live claims
    Given the public proof page consumes deterministic economic demo data
    And rail-neutral proof-chain fixtures are available
    When the public proof page data contract is generated
    Then it includes quote, policy decision, AUDD payment-plan preflight, receipt, EvidenceArchive, attestation draft, reputation draft, source refs, listing refs, and state labels
    And Pay.sh sandbox single-charge proof is represented as binding-ready refs and hashes only
    And Tempo unsupported-network, unsupported asset, malformed receipt, policy-denied, and live-path overclaim states fail closed
    And no paid provider request, signing operation, wallet mutation, RPC call, hosted registry write, trust or reputation mutation, custody claim, settlement-finality proof, or live payment occurs
    And the behavior is covered by "lib/__tests__/economic-demo-public-proof-page-data.test.ts"

  Scenario: x402 reference workflow rehearsal stays no-live and emits the public proof data contract
    Given the deterministic economic demo fixtures and the public proof page data contract are available
    When the x402 reference workflow rehearsal is built for the webpage scenario
    Then it rehearses discover, quote, policy preflight, dry-run x402 payment plan, receipt, evidence, and proof contract emission in order
    And the emitted proof artifact validates against the public proof page data contract schema
    And real metering fields stay at zero while test metering is explicitly marked as test
    And the live devnet reference run stays live-gated behind explicit operator approval with a committed runbook
    And no paid provider request, signing operation, wallet mutation, RPC call, devnet transaction, custody claim, or live payment occurs
    And the behavior is covered by "lib/__tests__/economic-demo-x402-reference-workflow-rehearsal.test.ts"

  Scenario: Paid workflow proof-chain UI fixture pack covers responsive render states
    Given the public proof page data contract is available
    When the paid workflow proof-chain UI fixture pack is generated
    Then it includes quote, budget ledger, result, receipt, evidence, attestation preview, and reputation preview sections
    And it provides mobile, tablet, and desktop fixture expectations for every case
    And Pay.sh sandbox single-charge proof is represented as a no-network no-spend happy path with refs and hashes only
    And Tempo unsupported-network, unsupported asset, malformed receipt, policy-denied, and live-path overclaim states stay blocked for downstream rendering
    And no UI implementation, paid provider request, signing operation, wallet mutation, RPC call, hosted registry write, trust or reputation mutation, custody claim, settlement-finality proof, or live payment occurs
    And the behavior is covered by "lib/__tests__/economic-demo-paid-workflow-proof-ui-fixtures.test.ts"

  Scenario: Public proof page renders quote to receipt evidence without live claims
    Given the paid workflow proof-chain UI fixture pack is available
    When a reviewer opens /economic-demo/public-proof
    Then the page renders quote, budget ledger, result, receipt, EvidenceArchive, attestation preview, and reputation preview sections
    And it shows Pay.sh sandbox single-charge proof as a no-network no-spend happy path with refs and hashes only
    And it shows Tempo unsupported-network, unsupported asset, malformed receipt, policy-denied, and live-path overclaim states as blocked fail-closed cases
    And it labels fixture zero-spend, planned dry-run, simulated, devnet proof metadata, live-gated, and production/live disabled states
    And no paid provider request, signing operation, wallet mutation, RPC call, hosted registry write, trust or reputation mutation, custody claim, settlement-finality proof, or live payment occurs
    And the behavior is covered by "e2e/economic-demo-public-proof.spec.ts"

  Scenario: Buyer paid-workflow route state contract preserves copy boundaries
    Given the public proof page data contract and paid workflow proof-chain UI fixture pack are available
    When the buyer paid-workflow route state contract is reviewed
    Then it maps quote, budget ledger, execution timeline, result, receipt, EvidenceArchive, attestation preview, and reputation preview states to existing proof contracts
    And it distinguishes fixture zero-spend, planned dry-run, simulated, devnet proof metadata, live-gated, and production-live-disabled copy
    And blocked states for missing evidence, unsupported rail or network, malformed receipt, policy denial, live-path overclaim, and approval mismatch fail closed
    And no paid provider request, signing operation, wallet mutation, RPC call, hosted registry write, marketplace publication, trust or reputation mutation, custody claim, settlement-finality proof, Pay.sh production activation, default USDC auto-pay, production AUDD rail, mainnet settlement, or live payment occurs
    And downstream UI PRs must include mobile, tablet, and desktop screenshots plus video or Playwright trace for changed flows
    And the behavior is documented by "docs/PAID-WORKFLOW-ROUTE-STATE-CONTRACT.md"

  Scenario: Superteam Australia can verify the devnet demo without production payment activation
    Given the Superteam Australia devnet verification runbook is available
    When a reviewer follows the default verification path
    Then it includes public routes, public proof UI, ARD no-spend package output, and recorded Solana devnet transaction checks
    And it separates deterministic no-spend proof, sandbox or local proof, devnet verification, and optional fresh bounded devnet spend
    And any fresh devnet payment remains behind explicit confirmation, cap, endpoint allowlist, signer, recipient/payee match, gate artifact, and receipt verification gates
    And no mainnet payment, production Pay.sh activation, uncontrolled wallet or RPC call, custody claim, settlement-finality proof, hosted registry write, trust or reputation mutation, or default USDC auto-pay occurs
    And the behavior is covered by "scripts/check-superteam-devnet-demo-readiness.mjs"

  Scenario: Submission readiness follows retrospective-driven BDD loops
    Given the economic demo is being prepared for judge or submission review
    And live research, paid image generation, signing, wallet mutation, devnet transfer, and Coolify mutation are not approved
    When the submission readiness plan advances a phase
    Then the phase declares BDD expectation, scope, acceptance criteria, validation, evidence artifact, and retrospective prompt
    And the retrospective must record what worked, what failed or surprised us, safety and spend review, judge clarity, and plan adjustment
    And the next phase cannot expand scope until the retrospective updates the plan
    And local ignored evidence paths may be referenced but raw private artifact contents are not published

  Scenario: Submission prep artifact index is locally checkable without live calls
    Given a local economic demo submission prep pack exists under artifacts/economic-demo-submission-prep/latest
    When the submission prep checker validates the pack
    Then it confirms the demo entrypoint, green evidence chain, local evidence paths, recording outline, and hard no-go list are present
    And every referenced local evidence artifact path exists
    And no hosted specialist call, provider request, signing operation, wallet mutation, devnet transfer, or Coolify mutation occurs

  Scenario: Operator checklist gives a public-safe recording path
    Given the economic demo operator checklist is committed
    When Nissan prepares to record or submit the economic demo
    Then the checklist names the demo route, local prep checker, five-beat narration, public PR or CI proof chain, and hard not-claimed section
    And it distinguishes controlled demo evidence, local Surfpool proof, storyboard-only image planning, and approval-gated future work
    And it references local ignored evidence paths only as operator pointers rather than publishing raw artifact contents
    And following the checklist does not call hosted specialists, request providers, sign, mutate wallets, transfer devnet funds, or mutate Coolify configuration

  Scenario: Final judge packet is public-safe and evidence-exact
    Given the economic demo final judge packet is committed
    When a reviewer reads the packet
    Then it states what is proven, what is local or simulated, and what is explicitly not claimed
    And it cites the public PR and CI proof chain by identifier
    And it separates approval-gated future proof categories from current evidence
    And it does not publish raw ignored artifacts, secrets, provider outputs, private logs, or unsupported production settlement claims

  Scenario: Hackathon demos target Quasar deployed programs
    Given Nissan has selected Quasar as the hackathon Solana program target
    When demo or submission readiness is evaluated
    Then the demo evidence must identify the Quasar program IDs used by the demo
    And the readiness gate must reject silent fallback to legacy Anchor program IDs
    And Anchor CI alone must not be presented as final hackathon submission proof
    And any missing Quasar deployment, signing, wallet, devnet, or environment action must be surfaced as an approval-gated blocker

  Scenario: Quasar mode blocks unverified Anchor-only transaction builders
    Given the hackathon demo program target is Quasar
    When a runtime path constructs an on-chain instruction or decodes an on-chain account
    Then the path must declare whether it is Quasar-compatible, Anchor-layout-only, or blocked pending verification
    And Quasar demo readiness must fail if a demo-critical path uses an Anchor-layout-only builder without an explicit blocker
    And the retrospective for the phase must decide whether the next loop ports builders or requests approval-gated live validation

  Scenario: Quasar cutover advances through retrospective-gated phases
    Given the Quasar hackathon cutover is active
    When a phase or slice completes
    Then the playbook must record expectation, implementation scope, acceptance criteria, validation commands, and safety guardrails
    And the retrospective must record observed behavior, blocker count, surprises, safety review, and next-plan adjustment
    And the next phase must not expand into signing, wallet mutation, devnet transfer, deployment, environment mutation, paid calls, or live execution without explicit approval
    And submission readiness must remain false while any demo-critical Quasar blocker remains
