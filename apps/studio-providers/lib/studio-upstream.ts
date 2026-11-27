/**
 * The "model" behind each studio desk: the GPU gateway, driven by a small JSON protocol in the last user
 * message, so the provider kit can sell media work through its usual Budget-paid chat call.
 *
 *   {"action": "start",   "budget": "<Budget address>", "job": {...}}   queue a job       (charged 0)
 *   {"action": "status",  "task": "t_..."}                              where it is       (charged 0)
 *   {"action": "collect", "task": "t_..."}                              the files         (charged once, by the unit)
 *
 * Media is sold by length, not by tokens: the kit's "output token" is one millisecond of audio or video
 * here, so a price of 20 per million output tokens is 0.02 a second. The script desk sells real output
 * tokens (estimated as characters / 4 of the script). A collect before the task is ready fails, and the
 * kit charges nothing for a failed answer; a second collect of the same task returns the files again
 * and charges 0. Every answer says what it billed and why.
 */
import { UpstreamError, type Upstream, type UpstreamRequest } from "@redditech/provider-kit";
import type { GatewayClient, GatewayTask } from "./gateway-client.ts";
import { mp4Seconds, wavSeconds } from "./media.ts";

export type Desk = "script" | "voice" | "video" | "stitch";

const TASK_ID = /^t_[A-Za-z0-9_-]{16,40}$/;

interface Collected {
  /** Returns true the first time a task is collected, false after (persisted by the gateway). */
  markCollected(task: string): Promise<boolean>;
}

function completion(model: string, content: unknown, outputTokens: number) {
  return {
    id: `studio-${Date.now()}`,
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: outputTokens, total_tokens: outputTokens },
  };
}

function lastUserJson(request: UpstreamRequest): Record<string, unknown> {
  const last = [...request.messages].reverse().find((m) => m.role === "user");
  try {
    const parsed: unknown = JSON.parse(last?.content ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new UpstreamError('send one JSON instruction: {"action": "start" | "status" | "collect", ...}', 400);
}

function taskOf(body: Record<string, unknown>): string {
  if (typeof body.task !== "string" || !TASK_ID.test(body.task)) throw new UpstreamError("task must be a task id from start", 400);
  return body.task;
}

/** Milliseconds billed for a ready task, from the file itself; the script desk bills tokens instead. */
async function billable(desk: Desk, task: GatewayTask, gateway: GatewayClient): Promise<{ units: number; unit: string; detail: Record<string, unknown>; text?: string }> {
  const names = Object.keys(task.files);
  const pick = (suffix: string) => names.find((n) => n.endsWith(suffix));
  if (desk === "script") {
    const name = pick(".md");
    if (!name) throw new UpstreamError("the script has no text file");
    const text = new TextDecoder().decode(await gateway.fileBytes(task.task, name));
    return { units: Math.ceil(text.length / 4), unit: "output token", detail: { characters: text.length }, text };
  }
  if (desk === "video" && task.kind === "image") return { units: 0, unit: "millisecond", detail: { note: "start frames are included in the clip price" } };
  const name = desk === "voice" ? pick(".wav") : pick(".mp4");
  if (!name) throw new UpstreamError("the task has no media file");
  const bytes = await gateway.fileBytes(task.task, name);
  const seconds = desk === "voice" ? wavSeconds(bytes) : mp4Seconds(bytes);
  return { units: Math.round(seconds * 1000), unit: "millisecond", detail: { seconds: Math.round(seconds * 1000) / 1000 } };
}

export function createStudioUpstream(desk: Desk, gateway: GatewayClient, collected: Collected): Upstream {
  return {
    async createChatCompletion(request) {
      const body = lastUserJson(request);
      switch (body.action) {
        case "start": {
          if (typeof body.budget !== "string") throw new UpstreamError("start needs the Budget address in budget", 400);
          const task = await gateway.createTask(body.budget, body.job).catch((e: Error & { status?: number }) => {
            throw new UpstreamError(`the studio refused the job: ${e.message}`, e.status === 429 ? 503 : e.status);
          });
          return completion(request.model, { task: task.task, kind: task.kind, status: task.status, billed: { units: 0, note: "starting is free; you pay when you collect" } }, 0);
        }
        case "status": {
          const task = await gateway.getTask(taskOf(body));
          return completion(request.model, { task: task.task, kind: task.kind, status: task.status, stage: task.stage, progress: task.progress, eta_s: task.eta_s, error: task.error, billed: { units: 0 } }, 0);
        }
        case "collect": {
          const task = await gateway.getTask(taskOf(body));
          if (task.status !== "ready") throw new UpstreamError(`task ${task.task} is ${task.status}, not ready; nothing is charged until it is`);
          const bill = await billable(desk, task, gateway);
          const files: Record<string, unknown> = {};
          for (const [name, meta] of Object.entries(task.files)) {
            const link = await gateway.link(task.task, name);
            files[name] = { ...meta, url: link.url, url_expires: new Date(link.expires * 1000).toISOString() };
          }
          const first = await collected.markCollected(task.task);
          // Never bill more than the buyer allowed for this call.
          const units = first ? Math.min(bill.units, request.max_tokens) : 0;
          const billed = { unit: bill.unit, units, ...bill.detail, ...(first ? {} : { note: "already delivered: not charged again" }) };
          return completion(request.model, { task: task.task, kind: task.kind, files, billed, ...(bill.text ? { text: bill.text } : {}) }, units);
        }
        default:
          throw new UpstreamError('action must be "start", "status" or "collect"', 400);
      }
    },
  };
}
