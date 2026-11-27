# RAP studio GPU gateway

A Cloudflare Worker that is the only public way to work on rtwin1, the GPU box behind the Reddi Agent
Protocol (RAP) studio providers. rtwin1 accepts no connections: its rgpu runner polls this Worker over
outbound HTTPS, runs what it is handed and uploads the files
([remote-llm-calls](https://github.com/nissan/remote-llm-calls), `server/rgpu_server/gateway.py`).

```
buyer agent -> studio desk (Vercel, paid RAP provider) -> this Worker <- rgpu runner on rtwin1 (outbound only)
```

Free plan only: one Worker, one SQLite Durable Object (all state, so every limit sees the same numbers)
and one KV namespace (files, kept 7 days, the hosting period in the studio quotes).

## Who may call what

| Caller | Auth | Routes |
| --- | --- | --- |
| Studio desks (script, voice, video, stitch) | HMAC-SHA256 per desk over timestamp, nonce, method, path and body hash (`src/auth.js`); 60 s clock window; each nonce once | `POST /v1/tasks`, `GET /v1/tasks/ID`, `POST /v1/tasks/ID/cancel`, `POST /v1/tasks/ID/collected` (true once, so a desk bills a task once), `POST /v1/tasks/ID/link`, `GET /v1/tasks/ID/files/NAME` |
| rgpu runner on rtwin1 | `Authorization: Bearer RUNNER_TOKEN` | `GET /v1/runner/next`, `POST /v1/runner/tasks/ID`, `PUT /v1/runner/tasks/ID/files/NAME` |
| Anyone with a link | HMAC-signed link, expires (at most 7 days) | `GET /f/TASK/FILE?e=&s=` |
| Anyone | none | `GET /health` (`ok`, `paused`, `runner_online`) |

## Limits (`src/templates.js`, `wrangler.toml` vars)

- Each desk runs only its own job kinds, with fixed models and sizes: script = text on `SCRIPT_MODEL`
  (qwen3), voice = Kokoro speech, video = z-image-turbo still at 832x480 then wan22-i2v-14b clips of at most
  5 s, stitch = ffmpeg with fixed settings. Prompts up to 4,000 characters (script), 2,000 (voice), 1,500
  (video). Unknown keys are refused.
- Inputs are earlier tasks of the same Budget, by task id and plain file name. Never a URL.
- Active tasks per desk per Budget: script 1, voice 1, video 5, stitch 1.
- GPU queue at most `MAX_QUEUED_GPU_TASKS` (6); `DAILY_GPU_MINUTES` (120) estimated GPU minutes per UTC day.
- `DESK_REQUESTS_PER_MINUTE` (30) per desk. Desk bodies up to 64 KB; files up to 25 MB, 4 per task.
- `GATEWAY_PAUSED = "true"` refuses new tasks and hands the runner nothing (kill switch).

The desks check the RAP Budget call (a reserved slice and the buyer's signature) before they queue
anything here, so no GPU time is spent for an unpaid call. This Worker never sees a key or a wallet.

## Set up (needs Nissan's go)

```bash
cd apps/gpu-gateway
npx wrangler@4 login
npx wrangler@4 kv namespace create rap-gpu-gateway-files   # paste the id into wrangler.toml
for s in RUNNER_TOKEN LINK_SECRET DESK_SECRET_SCRIPT DESK_SECRET_VOICE DESK_SECRET_VIDEO DESK_SECRET_STITCH; do
  npx wrangler@4 secret put "$s"                           # paste each value; none is printed
done
npx wrangler@4 deploy
```

`RUNNER_TOKEN` is the value `install-gateway.ps1` made on rtwin1. The other five are fresh random values
(`openssl rand -base64 36`), kept in 1Password; each desk secret also goes on its studio desk.

## Tests

`npm test` (Node 22+, no dependencies): signatures, replays, per-desk rules, the still to clip to voice to
stitch chain, limits, pause, links and their expiry. CI: `.github/workflows/gpu-gateway.yml`.
