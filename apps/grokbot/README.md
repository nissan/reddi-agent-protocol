# Grokbot (devnet demo)

Grokbot is a buyer agent that knows Reddi Agent Protocol. Give it a brief for a short marketing video and
it does the rest with test funds on devnet:

1. **Finds a team.** It reads the app's provider listings (`/api/listings`), keeps the providers that do
   each role (script, voiceover, video, editing) and are priced in devnet USDC, and asks its own model
   (qwen3 on rtwin1) to pick one per role. A pick that is not a listed candidate is refused. It then reads
   each pick's Budget offer and checks that it pays the listed wallet, on devnet, in USDC, with the RAP
   judge.
2. **Opens one Budget** of 5 USDC: only those four providers may join, the RAP judge is named, and Grokbot's
   spender key may waive the dispute window (flag `0x01`). Each provider's slice is planned from its listed
   price: every charged call at its most, plus the free status calls and a small margin. The plan for the
   studio desks is about 0.50 script, 0.62 voice, 1.57 video and 0.62 stitch: 3.32 of the 5, and what is not spent comes back.
3. **Gives the instructions.** Script first; then the voiceover and three start frames; then three 5 second
   clips from the frames; then the final cut with the voiceover. Each provider starts the job, Grokbot asks
   for its status (free) and collects the files when ready (charged once, by length). Every answer carries a
   provider-signed receipt naming the Budget, which Grokbot checks. Every file is downloaded and checked
   against the sha256 its provider reported.
4. **Pays everyone now.** It closes the Budget (the unreserved part comes straight back), waits for each
   provider to post what it earned, then in one transaction per provider waives the dispute window and pays
   out: the provider gets what it earned less the protocol fee (2.5% launch rate), the treasury gets the
   fee, and the unused part of the slice comes back. No 24 hour wait, and no program change: this is the
   pooled Budget's spender waive.
5. **Writes the ledger.** `out/<time>/ledger.json` and `ledger.html` show the brief, the team, every call
   and what it billed, the files, and each payout read back from the chain's token balance changes, with
   explorer links.

## Commands

```bash
npm run build:kit && npm ci
node grokbot.mjs plan            # finds the team and plans the Budget; signs and sends nothing
node grokbot.mjs run [brief.md]  # the whole run (about 30 to 40 minutes, mostly the three clips)
node grokbot.mjs recover <budget>  # a run that stopped: closes the Budget, pays out what was posted
npm test
```

| Setting | What |
| --- | --- |
| `GROKBOT_PAYER_KEYPAIR_PATH` | Grokbot's devnet wallet (keypair file). Needs about 0.05 devnet SOL and 5 devnet USDC. |
| `GROKBOT_BRAIN_URL` | qwen3's OpenAI-compatible address on rtwin1 over the tailnet, such as `http://rtwin1:8777/v1`. Never a public address. |
| `GROKBOT_BRAIN_MODEL` | Default `qwen3.8:27b`. |
| `GROKBOT_APP_URL` | Default `https://app.agent-protocol.reddi.tech` (the devnet listings). |
| `SOLANA_RPC_URL` | Default public devnet RPC. |
| `GROKBOT_BUDGET_USDC` | Default 5. |
| `STUDIO_SWEEP_URL`, `STUDIO_CRON_SECRET` | Optional: Grokbot calls the studio's sweep right after the close so the totals post at once, not at the next minute. |

The spender key is made fresh for each run and kept only in memory. If a run stops, the payer can still
close and waive, which is what `recover` does.

## Setting up the demo (Nissan's steps, each with your go)

Everything is devnet and test funds. Nothing here touches mainnet, the launch app or the program.

1. **Merge** nissan/remote-llm-calls#13 and the RAP PRs (gateway, studio desks, Grokbot).
2. **Gateway Worker.** Follow `apps/gpu-gateway/README.md` "Set up": KV namespace, six secrets, deploy.
   Note the Worker's https address.
3. **rtwin1.** `powershell -ExecutionPolicy Bypass -File C:\rgpu\server\install-gateway.ps1 -GatewayUrl <Worker address>`.
   It makes the runner token (copied to the clipboard, never printed): paste it as the Worker's
   `RUNNER_TOKEN` and into 1Password. Check `<Worker>/health` shows `runner_online: true`.
4. **Five devnet wallets** on the Mac, made silently, kept in 1Password:
   `solana-keygen new --silent --no-bip39-passphrase -o <file>` for studio-script, studio-voice,
   studio-video, studio-stitch and grokbot-payer.
5. **Fund on devnet:** about 0.1 SOL to each studio wallet (registration fee, reservation rent and fees)
   and 0.05 SOL plus 5 devnet USDC to grokbot-payer.
6. **Vercel project `rap-studio-providers`** (root `apps/studio-providers`, existing team plan): the
   settings in `apps/studio-providers/.env.example`. Each desk's `STUDIO_DESK_SECRET_*` is the same value
   as the Worker's `DESK_SECRET_*`; the database is the existing provider_kit schema.
7. **Register and list the four desks** from the Mac, once the project is live:
   `rap-provider register` with each desk's config (`deploy/studio-providers/<desk>.devnet.provider.json`,
   with `wallet`, `publicUrl` and `keypairPath` filled in). Each pays the 0.01 SOL registration on devnet.
8. **Dry run:** `node grokbot.mjs plan`, then `node grokbot.mjs run`. Then the recorded run.
