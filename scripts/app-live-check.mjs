#!/usr/bin/env node
// Check of the live developer app, run hourly by .github/workflows/marketing-uptime.yml
// next to the marketing check. Read only: public pages and one read-only RPC method
// through the app's own proxy. No secrets, nothing signed or written.
//
// APP_ORIGIN (default https://app.agent-protocol.reddi.tech) and APP_EXPECTED_NETWORK
// (devnet or mainnet, default devnet) can be overridden. When the app switches to
// mainnet, change APP_EXPECTED_NETWORK in the workflow in the same pull request.
const origin = (process.env.APP_ORIGIN ?? 'https://app.agent-protocol.reddi.tech').replace(/\/$/, '');
const network = process.env.APP_EXPECTED_NETWORK ?? 'devnet';
const GENESIS = {
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
};
const problems = [];
if (!(network in GENESIS)) {
  console.error(`FAIL APP_EXPECTED_NETWORK must be devnet or mainnet, not ${network}`);
  process.exit(1);
}

const get = async (path, init = {}) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init, headers: { 'user-agent': 'rap-app-live-check', ...(init.headers ?? {}) } });
    } catch (error) {
      if (attempt === 3) { problems.push(`${path}: no answer (${error instanceof Error ? error.name : 'error'})`); return null; }
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
};

for (const path of ['/', '/sandbox']) {
  const res = await get(path);
  if (res && res.status !== 200) problems.push(`${path}: status ${res.status}`);
}

// The proxy only answers the app's own origin, so the check sends it, as the app's pages do.
const rpc = await get('/api/rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }),
});
if (rpc) {
  const body = await rpc.json().catch(() => ({}));
  if (rpc.status !== 200) problems.push(`/api/rpc: status ${rpc.status}${body?.error?.data?.code ? ` (${body.error.data.code})` : ''}`);
  else if (body.result !== GENESIS[network]) problems.push(`/api/rpc: genesis ${body.result ?? 'missing'} is not ${network}`);
}

// A caller from another origin must still be refused.
const foreign = await get('/api/rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://example.com' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }),
});
if (foreign && foreign.status !== 403) problems.push(`/api/rpc from another origin: status ${foreign.status}, expected 403`);

if (problems.length) { for (const p of problems) console.error(`FAIL app ${p}`); process.exit(1); }
console.log(`app live ok: ${origin}, RPC proxy on ${network}`);
