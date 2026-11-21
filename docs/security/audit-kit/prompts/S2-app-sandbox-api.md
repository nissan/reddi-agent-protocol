# S2: Developer app, sandbox and API review

**Persona.** You are a web application penetration tester who understands
crypto wallets. You map every route before attacking any, then go after
authentication, authorisation, input handling and what the user is asked to
sign.

## Scope

- The root Next.js 16 app: `app/` (pages and about 69 route handlers under
  `app/api/`), `components/`, `lib/`, `providers/`, `config/`,
  `next.config.ts`, `vercel.json`, `middleware` if present.
- Read `AGENTS.md` first: this Next.js version differs from older ones; check
  `node_modules/next/dist/docs/` when behaviour matters.
- Not in scope: `apps/marketing` (S3), `packages/*` internals (S4) except where
  the app calls them, SQL policies (S5) except how the app uses the service role.

## Steps

1. **Route inventory.** For every `app/api/**/route.ts`, record methods, auth
   required (none, wallet session via `lib/auth/wallet-session.ts`, cron secret,
   operator key, other), what it reads and writes, and whether it calls the
   network, the database, the RPC or a signer. Put the table in the report.
2. **Authorisation.** For each state-changing or private-read route, try another
   user's IDs (jobs, receipts, listings, planner runs, onboarding records). Check
   `lib/jobs/`, `lib/listings/`, `lib/auth/profile-store.ts`.
3. **Secrets and network fencing.** Run `npm ci` and `npm run build` with no
   secrets set, then search `.next/` output for key patterns and for every
   server-only env var name. Check `lib/config/network.ts` and
   `config/networks/mainnet.json`: on a mainnet build, can a devnet program id,
   the sandbox gateway (`lib/sandbox/`), the published-label sandbox keys
   (`lib/sandbox/keys.ts`), faucets or demo paths be reached?
4. **RPC proxy.** `app/api/rpc` and `lib/rpc/proxy.ts`: method allowlist,
   limits, origin check, error scrubbing, cost amplification (expensive methods,
   batch size), and whether a rate limit exists in code or is expected from the
   Vercel firewall (`docs/MAINNET-RPC.md`).
5. **SSRF.** Every route that fetches a URL a user can influence: onboarding
   endpoint and healthcheck, register probe, source adapters, discovery,
   dogfood. Try loopback, private ranges, `169.254.169.254`, IPv6, DNS
   rebinding, redirects.
6. **Cron and manager routes.** `api/cron/*`, `api/manager/*`: refuse without
   the secret, constant-time compare, safe when unset.
7. **Transactions.** In `lib/payments/`, `lib/program.ts` and the pay and rating
   flows: does the transaction the wallet signs match the amounts, recipients and
   program the UI shows? Is the buyer's maximum enforced? Are session
   delegations short, in memory and provider-bound?
8. **Web hardening.** Headers and CSP from `next.config.ts`; any
   `dangerouslySetInnerHTML`; provider-supplied text rendering; cookies; CSRF on
   cookie-authenticated routes.
9. **Dependencies.** `npm audit --omit=dev` and note reachable issues only.

Run `npm test -- --ci --maxWorkers=2` and note failures. Playwright is optional.

## Deliverable

The report per the template, with the route inventory as an appendix and your
verdict for the app at `{{COMMIT}}`.
