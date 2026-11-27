import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { firstJson, chooseTeam } from "../src/brain.mjs";
import { candidatesFrom, checkOffer, DEVNET_GENESIS, DEVNET_USDC } from "../src/discover.mjs";
import { createDesk } from "../src/desk.mjs";
import { renderLedger, splitPayout, totals } from "../src/ledger.mjs";
import { callCost, planSlices, sliceFor, usdc } from "../src/plan.mjs";
import { parseScript } from "../src/script.mjs";

const JUDGE = "9Zv4HWNRt5WzSjBkbmJnGPtAT7vrcG8NxTzcd2iGF576";
const M = 1_000_000n;
// The studio's listed prices in base units per million output tokens (USDC has 6 decimals).
const PRICES = { script: 400n * M, voice: 20n * M, video: 100n * M, stitch: 20n * M };

test("costs and slices come from the listed prices and fit a 5 USDC Budget", () => {
  assert.equal(callCost(1000, 400n * M), 400_000n); // 1000 script tokens = 0.40
  assert.equal(callCost(5_100, 100n * M), 510_000n); // a 5.1 s clip = 0.51
  assert.equal(callCost(1, 20n * M), 20n);
  const { slices, sum } = planSlices(PRICES, 5n * M);
  assert.ok(sum <= 5n * M);
  for (const s of Object.values(slices)) assert.ok(s <= 2_500_000n && s >= 50_000n);
  assert.equal(usdc(slices.video), "1.5703"); // three 0.51 clips, 0.0003 of frames, 0.02 of status calls, 0.02 margin
  assert.throws(() => planSlices({ ...PRICES, video: 1000n * M }, 5n * M), /per-provider cap/);
  assert.equal(sliceFor("script", 1n, 5n * M), 50_000n, "never below the program's 1% floor");
});

test("usdc formats base units", () => {
  assert.equal(usdc(400_000n), "0.40");
  assert.equal(usdc(5_000_000n), "5.00");
  assert.equal(usdc(1_234_567n), "1.234567");
  assert.equal(usdc(-20_000n), "-0.02");
});

const SCRIPT = `TITLE: Agents that pay their way
**VOICEOVER:** One Budget. Four agents. A script, a voice, the pictures and the cut, each paid for exactly what it delivered, the moment the work is in. That is Reddi Agent Protocol on Solana: agents hiring agents, with a receipt for every call.
SHOT 1 IMAGE: A dark field of soft light points.
SHOT 1 MOTION: The camera drifts forward as points connect.
SHOT 2 IMAGE: Four glowing shapes around a bright core.
SHOT 2 MOTION: The shapes orbit and pass light between them.
SHOT 3 IMAGE: A calm horizon of light at dawn.
SHOT 3 MOTION: Slow push in as the light brightens.`;

test("the script parser reads the format, bold labels included, and names what is missing", () => {
  const s = parseScript(SCRIPT);
  assert.equal(s.title, "Agents that pay their way");
  assert.match(s.voiceover, /^One Budget/);
  assert.equal(s.shots.length, 3);
  assert.match(s.shots[2].motion, /push in/);
  assert.throws(() => parseScript("TITLE: x\nVOICEOVER: y"), /SHOT 1 IMAGE/);
});

test("firstJson finds the JSON in a model answer", () => {
  assert.deepEqual(firstJson('<think>{"no": 1}</think>Sure: ```json\n{"a": "}", "b": {"c": 2}}\n```'), { a: "}", b: { c: 2 } });
  assert.throws(() => firstJson("no json"), /no JSON/);
});

const listing = (name, wallet, taskTypes, price, extra = {}) => ({ displayName: name, wallet, endpointUrl: `https://studio.example/${name}`, status: "listed", priceMint: DEVNET_USDC, priceOutputPerMillionBaseUnits: String(price), capabilities: { taskTypes }, healthStatus: "pass", ...extra });
const W = Array.from({ length: 6 }, () => Keypair.generate().publicKey.toBase58());
const LISTINGS = [
  listing("script", W[0], ["writing", "scriptwriting"], PRICES.script),
  listing("voice", W[1], ["audio", "voiceover"], PRICES.voice),
  listing("video", W[2], ["video", "animation"], PRICES.video),
  listing("stitch", W[3], ["video", "editing"], PRICES.stitch),
  listing("cheap-but-down", W[4], ["voiceover"], 1n, { healthStatus: "fail" }),
  listing("sol-priced", W[5], ["editing"], 1n, { priceMint: "SOL" }),
];

test("candidates are filtered by role, devnet USDC and https, healthy first", () => {
  const c = candidatesFrom(LISTINGS);
  assert.deepEqual(c.voice.map((l) => l.displayName), ["voice", "cheap-but-down"]);
  assert.deepEqual(c.stitch.map((l) => l.displayName), ["stitch"]);
  assert.throws(() => candidatesFrom(LISTINGS.slice(0, 3)), /editing/);
});

test("the brain's picks must be listed candidates", async () => {
  const c = candidatesFrom(LISTINGS);
  const fake = (answer) => ({ json: async () => answer });
  const { team } = await chooseTeam(fake({ script: W[0], voice: W[1], video: W[2], stitch: W[3], why: "healthy and cheapest" }), "brief", c);
  assert.equal(team.voice.displayName, "voice");
  await assert.rejects(chooseTeam(fake({ script: W[0], voice: W[5], video: W[2], stitch: W[3] }), "brief", c), /not a listed candidate/);
});

test("an offer must be a devnet USDC Budget offer paying the listed wallet with the RAP judge", () => {
  const l = LISTINGS[0];
  const good = { budget: { scheme: "budget", network: DEVNET_GENESIS, mint: DEVNET_USDC, payee: l.wallet, acceptedJudges: [JUDGE] } };
  assert.equal(checkOffer(l, good, JUDGE).outputPerMillion, PRICES.script);
  for (const [change, why] of [[{ payee: W[1] }, /listed wallet/], [{ mint: "So11111111111111111111111111111111111111112" }, /devnet USDC/], [{ acceptedJudges: [] }, /judge/], [{ network: "x" }, /devnet/], [{ scheme: "x" }, /no Budgets/]]) {
    assert.throws(() => checkOffer(l, { budget: { ...good.budget, ...change } }, JUDGE), why);
  }
});

test("a desk reserves its planned slice once, retries busy answers on the same call number, and checks receipts", async () => {
  const spender = Keypair.generate();
  const budget = Keypair.generate().publicKey;
  const l = LISTINGS[1];
  const seen = [];
  let n = 0;
  const offer = { scheme: "budget", programId: Keypair.generate().publicKey.toBase58(), payee: l.wallet, payoutAccount: Keypair.generate().publicKey.toBase58(), minReservation: "50000", reservation: "100000" };
  const receipt = (b) => Buffer.from(JSON.stringify({ receipt: { budget: { address: budget.toBase58() } }, body: b })).toString("base64url");
  const fetchImpl = async (_url, init) => {
    n += 1;
    const header = JSON.parse(Buffer.from(init.headers["x402-budget"], "base64").toString());
    seen.push({ sequence: header.sequence, reserve: Boolean(init.headers["x402-budget-reserve"]) });
    if (n === 1) return Response.json({ error: { code: "budget_reservation_required" }, budget: offer }, { status: 402 });
    if (n === 2) return new Response("busy", { status: 409, headers: { "retry-after": "1" } });
    const content = JSON.stringify({ task: "t_abcdefghijklmnop1234", kind: "speech", status: "queued" });
    const text = JSON.stringify({ choices: [{ message: { content } }], reddi: { metered: { outputTokens: 0, budget: { cost: "0" } } } });
    return new Response(text, { status: 200, headers: { "x-reddi-provider-receipt": receipt(text) } });
  };
  const desk = createDesk({ role: "voice", listing: l, budget, createdSlot: 7n, spender, slice: 700_000n, blockhash: async () => Keypair.generate().publicKey.toBase58(), fetchImpl, wait: async () => {}, verifyReceipt: () => ({ ok: true }) });
  assert.equal(await desk.start({ kind: "speech", prompt: "hi" }), "t_abcdefghijklmnop1234");
  // Asked for a reserve, sent it, got "busy", sent the same call number again.
  assert.deepEqual(seen, [{ sequence: 1, reserve: false }, { sequence: 1, reserve: true }, { sequence: 1, reserve: false }]);
  assert.equal(desk.calls.length, 1);

  const bad = createDesk({ role: "voice", listing: l, budget, createdSlot: 7n, spender, slice: 10_000n, blockhash: async () => Keypair.generate().publicKey.toBase58(), fetchImpl: async () => Response.json({ error: { code: "budget_reservation_required" }, budget: offer }, { status: 402 }), wait: async () => {}, verifyReceipt: () => ({ ok: true }) });
  await assert.rejects(bad.start({}), /above its planned slice/);
  const other = createDesk({ role: "voice", listing: l, budget, createdSlot: 7n, spender, slice: 700_000n, blockhash: async () => Keypair.generate().publicKey.toBase58(), fetchImpl: async () => Response.json({ error: { code: "budget_reservation_required" }, budget: { ...offer, payee: W[0] } }, { status: 402 }), wait: async () => {}, verifyReceipt: () => ({ ok: true }) });
  await assert.rejects(other.start({}), /another wallet/);
  const forged = createDesk({ role: "voice", listing: l, budget, createdSlot: 7n, spender, slice: 700_000n, blockhash: async () => "", fetchImpl: async () => new Response("{}", { status: 200, headers: { "x-reddi-provider-receipt": receipt("{}") } }), wait: async () => {}, verifyReceipt: () => ({ ok: false, errors: ["bad"] }) });
  await assert.rejects(forged.start({}), /did not verify/);
});

test("payouts split into provider, fee and refund from the chain's balance changes, and the page escapes text", () => {
  const moves = { P: { delta: 390_000n }, T: { delta: 10_000n }, R: { delta: 300_000n } };
  assert.deepEqual(splitPayout(moves, { payoutAccount: "P", treasuryTokens: "T", payerTokens: "R" }), { provider: 390_000n, fee: 10_000n, refund: 300_000n });
  const ledger = {
    brief: "<script>alert(1)</script>",
    brain: "qwen3",
    why: "",
    budget: W[0],
    total: "5000000",
    open: { signature: "o" },
    close: { signature: "c", refund: "1000000" },
    payouts: [{ role: "voice", name: "RAP Studio Voice", wallet: W[1], reserved: "700000", posted: "400000", provider: "390000", fee: "10000", refund: "300000", signature: "s" }],
    calls: [{ role: "voice", sequence: 1, action: "collect", task: "t_x", cost: "400000" }],
    files: [{ role: "voice", name: "speech.wav", url: "https://x/f", size: 2048, sha256: "a".repeat(64), verified: true }],
    script: { title: "T", voiceover: "V" },
    finishedAt: "now",
  };
  const t = totals(ledger);
  assert.equal(t.spent, 400_000n);
  assert.equal(t.refund, 1_300_000n);
  const html = renderLedger(ledger);
  assert.ok(!html.includes("<script>alert"));
  assert.match(html, /RAP Studio Voice/);
  assert.match(html, /cluster=devnet/);
});

test("listings are read from the app's devnet listing API", async () => {
  const { listCandidates } = await import("../src/discover.mjs");
  const fetchImpl = async (url) => {
    assert.equal(url, "https://app.example/api/listings");
    return Response.json({ ok: true, network: "solana-devnet", listings: LISTINGS });
  };
  assert.equal((await listCandidates("https://app.example/", fetchImpl)).script[0].displayName, "script");
  await assert.rejects(listCandidates("https://app.example", async () => Response.json({ ok: true, network: "solana-mainnet-beta", listings: LISTINGS })), /devnet/);
});
