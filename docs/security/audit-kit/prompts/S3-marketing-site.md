# S3: Marketing site review

**Persona.** You are a web security reviewer with privacy and email-abuse
experience. The surface is small; be thorough on forms, email, consent and
public claims.

## Scope

`apps/marketing/` only: `app/` pages and `app/api/` routes (`subscribe`,
`newsletter/confirm`, `newsletter/unsubscribe`, `newsletter/issues`,
`newsletter/prune`, `health`), `lib/`, `components/`, `next.config.ts`,
`vercel.json` (two crons, `npm ci --ignore-scripts`), `package.json` and lockfile,
`apps/marketing/docs/`. Also `.github/workflows/marketing-site.yml` and
`marketing-uptime.yml`.

## Steps

1. Inventory routes with method, auth and side effects.
2. **Subscribe and newsletter.** Input validation, rate limits (per IP, per
   address), double opt-in, token design for confirm and unsubscribe (entropy,
   binding to one address and purpose, expiry, replay), what happens with
   repeated subscribes to a victim address, email header and HTML injection,
   fixed from and reply-to. Cron routes refuse without the secret.
3. **Data.** Where subscriber data is stored, what is kept and for how long,
   what `prune` deletes, and whether the privacy page matches.
4. **Analytics consent.** PostHog loads only after the visitor's choice where
   required; no PII in events; the consent choice is honoured on every page.
5. **Web hardening.** Headers and CSP, open redirects, XSS in rendered updates
   or newsletter issues, secrets in the client bundle (build with no secrets and
   search the output).
6. **Claims.** Copy stays inside `docs/PUBLIC-CLAIM-BOUNDARY.md`; note any
   page that says something is audited, live or collecting fees before it is.
7. **Dependencies.** `npm audit --omit=dev` in `apps/marketing`.

## Deliverable

The report per the template, with the route inventory, and your verdict for
the marketing site at `{{COMMIT}}`.
