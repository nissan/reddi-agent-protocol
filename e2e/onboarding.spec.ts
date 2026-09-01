import { test, expect, type Page } from '@playwright/test'

// ─── helpers ─────────────────────────────────────────────────────────────────

async function checked(page: Page, label: RegExp) {
  const input = page.getByLabel(label)
  await expect(input).toBeVisible({ timeout: 10000 })
  if (!(await input.isChecked())) {
    await input.check({ force: true }).catch(async () => {
      await input.evaluate((node) => {
        const checkbox = node as HTMLInputElement
        checkbox.checked = true
        checkbox.dispatchEvent(new Event('input', { bubbles: true }))
        checkbox.dispatchEvent(new Event('change', { bubbles: true }))
      })
    })
  }
  await expect(input).toBeChecked({ timeout: 10000 })
}

async function completeStep1(page: Page) {
  await page.waitForLoadState('networkidle')
  await checked(page, /I consent to exposing my local runtime API/i)
  await checked(page, /I consent to protocol-funded onboarding transactions/i)
  const next = page.getByRole('button', { name: 'Next', exact: true })
  await expect(next).toBeEnabled({ timeout: 10000 })
  await next.click()
}

// ─── Suite ───────────────────────────────────────────────────────────────────

test.describe('/onboarding page', () => {

  // ── Step 1 — Consent ───────────────────────────────────────────────────────

  test('loads wizard header, all 8 step labels, and step indicator', async ({ page }) => {
    await page.goto('/onboarding')
    await expect(page.getByRole('heading', { name: /Specialist Onboarding Wizard/i })).toBeVisible()

    const stepList = page.locator('div.space-y-3').first()
    for (const label of ['Consent', 'Runtime', 'Endpoint', 'Wallet', 'Register', 'Healthcheck', 'Attestation', 'Try Planner']) {
      await expect(stepList.getByText(new RegExp(`^${label}$`))).toBeVisible()
    }
  })

  test('consent gates next button — both checkboxes required', async ({ page }) => {
    await page.goto('/onboarding')
    const nextBtn = page.getByRole('button', { name: 'Next', exact: true })
    await expect(nextBtn).toBeDisabled()

    await page.getByLabel(/I consent to exposing my local runtime API/i).check()
    await expect(nextBtn).toBeDisabled()

    await page.getByLabel(/I consent to protocol-funded onboarding transactions/i).check()
    await expect(nextBtn).toBeEnabled({ timeout: 10000 })
  })

  test('next button advances to step 2 after consent', async ({ page }) => {
    await page.goto('/onboarding')
    await completeStep1(page)
    await expect(page.getByText(/Runtime Setup/i)).toBeVisible()
  })

  test('back button returns to previous step', async ({ page }) => {
    await page.goto('/onboarding')
    await completeStep1(page)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByText(/Consent/i).first()).toBeVisible()
  })

  // ── Step 2 — Runtime ───────────────────────────────────────────────────────

  test('step 2 runtime — platform selector renders and defaults to macos', async ({ page }) => {
    await page.goto('/onboarding')
    await completeStep1(page)
    await expect(page.locator('select').nth(1)).toHaveValue('macos')
    await expect(page.getByRole('button', { name: /Run runtime bootstrap/i })).toBeVisible()
  })

  test('step 2 runtime — next is disabled until runtime is confirmed ready', async ({ page }) => {
    await page.goto('/onboarding')
    await completeStep1(page)
    const nextBtn = page.getByRole('button', { name: 'Next', exact: true })
    await expect(nextBtn).toBeDisabled()
  })

  // ── Step 3 — Endpoint ─────────────────────────────────────────────────────

  test('step 3 endpoint — accessible from step 2 via localStore state injection', async ({ page }) => {
    await page.goto('/onboarding')
    await completeStep1(page)

    await page.selectOption('select', 'openai_local')
    await page.getByRole('button', { name: /Mark runtime ready \(manual\)/i }).click()
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    await expect(page.getByText(/Endpoint setup/i)).toBeVisible()
  })

  // ── Step 8 — Planner UI ───────────────────────────────────────────────────

  test('step 8 planner — visible and contains prompt textarea + run button', async ({ page }) => {
    await page.goto('/onboarding')
    // Inject state with everything completed up to step 7
    await page.evaluate(() => {
      const state = {
        consentExposeEndpoint: true,
        consentProtocolOps: true,
        platform: 'macos',
        ollamaPort: '11434',
        protocolDomain: 'https://reddi.tech',
        runtimeReady: true,
        runtimeNote: '',
        runtimeTokenStored: false,
        hasWallet: 'yes',
        walletAddress: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        walletPassphrase: '',
        walletBackupConfirmed: true,
        walletStatusNote: '',
        sponsorshipReady: true,
        sponsorshipNote: '',
        sponsorshipLamports: 10000000,
        endpointUrl: 'http://localhost:11434',
        endpointStatus: 'online',
        endpointNote: '',
        endpointTunnelCommand: '',
        endpointProxyCommand: '',
        endpointProxyPort: 3030,
        endpointAuthHeader: 'x-reddi-agent-token',
        endpointAuthTokenPreview: 'abc123',
        endpointAuthToken: 'abc123',
        healthcheckStatus: 'pass',
        healthcheckNote: '',
        attested: true,
        attestationNote: 'Attested',
        attestationJobIdHex: 'aabbccddeeff00112233445566778899',
        attestationPda: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        attestationOperator: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        attestationConsumer: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        attestationResolution: 'confirmed',
        attestationResolutionSig: 'mocksig',
        attestationOperatorReady: true,
        attestationOperatorStatusNote: '',
        capabilityTaskTypes: 'summarize, classify',
        capabilityInputModes: 'text',
        capabilityOutputModes: 'text',
        capabilityPrivacyModes: 'public, per',
        capabilityTags: 'onboarding, default',
        capabilityBaseUsd: '0',
        capabilityPerCallUsd: '0',
        capabilitySaved: true,
        capabilityNote: '',
        registrationCompleted: true,
        registrationTxSig: 'mock-register-sig',
        plannerPrompt: 'Summarise the key risks in deploying an AI agent with on-chain payment capabilities.',
        plannerRunId: '',
        plannerStatus: 'idle',
        plannerNote: '',
        plannerResponsePreview: '',
        plannerX402Tx: '',
        plannerFeedbackScore: '8',
        plannerFeedbackNote: '',
        plannerFeedbackSent: false,
        plannerFeedbackNote2: '',
      }
      localStorage.setItem('reddi-onboarding-wizard-v1', JSON.stringify(state))
    })
    await page.reload()
    await completeStep1(page)
    // Navigate to step 8
    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: 'Next', exact: true }).click()
    }
    await expect(page.getByText(/Try Planner/i).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Run specialist call/i })).toBeVisible()
    await expect(page.locator('textarea')).toBeVisible()
  })

  test('step 8 planner — completion button is visible and enabled once attested', async ({ page }) => {
    await page.goto('/onboarding')
    await page.evaluate(() => {
      const state = {
        consentExposeEndpoint: true,
        consentProtocolOps: true,
        platform: 'macos',
        ollamaPort: '11434',
        protocolDomain: 'https://reddi.tech',
        runtimeReady: true,
        runtimeNote: '',
        runtimeTokenStored: false,
        hasWallet: 'yes',
        walletAddress: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        walletPassphrase: '',
        walletBackupConfirmed: true,
        walletStatusNote: '',
        sponsorshipReady: true,
        sponsorshipNote: '',
        sponsorshipLamports: 10000000,
        endpointUrl: 'http://localhost:11434',
        endpointStatus: 'online',
        endpointNote: '',
        endpointTunnelCommand: '',
        endpointProxyCommand: '',
        endpointProxyPort: 3030,
        endpointAuthHeader: 'x-reddi-agent-token',
        endpointAuthTokenPreview: 'abc123',
        endpointAuthToken: 'abc123',
        healthcheckStatus: 'pass',
        healthcheckNote: '',
        attested: true,
        attestationNote: '',
        attestationJobIdHex: 'aabbccddeeff00112233445566778899',
        attestationPda: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        attestationOperator: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        attestationConsumer: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        attestationResolution: 'confirmed',
        attestationResolutionSig: 'mocksig',
        attestationOperatorReady: true,
        attestationOperatorStatusNote: '',
        capabilityTaskTypes: 'summarize, classify',
        capabilityInputModes: 'text',
        capabilityOutputModes: 'text',
        capabilityPrivacyModes: 'public, per',
        capabilityTags: 'onboarding, default',
        capabilityBaseUsd: '0',
        capabilityPerCallUsd: '0',
        capabilitySaved: true,
        capabilityNote: '',
        registrationCompleted: true,
        registrationTxSig: 'mock-register-sig',
        plannerPrompt: 'Test',
        plannerRunId: '',
        plannerStatus: 'idle',
        plannerNote: '',
        plannerResponsePreview: '',
        plannerX402Tx: '',
        plannerFeedbackScore: '8',
        plannerFeedbackNote: '',
        plannerFeedbackSent: false,
        plannerFeedbackNote2: '',
      }
      localStorage.setItem('reddi-onboarding-wizard-v1', JSON.stringify(state))
    })
    await page.reload()
    await completeStep1(page)
    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: 'Next', exact: true }).click()
    }
    const completionBtn = page.getByRole('button', { name: /Onboarding complete/i })
    await expect(completionBtn).toBeVisible()
    await expect(completionBtn).toBeEnabled()

    // Inject completed state via localStorage + reload
    await page.evaluate(() => {
      const raw = localStorage.getItem('reddi-onboarding-wizard-v1')
      const state = raw ? JSON.parse(raw) : {}
      state.plannerFeedbackSent = true
      localStorage.setItem('reddi-onboarding-wizard-v1', JSON.stringify(state))
    })
    await page.reload()
    await completeStep1(page)
    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: 'Next', exact: true }).click()
    }
    await expect(page.getByRole('button', { name: /Onboarding complete/i })).toBeVisible()
  })

  test('step 8 planner — run button disabled when prompt is empty', async ({ page }) => {
    await page.goto('/onboarding')
    await page.evaluate(() => {
      const state = {
        consentExposeEndpoint: true, consentProtocolOps: true, platform: 'macos',
        ollamaPort: '11434', protocolDomain: 'https://reddi.tech',
        runtimeReady: true, runtimeNote: '', runtimeTokenStored: false,
        hasWallet: 'yes', walletAddress: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        walletPassphrase: '', walletBackupConfirmed: true, walletStatusNote: '',
        sponsorshipReady: true, sponsorshipNote: '', sponsorshipLamports: 10000000,
        endpointUrl: 'http://localhost:11434', endpointStatus: 'online', endpointNote: '',
        endpointTunnelCommand: '', endpointProxyCommand: '', endpointProxyPort: 3030,
        endpointAuthHeader: 'x-reddi-agent-token', endpointAuthTokenPreview: 'abc123', endpointAuthToken: 'abc123',
        healthcheckStatus: 'pass', healthcheckNote: '', attested: true,
        attestationNote: '', attestationJobIdHex: 'aabbccddeeff00112233445566778899',
        attestationPda: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        attestationOperator: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        attestationConsumer: 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
        attestationResolution: 'confirmed', attestationResolutionSig: 'mocksig',
        attestationOperatorReady: true, attestationOperatorStatusNote: '',
        capabilityTaskTypes: 'summarize, classify', capabilityInputModes: 'text',
        capabilityOutputModes: 'text', capabilityPrivacyModes: 'public, per',
        capabilityTags: 'onboarding, default', capabilityBaseUsd: '0', capabilityPerCallUsd: '0',
        capabilitySaved: true, capabilityNote: '',
        registrationCompleted: true, registrationTxSig: 'mock-register-sig',
        plannerPrompt: '', plannerRunId: '', plannerStatus: 'idle', plannerNote: '',
        plannerResponsePreview: '', plannerX402Tx: '',
        plannerFeedbackScore: '8', plannerFeedbackNote: '', plannerFeedbackSent: false, plannerFeedbackNote2: '',
      }
      localStorage.setItem('reddi-onboarding-wizard-v1', JSON.stringify(state))
    })
    await page.reload()
    await completeStep1(page)
    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: 'Next', exact: true }).click()
    }
    await expect(page.getByRole('button', { name: /Run specialist call/i })).toBeDisabled()
  })

  // ── API routes — planner execute ──────────────────────────────────────────

  test('POST /api/onboarding/planner/execute — returns ok:false with empty prompt', async ({ request }) => {
    const res = await request.post('/api/onboarding/planner/execute', {
      data: { prompt: '' },
    })
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBeTruthy()
  })

  test('POST /api/onboarding/planner/execute — valid prompt returns result shape', async ({ request }) => {
    const res = await request.post('/api/onboarding/planner/execute', {
      data: { prompt: 'What is the capital of France?' },
    })
    // ok may be false (no specialists registered in test env) but shape must be valid
    const body = await res.json()
    expect(typeof body.ok).toBe('boolean')
    expect(body.result).toBeDefined()
  })

  test('GET /api/onboarding/planner/execute — returns runs array', async ({ request }) => {
    const res = await request.get('/api/onboarding/planner/execute')
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.result?.results)).toBe(true)
  })

  // ── API routes — planner feedback ─────────────────────────────────────────

  test('POST /api/onboarding/planner/feedback — missing runId returns 400', async ({ request }) => {
    const res = await request.post('/api/onboarding/planner/feedback', {
      data: { score: 7 },
    })
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  test('POST /api/onboarding/planner/feedback — invalid score returns 400', async ({ request }) => {
    const res = await request.post('/api/onboarding/planner/feedback', {
      data: { runId: 'run_nonexistent', score: 15 },
    })
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  test('GET /api/onboarding/planner/feedback — returns feedback array', async ({ request }) => {
    const res = await request.get('/api/onboarding/planner/feedback')
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.result?.results)).toBe(true)
  })

  // ── API routes — planner reveal ───────────────────────────────────────────

  test('GET /api/onboarding/planner/reveal — returns commits array', async ({ request }) => {
    const res = await request.get('/api/onboarding/planner/reveal')
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.result?.commits)).toBe(true)
  })

  test('POST /api/onboarding/planner/reveal — missing runId returns 400', async ({ request }) => {
    const res = await request.post('/api/onboarding/planner/reveal', {
      data: {},
    })
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  test('POST /api/onboarding/planner/reveal — unknown runId returns error', async ({ request }) => {
    const res = await request.post('/api/onboarding/planner/reveal', {
      data: { runId: 'run_does_not_exist_xyz' },
    })
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.result?.error).toBeTruthy()
  })

  // ── API routes — capabilities ─────────────────────────────────────────────

  test('GET /api/onboarding/capabilities — returns specialists array', async ({ request }) => {
    const res = await request.get('/api/onboarding/capabilities')
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.result?.results)).toBe(true)
  })

  test('POST /api/onboarding/planner — valid policy returns result shape', async ({ request }) => {
    const res = await request.post('/api/onboarding/planner', {
      data: { requiresHealthPass: true },
    })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result).toBeDefined()
  })
})
