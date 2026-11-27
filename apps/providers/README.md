# RAP first-party providers

One Vercel project serving RAP's own providers (#832) through `@redditech/provider-kit`:

| Path | Provider | Config |
| --- | --- | --- |
| `/humaniser` | RAP Humaniser | `deploy/first-party-providers/humaniser.<network>.provider.json` |
| `/writing-style` | RAP Writing Style | `deploy/first-party-providers/writing-style.<network>.provider.json` |
| `/script-writer` | RAP Script Writer | `deploy/first-party-providers/script-writer.<network>.provider.json` |

Each path is a full provider: `/<name>/v1/chat/completions`, `/<name>/.well-known/reddi-agent.json`, its ADL and so on. Every instance shares one Postgres database (the `provider_kit` schema), so a lock pays for one call however many instances are running. Vercel Cron calls `/api/sweep` every minute to look again at settles whose outcome was not known.

## Settings

`.env.example` lists every variable. Mark each secret as Sensitive in Vercel.

- `PROVIDERS_NETWORK`: `devnet` (default) or `mainnet`.
- `PROVIDERS_PUBLIC_ORIGIN`: the https origin the project is served at.
- `PROVIDER_KIT_DATABASE_URL`: the Supabase transaction pooler connection string for the `provider_kit_app` role, so many instances share a few connections. Never the `postgres` owner: that role bypasses row level security on every table.
- `CRON_SECRET`: Vercel sends it to `/api/sweep`; any other caller is refused.
- Per provider: `<NAME>_WALLET`, `<NAME>_KEYPAIR` (a JSON array of 64 numbers) and `<NAME>_PROMPT` (the private instructions).
- The model keys named in the configs, and `SOLANA_RPC_URL` on mainnet.

A provider missing any of these answers 503 and charges nothing; the log line `provider_not_configured` names the missing setting, never a value.

Alert email (optional, recommended on mainnet): with `PROVIDER_ALERT_RESEND_API_KEY` (Sensitive), `PROVIDER_ALERT_EMAIL_TO` (one address) and `PROVIDER_ALERT_EMAIL_FROM` (a sender on a domain verified in Resend) all set, every log event marked `alert: true` (a failed sweep, a settle whose outcome is unknown, a lost paid answer, a provider not set up) is also emailed, sent after the response. Each instance sends at most one email per event name every 15 minutes and counts the ones it held back. With only some of the three set, it logs `alert_email_not_configured` with the missing names and sends nothing; a refused send logs `alert_email_failed` with the status only. See `lib/alerts.ts`.

## Launch Budget bonus

For 30 days after mainnet launch, a USDC Budget earns a bonus of 50% of what it locks, spent only with these providers (`lib/launch-bonus.ts`). The bonus is a discount on their own price, recorded in `provider_kit.launch_bonus_*` (migration `20261124200000_provider_kit_launch_bonus.sql`): no funds move and RAP holds nothing. On each call it covers one third of the cost and the Budget pays the rest; the receipt states it as a signed `bonus` block.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LAUNCH_BONUS_STARTS_AT` | unset (offer off) | ISO 8601 UTC time the offer starts: the actual mainnet launch |
| `LAUNCH_BONUS_DAYS` | 30 | Budgets opened in this many days earn |
| `LAUNCH_BONUS_MATCH_BPS` | 5000 | Bonus as basis points of the Budget (5000 = 50%) |
| `LAUNCH_BONUS_WALLET_CAP_USDC` | 10 | Most bonus one payer earns across its Budgets |
| `LAUNCH_BONUS_POOL_CAP_USDC` | 1000 | Most bonus granted and not lapsed, for the whole offer |
| `LAUNCH_BONUS_MIN_BUDGET_USDC` | 1 | Smallest Budget that earns |
| `LAUNCH_BONUS_EXCLUDED_PAYERS` | none | Extra payer addresses that never earn (the treasury and the provider wallets never do) |

A malformed setting turns the offer off (the caller logs its message); it never falls back to a guessed value. `launchBonusHooks` gives the provider kit its three Budget hooks (PR #1114): `budgetCallPricing` per call, `budgetCallPricingVoided` when a priced call is refused (its bonus goes back), and `onBudgetDone` after the Budget closes (unspent bonus lapses). Grants are keyed by Budget address and created_slot, so a new Budget at a reused address gets its own.

## Database setup (owner, once)

1. Apply `supabase/migrations/20261123120000_provider_kit_state.sql`. It creates `provider_kit_app` without a login: it can use the five `provider_kit` tables and nothing else.
2. In the Supabase SQL editor, give it a login with a new password from 1Password: `alter role provider_kit_app with login password '…';`. The password goes only into 1Password and the Vercel sensitive variable.
3. The pooler user name is `provider_kit_app.<project ref>`.

The `replay` table keeps every accepted lock key, and must keep a key for as long as its lock could be presented again. A retention rule (deleting keys older than the longest lock window) is not set up yet.

## Checks

```bash
npm run build:kit   # builds the kit from this repository, as Vercel does
npm ci
npm run build && npm run typecheck && npm test
```
