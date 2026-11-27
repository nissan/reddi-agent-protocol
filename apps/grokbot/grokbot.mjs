#!/usr/bin/env node
/**
 * Grokbot: a buyer agent that makes a short marketing video by hiring providers on Reddi Agent Protocol.
 *
 *   node grokbot.mjs plan  [brief.md]   find the team and plan the Budget; signs and sends nothing
 *   node grokbot.mjs run   [brief.md]   open the Budget, make the video, close, waive, pay out, write the ledger
 *   node grokbot.mjs recover <budget>   close a Budget a failed run left open and pay out what was posted
 *
 * Devnet only, test USDC. Its thinking is qwen3 on rtwin1 over the local network (GROKBOT_BRAIN_URL); its
 * providers are whoever the app lists for each role. See README.md for the settings.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { chooseTeam, createBrain, restructure, scriptPrompt } from "./src/brain.mjs";
import { connect, createBudgetChain, explorer } from "./src/chain.mjs";
import { createDesk } from "./src/desk.mjs";
import { listCandidates, readOffer } from "./src/discover.mjs";
import { renderLedger, splitPayout, totals } from "./src/ledger.mjs";
import { JOBS, planSlices, ROLES, ROLE_NAMES, usdc } from "./src/plan.mjs";
import { checkScript, parseScript, SCRIPT_SYSTEM } from "./src/script.mjs";

const env = process.env;
const DEVNET_JUDGE = "9Zv4HWNRt5WzSjBkbmJnGPtAT7vrcG8NxTzcd2iGF576";
const settings = {
  appUrl: env.GROKBOT_APP_URL || "https://app.agent-protocol.reddi.tech",
  rpcUrl: env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  brainUrl: env.GROKBOT_BRAIN_URL || "",
  brainModel: env.GROKBOT_BRAIN_MODEL || "qwen3.8:27b",
  judge: env.GROKBOT_JUDGE || DEVNET_JUDGE,
  total: BigInt(Math.round(Number(env.GROKBOT_BUDGET_USDC || "5") * 1_000_000)),
  out: env.GROKBOT_OUT || join(process.cwd(), "out", new Date().toISOString().replace(/[:.]/g, "-")),
  sweepUrl: env.STUDIO_SWEEP_URL || "",
  cronSecret: env.STUDIO_CRON_SECRET || "",
};

const started = Date.now();
const log = (event) => console.log(JSON.stringify({ t: Math.round((Date.now() - started) / 1000), ...event }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
const say = (text) => console.log(`\n▶ ${text}`);

function payerKey() {
  const path = (env.GROKBOT_PAYER_KEYPAIR_PATH || "").replace(/^~(?=\/)/, homedir());
  if (!path) throw new Error("Set GROKBOT_PAYER_KEYPAIR_PATH to Grokbot's devnet wallet keypair file.");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function brain() {
  if (!settings.brainUrl) throw new Error("Set GROKBOT_BRAIN_URL to qwen3's OpenAI-compatible address on rtwin1, such as http://rtwin1:11434/v1.");
  return createBrain({ url: settings.brainUrl, model: settings.brainModel, log });
}

function loadBrief(path) {
  const text = readFileSync(path || new URL("./brief.md", import.meta.url), "utf8").trim();
  if (!text) throw new Error("the brief is empty");
  return text.slice(0, 3000);
}

/** Discovery, the brain's picks, each pick's offer, and the slices. Reads only. */
async function planTeam(mind, brief) {
  say(`Finding providers listed on ${settings.appUrl}`);
  const candidates = await listCandidates(settings.appUrl);
  for (const role of ROLE_NAMES) log({ event: "candidates", role, names: candidates[role].map((c) => c.displayName) });
  const { team, why } = await chooseTeam(mind, brief, candidates);
  say(`Team: ${ROLE_NAMES.map((r) => `${r} = ${team[r].displayName}`).join(", ")}. ${why}`);
  const offers = {};
  const prices = {};
  for (const role of ROLE_NAMES) {
    const { offer, outputPerMillion } = await readOffer(team[role], settings.judge);
    offers[role] = offer;
    prices[role] = outputPerMillion;
  }
  const programIds = new Set(ROLE_NAMES.map((r) => offers[r].programId));
  if (programIds.size !== 1) throw new Error("the providers name different Budget programs");
  const { slices, sum } = planSlices(prices, settings.total);
  for (const role of ROLE_NAMES) log({ event: "slice", role, provider: team[role].displayName, price_per_million: usdc(prices[role]), slice: usdc(slices[role]) });
  say(`Budget ${usdc(settings.total)} USDC; slices ${usdc(sum)}; the rest returns at close.`);
  const minOpen = ROLE_NAMES.reduce((m, r) => (BigInt(offers[r].minOpenSlotsLeft) > m ? BigInt(offers[r].minOpenSlotsLeft) : m), 0n);
  return { team, why, offers, slices, programId: new PublicKey([...programIds][0]), minOpen };
}

async function fetchChecked(file, dir) {
  const response = await fetch(file.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${file.name} download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== file.sha256 || bytes.length !== file.size) throw new Error(`${file.name} does not match the sha256 and size its desk reported`);
  writeFileSync(join(dir, `${file.task}-${file.name}`), bytes);
  return { ...file, verified: true };
}

async function make(desks, brief, mind, files) {
  const keep = (role, task, content) => {
    for (const [name, meta] of Object.entries(content.files ?? {})) files.push({ role, task, name, ...meta });
  };
  const first = (content, suffix) => Object.keys(content.files ?? {}).find((n) => n.endsWith(suffix));

  say("Script desk: writing the script");
  const prompt = await scriptPrompt(mind, brief);
  const scriptTask = await desks.script.start(JOBS.script(prompt, SCRIPT_SYSTEM));
  await desks.script.waitReady(scriptTask, { everyS: 10 });
  const scriptDone = await desks.script.collect(scriptTask, ROLES.script.collects[0]);
  keep("script", scriptTask, scriptDone);
  let script;
  try {
    script = parseScript(scriptDone.text);
  } catch (error) {
    log({ event: "script_restructured", reason: error.message });
    script = checkScript(await restructure(mind, scriptDone.text));
  }
  log({ event: "script", title: script.title, voiceover: script.voiceover });

  say("Voice desk and Video desk start together: voiceover, then three start frames");
  const voiceTask = await desks.voice.start(JOBS.voice(script.voiceover));
  const frameTasks = [];
  for (const [i, shot] of script.shots.entries()) frameTasks.push(await desks.video.start(JOBS.frame(shot.image, 1000 + i)));
  const frames = [];
  for (const task of frameTasks) {
    await desks.video.waitReady(task, { everyS: 10 });
    const content = await desks.video.collect(task, ROLES.video.collects[0]);
    keep("video", task, content);
    frames.push({ task, file: first(content, ".png") });
  }
  say("Video desk: three 5 second clips from the frames (about 7 minutes each on one GPU)");
  const clipTasks = [];
  for (const [i, shot] of script.shots.entries()) clipTasks.push(await desks.video.start(JOBS.clip(shot.motion, frames[i], 2000 + i)));
  await desks.voice.waitReady(voiceTask);
  const voiceDone = await desks.voice.collect(voiceTask, ROLES.voice.collects[0]);
  keep("voice", voiceTask, voiceDone);
  const clips = [];
  for (const task of clipTasks) {
    await desks.video.waitReady(task, { everyS: 30, maxMinutes: 60 });
    const content = await desks.video.collect(task, ROLES.video.collects[3]);
    keep("video", task, content);
    clips.push({ task, file: first(content, ".mp4") });
  }

  say("Stitch desk: the final cut with the voiceover");
  const stitchTask = await desks.stitch.start(JOBS.stitch(clips, { task: voiceTask, file: first(voiceDone, ".wav") }));
  await desks.stitch.waitReady(stitchTask, { everyS: 10 });
  const cut = await desks.stitch.collect(stitchTask, ROLES.stitch.collects[0]);
  keep("stitch", stitchTask, cut);
  return { script, final: { task: stitchTask, file: first(cut, ".mp4") } };
}

async function nudgeSweep() {
  if (!settings.sweepUrl || !settings.cronSecret) return;
  const r = await fetch(settings.sweepUrl, { headers: { authorization: `Bearer ${settings.cronSecret}` }, signal: AbortSignal.timeout(300_000) });
  log({ event: "sweep_nudged", status: r.status });
}

async function settleAndLedger({ chain, team, budget, createdSlot, earned }) {
  // A desk that billed nothing posts nothing; its unused slice comes back when the window ends.
  const roles = ROLE_NAMES.filter((r) => earned[r] > 0n);
  const payees = roles.map((r) => new PublicKey(team[r].wallet));
  say("Waiting for each provider to post what it earned");
  await chain.waitPosted({ budget, payees, nudge: nudgeSweep });
  say("Waiving the dispute window (every file was checked on delivery) and paying out now");
  const payouts = [];
  for (const role of roles) {
    const payee = new PublicKey(team[role].wallet);
    const paid = await chain.waiveAndPay({ budget, createdSlot, payee });
    const moves = await chain.tokenMoves(paid.signature);
    const split = splitPayout(moves, { payoutAccount: paid.payoutAccount.toBase58(), treasuryTokens: chain.treasuryTokens.toBase58(), payerTokens: chain.payerTokens.toBase58() });
    payouts.push({ role, name: team[role].displayName, wallet: team[role].wallet, reserved: paid.reserved.toString(), posted: paid.posted.toString(), provider: split.provider.toString(), fee: split.fee.toString(), refund: split.refund.toString(), signature: paid.signature });
    say(`${team[role].displayName} paid ${usdc(split.provider)} USDC (fee ${usdc(split.fee)}, ${usdc(split.refund)} back): ${explorer(paid.signature)}`);
  }
  return payouts;
}

async function run(briefPath) {
  const brief = loadBrief(briefPath);
  const mind = brain();
  const plan = await planTeam(mind, brief);
  const payer = payerKey();
  const spender = Keypair.generate();
  const connection = await connect(settings.rpcUrl);
  const chain = createBudgetChain({ connection, payer, spender, programId: plan.programId, log });
  const balance = await chain.usdcBalance();
  if (balance < settings.total) throw new Error(`Grokbot's wallet has ${usdc(balance)} devnet USDC; the Budget needs ${usdc(settings.total)}`);
  mkdirSync(settings.out, { recursive: true });

  say(`Opening a ${usdc(settings.total)} USDC Budget: these four providers only, judge ${settings.judge.slice(0, 4)}…, spender may waive`);
  const openSlots = plan.minOpen * 2n > 27_000n ? plan.minOpen * 2n : 27_000n; // about three hours
  const opened = await chain.open({ total: settings.total, judge: new PublicKey(settings.judge), allowlist: ROLE_NAMES.map((r) => new PublicKey(plan.team[r].wallet)), openSlots });
  say(`Budget ${opened.budget.toBase58()}: ${explorer(opened.signature)}`);

  const blockhash = async () => (await connection.getLatestBlockhash("confirmed")).blockhash;
  const desks = Object.fromEntries(ROLE_NAMES.map((role) => [role, createDesk({ role, listing: plan.team[role], budget: opened.budget, createdSlot: opened.createdSlot, spender, slice: plan.slices[role], blockhash, log })]));
  const files = [];
  let made;
  try {
    made = await make(desks, brief, mind, files);
  } catch (error) {
    say(`The work stopped: ${error.message}. Closing the Budget so nothing unreserved stays locked; posted slices are still paid out.`);
  }
  say("Checking every file against the sha256 its desk reported");
  const checked = [];
  for (const f of files) checked.push(await fetchChecked(f, settings.out));

  const before = await chain.usdcBalance();
  const closeSignature = await chain.close(opened);
  const closeRefund = (await chain.usdcBalance()) - before;
  say(`Budget closed, ${usdc(closeRefund)} USDC unreserved came straight back: ${explorer(closeSignature)}`);

  const earned = Object.fromEntries(ROLE_NAMES.map((r) => [r, desks[r].calls.reduce((sum, c) => sum + BigInt(c.cost), 0n)]));
  const payouts = await settleAndLedger({ chain, team: plan.team, budget: opened.budget, createdSlot: opened.createdSlot, earned });
  const ledger = {
    brief,
    brain: `${settings.brainModel} on rtwin1`,
    why: plan.why,
    budget: opened.budget.toBase58(),
    total: settings.total.toString(),
    open: { signature: opened.signature },
    close: { signature: closeSignature, refund: closeRefund.toString() },
    payouts,
    calls: ROLE_NAMES.flatMap((r) => desks[r].calls.map((c) => ({ role: r, ...c }))),
    files: checked,
    script: made?.script ?? { title: "(not finished)", voiceover: "" },
    final: made?.final ?? null,
    finishedAt: new Date().toISOString(),
  };
  const t = totals(ledger);
  writeFileSync(join(settings.out, "ledger.json"), JSON.stringify(ledger, null, 2));
  writeFileSync(join(settings.out, "ledger.html"), renderLedger(ledger));
  say(`Done. Providers ${usdc(t.provider)}, protocol fee ${usdc(t.fee)}, back to Grokbot ${usdc(t.refund)} of ${usdc(settings.total)} USDC. Ledger and files in ${settings.out}`);
  if (!made) process.exitCode = 1;
}

async function recover(budgetText) {
  if (!budgetText) throw new Error("Usage: node grokbot.mjs recover <budget address>");
  const payer = payerKey();
  const connection = await connect(settings.rpcUrl);
  const budget = new PublicKey(budgetText);
  const info = await connection.getAccountInfo(budget, "confirmed");
  if (!info) throw new Error("no such Budget");
  const chain = createBudgetChain({ connection, payer, spender: payer, programId: info.owner, log });
  const b = await chain.readBudget(budget);
  if (!b.payer.equals(payer.publicKey)) throw new Error("this Budget is not Grokbot's");
  if (!b.closed) log({ event: "closed", signature: await chain.close({ budget, createdSlot: b.createdSlot }) });
  for (const payee of b.allowlist) {
    const r = await chain.readReservation(budget, payee);
    if (r?.state === "posted") log({ event: "paid", payee: payee.toBase58(), ...(await chain.waiveAndPay({ budget, createdSlot: b.createdSlot, payee, waiver: payer })) });
    else log({ event: "slice", payee: payee.toBase58(), state: r?.state ?? "none" });
  }
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "plan") {
    const p = await planTeam(brain(), loadBrief(arg));
    say(`Plan only: nothing was signed or sent. Program ${p.programId.toBase58()}.`);
  } else if (command === "run") await run(arg);
  else if (command === "recover") await recover(arg);
  else {
    console.error("Usage: node grokbot.mjs plan|run [brief.md] | recover <budget>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
}
