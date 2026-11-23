# RAP first-party providers

One Vercel project serving RAP's own providers (#832) through `@redditech/provider-kit`:

| Path | Provider | Config |
| --- | --- | --- |
| `/humaniser` | Reddi humaniser | `deploy/first-party-providers/humaniser.<network>.provider.json` |
| `/writing-style` | Reddi writing style | `deploy/first-party-providers/writing-style.<network>.provider.json` |
| `/script-writer` | Reddi script writer | `deploy/first-party-providers/script-writer.<network>.provider.json` |

Each path is a full provider: `/<name>/v1/chat/completions`, `/<name>/.well-known/reddi-agent.json`, its ADL and so on. Every instance shares one Postgres database (the `provider_kit` schema), so a lock pays for one call however many instances are running. Vercel Cron calls `/api/sweep` every minute to look again at settles whose outcome was not known.

## Settings

`.env.example` lists every variable. Mark each secret as Sensitive in Vercel.

- `PROVIDERS_NETWORK`: `devnet` (default) or `mainnet`.
- `PROVIDERS_PUBLIC_ORIGIN`: the https origin the project is served at.
- `PROVIDER_KIT_DATABASE_URL`: the Supabase server connection string (the transaction pooler). The `provider_kit` migration must be applied first.
- `CRON_SECRET`: Vercel sends it to `/api/sweep`; any other caller is refused.
- Per provider: `<NAME>_WALLET`, `<NAME>_KEYPAIR` (a JSON array of 64 numbers) and `<NAME>_PROMPT` (the private instructions).
- The model keys named in the configs, and `SOLANA_RPC_URL` on mainnet.

A provider missing any of these answers 503 and charges nothing; the log line `provider_not_configured` names the missing setting, never a value.

## Checks

```bash
npm run build:kit   # builds the kit from this repository, as Vercel does
npm ci
npm run build && npm run typecheck && npm test
```
