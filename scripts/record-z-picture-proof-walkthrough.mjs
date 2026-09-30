import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--window-size=1440,900', '--disable-extensions', '--new-window'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3000/economic-demo/z-picture-proof', { waitUntil: 'networkidle' });
await page.bringToFront();
await page.waitForTimeout(5000);
await page.getByText('Returned image proof', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(7000);
await page.getByText('Solscan devnet references', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(6000);
const firstTx = await page.locator('a[href*="solscan.io/tx/"]').first().getAttribute('href');
if (firstTx) { await page.goto(firstTx, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null); await page.waitForTimeout(8000); await page.goto('http://127.0.0.1:3000/economic-demo/z-picture-proof', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); }
await page.getByText('MagicBlock PER', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(7000);
const perTx = await page.locator('a', { hasText: /release/ }).first().getAttribute('href').catch(() => null);
if (perTx) { await page.goto(perTx, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null); await page.waitForTimeout(8000); await page.goto('http://127.0.0.1:3000/economic-demo/z-picture-proof', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); }
await page.getByText('Torque reputation-input dashboard', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(8000);
await browser.close();
