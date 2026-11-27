# RAP Studio desks (devnet)

Four Reddi Agent Protocol providers, each its own registered agent with its own wallet, served from one
Vercel project (`rap-studio-providers`) through the provider kit:

| Desk | Path | Makes | Price (devnet USDC) |
| --- | --- | --- | --- |
| RAP Studio Script | `/script` | a video script (qwen3 on rtwin1) | 400 per million output tokens |
| RAP Studio Voice | `/voice` | a voiceover WAV (Kokoro, CPU) | 0.02 a second of audio |
| RAP Studio Video | `/video` | start frames and 5 s clips at 832x480 (Wan 2.2) | 0.10 a second of video, frames included |
| RAP Studio Stitch | `/stitch` | the final cut with the voiceover and an "AI-generated" label (ffmpeg) | 0.02 a second of the cut |

The configs are the reviewed files in `deploy/studio-providers/`. The GPU work runs on rtwin1 behind
the studio gateway (`apps/gpu-gateway`); rtwin1 takes no inbound connections.

## How a buyer uses a desk

A Budget-paid chat call whose last user message is one JSON instruction:

```json
{"action": "start", "budget": "<Budget address>", "job": {"kind": "speech", "prompt": "..."}}
{"action": "status", "task": "t_..."}
{"action": "collect", "task": "t_..."}
```

- **start** queues the job at the gateway and answers with a task id. Charged 0.
- **status** says where it is (queued, running, ready, failed). Charged 0.
- **collect** answers with signed download links (7 days), each file's size and sha256, and what was
  billed. It is charged once, by length: the kit's output token is one millisecond of media here, read
  from the file itself (WAV data size, MP4 movie header). The script desk bills characters / 4 as
  tokens and returns the text too. A collect before the task is ready fails and charges nothing; a
  second collect returns the files again and charges 0. The charge never exceeds the call's
  `max_tokens`, so set it to the most you allow (for a 5 s clip, 5100 or more).

The job shapes and limits are in `apps/gpu-gateway/src/templates.js`; models and sizes are fixed there.

Known limit (demo scope): the `budget` in a start is the buyer's word, used to group tasks and count the
per-Budget caps; the kit does not tell the desk which Budget paid. A task id is a bearer handle: keep it
private. The gateway still caps the GPU queue and the GPU minutes per day for everyone.

## Settings

See `.env.example`. A desk that is not fully set up answers 503 and charges nothing. The sweep
(`/api/sweep`, Vercel Cron every minute with `CRON_SECRET`) posts Budget slices once a Budget closes.

## Checks

```bash
npm run build:kit && npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
```
