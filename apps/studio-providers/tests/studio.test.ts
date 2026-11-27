import assert from "node:assert/strict";
import { createHmac, createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { UpstreamError, type PgPool } from "@redditech/provider-kit";
import { createGatewayClient, signRequest, type GatewayClient, type GatewayTask } from "../lib/gateway-client.ts";
import { mp4Seconds, wavSeconds } from "../lib/media.ts";
import { createStudioUpstream, type Desk } from "../lib/studio-upstream.ts";
import { DESKS, isDesk, loadDesk } from "../lib/desks.ts";

// ---- media fixtures ----

function wav(seconds: number, rate = 24_000): Uint8Array {
  const data = Math.round(seconds * rate) * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode("RIFF"), 0);
  v.setUint32(4, 36 + data, true);
  out.set(new TextEncoder().encode("WAVEfmt "), 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  out.set(new TextEncoder().encode("data"), 36);
  v.setUint32(40, data, true);
  return out;
}

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}

function mp4(seconds: number, version: 0 | 1 = 0, timescale = 1000): Uint8Array {
  const body = new Uint8Array(version === 1 ? 108 : 96);
  const v = new DataView(body.buffer);
  body[0] = version;
  if (version === 1) {
    v.setUint32(20, timescale);
    v.setBigUint64(24, BigInt(Math.round(seconds * timescale)));
  } else {
    v.setUint32(12, timescale);
    v.setUint32(16, Math.round(seconds * timescale));
  }
  const ftyp = box("ftyp", new TextEncoder().encode("isom0000"));
  const moov = box("moov", box("mvhd", body));
  const mdat = box("mdat", new Uint8Array(32));
  return Uint8Array.from([...ftyp, ...mdat, ...moov]);
}

test("wavSeconds reads the data size over the byte rate", () => {
  assert.equal(wavSeconds(wav(2.5)), 2.5);
  assert.throws(() => wavSeconds(new Uint8Array(20)), /not a WAV/);
});

test("mp4Seconds reads mvhd in either version, wherever moov sits", () => {
  assert.equal(mp4Seconds(mp4(5.0625, 0, 16_000)), 5.0625);
  assert.equal(mp4Seconds(mp4(15.25, 1, 16_000)), 15.25);
  assert.throws(() => mp4Seconds(box("ftyp", new Uint8Array(8))), /no moov/);
});

// ---- a fake gateway ----

const TASK = "t_abcdefghijklmnop1234";

function fakeGateway(task: Partial<GatewayTask>, bytes: Record<string, Uint8Array>) {
  const calls: string[] = [];
  let collected = false;
  const full: GatewayTask = { task: TASK, desk: "voice", budget: "B", kind: "speech", status: "ready", stage: "", progress: null, eta_s: null, error: "", files: {}, ...task };
  const gateway: GatewayClient = {
    async createTask(budget, job) {
      calls.push(`create ${budget} ${JSON.stringify(job)}`);
      return { ...full, status: "queued" };
    },
    async getTask(id) {
      calls.push(`get ${id}`);
      return full;
    },
    async link(id, file) {
      return { url: `https://gw.example/f/${id}/${file}?e=1&s=x`, expires: 2_000_000_000 };
    },
    async fileBytes(_id, file) {
      return bytes[file] ?? new Uint8Array();
    },
    async markCollected() {
      const first = !collected;
      collected = true;
      return first;
    },
  };
  return { gateway, calls };
}

const ask = (content: unknown, max_tokens = 100_000) => ({ model: "m", max_tokens, messages: [{ role: "user", content: typeof content === "string" ? content : JSON.stringify(content) }] });
const answer = (r: Record<string, unknown>) => {
  const choice = (r.choices as { message: { content: string } }[])[0];
  return { body: JSON.parse(choice.message.content), tokens: (r.usage as { completion_tokens: number }).completion_tokens };
};

function upstream(desk: Desk, task: Partial<GatewayTask>, bytes: Record<string, Uint8Array> = {}) {
  const fake = fakeGateway(task, bytes);
  return { up: createStudioUpstream(desk, fake.gateway, { markCollected: fake.gateway.markCollected }), calls: fake.calls };
}

test("start and status are free; start passes the Budget and job through", async () => {
  const { up, calls } = upstream("voice", {});
  const started = answer(await up.createChatCompletion(ask({ action: "start", budget: "BUDGET1", job: { kind: "speech", prompt: "hi" } })));
  assert.equal(started.tokens, 0);
  assert.equal(started.body.task, TASK);
  assert.match(calls[0], /^create BUDGET1 /);
  const status = answer(await up.createChatCompletion(ask({ action: "status", task: TASK })));
  assert.equal(status.tokens, 0);
});

test("collect bills a voice task by its milliseconds, once", async () => {
  const { up } = upstream("voice", { files: { "speech.wav": { size: 1, sha256: "a", type: "audio/wav", hosted_until: "x" } } }, { "speech.wav": wav(20.4) });
  const first = answer(await up.createChatCompletion(ask({ action: "collect", task: TASK })));
  assert.equal(first.tokens, 20_400);
  assert.equal(first.body.billed.units, 20_400);
  assert.match(first.body.files["speech.wav"].url, /^https:\/\/gw\.example\/f\//);
  const again = answer(await up.createChatCompletion(ask({ action: "collect", task: TASK })));
  assert.equal(again.tokens, 0);
  assert.match(again.body.billed.note, /not charged again/);
});

test("collect never bills more than the buyer's max_tokens", async () => {
  const { up } = upstream("video", { kind: "video", files: { "clip.mp4": { size: 1, sha256: "a", type: "video/mp4", hosted_until: "x" } } }, { "clip.mp4": mp4(5.0625, 0, 16_000) });
  assert.equal(answer(await up.createChatCompletion(ask({ action: "collect", task: TASK }, 3000))).tokens, 3000);
});

test("a start frame is free and a script is billed by characters / 4", async () => {
  const frame = upstream("video", { kind: "image", files: { "frame.png": { size: 1, sha256: "a", type: "image/png", hosted_until: "x" } } });
  assert.equal(answer(await frame.up.createChatCompletion(ask({ action: "collect", task: TASK }))).tokens, 0);
  const text = "x".repeat(1001);
  const script = upstream("script", { kind: "text", files: { "script.md": { size: 1, sha256: "a", type: "text/markdown", hosted_until: "x" } } }, { "script.md": new TextEncoder().encode(text) });
  const got = answer(await script.up.createChatCompletion(ask({ action: "collect", task: TASK })));
  assert.equal(got.tokens, 251);
  assert.equal(got.body.text, text);
});

test("collect before ready fails (so nothing is charged); bad input is a 400", async () => {
  const { up } = upstream("voice", { status: "running" });
  await assert.rejects(up.createChatCompletion(ask({ action: "collect", task: TASK })), (e: unknown) => e instanceof UpstreamError && /not ready/.test(e.message));
  for (const bad of ["not json", { action: "dance" }, { action: "status", task: "../x" }, { action: "start", job: {} }, [1]]) {
    await assert.rejects(up.createChatCompletion(ask(bad)), (e: unknown) => e instanceof UpstreamError);
  }
});

test("a gateway 429 on start becomes 503, so the kit does not cool the desk down", async () => {
  const fake = fakeGateway({}, {});
  fake.gateway.createTask = async () => {
    throw Object.assign(new Error("too many active tasks"), { status: 429 });
  };
  const up = createStudioUpstream("voice", fake.gateway, { markCollected: fake.gateway.markCollected });
  await assert.rejects(up.createChatCompletion(ask({ action: "start", budget: "B", job: {} })), (e: unknown) => e instanceof UpstreamError && e.status === 503);
});

// ---- the signed client ----

test("the client signs what the gateway checks", async () => {
  const secret = "s".repeat(40);
  let seen: { url: string; init: RequestInit } | undefined;
  const client = createGatewayClient({
    origin: "https://gw.example/",
    desk: "voice",
    secret,
    now: () => 1_800_000_000_000,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return Response.json({ first: true });
    },
  });
  assert.equal(await client.markCollected(TASK), true);
  assert.ok(seen);
  assert.equal(seen.url, `https://gw.example/v1/tasks/${TASK}/collected`);
  const h = seen.init.headers as Record<string, string>;
  const body = String(seen.init.body);
  const expected = createHmac("sha256", secret)
    .update(`1800000000\n${h["x-rap-nonce"]}\nPOST\n/v1/tasks/${TASK}/collected\n${createHash("sha256").update(body).digest("hex")}`)
    .digest("hex");
  assert.equal(h["x-rap-signature"], expected);
  assert.equal(h["x-rap-signature"], signRequest(secret, "post", `/v1/tasks/${TASK}/collected`, body, "1800000000", h["x-rap-nonce"]));
  assert.match(h["x-rap-nonce"], /^[A-Za-z0-9_-]{16,64}$/);
});

// ---- desk loading ----

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}
function wallet() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: base58(pub), keypair: JSON.stringify([...seed, ...pub]) };
}
const pool: PgPool = { query: async () => ({ rows: [] }), connect: async () => { throw new Error("not in this test"); } };

function env(desk: Desk, overrides: Record<string, string | undefined> = {}) {
  const prefix = DESKS[desk].prefix;
  const w = wallet();
  return {
    STUDIO_PUBLIC_ORIGIN: "https://studio.example",
    STUDIO_GATEWAY_URL: "https://gw.example",
    [`STUDIO_${prefix}_WALLET`]: w.address,
    [`STUDIO_${prefix}_KEYPAIR`]: w.keypair,
    [`STUDIO_DESK_SECRET_${prefix}`]: "k".repeat(40),
    ...overrides,
  };
}

test("each desk loads from its reviewed config and is served at /<desk>", () => {
  for (const name of Object.keys(DESKS) as Desk[]) {
    const loaded = loadDesk(name, env(name), () => pool);
    assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
    assert.equal(loaded.provider.config.publicUrl, `https://studio.example/${name}`);
    assert.ok(loaded.provider.config.budgets.enabled);
  }
  assert.ok(isDesk("stitch"));
  assert.ok(!isDesk("constructor"));
});

test("a desk that is not fully set up refuses to load", () => {
  const cases: [Record<string, string | undefined>, RegExp][] = [
    [{ STUDIO_PUBLIC_ORIGIN: "http://studio.example" }, /STUDIO_PUBLIC_ORIGIN/],
    [{ STUDIO_GATEWAY_URL: undefined }, /STUDIO_GATEWAY_URL/],
    [{ STUDIO_VOICE_WALLET: undefined }, /STUDIO_VOICE_WALLET/],
    [{ STUDIO_DESK_SECRET_VOICE: "short" }, /STUDIO_DESK_SECRET_VOICE/],
    [{ STUDIO_VOICE_KEYPAIR: wallet().keypair }, /./],
  ];
  for (const [overrides, why] of cases) {
    const loaded = loadDesk("voice", env("voice", overrides), () => pool);
    assert.ok(!loaded.ok);
    assert.match(loaded.message, why);
  }
  const noDb = loadDesk("voice", env("voice"), () => undefined);
  assert.ok(!noDb.ok && /PROVIDER_KIT_DATABASE_URL/.test(noDb.message));
});
