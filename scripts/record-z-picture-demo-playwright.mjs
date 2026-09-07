import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = 'artifacts/economic-demo-z-picture/loop46-recording';
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--window-size=1440,900', '--new-window'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(180_000);

await page.goto('http://127.0.0.1:3000/economic-demo/z-picture-demo', { waitUntil: 'networkidle' });
await page.bringToFront();
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /Execute Agent Protocol Z image call/i }).scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Execute Agent Protocol Z image call/i }).click();
await page.waitForTimeout(1500);
await page.getByText('Returned image proof', { exact: true }).waitFor({ timeout: 180_000 });
await page.waitForTimeout(2500);

await page.getByText('Returned image proof', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(6500);
await page.getByText('Wallet-authorized Agent Protocol run', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(5500);

const result = await page.evaluate(async () => {
  const res = await fetch('/api/torque/leaderboard');
  const leaderboard = await res.json().catch(() => null);
  const paymentLinks = Array.from(document.querySelectorAll('a[href*="solscan.io/tx/"]')).map((a) => a.href);
  const image = document.querySelector('img[alt="Generated proof image showing Z"]')?.getAttribute('src') ?? null;
  return { leaderboard, paymentLinks, imageVisible: Boolean(image), title: document.title };
});
await writeFile(join(outDir, 'browser-observed-links.json'), JSON.stringify(result, null, 2));

const paymentUrl = result.paymentLinks?.[0];
if (paymentUrl) {
  await page.goto(paymentUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8500);
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1500);
}

await page.getByText('MagicBlock PER reference proof', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(5500);
const perUrl = await page.locator('a', { hasText: /release tx/i }).first().getAttribute('href').catch(() => null);
if (perUrl) {
  await page.goto(perUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8500);
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1500);
}

await page.getByText('Torque reputation dashboard', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(8000);
await page.screenshot({ path: join(outDir, 'final-torque-dashboard.png'), fullPage: false });
await browser.close();
