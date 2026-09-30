import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = 'artifacts/economic-demo-z-picture/loop46-recording-v2';
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--window-size=1440,900', '--disable-extensions', '--new-window'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(180_000);

await page.goto('http://127.0.0.1:3000/economic-demo/z-picture-demo', { waitUntil: 'networkidle' });
await page.bringToFront();
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /Execute Agent Protocol Z image call/i }).scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Execute Agent Protocol Z image call/i }).click();
await page.waitForTimeout(1500);
await page.getByText('Returned image proof', { exact: true }).waitFor({ timeout: 180_000 });
await page.waitForTimeout(2500);

await page.getByText('Returned image proof', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(6000);
await page.getByText('Wallet-authorized Agent Protocol run', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(5000);

const observed = await page.evaluate(async () => {
  const paymentLinks = Array.from(document.querySelectorAll('a[href*="solscan.io/tx/"]')).map((a) => a.href);
  return { paymentLinks, title: document.title, url: location.href };
});
await writeFile(join(outDir, 'browser-observed-links.json'), JSON.stringify(observed, null, 2));

if (observed.paymentLinks[0]) {
  await page.evaluate((url) => { location.href = url; }, observed.paymentLinks[0]);
  await page.waitForTimeout(8000);
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(2500);
}

await page.getByText('MagicBlock PER reference proof', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(5000);
const releaseUrl = observed.paymentLinks.find((url) => url.includes('2Hj5pFtu')) ?? observed.paymentLinks[6];
if (releaseUrl) {
  await page.evaluate((url) => { location.href = url; }, releaseUrl);
  await page.waitForTimeout(8000);
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(2500);
}

await page.getByText('Torque reputation dashboard', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(9000);
await page.screenshot({ path: join(outDir, 'final-torque-dashboard.png'), fullPage: false });
await browser.close();
