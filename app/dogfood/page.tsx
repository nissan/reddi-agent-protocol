"use client";

import { useState } from "react";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

async function callJson(path: string, body?: Record<string, unknown>) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as JsonValue;
  return { ok: res.ok, status: res.status, data };
}

export default function DogfoodPage() {
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string>("none");
  const [lastStatus, setLastStatus] = useState<string>("idle");
  const [payload, setPayload] = useState<JsonValue>(null);

  async function run(action: string, fn: () => Promise<{ ok: boolean; status: number; data: JsonValue }>) {
    setBusy(true);
    setLastAction(action);
    try {
      const result = await fn();
      setLastStatus(`${result.ok ? "ok" : "error"} (${result.status})`);
      setPayload(result.data);
    } catch (error) {
      setLastStatus("error");
      setPayload({ error: error instanceof Error ? error.message : "Request failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <h1 className="text-3xl font-semibold" data-testid="dogfood-heading">Dogfood Specialist + Attestor Flow</h1>
        <p className="text-sm text-muted-foreground">
          End-to-end ping/pong+haiku verification with attested release/refund recommendations; no settlement finality implied.
        </p>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <button
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            disabled={busy}
            data-testid="dogfood-seed-btn"
            onClick={() => run("seed", () => callJson("/api/dogfood/seed"))}
          >
            Seed test agents
          </button>

          <button
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            disabled={busy}
            data-testid="dogfood-search-btn"
            onClick={() => run("search", () => callJson("/api/dogfood/search"))}
          >
            Search dogfood agents
          </button>

          <button
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            disabled={busy}
            data-testid="dogfood-run-random-btn"
            onClick={() => run("consumer-run-random", () => callJson("/api/dogfood/consumer-run", { message: "ping" }))}
          >
            Run consumer flow (random)
          </button>

          <button
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            disabled={busy}
            data-testid="dogfood-run-pass-btn"
            onClick={() =>
              run("consumer-run-pass", () =>
                callJson("/api/dogfood/consumer-run", { message: "ping", force: "pass" })
              )
            }
          >
            Run forced PASS
          </button>

          <button
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            disabled={busy}
            data-testid="dogfood-run-fail-btn"
            onClick={() =>
              run("consumer-run-fail", () =>
                callJson("/api/dogfood/consumer-run", { message: "ping", force: "fail" })
              )
            }
          >
            Run forced FAIL
          </button>
        </div>

        <div className="rounded-lg border p-4 bg-card/50 space-y-2" data-testid="dogfood-status-card">
          <p className="text-sm"><span className="font-medium">Last action:</span> {lastAction}</p>
          <p className="text-sm"><span className="font-medium">Status:</span> {lastStatus}</p>
        </div>

        <pre
          className="rounded-lg border bg-black/40 p-4 text-xs overflow-auto"
          style={{ maxHeight: 480 }}
          data-testid="dogfood-json-output"
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}

