import { chromium } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = 'https://agent-protocol.reddi.tech'
const OUT_DIR = path.join(__dirname, '..', 'public', 'tour')

const SHOTS = [
  { id: '01-landing', url: '/', title: 'Welcome', caption: 'The Reddi Agent Protocol — permissionless AI agent marketplace on Solana', scroll: 0 },
  { id: '02-economics', url: '/', title: 'The Economics', caption: '83.3% to specialists, 16.7% to treasury — only on success. Zero on failure.', scroll: 600 },
  { id: '03-agents', url: '/agents', title: 'Browse Agents', caption: 'Browse registered agents — filter by type, reputation, and per-call rate', scroll: 0 },
  { id: '04-setup-connect', url: '/setup', title: 'Connect Your Ollama', caption: 'Enter your public endpoint URL — ngrok or Cloudflare Tunnel. CORS setup included.', scroll: 0 },
  { id: '05-setup-tools', url: '/setup', title: 'Configure Tools', caption: 'Add functions your agent can call — name, description, parameters. Preview the exact Ollama JSON.', scroll: 0, clickTab: 'Tools' },
  { id: '06-setup-skills', url: '/setup', title: 'Add Skills', caption: 'Type, upload, or pull skills from a URL — stacked into your system prompt in priority order.', scroll: 0, clickTab: 'Skills' },
  { id: '07-setup-test', url: '/setup', title: 'Test Your Endpoint', caption: '5-step test: reachability → model present → chat → tool calling → embeddings.', scroll: 0, clickTab: 'Test' },
  { id: '08-setup-register', url: '/setup', title: 'Ready to Register', caption: 'Summary of your config — specialisation, tags, rate — then straight to on-chain registration.', scroll: 0, clickTab: 'Register' },
  { id: '09-register', url: '/register', title: 'Register On-Chain', caption: 'Connect wallet · Set your rate · Pay 0.01 SOL · You\'re live in the agent index', scroll: 0 },
  { id: '10-demo', url: '/demo', title: 'Live Debug Playground', caption: 'Enter any brief — watch the full pipeline fire in real time', scroll: 0 },
  { id: '11-demo-running', url: '/demo', title: 'Pipeline In Action', caption: 'Planning → discovery → escrow deposit → primary agent → attestation scoring', fill: 'A landing page for a privacy-first AI assistant for developers', wait: 7000 },
  { id: '12-demo-complete', url: '/demo', title: 'Pipeline Complete', caption: 'Commit-reveal closed · Escrow settled · Quality score written on-chain', fill: 'A landing page for a web3 productivity tool', wait: 13000 },
  { id: '13-customize', url: '/customize', title: 'Stand Out', caption: 'Prompts, model selection, reputation strategy — differentiate your agent', scroll: 0 },
  { id: '14-dashboard', url: '/dashboard', title: 'Track Your Earnings', caption: 'Earnings, jobs completed, reputation score — all in one place', scroll: 0 },
]

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })

  for (const shot of SHOTS) {
    process.stdout.write(`📸 ${shot.id}...`)
    try {
      await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: 'networkidle', timeout: 20000 })
      await page.waitForTimeout(800)

      if (shot.clickTab) {
        const tab = page.getByRole('tab', { name: shot.clickTab }).first()
        if (await tab.isVisible()) { await tab.click(); await page.waitForTimeout(600) }
      }
      if (shot.click) {
        const el = page.getByText(shot.click).first()
        if (await el.isVisible()) { await el.click(); await page.waitForTimeout(500) }
      }
      if (shot.fill) {
        const ta = page.locator('textarea').first()
        if (await ta.isVisible()) {
          await ta.fill(shot.fill)
          await page.getByRole('button', { name: /generate/i }).click()
          await page.waitForTimeout(shot.wait || 3000)
        }
      }
      if (shot.scroll) {
        await page.evaluate(y => window.scrollTo(0, y), shot.scroll)
        await page.waitForTimeout(300)
      }

      await page.screenshot({ path: path.join(OUT_DIR, `${shot.id}.png`), fullPage: false })
      console.log(' ✅')
    } catch (e) {
      console.log(` ❌ ${e.message?.slice(0,80)}`)
    }
  }

  await browser.close()
  const count = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png')).length
  console.log(`\nDone → public/tour/ (${count} screenshots)`)
}

run()
