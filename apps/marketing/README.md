# Reddi Agent Protocol marketing site

An isolated Next.js app for the public website. It shares no code with the root app, the programs or the packages, and it
is deployed from this directory only. It follows the pattern of the BattleBlocks AI marketing site
(`nissan/battleblocks-ai`, `apps/marketing`); the newsletter module in `lib/newsletter/` is ported from there, and the
`WEB-nn` references in its comments are that repository's issue numbers.

## Run and verify

```sh
cd apps/marketing
npm ci --ignore-scripts
NEXT_TELEMETRY_DISABLED=1 npm run build
npm run typecheck
npm test
npm run start -- --port 3000   # then, in another shell: npm run smoke
```

`npm test` includes `tests/claims.test.ts`, which holds every page, component and copy module to
`docs/PUBLIC-CLAIM-BOUNDARY.md` using the repository's shared pattern list, with a negative control.

## Pages

| Route | What it is |
|---|---|
| `/` | Landing page: the receipt, Solana's request and where this project fits, how it works, sandbox scenarios, status, X posts, signup, questions |
| `/status` | What exists, what is being built and what is planned, each line linked to where it can be checked. Rows live in `lib/copy.ts` |
| `/sandbox` | The devnet sandbox slot. Shows "opens soon" until `NEXT_PUBLIC_SANDBOX_URL` is set |
| `/privacy`, `/terms` | Draft policy pages for the owner's review before the signup opens |
| `/newsletter/*` | One-button confirm and unsubscribe pages and their result pages |

All factual copy is in `lib/copy.ts` and `lib/newsletter/copy.ts`. Change a status row only when the thing it describes has changed.

## Everything is off until the owner turns it on

With no environment variables the site builds and serves, the signup form renders disabled and says so,
`POST /api/subscribe` answers 503, nothing is loaded from X until a visitor presses the button, and every page carries
`noindex`.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SANDBOX_URL` | https address of the devnet sandbox. Build time. Unset or not https: "opens soon" |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Contact address printed on the privacy page. Unset: the page points to the repository |
| `NEXT_PUBLIC_NEWSLETTER_FORM=1` | Build-time switch that enables the signup form |
| `NEWSLETTER_ENABLED=1` | Turns the newsletter endpoints on |
| `NEWSLETTER_SIGNING_SECRET` | At least 32 random characters (`openssl rand -hex 32`) for signing confirm and unsubscribe links |
| `RESEND_API_KEY` | Resend API key. Set in Vercel by the owner; never in Git |
| `NEWSLETTER_FROM`, `NEWSLETTER_REPLY_TO` | Sender on a domain verified in Resend, and the reply-to address |
| `BLOB_STORE_ID` (or legacy `BLOB_READ_WRITE_TOKEN`) | The Vercel Blob store that holds the list (private; one JSON document per contact, keyed by a hash of the address) |
| `NEWSLETTER_ALLOWED_RECIPIENTS` | Comma-separated addresses or `@domains` allowed while testing; required until `NEWSLETTER_PUBLIC=1` |
| `NEWSLETTER_PUBLIC=1` | Lifts the allowlist: public collection |
| `CRON_SECRET` | Lets the daily cron `/api/newsletter/prune` delete unconfirmed addresses after seven days |
| `SITE_PUBLIC=1` | The indexing switch: with a Vercel production build, drops `noindex` and opens `robots.txt` |

Newsletter rules (confirmed opt-in, three confirmation emails per address per day, same reply for known and unknown
addresses, one-click unsubscribe, conditional writes) are enforced in `lib/newsletter/flow.ts` and covered by
`tests/newsletter.test.ts`. The application logs no address.

## Vercel

Create a separate Vercel project with **Root Directory `apps/marketing`**, framework Next.js, Node 24. `vercel.json`
here sets the install and build commands and skips builds when nothing under this directory changed. Creating the
project, setting variables and pointing a domain at it are owner steps.

## Not in this first slice

Devlog posts and automatic newsletter issues, a health endpoint and uptime alert, analytics with consent, and video
pages. The BattleBlocks site has each of these and they can be ported the same way.
