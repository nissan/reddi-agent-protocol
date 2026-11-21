/**
 * Record short screen clips of the V1 scenarios that need no wallet signature.
 *
 * Read-only: every scene runs against the devnet app and uses the sandbox's
 * simulated payment, so nothing is signed, sent or spent, and no key is read.
 *
 * Run:   node scripts/record-v1-scenarios.ts
 * One:   SCENE=04-underpay-refused node scripts/record-v1-scenarios.ts
 * Env:   RECORD_BASE_URL  (default https://app.agent-protocol.reddi.tech)
 *        RECORD_OUT_DIR   (default ~/rap-marketing/clips/v1-scenarios)
 *        RECORD_HEADLESS=1 to record without a visible window
 *        RECORD_PACE_MS   pause on each result (default 1600)
 *
 * Each scene gets its own browser context, so each is its own .webm. An
 * index.md listing every clip, the scenario ids it shows, its duration and any
 * problem is rewritten after each run (scenes not re-recorded keep their row).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const BASE = (process.env.RECORD_BASE_URL ?? "https://app.agent-protocol.reddi.tech").replace(/\/$/, "");
const OUT = process.env.RECORD_OUT_DIR ?? path.join(os.homedir(), "rap-marketing", "clips", "v1-scenarios");
const PACE = Number(process.env.RECORD_PACE_MS ?? 1600);
const VIEWPORT = { width: 1440, height: 900 };

type Scene = { id: string; title: string; scenarios: string[]; note?: string; run: (page: Page) => Promise<void> };

const tid = (id: string) => `[data-testid="${id}"]`;
const beat = (page: Page, factor = 1) => page.waitForTimeout(PACE * factor);

async function glideTo(page: Page, selector: string, offset = 110, ms = 1100) {
  await page.evaluate(
    ([sel, off, dur]) =>
      new Promise<void>((resolve) => {
        const el = document.querySelector(sel as string);
        if (!el) return resolve();
        const target = Math.max(0, el.getBoundingClientRect().top + window.scrollY - (off as number));
        const start = window.scrollY;
        const t0 = performance.now();
        const step = (t: number) => {
          const k = Math.min(1, (t - t0) / (dur as number));
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          window.scrollTo(0, start + (target - start) * e);
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [selector, offset, ms] as const,
  );
}

async function highlight(page: Page, selector: string, on = true) {
  await page.evaluate(
    ([sel, flag]) => document.querySelectorAll(sel as string).forEach((el) => el.classList.toggle("rap-rec-hl", flag as boolean)),
    [selector, on] as const,
  );
}

const RECORDING_CSS = `
  nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }
  .rap-rec-hl { outline: 3px solid #14F195 !important; outline-offset: 6px; border-radius: 12px; }
`;

async function openSandbox(page: Page, scenario: string) {
  await page.goto(`${BASE}/sandbox?scenario=${scenario}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`${tid("sandbox-console")}[data-ready="true"]`, { timeout: 60_000 });
  await page.addStyleTag({ content: RECORDING_CSS });
  await beat(page);
}

async function send(page: Page) {
  await glideTo(page, tid("sandbox-send"), 420);
  await beat(page, 0.5);
  await page.click(tid("sandbox-send"));
}

async function sendAndSeeChallenge(page: Page) {
  await send(page);
  await page.waitForSelector(tid("sandbox-challenge"));
  await glideTo(page, tid("sandbox-challenge"), 160);
  await highlight(page, tid("sandbox-challenge"));
  await beat(page);
  await highlight(page, tid("sandbox-challenge"), false);
}

async function payAndVerify(page: Page) {
  await page.click(tid("sandbox-pay"));
  await page.waitForSelector(`${tid("sandbox-verification")}[data-ok="true"]`);
}

async function expectText(page: Page, selector: string, text: string) {
  const got = (await page.locator(selector).first().innerText()).replace(/\s+/g, " ");
  if (!got.toLowerCase().includes(text.toLowerCase())) throw new Error(`${selector} does not show "${text}"`);
}

const SCENES: Scene[] = [
  {
    id: "01-quote-and-maximum",
    title: "Per-token price, estimated cost and the maximum per call",
    scenarios: ["RAP-FEE2-S1"],
    note: "Sandbox catalog prices and demo exchange rates; the buyer approves the maximum shown in the 402 challenge. Nothing is signed.",
    run: async (page) => {
      await openSandbox(page, "buy-a-review");
      await glideTo(page, tid("sandbox-price-atlas-review"), 260);
      await highlight(page, tid("sandbox-price-atlas-review"));
      await expectText(page, tid("sandbox-price-atlas-review"), "in,");
      await beat(page, 1.5);
      await highlight(page, tid("sandbox-price-atlas-review"), false);
      await highlight(page, tid("sandbox-pricing-note"));
      await beat(page, 1.5);
      await highlight(page, tid("sandbox-pricing-note"), false);
      await sendAndSeeChallenge(page);
      await expectText(page, tid("sandbox-challenge"), "Maximum");
      await beat(page);
    },
  },
  {
    id: "03-receipt-verify-and-tamper",
    title: "Check a receipt in the browser, then edit the answer and watch the check fail",
    scenarios: ["RAP-739-S2", "RAP-739-S3", "RAP-V2-S2"],
    note: "Uses the sandbox simulated payment (no transaction). The receipt is the sandbox simulated receipt: the v2 field layout, signed, but not a reddi.receipt.v2 receipt, and the page says so.",
    run: async (page) => {
      await openSandbox(page, "buy-a-review");
      await sendAndSeeChallenge(page);
      await payAndVerify(page);
      await glideTo(page, tid("sandbox-verification"), 140);
      await highlight(page, tid("sandbox-verification"));
      await beat(page, 2);
      await highlight(page, tid("sandbox-verification"), false);
      await glideTo(page, tid("sandbox-receipt"), 120, 1400);
      await beat(page, 2);
      await glideTo(page, tid("sandbox-answer"), 160);
      await beat(page, 0.6);
      await page.click(tid("sandbox-tamper"));
      await page.waitForSelector(`${tid("sandbox-verification")}[data-ok="false"]`);
      await glideTo(page, tid("sandbox-verification"), 260);
      await highlight(page, tid("sandbox-check-response-hash"));
      await beat(page, 2);
      await highlight(page, tid("sandbox-check-response-hash"), false);
      await glideTo(page, tid("sandbox-answer"), 160);
      await page.click(tid("sandbox-restore"));
      await page.waitForSelector(`${tid("sandbox-verification")}[data-ok="true"]`);
      await glideTo(page, tid("sandbox-verification"), 260);
      await beat(page, 1.5);
    },
  },
  {
    id: "04-underpay-refused",
    title: "Underpaying, paying the wrong wallet and reusing a payment are refused",
    scenarios: ["RAP-738-S3", "RAP-738-S2"],
    note: "Simulated payments checked by the sandbox gateway. The reuse refusal is held by one server instance in the sandbox; V1 uses the durable store.",
    run: async (page) => {
      await openSandbox(page, "try-to-cheat");
      await sendAndSeeChallenge(page);
      await glideTo(page, tid("sandbox-underpay"), 420);
      await beat(page, 0.6);
      await page.click(tid("sandbox-underpay"));
      await page.waitForFunction((sel) => /wrong_amount/.test(document.querySelector(sel)?.textContent ?? ""), tid("sandbox-notice"));
      await highlight(page, tid("sandbox-notice"));
      await beat(page, 1.5);
      await highlight(page, tid("sandbox-notice"), false);
      await page.click(tid("sandbox-wrong-payee"));
      await page.waitForFunction((sel) => /wrong_payee/.test(document.querySelector(sel)?.textContent ?? ""), tid("sandbox-notice"));
      await highlight(page, tid("sandbox-notice"));
      await beat(page, 1.5);
      await highlight(page, tid("sandbox-notice"), false);
      await page.click(tid("sandbox-pay"));
      await page.waitForSelector(`${tid("sandbox-verification")}[data-ok="true"]`);
      await glideTo(page, tid("sandbox-reuse"), 420);
      await beat(page, 0.6);
      await page.click(tid("sandbox-reuse"));
      await page.waitForFunction((sel) => /409/.test(document.querySelector(sel)?.textContent ?? ""), tid("sandbox-notice"));
      await glideTo(page, tid("sandbox-notice"), 300);
      await highlight(page, tid("sandbox-notice"));
      await beat(page, 1.5);
      await highlight(page, tid("sandbox-notice"), false);
      await glideTo(page, tid("sandbox-ledger"), 200);
      await expectText(page, tid("sandbox-receipt-count"), "1");
      await beat(page);
    },
  },
  {
    id: "05-offline-provider",
    title: "A listed provider that is offline: clear error, nothing charged",
    scenarios: ["RAP-739-S4"],
    note: "The sandbox refuses before any challenge is issued, so nothing is paid; then the same request goes to a provider that answers.",
    run: async (page) => {
      await openSandbox(page, "provider-offline");
      await send(page);
      await page.waitForFunction((sel) => /You paid nothing\./.test(document.querySelector(sel)?.textContent ?? ""), tid("sandbox-notice"));
      await glideTo(page, tid("sandbox-notice"), 300);
      await highlight(page, tid("sandbox-notice"));
      await beat(page, 2);
      await highlight(page, tid("sandbox-notice"), false);
      if ((await page.locator(tid("sandbox-challenge")).count()) !== 0) throw new Error("a challenge was shown for an offline provider");
      await glideTo(page, tid("sandbox-ledger"), 200);
      await expectText(page, tid("sandbox-receipt-count"), "0");
      await beat(page);
      await glideTo(page, tid("sandbox-provider-swift-infer"), 300);
      await page.click(tid("sandbox-provider-swift-infer"));
      await beat(page, 0.6);
      await sendAndSeeChallenge(page);
      await payAndVerify(page);
      await glideTo(page, tid("sandbox-verification"), 140);
      await beat(page, 1.5);
    },
  },
  {
    id: "07-adl-v03",
    title: "The site publishes ADL v0.3",
    scenarios: ["RAP-ADL-S1"],
    note: "Downloads the v0.3 Markdown spec, then opens the v0.3 JSON Schema; the script fails if a v0.2 download is on the page.",
    run: async (page) => {
      await page.goto(`${BASE}/spec`, { waitUntil: "domcontentloaded" });
      await page.addStyleTag({ content: RECORDING_CSS });
      await beat(page, 1.5);
      const body = await page.locator("body").innerText();
      if (/v0\.2\.(zip|md)|ADL-v0\.2/i.test(body)) throw new Error("a v0.2 download is still on /spec");
      const md = page.locator('a[href="/downloads/ADL-v0.3.md"]');
      await md.scrollIntoViewIfNeeded();
      await glideTo(page, 'a[href="/downloads/adl-v0.3.zip"]', 300);
      await highlight(page, 'a[href^="/downloads/"]');
      await beat(page, 1.5);
      const [download] = await Promise.all([page.waitForEvent("download"), md.click()]);
      const name = download.suggestedFilename();
      if (name !== "ADL-v0.3.md") throw new Error(`downloaded ${name}`);
      await highlight(page, 'a[href^="/downloads/"]', false);
      await beat(page);
      await page.goto(`${BASE}/downloads/ADL-v0.3.schema.json`, { waitUntil: "domcontentloaded" });
      await beat(page, 2);
    },
  },
];

function durationSeconds(file: string): string {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
    return `${Number(out.trim()).toFixed(1)} s`;
  } catch {
    return "unknown (ffprobe failed)";
  }
}

type Row = { id: string; title: string; scenarios: string; duration: string; problem: string };

function writeIndex(rows: Map<string, Row>) {
  const lines = [
    "# V1 scenario clips",
    "",
    `Recorded from ${BASE} with \`scripts/record-v1-scenarios.ts\` (viewport ${VIEWPORT.width}x${VIEWPORT.height}).`,
    "Every clip is read-only: the sandbox's simulated payment, no wallet, nothing signed or sent.",
    "",
    "| Clip | Shows | Scenario ids | Duration | Problem |",
    "|---|---|---|---|---|",
    ...[...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).map((r) => `| \`${r.id}.webm\` | ${r.title} | ${r.scenarios} | ${r.duration} | ${r.problem} |`),
    "",
  ];
  fs.writeFileSync(path.join(OUT, "index.md"), lines.join("\n"));
}

function readIndex(): Map<string, Row> {
  const rows = new Map<string, Row>();
  const file = path.join(OUT, "index.md");
  if (!fs.existsSync(file)) return rows;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\| `([^`]+)\.webm` \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/);
    if (m) rows.set(m[1], { id: m[1], title: m[2], scenarios: m[3], duration: m[4], problem: m[5] });
  }
  return rows;
}

async function main() {
  const only = process.env.SCENE;
  const scenes = only ? SCENES.filter((s) => s.id === only) : SCENES;
  if (scenes.length === 0) throw new Error(`no scene named ${only}; scenes: ${SCENES.map((s) => s.id).join(", ")}`);
  fs.mkdirSync(OUT, { recursive: true });
  const rows = readIndex();
  const browser = await chromium.launch({ headless: process.env.RECORD_HEADLESS === "1", channel: process.env.RECORD_CHANNEL || undefined });
  let failed = 0;
  for (const scene of scenes) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rap-rec-"));
    const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: tmp, size: VIEWPORT }, acceptDownloads: true });
    const page = await context.newPage();
    let problem = "none";
    try {
      await scene.run(page);
      if (scene.note) problem = `none. ${scene.note}`;
    } catch (err) {
      failed += 1;
      problem = `FAILED: ${(err as Error).message.split("\n")[0]}`;
    }
    const video = page.video();
    await context.close();
    const dest = path.join(OUT, `${scene.id}.webm`);
    if (video) fs.renameSync(await video.path(), dest);
    fs.rmSync(tmp, { recursive: true, force: true });
    const duration = durationSeconds(dest);
    rows.set(scene.id, { id: scene.id, title: scene.title, scenarios: scene.scenarios.join(", "), duration, problem: problem.replace(/\|/g, "/") });
    console.log(`${scene.id}: ${duration} ${problem.startsWith("FAILED") ? problem : "ok"} -> ${dest}`);
  }
  await browser.close();
  writeIndex(rows);
  console.log(`index: ${path.join(OUT, "index.md")}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
