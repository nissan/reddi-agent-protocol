import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = process.env.OUT_DIR || 'artifacts/economic-demo-z-picture/loop49-phantom-onchain-proof';
await mkdir(outDir, { recursive: true });
const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const teeExplorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent('https://devnet-tee.magicblock.app')}`;
const local = 'http://127.0.0.1:3000/economic-demo/z-picture-onchain-proof';

const latest = await fetch('http://127.0.0.1:3000/api/economic-demo/z-picture-latest').then((res) => res.json());
const latestTxs = latest?.paymentTxs || latest?.run?.paymentTxs || latest?.summary?.paymentTxs || [];
const x402 = {
  planning: latestTxs[0]?.signature || '2btc46Zk7jCxYeXtfYouUuWnQXzFFz9zj4XiNWcXgV22DoRXWdrmXg7TQwPrAimnvCBM89ExKueahGso9efQws64',
  codegen: latestTxs[2]?.signature || latestTxs[1]?.signature || 'FFbwtvye4beBgYmxf6VRVAoXrGTS8soVZzCMLNbKnvhkG8ZTDsWQiCW67a6JUTyK7g9q3uNwY6AGmB1SoYYGr35',
};
await writeFile(join(outDir, 'latest-run-used.json'), JSON.stringify({ runId: latest?.runId || latest?.run?.runId || latest?.summary?.runId, walletAuthorization: latest?.walletAuthorization || latest?.run?.walletAuthorization || latest?.summary?.walletAuthorization, x402 }, null, 2));
const magic = {
  delegate: '3JCzpBo7Wz7hi6hP89ggRhfcvBDz9mGAgfjKDQxzaNtkkK7nbWEkiaQH7nE3HyjmbAxpywpGSV3CujsBwdoGxb5P',
  release: '2Hj5pFtuAeDuYEDe5PP6hEi3ybVbfNXW5BVSAEimNGgvs1VVR8d7xqofkeVqkTZ9dQhDZr25nhCWATU2GGk1M7TC',
};
const umbra = {
  create: '5kiNbAVHG2AhqNFqsLprTfSYJDKQSMh6FCUtz2RiroRSeXQiss2tjLsV3yu4ccKBYzmCeaNvMNzxkQHZUcW6AwBK',
  claim: '5DsrahqsiTJqrbSu5tAiJdWJMCxGNBrMqjTvNa8xKAqdDoFex5UPqSjWrYcPEAiHeV8N7mrJ2F5xcNh8wvyRAvQo',
};

async function waitForExplorer(page, sig, label, url = explorer(sig)) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(10_000);
  const text = await page.locator('body').innerText({ timeout: 10_000 }).catch((e) => `ERR ${e.message}`);
  await writeFile(join(outDir, `${label}-body.txt`), text.slice(0, 12000));
  if (/captcha|security verification|not a bot|cloudflare/i.test(text)) {
    await writeFile(join(outDir, `${label}-captcha-detected.txt`), text);
    console.log(`CAPTCHA_OR_SECURITY_GATE:${label}`);
    await page.waitForTimeout(120_000);
  }
  if (!text.includes(sig) || !/Result|Success|Signature|Instructions/i.test(text)) {
    console.log(`EXPLORER_DETAILS_NOT_CONFIRMED:${label}`);
  }
  await page.screenshot({ path: join(outDir, `${label}-overview.png`), fullPage: false });
  await page.waitForTimeout(4500);
  await page.mouse.wheel(0, 620);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: join(outDir, `${label}-scrolled.png`), fullPage: false });
}

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--window-size=1440,900', '--disable-extensions', '--new-window'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: outDir, size: { width: 1440, height: 900 } } });
const page = await context.newPage();
page.setDefaultTimeout(90_000);

await page.goto(local, { waitUntil: 'networkidle' });
await page.bringToFront();
await page.waitForTimeout(4500);
await page.getByText('Returned image proof', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(5000);
await page.getByText('2 · x402 transfer references', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(4000);

await waitForExplorer(page, x402.planning, '01-x402-planning');
await page.goto(local, { waitUntil: 'networkidle' });
await page.getByText('2 · x402 transfer references', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
await waitForExplorer(page, x402.codegen, '02-x402-codegen');

await page.goto(local, { waitUntil: 'networkidle' });
await page.getByText('3 · MagicBlock PER reference evidence', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(5500);
await waitForExplorer(page, magic.delegate, '03-magicblock-delegate');
await page.goto(local, { waitUntil: 'networkidle' });
await page.getByText('3 · MagicBlock PER reference evidence', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
await waitForExplorer(page, magic.release, '04-magicblock-release-tee-rpc', teeExplorer(magic.release));

await page.goto(local, { waitUntil: 'networkidle' });
await page.getByText('4 · Umbra adapter evidence boundary', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(5500);
await waitForExplorer(page, umbra.create, '05-umbra-create-utxo');
await page.goto(local, { waitUntil: 'networkidle' });
await page.getByText('4 · Umbra adapter evidence boundary', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
await waitForExplorer(page, umbra.claim, '06-umbra-claim');

await page.goto(local, { waitUntil: 'networkidle' });
await page.getByText('5 · Torque reputation-input boundary', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(8000);
await page.screenshot({ path: join(outDir, '07-torque-boundary.png'), fullPage: false });
const video = page.video();
await context.close();
if (video) {
  const videoPath = await video.path();
  await writeFile(join(outDir, 'playwright-video-path.txt'), videoPath);
}
await browser.close();
