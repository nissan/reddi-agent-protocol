// The GPU gateway: the only public way to work on rtwin1. Studio desks (RAP providers on Vercel) queue
// signed tasks; the rgpu runner on rtwin1 polls for them over outbound HTTPS and uploads the files; desks
// and buyers fetch the files. rtwin1 itself accepts no connections.
//
// All state lives in one Durable Object (tasks, nonces, counters) so every check sees the same numbers.
// Files live in a KV namespace with a 7 day expiry (the hosting period in the studio quotes).

import { sameText, sha256hex, signLink, verifyDesk, verifyLink } from "./auth.js";
import { ACTIVE_PER_BUDGET, DESKS, GPU_MINUTES, PLAIN_FILE, Refused, TASK_ID, checkJob, resolveRefs } from "./templates.js";

export const FILE_TTL_S = 7 * 24 * 3600;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // the KV value limit
const MAX_FILES_PER_TASK = 4;
const MAX_BODY_BYTES = 64 * 1024;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const KEEP_TASK_MS = 8 * 24 * 3600 * 1000;
const BUDGET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACTIVE = new Set(["queued", "claimed", "running"]);
const DONE_BAD = new Set(["failed", "refused", "cancelled"]);
const RUNNER_STATUSES = new Set(["queued", "running", "ready", "failed", "refused", "cancelled"]);

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function limits(env) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    queue: n(env.MAX_QUEUED_GPU_TASKS, 6),
    dailyGpuMinutes: n(env.DAILY_GPU_MINUTES, 120),
    perDeskPerMinute: n(env.DESK_REQUESTS_PER_MINUTE, 30),
  };
}

function deskSecrets(env) {
  return Object.fromEntries(DESKS.map((d) => [d, env[`DESK_SECRET_${d.toUpperCase()}`] || ""]));
}

function newTaskId() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return "t_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What a desk sees of a task. */
function view(task) {
  return {
    task: task.id,
    desk: task.desk,
    budget: task.budget,
    kind: task.job.kind,
    status: task.status === "claimed" ? "queued" : task.status,
    stage: task.stage || "",
    progress: task.progress ?? null,
    eta_s: task.eta_s ?? null,
    error: task.error || "",
    files: task.status === "ready" ? task.files : {},
    created: task.created,
    finished: task.finished || null,
  };
}

export class Gateway {
  /**
   * store: { get, put, delete, list({prefix}) -> Map } (Durable Object storage). files: KV namespace.
   * env: secrets and settings. now: () => ms.
   */
  constructor(store, files, env, now = () => Date.now()) {
    this.store = store;
    this.files = files;
    this.env = env;
    this.now = now;
  }

  paused() {
    return String(this.env.GATEWAY_PAUSED || "").toLowerCase() === "true";
  }

  async tasks() {
    return [...(await this.store.list({ prefix: "task:" })).values()];
  }

  async getTask(id) {
    return TASK_ID.test(id) ? this.store.get(`task:${id}`) : undefined;
  }

  async save(task) {
    task.updated = new Date(this.now()).toISOString();
    await this.store.put(`task:${task.id}`, task);
  }

  // --- desks -------------------------------------------------------------------------------

  async useNonce(nonce) {
    const key = `nonce:${nonce}`;
    if (await this.store.get(key)) throw new Refused("replayed request", 401);
    await this.store.put(key, this.now() + 120_000);
  }

  async rateLimit(desk) {
    const minute = Math.floor(this.now() / 60_000);
    const key = `rate:${desk}:${minute}`;
    const count = ((await this.store.get(key)) || 0) + 1;
    await this.store.put(key, count);
    if (count > limits(this.env).perDeskPerMinute) throw new Refused("too many requests from this desk; try again in a minute", 429);
  }

  async createTask(desk, body) {
    if (this.paused()) throw new Refused("the studio gateway is paused", 503);
    if (!body || typeof body !== "object") throw new Refused("body must be an object");
    const extra = Object.keys(body).filter((k) => !["budget", "job"].includes(k));
    if (extra.length) throw new Refused(`not allowed: ${extra.join(", ")}`);
    if (typeof body.budget !== "string" || !BUDGET.test(body.budget)) throw new Refused("budget must be a Budget address");
    const { job, refs } = checkJob(desk, body.job, this.env);

    const all = await this.tasks();
    for (const ref of refs) {
      const source = all.find((t) => t.id === ref.task);
      if (!source || source.budget !== body.budget) throw new Refused(`no task ${ref.task} in this Budget`, 404);
      if (DONE_BAD.has(source.status)) throw new Refused(`task ${ref.task} did not finish: ${source.status}`, 409);
    }
    const active = all.filter((t) => ACTIVE.has(t.status));
    if (active.filter((t) => t.desk === desk && t.budget === body.budget).length >= ACTIVE_PER_BUDGET[desk]) {
      throw new Refused(`this desk already has ${ACTIVE_PER_BUDGET[desk]} task(s) running for this Budget`, 429);
    }
    const lim = limits(this.env);
    const gpu = GPU_MINUTES[job.kind];
    if (gpu > 0 && active.filter((t) => t.gpu_min > 0).length >= lim.queue) throw new Refused("the GPU queue is full; try again later", 503);
    const dayKey = `day:${new Date(this.now()).toISOString().slice(0, 10)}`;
    const used = (await this.store.get(dayKey)) || 0;
    if (used + gpu > lim.dailyGpuMinutes) throw new Refused("today's GPU time is used up; try again tomorrow (UTC)", 503);
    if (gpu > 0) await this.store.put(dayKey, used + gpu);

    const seq = ((await this.store.get("seq")) || 0) + 1;
    await this.store.put("seq", seq);
    const task = {
      id: newTaskId(),
      seq,
      desk,
      budget: body.budget,
      job,
      refs: refs.map((r) => r.task),
      gpu_min: gpu,
      status: "queued",
      files: {},
      created: new Date(this.now()).toISOString(),
    };
    await this.save(task);
    return view(task);
  }

  async ownTask(desk, id) {
    const task = await this.getTask(id);
    if (!task || task.desk !== desk) throw new Refused("no such task", 404);
    return task;
  }

  async cancel(desk, id) {
    const task = await this.ownTask(desk, id);
    if (task.status === "queued") {
      task.status = "cancelled";
      task.finished = new Date(this.now()).toISOString();
      await this.save(task);
    } else if (ACTIVE.has(task.status)) {
      task.cancel_requested = true; // the runner sees it in its next report's reply
      await this.save(task);
    }
    return view(task);
  }

  linkSecret() {
    const secret = this.env.LINK_SECRET || "";
    if (secret.length < 32) throw new Refused("download links are not set up", 503);
    return secret;
  }

  async link(desk, id, file, ttlS) {
    const secret = this.linkSecret();
    const task = await this.ownTask(desk, id);
    if (task.status !== "ready" || !task.files[file]) throw new Refused("no such file", 404);
    const ttl = Math.min(Math.max(Number(ttlS) || FILE_TTL_S, 60), FILE_TTL_S);
    const expires = Math.floor(this.now() / 1000) + ttl;
    return { path: await signLink(secret, id, file, expires), expires };
  }

  async fileResponse(task, file) {
    const meta = task.files[file];
    if (task.status !== "ready" || !meta) return json(404, { error: "no such file" });
    const stored = await this.files.get(`${task.id}/${file}`, { type: "stream" });
    if (!stored) return json(410, { error: "this file has expired" });
    return new Response(stored, {
      headers: {
        "content-type": meta.type,
        "content-length": String(meta.size),
        "cache-control": "private, max-age=3600",
        "x-content-sha256": meta.sha256,
        "content-disposition": `inline; filename="${file}"`,
        "x-content-type-options": "nosniff",
      },
    });
  }

  // --- runner ------------------------------------------------------------------------------

  async runnerNext() {
    if (this.paused()) return null;
    const all = (await this.tasks()).sort((a, b) => a.seq - b.seq);
    const byId = new Map(all.map((t) => [t.id, t]));
    const nowMs = this.now();
    for (const task of all) {
      if (task.status === "claimed" && !task.rgpu_job && nowMs - Date.parse(task.claimed_at) > CLAIM_TIMEOUT_MS) {
        task.status = "queued"; // the runner took it and never reported: hand it out again
        await this.save(task);
      }
      if (!ACTIVE.has(task.status) && nowMs - Date.parse(task.created) > KEEP_TASK_MS) {
        await this.store.delete(`task:${task.id}`);
        task.pruned = true;
      }
    }
    for (const task of all) {
      if (task.pruned || task.status !== "queued") continue;
      const sources = task.refs.map((id) => byId.get(id));
      const bad = sources.find((s) => !s || DONE_BAD.has(s.status));
      if (bad !== undefined) {
        task.status = "failed";
        task.error = "an input task did not finish";
        task.finished = new Date(nowMs).toISOString();
        await this.save(task);
        continue;
      }
      if (!sources.every((s) => s.status === "ready" && s.rgpu_job)) continue;
      task.status = "claimed";
      task.claimed_at = new Date(nowMs).toISOString();
      await this.save(task);
      return { task: task.id, job: resolveRefs(task.job, (id) => byId.get(id).rgpu_job) };
    }
    return null;
  }

  async runnerReport(id, state) {
    const task = await this.getTask(id);
    if (!task) throw new Refused("no such task", 404);
    if (!ACTIVE.has(task.status)) return { ok: true, cancel: false }; // late report for a finished task
    if (!state || !RUNNER_STATUSES.has(state.status)) throw new Refused("bad status");
    if (state.rgpu_job !== undefined) {
      if (typeof state.rgpu_job !== "string" || !/^\d{8}-\d{6}-\d{3}$/.test(state.rgpu_job)) throw new Refused("bad rgpu_job");
      if (task.rgpu_job && task.rgpu_job !== state.rgpu_job) throw new Refused("rgpu_job changed", 409);
      task.rgpu_job = state.rgpu_job;
    }
    task.stage = typeof state.stage === "string" ? state.stage.slice(0, 120) : "";
    task.progress = typeof state.progress === "number" ? Math.min(Math.max(state.progress, 0), 1) : null;
    task.eta_s = Number.isInteger(state.eta_s) ? state.eta_s : null;
    if (state.status === "ready") {
      const outputs = Array.isArray(state.outputs) ? state.outputs : [];
      if (!outputs.length || outputs.some((n) => !task.files[n])) throw new Refused("ready before its files were uploaded", 409);
      for (const name of Object.keys(task.files)) if (!outputs.includes(name)) delete task.files[name];
    }
    // Waiting in rtwin1's own queue stays "claimed" here (shown as queued), so it is never handed out twice.
    if (state.status === "queued") task.status = "claimed";
    else if (state.status === "running") task.status = "running";
    else {
      task.status = state.status;
      task.error = typeof state.error === "string" ? state.error.slice(0, 300) : "";
      task.finished = new Date(this.now()).toISOString();
    }
    await this.save(task);
    return { ok: true, cancel: Boolean(task.cancel_requested) };
  }

  async runnerUpload(id, file, bytes, type) {
    const task = await this.getTask(id);
    if (!task || !ACTIVE.has(task.status)) throw new Refused("no such running task", 404);
    if (!PLAIN_FILE.test(file)) throw new Refused("bad file name");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) throw new Refused("file is empty or larger than 25 MB", 413);
    if (!task.files[file] && Object.keys(task.files).length >= MAX_FILES_PER_TASK) throw new Refused("too many files", 413);
    const allowed = ["video/mp4", "image/png", "audio/wav", "text/markdown; charset=utf-8"];
    const contentType = allowed.includes(type) ? type : "application/octet-stream";
    const sha256 = await sha256hex(bytes);
    await this.files.put(`${task.id}/${file}`, bytes, { expirationTtl: FILE_TTL_S });
    task.files[file] = { size: bytes.byteLength, sha256, type: contentType, hosted_until: new Date(this.now() + FILE_TTL_S * 1000).toISOString() };
    await this.save(task);
    return { ok: true, sha256 };
  }

  // --- HTTP --------------------------------------------------------------------------------

  async handle(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const method = request.method.toUpperCase();
    try {
      if (method === "GET" && url.pathname === "/health") {
        const seen = (await this.store.get("runner_seen")) || 0;
        return json(200, { ok: true, paused: this.paused(), runner_online: this.now() - seen < 60_000 });
      }

      // Public signed download links: /f/TASK/FILE?e=&s=
      if (method === "GET" && parts[0] === "f" && parts.length === 3) {
        const [, id, file] = parts;
        if (!(await verifyLink(this.linkSecret(), id, file, url.searchParams.get("e"), url.searchParams.get("s"), this.now() / 1000))) {
          return json(403, { error: "this link is not valid or has expired" });
        }
        const task = await this.getTask(id);
        return task ? await this.fileResponse(task, file) : json(404, { error: "no such file" });
      }

      if (parts[0] === "v1" && parts[1] === "runner") return await this.handleRunner(request, method, parts.slice(2));
      if (parts[0] === "v1" && parts[1] === "tasks") return await this.handleDesk(request, method, url.pathname, parts.slice(2));
      return json(404, { error: "not found" });
    } catch (e) {
      if (e instanceof Refused || e.status) return json(e.status || 400, { error: e.message });
      console.error("gateway error", e && e.name);
      return json(500, { error: "internal error" });
    }
  }

  async handleRunner(request, method, rest) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!this.env.RUNNER_TOKEN || this.env.RUNNER_TOKEN.length < 32 || !sameText(token, this.env.RUNNER_TOKEN)) {
      return json(401, { error: "unauthorised" });
    }
    await this.store.put("runner_seen", this.now());
    if (method === "GET" && rest.length === 1 && rest[0] === "next") {
      const next = await this.runnerNext();
      return next ? json(200, next) : new Response(null, { status: 204 });
    }
    if (method === "POST" && rest.length === 2 && rest[0] === "tasks") {
      return json(200, await this.runnerReport(rest[1], await request.json().catch(() => null)));
    }
    if (method === "PUT" && rest.length === 4 && rest[0] === "tasks" && rest[2] === "files") {
      const length = Number(request.headers.get("content-length") || 0);
      if (length > MAX_FILE_BYTES) throw new Refused("file larger than 25 MB", 413);
      const bytes = await request.arrayBuffer();
      return json(200, await this.runnerUpload(rest[1], decodeURIComponent(rest[3]), bytes, request.headers.get("content-type") || ""));
    }
    return json(404, { error: "not found" });
  }

  async handleDesk(request, method, path, rest) {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY_BYTES) throw new Refused("request body too large", 413);
    const bodyBytes = method === "POST" ? await request.arrayBuffer() : new ArrayBuffer(0);
    if (bodyBytes.byteLength > MAX_BODY_BYTES) throw new Refused("request body too large", 413);
    const { desk, nonce } = await verifyDesk(request.headers, { method, path, bodyBytes, secrets: deskSecrets(this.env), now: this.now() / 1000 });
    await this.useNonce(nonce);
    await this.rateLimit(desk);
    const body = () => {
      try {
        return JSON.parse(new TextDecoder().decode(bodyBytes) || "{}");
      } catch {
        throw new Refused("body is not JSON");
      }
    };
    if (method === "POST" && rest.length === 0) return json(201, await this.createTask(desk, body()));
    if (method === "GET" && rest.length === 1) return json(200, view(await this.ownTask(desk, rest[0])));
    if (method === "POST" && rest.length === 2 && rest[1] === "cancel") return json(200, await this.cancel(desk, rest[0]));
    if (method === "POST" && rest.length === 2 && rest[1] === "link") {
      const { file, ttl_s } = body();
      return json(200, await this.link(desk, rest[0], file, ttl_s));
    }
    if (method === "GET" && rest.length === 3 && rest[1] === "files") {
      return this.fileResponse(await this.ownTask(desk, rest[0]), rest[2]);
    }
    return json(404, { error: "not found" });
  }

  /** Drops expired nonces and rate counters (run from the alarm). */
  async sweep() {
    const nowMs = this.now();
    for (const [key, expires] of await this.store.list({ prefix: "nonce:" })) if (expires < nowMs) await this.store.delete(key);
    const minute = Math.floor(nowMs / 60_000);
    for (const key of (await this.store.list({ prefix: "rate:" })).keys()) if (Number(key.split(":")[2]) < minute - 1) await this.store.delete(key);
  }
}
