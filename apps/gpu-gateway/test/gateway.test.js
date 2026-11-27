import { test } from "node:test";
import assert from "node:assert/strict";
import { Gateway } from "../src/gateway.js";
import { signDeskRequest, signLink } from "../src/auth.js";

const BUDGET = "CcSH3XrYivZhbeGnEWx498dWa6A4fUNPwEsUyJotBWCy";
const OTHER_BUDGET = "9Zv4HWNRt5WzSjBkbmJnGPtAT7vrcG8NxTzcd2iGF576";
const RUNNER = "r".repeat(40);
const SECRETS = { script: "s".repeat(40), voice: "v".repeat(40), video: "w".repeat(40), stitch: "x".repeat(40) };

class FakeStore {
  constructor() {
    this.map = new Map();
  }
  async get(k) {
    return structuredClone(this.map.get(k));
  }
  async put(k, v) {
    this.map.set(k, structuredClone(v));
  }
  async delete(k) {
    this.map.delete(k);
  }
  async list({ prefix }) {
    return new Map([...this.map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]));
  }
}

class FakeKV {
  constructor() {
    this.map = new Map();
  }
  async put(k, v, opts) {
    this.map.set(k, { v: new Uint8Array(v), opts });
  }
  async get(k) {
    const e = this.map.get(k);
    return e ? new Blob([e.v]).stream() : null;
  }
}

function setup(envOver = {}) {
  let clock = Date.parse("2026-11-28T00:00:00Z");
  const env = {
    RUNNER_TOKEN: RUNNER,
    LINK_SECRET: "l".repeat(40),
    ...Object.fromEntries(Object.entries(SECRETS).map(([d, s]) => [`DESK_SECRET_${d.toUpperCase()}`, s])),
    ...envOver,
  };
  const files = new FakeKV();
  const gw = new Gateway(new FakeStore(), files, env, () => clock);
  const advance = (ms) => (clock += ms);
  const now = () => clock;

  async function desk(name, method, path, body, { secret = SECRETS[name], tsOffset = 0, reuse } = {}) {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const timestamp = String(Math.floor(clock / 1000) + tsOffset);
    const nonce = reuse?.nonce ?? crypto.randomUUID().replace(/-/g, "");
    const sig = reuse?.sig ?? (await signDeskRequest(secret, { method, path, body: raw, timestamp, nonce }));
    const req = new Request(`https://gw.example${path}`, {
      method,
      body: method === "GET" ? undefined : raw,
      headers: { "x-rap-desk": name, "x-rap-timestamp": timestamp, "x-rap-nonce": nonce, "x-rap-signature": sig, "content-type": "application/json" },
    });
    const res = await gw.handle(req);
    const type = res.headers.get("content-type") || "";
    return { status: res.status, body: type.includes("json") ? await res.json() : await res.arrayBuffer(), sig, nonce, res };
  }

  async function runner(method, path, body, { token = RUNNER, type = "application/json" } = {}) {
    const init = { method, headers: { authorization: `Bearer ${token}`, "content-type": type } };
    if (body !== undefined) init.body = body instanceof Uint8Array ? body : JSON.stringify(body);
    const res = await gw.handle(new Request(`https://gw.example${path}`, init));
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  }

  /** Plays the rtwin1 runner: takes the next task, reports it, uploads files and reports ready. */
  async function runNext(files = { "out.png": "image/png" }, job = "20261128-000000-001") {
    const next = await runner("GET", "/v1/runner/next");
    if (next.status === 204) return null;
    const id = next.body.task;
    assert.equal((await runner("POST", `/v1/runner/tasks/${id}`, { rgpu_job: job, status: "queued" })).status, 200);
    for (const [name, type] of Object.entries(files)) {
      const up = await runner("PUT", `/v1/runner/tasks/${id}/files/${name}`, new Uint8Array([1, 2, 3, 4]), { type });
      assert.equal(up.status, 200, JSON.stringify(up.body));
    }
    const done = await runner("POST", `/v1/runner/tasks/${id}`, { rgpu_job: job, status: "ready", outputs: Object.keys(files) });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    return next.body;
  }

  return { gw, env, files, desk, runner, runNext, advance, now };
}

const scriptJob = { budget: BUDGET, job: { kind: "text", prompt: "Write a 20 second script about agents paying agents." } };

test("health is public and says only whether the gateway is paused", async () => {
  const { gw } = setup();
  const res = await gw.handle(new Request("https://gw.example/health"));
  assert.deepEqual(await res.json(), { ok: true, paused: false, runner_online: false });
});

test("health shows the runner online for a minute after it last polled", async () => {
  const { gw, runner, advance } = setup();
  await runner("GET", "/v1/runner/next");
  assert.equal((await (await gw.handle(new Request("https://gw.example/health"))).json()).runner_online, true);
  advance(61_000);
  assert.equal((await (await gw.handle(new Request("https://gw.example/health"))).json()).runner_online, false);
});

test("without a link secret no links are made or honoured", async () => {
  const { gw } = setup({ LINK_SECRET: "" });
  const res = await gw.handle(new Request("https://gw.example/f/t_aaaaaaaaaaaaaaaaaaaa/a.mp4?e=9999999999&s=" + "0".repeat(64)));
  assert.equal(res.status, 503);
});

test("desk calls need a valid signature from a known desk", async () => {
  const { desk } = setup();
  assert.equal((await desk("script", "POST", "/v1/tasks", scriptJob)).status, 201);
  assert.equal((await desk("script", "POST", "/v1/tasks", scriptJob, { secret: "z".repeat(40) })).status, 401);
  assert.equal((await desk("nobody", "POST", "/v1/tasks", scriptJob, { secret: "z".repeat(40) })).status, 401);
  assert.equal((await desk("script", "POST", "/v1/tasks", scriptJob, { tsOffset: -120 })).status, 401);
  assert.equal((await desk("script", "POST", "/v1/tasks", scriptJob, { secret: SECRETS.voice })).status, 401);
});

test("a desk with no secret configured, or a short one, is refused", async () => {
  const { desk } = setup({ DESK_SECRET_SCRIPT: "short" });
  assert.equal((await desk("script", "POST", "/v1/tasks", scriptJob, { secret: "short" })).status, 401);
});

test("a signed request cannot be replayed", async () => {
  const { desk } = setup();
  const first = await desk("script", "POST", "/v1/tasks", scriptJob);
  assert.equal(first.status, 201);
  assert.equal((await desk("script", "POST", "/v1/tasks", scriptJob, { reuse: { sig: first.sig, nonce: first.nonce } })).status, 401);
});

test("a tampered body fails the signature", async () => {
  const { gw } = setup();
  const timestamp = String(Math.floor(Date.parse("2026-11-28T00:00:00Z") / 1000));
  const nonce = "n".repeat(20);
  const sig = await signDeskRequest(SECRETS.script, { method: "POST", path: "/v1/tasks", body: JSON.stringify(scriptJob), timestamp, nonce });
  const res = await gw.handle(
    new Request("https://gw.example/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ ...scriptJob, job: { ...scriptJob.job, prompt: "something else" } }),
      headers: { "x-rap-desk": "script", "x-rap-timestamp": timestamp, "x-rap-nonce": nonce, "x-rap-signature": sig },
    }),
  );
  assert.equal(res.status, 401);
});

test("each desk may only run its own kind of job, with fixed models", async () => {
  const { desk, gw } = setup();
  assert.equal((await desk("script", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "video", prompt: "x" } })).status, 400);
  assert.equal((await desk("voice", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "text", prompt: "x" } })).status, 400);
  const withModel = await desk("script", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "text", prompt: "x", model: "huge:400b" } });
  assert.equal(withModel.status, 400);
  assert.match(withModel.body.error, /model/);
  const ok = await desk("video", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "image", prompt: "a calm office", params: { seed: 7 } } });
  assert.equal(ok.status, 201);
  const stored = await gw.getTask(ok.body.task);
  assert.deepEqual(stored.job, { kind: "image", model: "z-image-turbo", prompt: "a calm office", params: { width: 832, height: 480, seed: 7 } });
  const big = await desk("video", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "image", prompt: "x", params: { width: 4096 } } });
  assert.equal(big.status, 400);
});

test("prompts and params have limits", async () => {
  const { desk } = setup();
  assert.equal((await desk("script", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "text", prompt: "x".repeat(4001) } })).status, 400);
  assert.equal((await desk("voice", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "speech", prompt: "hi", params: { speed: 5 } } })).status, 400);
  assert.equal((await desk("script", "POST", "/v1/tasks", { budget: "not-a-budget", job: scriptJob.job })).status, 400);
  assert.equal((await desk("script", "POST", "/v1/tasks", { ...scriptJob, extra: 1 })).status, 400);
});

test("one active task per desk per Budget (video may hold five)", async () => {
  const { desk } = setup();
  assert.equal((await desk("script", "POST", "/v1/tasks", scriptJob)).status, 201);
  assert.equal((await desk("script", "POST", "/v1/tasks", scriptJob)).status, 429);
  assert.equal((await desk("script", "POST", "/v1/tasks", { ...scriptJob, budget: OTHER_BUDGET })).status, 201);
});

test("the runner needs its token, and plays the whole chain: still, clip, voice, stitch", async () => {
  const { desk, runner, runNext, gw } = setup();
  assert.equal((await runner("GET", "/v1/runner/next", undefined, { token: "wrong" })).status, 401);

  const still = (await desk("video", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "image", prompt: "office water cooler" } })).body;
  const clip = await desk("video", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "video", prompt: "slow push in", image_from: { task: still.task, file: "out.png" } } });
  assert.equal(clip.status, 201);
  const voice = (await desk("voice", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "speech", prompt: "Agents hire agents.", params: { voice: "af_bella" } } })).body;

  // The clip waits for its still, then runs before the later voice task.
  assert.equal((await runner("GET", "/v1/runner/next")).status, 200);
  await runner("POST", `/v1/runner/tasks/${still.task}`, { rgpu_job: "20261128-000000-001", status: "running" });
  assert.equal((await runner("GET", "/v1/runner/next")).body.task, voice.task, "the clip cannot run before its still is ready");
  await runner("POST", `/v1/runner/tasks/${voice.task}`, { rgpu_job: "20261128-000000-002", status: "queued" });
  await runner("PUT", `/v1/runner/tasks/${voice.task}/files/voice.wav`, new Uint8Array([7]), { type: "audio/wav" });
  await runner("POST", `/v1/runner/tasks/${voice.task}`, { rgpu_job: "20261128-000000-002", status: "ready", outputs: ["voice.wav"] });
  await runner("PUT", `/v1/runner/tasks/${still.task}/files/out.png`, new Uint8Array([5]), { type: "image/png" });
  await runner("POST", `/v1/runner/tasks/${still.task}`, { rgpu_job: "20261128-000000-001", status: "ready", outputs: ["out.png"] });
  const third = await runner("GET", "/v1/runner/next");
  assert.equal(third.body.task, clip.body.task);
  assert.deepEqual(third.body.job.image_from, { job: "20261128-000000-001", file: "out.png" }, "task refs become rgpu job ids");
  await runner("POST", `/v1/runner/tasks/${third.body.task}`, { rgpu_job: "20261128-000000-003", status: "running", stage: "sampling", progress: 0.5 });
  assert.equal((await runner("GET", "/v1/runner/next")).status, 204, "a claimed task is never handed out twice");
  await runner("PUT", `/v1/runner/tasks/${third.body.task}/files/clip.mp4`, new Uint8Array([9, 9]), { type: "video/mp4" });
  await runner("POST", `/v1/runner/tasks/${third.body.task}`, { rgpu_job: "20261128-000000-003", status: "ready", outputs: ["clip.mp4"] });

  const stitch = await desk("stitch", "POST", "/v1/tasks", {
    budget: BUDGET,
    job: { kind: "stitch", params: { clips: [{ task: clip.body.task, file: "clip.mp4" }], audio: { task: voice.task, file: "voice.wav" } } },
  });
  assert.equal(stitch.status, 201, JSON.stringify(stitch.body));
  const s = await runner("GET", "/v1/runner/next");
  assert.deepEqual(s.body.job.params.clips, [{ job: "20261128-000000-003", file: "clip.mp4" }]);
  assert.deepEqual(s.body.job.params.audio, { job: "20261128-000000-002", file: "voice.wav" });
  assert.equal(s.body.job.params.width, 832);

  const view = await desk("video", "GET", `/v1/tasks/${clip.body.task}`);
  assert.equal(view.body.status, "ready");
  assert.equal(view.body.files["clip.mp4"].size, 2);
  assert.match(view.body.files["clip.mp4"].sha256, /^[0-9a-f]{64}$/);
  assert.ok((await gw.getTask(clip.body.task)).files["clip.mp4"].hosted_until);
});

test("references must be tasks in the same Budget that have not failed", async () => {
  const { desk, runner } = setup();
  const voice = (await desk("voice", "POST", "/v1/tasks", { budget: OTHER_BUDGET, job: { kind: "speech", prompt: "hi" } })).body;
  const cross = await desk("stitch", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "stitch", params: { clips: [{ task: voice.task, file: "a.mp4" }] } } });
  assert.equal(cross.status, 404);
  const urlRef = await desk("stitch", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "stitch", params: { clips: [{ task: "https://evil.example/a.mp4", file: "a.mp4" }] } } });
  assert.equal(urlRef.status, 400);
  const next = await runner("GET", "/v1/runner/next");
  await runner("POST", `/v1/runner/tasks/${next.body.task}`, { status: "failed", error: "boom" });
  const afterFail = await desk("stitch", "POST", "/v1/tasks", { budget: OTHER_BUDGET, job: { kind: "stitch", params: { clips: [{ task: voice.task, file: "a.mp4" }] } } });
  assert.equal(afterFail.status, 409);
});

test("a dependent task fails when its input fails", async () => {
  const { desk, runner, gw } = setup();
  const still = (await desk("video", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "image", prompt: "x" } })).body;
  const clip = (await desk("video", "POST", "/v1/tasks", { budget: BUDGET, job: { kind: "video", prompt: "y", image_from: { task: still.task, file: "a.png" } } })).body;
  const next = await runner("GET", "/v1/runner/next");
  await runner("POST", `/v1/runner/tasks/${next.body.task}`, { status: "refused", error: "no" });
  assert.equal((await runner("GET", "/v1/runner/next")).status, 204);
  assert.equal((await gw.getTask(clip.task)).status, "failed");
});

test("ready needs its files uploaded first; uploads have limits", async () => {
  const { desk, runner } = setup();
  await desk("script", "POST", "/v1/tasks", scriptJob);
  const next = await runner("GET", "/v1/runner/next");
  const id = next.body.task;
  assert.equal((await runner("POST", `/v1/runner/tasks/${id}`, { rgpu_job: "20261128-000000-009", status: "ready", outputs: ["a.md"] })).status, 409);
  assert.equal((await runner("PUT", `/v1/runner/tasks/${id}/files/..%2Fx`, new Uint8Array([1]))).status, 400);
  assert.equal((await runner("PUT", `/v1/runner/tasks/${id}/files/empty.md`, new Uint8Array([]))).status, 413);
  assert.equal((await runner("POST", `/v1/runner/tasks/${id}`, { rgpu_job: "../../x", status: "running" })).status, 400);
});

test("files reach the owning desk and signed links; nobody else", async () => {
  const { desk, runNext, gw, env, advance } = setup();
  const task = (await desk("script", "POST", "/v1/tasks", scriptJob)).body.task;
  await runNext({ "script.md": "text/markdown; charset=utf-8" });
  const own = await desk("script", "GET", `/v1/tasks/${task}/files/script.md`);
  assert.equal(own.status, 200);
  assert.deepEqual([...new Uint8Array(own.body)], [1, 2, 3, 4]);
  assert.equal((await desk("voice", "GET", `/v1/tasks/${task}/files/script.md`)).status, 404);
  assert.equal((await desk("voice", "GET", `/v1/tasks/${task}`)).status, 404);

  const link = await desk("script", "POST", `/v1/tasks/${task}/link`, { file: "script.md", ttl_s: 3600 });
  assert.equal(link.status, 200);
  const res = await gw.handle(new Request(`https://gw.example${link.body.path}`));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("x-content-sha256"), /^[0-9a-f]{64}$/);
  const forged = await gw.handle(new Request(`https://gw.example${link.body.path.replace(/s=[0-9a-f]+/, "s=" + "0".repeat(64))}`));
  assert.equal(forged.status, 403);
  const other = await signLink("wrong".repeat(10), task, "script.md", Math.floor(Date.now() / 1e3) + 99999);
  assert.equal((await gw.handle(new Request(`https://gw.example${other}`))).status, 403);
  advance(3601 * 1000);
  assert.equal((await gw.handle(new Request(`https://gw.example${link.body.path}`))).status, 403, "links expire");
  assert.ok(env.LINK_SECRET);
});

test("files are kept for 7 days in KV", async () => {
  const { desk, runNext, files } = setup();
  await desk("script", "POST", "/v1/tasks", scriptJob);
  await runNext({ "script.md": "text/markdown; charset=utf-8" });
  const [entry] = files.map.values();
  assert.equal(entry.opts.expirationTtl, 7 * 24 * 3600);
});

test("pause stops new tasks and hands nothing to the runner", async () => {
  const { desk, runner } = setup({ GATEWAY_PAUSED: "true" });
  assert.equal((await desk("script", "POST", "/v1/tasks", scriptJob)).status, 503);
  assert.equal((await runner("GET", "/v1/runner/next")).status, 204);
});

test("the GPU queue and the daily GPU minutes are capped", async () => {
  const { desk } = setup({ MAX_QUEUED_GPU_TASKS: "2", DAILY_GPU_MINUTES: "100" });
  const budgets = [BUDGET, OTHER_BUDGET, "J5zeR6m9ZSdyjqPeS7QNFkqvpLQRPMqKfwCWX43W5kdt"];
  assert.equal((await desk("script", "POST", "/v1/tasks", { ...scriptJob, budget: budgets[0] })).status, 201);
  assert.equal((await desk("script", "POST", "/v1/tasks", { ...scriptJob, budget: budgets[1] })).status, 201);
  assert.equal((await desk("script", "POST", "/v1/tasks", { ...scriptJob, budget: budgets[2] })).status, 503);
  // CPU jobs (voice) do not count toward the GPU queue.
  assert.equal((await desk("voice", "POST", "/v1/tasks", { budget: budgets[2], job: { kind: "speech", prompt: "hi" } })).status, 201);

  const { desk: desk2 } = setup({ DAILY_GPU_MINUTES: "1" });
  assert.equal((await desk2("script", "POST", "/v1/tasks", scriptJob)).status, 201);
  assert.equal((await desk2("script", "POST", "/v1/tasks", { ...scriptJob, budget: OTHER_BUDGET })).status, 503);
});

test("each desk is rate limited per minute", async () => {
  const { desk, advance } = setup({ DESK_REQUESTS_PER_MINUTE: "3" });
  const task = (await desk("script", "POST", "/v1/tasks", scriptJob)).body.task;
  assert.equal((await desk("script", "GET", `/v1/tasks/${task}`)).status, 200);
  assert.equal((await desk("script", "GET", `/v1/tasks/${task}`)).status, 200);
  assert.equal((await desk("script", "GET", `/v1/tasks/${task}`)).status, 429);
  advance(60_000);
  assert.equal((await desk("script", "GET", `/v1/tasks/${task}`)).status, 200);
});

test("a task the runner claimed but never reported is handed out again after 15 minutes", async () => {
  const { desk, runner, advance } = setup();
  const task = (await desk("script", "POST", "/v1/tasks", scriptJob)).body.task;
  assert.equal((await runner("GET", "/v1/runner/next")).body.task, task);
  assert.equal((await runner("GET", "/v1/runner/next")).status, 204);
  advance(16 * 60_000);
  assert.equal((await runner("GET", "/v1/runner/next")).body.task, task);
});

test("an oversized desk body is refused before it is read", async () => {
  const { gw } = setup();
  const res = await gw.handle(new Request("https://gw.example/v1/tasks", { method: "POST", body: "x", headers: { "content-length": String(1 << 20) } }));
  assert.equal(res.status, 413);
});
