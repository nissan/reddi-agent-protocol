#!/usr/bin/env node
/**
 * Regenerates the `overview` onboarding walkthrough.
 *
 * The RAP Assurance claim remediation deleted `public/videos/onboarding/overview.mp4`,
 * its poster, and its caption track outright, and the `overview` guide in
 * `lib/onboarding/video-guides.ts` now carries no `videoSrc` at all — see
 * "Withheld stale captures" in `docs/PUBLIC-CLAIM-BOUNDARY.md`. The default output
 * paths below still write back to those deleted files, and the scene labels below
 * still narrate the retired pre-remediation copy. Re-author the scenes and voiceover
 * against current copy before running this, or the run restores exactly what the
 * remediation removed.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const baseUrl = process.env.ONBOARDING_BASE_URL || 'http://127.0.0.1:3107';
const outDir = resolve(process.env.ONBOARDING_OUT_DIR || 'artifacts/onboarding-videos/overview');
const framesDir = join(outDir, 'frames');
const voiceover = resolve(process.env.ONBOARDING_VOICEOVER || join(outDir, 'voiceover-elevenlabs-v1.mp3'));
const output = resolve(process.env.ONBOARDING_OUTPUT || join(outDir, 'onboarding-overview-final.mp4'));
const publicOutput = resolve(process.env.ONBOARDING_PUBLIC_OUTPUT || 'public/videos/onboarding/overview.mp4');
const publicPoster = resolve(process.env.ONBOARDING_PUBLIC_POSTER || 'public/videos/onboarding/posters/overview.jpg');

mkdirSync(framesDir, { recursive: true });
mkdirSync(resolve('public/videos/onboarding/posters'), { recursive: true });

const scenes = [
  { id: '01-home', route: '/', label: 'Homepage: choose your path', duration: 5.5 },
  { id: '02-start', route: '/start', label: 'Start hub: three proof videos', duration: 6.5 },
  { id: '03-setup', route: '/setup', label: 'Setup guide: endpoint, tools, skills, test', duration: 7.0 },
  { id: '04-agents', route: '/agents', label: 'Marketplace: discover specialists', duration: 6.0 },
  { id: '05-register', route: '/register', label: 'Register: specialist onboarding proof', duration: 6.5 },
  { id: '06-economic-demo', route: '/economic-demo', label: 'Economic demo: payment evidence trail', duration: 6.5 },
  { id: '07-verify', route: '/#verify-demo', label: 'Verify: public replication command', duration: 5.0 },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const metadata = [];
for (const scene of scenes) {
  await page.goto(`${baseUrl}${scene.route}`, { waitUntil: 'networkidle', timeout: 60000 });
  if (scene.route === '/#verify-demo') {
    await page.locator('#verify-demo').scrollIntoViewIfNeeded();
  }
  await page.screenshot({ path: join(framesDir, `${scene.id}.png`), fullPage: false });
  metadata.push(scene);
}
await browser.close();

const concatPath = join(outDir, 'overview.ffconcat');
let concat = 'ffconcat version 1.0\n';
for (const scene of scenes) {
  concat += `file '${join(framesDir, `${scene.id}.png`).replaceAll("'", "'\\''")}'\n`;
  concat += `duration ${scene.duration.toFixed(3)}\n`;
}
concat += `file '${join(framesDir, `${scenes.at(-1).id}.png`).replaceAll("'", "'\\''")}'\n`;
writeFileSync(concatPath, concat);
writeFileSync(join(outDir, 'metadata.json'), JSON.stringify({ baseUrl, scenes, output, voiceover }, null, 2));

const ffmpegArgs = [
  '-y',
  '-f', 'concat',
  '-safe', '0',
  '-i', concatPath,
  '-i', voiceover,
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
  '-r', '30',
  '-map', '0:v:0',
  '-map', '1:a:0',
  '-c:v', 'libx264',
  '-crf', '18',
  '-preset', 'veryfast',
  '-c:a', 'aac',
  '-b:a', '160k',
  '-shortest',
  '-movflags', '+faststart',
  output,
];
const result = spawnSync('ffmpeg', ffmpegArgs, { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

spawnSync('cp', [output, publicOutput], { stdio: 'inherit' });
spawnSync('ffmpeg', ['-y', '-ss', '2', '-i', output, '-frames:v', '1', '-q:v', '3', publicPoster], { stdio: 'ignore' });
spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,nb_frames', '-show_entries', 'format=duration,size', '-of', 'json', output], { stdio: 'inherit' });
console.log(`Wrote ${output}`);
console.log(`Copied ${publicOutput}`);
