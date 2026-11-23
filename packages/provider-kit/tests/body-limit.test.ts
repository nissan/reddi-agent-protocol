import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { MAX_BODY_BYTES } from "../src/config.js";
import { readBodyText } from "../src/handler.js";
import { serve } from "../src/server.js";

/** A body that never ends on its own, counting how much was pulled from it. */
function endless(chunk = 64 * 1024) {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += chunk;
      controller.enqueue(new Uint8Array(chunk).fill(0x61));
    },
  });
  return { stream, state };
}

test("a body with no stated length is refused once it passes the limit, without reading the rest", async () => {
  const { stream, state } = endless();
  const request = new Request("http://localhost/v1/chat/completions", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  const read = await readBodyText(request);
  assert.deepEqual(read, { ok: false, reason: "too_large" });
  assert.ok(state.pulled <= MAX_BODY_BYTES + 2 * 64 * 1024, `pulled ${state.pulled}`);
});

test("a stated length over the limit is refused before any of the body is read", async () => {
  const { stream, state } = endless();
  const request = new Request("http://localhost/x", { method: "POST", body: stream, headers: { "content-length": String(MAX_BODY_BYTES + 1) }, duplex: "half" } as RequestInit);
  assert.equal((await readBodyText(request)).ok, false);
  assert.ok(state.pulled <= 2 * 64 * 1024, `pulled ${state.pulled}`);
});

test("a body that breaks off is refused, never read as an empty request", async () => {
  let sent = false;
  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) return controller.error(new Error("connection reset"));
      sent = true;
      controller.enqueue(new TextEncoder().encode('{"messages":'));
    },
  });
  const request = new Request("http://localhost/x", { method: "POST", body: broken, duplex: "half" } as RequestInit);
  assert.deepEqual(await readBodyText(request), { ok: false, reason: "unreadable" });
});

test("a body within the limit is read whole", async () => {
  const text = JSON.stringify({ messages: [{ role: "user", content: "漢".repeat(1000) }] });
  assert.deepEqual(await readBodyText(new Request("http://localhost/x", { method: "POST", body: text })), { ok: true, text });
});

test("the server answers 413 to a chunked body over the limit and closes the connection", async () => {
  const server = serve(async (req) => {
    const read = await readBodyText(req);
    return new Response(JSON.stringify({ ok: read.ok }), { status: read.ok ? 200 : 413 });
  }, "http://localhost");
  assert.equal(server.headersTimeout, 15_000);
  assert.equal(server.requestTimeout, 60_000);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  let sent = 0;
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/v1/chat/completions", headers: { "transfer-encoding": "chunked" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => undefined);
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const pump = () => {
      // Keep sending well past the limit; the server should answer and close long before 50 MB.
      while (sent < 50 * 1024 * 1024 && !req.destroyed) {
        sent += chunk.length;
        if (!req.write(chunk)) return void req.once("drain", pump);
      }
      req.end();
    };
    pump();
    setTimeout(() => reject(new Error("no answer")), 10_000).unref();
  });
  assert.equal(status, 413);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
