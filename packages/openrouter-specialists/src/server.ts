import { createServer } from "node:http";
import { Readable } from "node:stream";
import { chooseReplayStore } from "./replay-store.js";
import { createOpenRouterClient, createRuntimeConfig, handleRuntimeRequest } from "./runtime.js";

const config = createRuntimeConfig();
const client = createOpenRouterClient(config);
const port = Number(process.env.PORT ?? 8787);
const replay = chooseReplayStore(process.env);
if (!replay.ok) {
  // Refuse to start rather than accept real payments it could accept twice.
  console.error(`openrouter-specialists cannot start: ${replay.message}`);
  process.exit(1);
}

createServer(async (req, res) => {
  const origin = config.endpointBaseUrl;
  const request = new Request(new URL(req.url ?? "/", origin), {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as BodyInit),
    duplex: "half",
  } as RequestInit);
  const response = await handleRuntimeRequest(request, config, client, { replayStore: replay.store });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(await response.text());
}).listen(port, () => {
  console.log(`openrouter-specialists listening on :${port} profile=${config.profileId} mock=${config.mockOpenRouter} replay=${replay.description}`);
});
