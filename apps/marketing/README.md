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
| `NEXT_PUBLIC_SANDBOX_URL` | https address of the devnet sandbox. Build time. Unset or not https: "opens soon". Each scenario card links to it with `?scenario=<id>`; the ids in `lib/copy.ts` mirror the sandbox catalog in the developer app |
| `NEXT_PUBLIC_APP_URL` | https address of the developer app that the "For developers" links open. Build time. Unset or not https: `https://reddi-agent-protocol.vercel.app` |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Contact address printed on the privacy page. Unset: the page points to the repository |
| `NEXT_PUBLIC_NEWSLETTER_FORM=1` | Build-time switch that enables the signup form |
| `NEWSLETTER_ENABLED=1` | Turns the newsletter endpoints on |
| `NEWSLETTER_SIGNING_SECRET` | At least 32 random characters (`openssl rand -hex 32`) for signing confirm and unsubscribe links |
| `RESEND_API_KEY` | Resend API key. Set in Vercel by the owner; never in Git |
| `NEWSLETTER_FROM`, `NEWSLETTER_REPLY_TO` | Sender on a domain verified in Resend, and the reply-to address |
| `BLOB_STORE_ID` (or legacy `BLOB_READ_WRITE_TOKEN`) | The Vercel Blob store that holds the list (private; one JSON document per contact, keyed by a hash of the address) |
| `NEWSLETTER_ALLOWED_RECIPIENTS` | Comma-separated addresses or `@domains` of the owner's own mailboxes. Required until `NEWSLETTER_PUBLIC=1` (only these may sign up); after that it marks them internal, and nothing is emailed until a confirmed subscriber who is not internal exists. Keep it set on production |
| `NEWSLETTER_PUBLIC=1` | Lifts the allowlist: public collection |
| `CRON_SECRET` | Lets the daily crons run: `/api/newsletter/prune` deletes unconfirmed addresses after seven days, `/api/newsletter/issues` sends due issues |
| `NEWSLETTER_AUTOSEND=1` | Lets `/api/newsletter/issues` email updates flagged `newsletterSend: true`: a weekly digest on the Monday run (the default for subscribers) and each update on its day to subscribers who chose daily. Default off. Needs `NEWSLETTER_ENABLED` and `CRON_SECRET` too |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog's public project key (`phc_...`). Without it the site loads no analytics, asks no consent question and shows no privacy banner |
| `NEXT_PUBLIC_POSTHOG_HOST` | Optional. PostHog ingestion host; defaults to `https://us.i.posthog.com` (use `https://eu.i.posthog.com` for an EU project) |
| `SITE_PUBLIC=1` | The indexing switch: with a Vercel production build, drops `noindex` and opens `robots.txt` |

Newsletter rules (confirmed opt-in, three confirmation emails per address per day, same reply for known and unknown
addresses, one welcome email on confirmation that carries the first unsubscribe link, one-click unsubscribe,
conditional writes) are enforced in `lib/newsletter/flow.ts` and covered by
`tests/newsletter.test.ts`. The application logs no address.

### Build updates and newsletter issues

Build updates live in `lib/updates.ts` as typed records and appear on `/updates` and `/updates/<slug>`. A `draft` is
shown only on previews and local builds; only `published` updates reach the public site, the sitemap or an email.
`tests/updates.test.ts` validates the records and `tests/claims.test.ts` holds their wording to the public-claim boundary.

An update with `newsletterSend: true` is emailed to confirmed subscribers once it is published and its date (a calendar
day in Sydney) has arrived. The reviewed, merged change that sets the flag is the owner's approval; never set it without
the owner. `vercel.json` runs `/api/newsletter/issues` daily at 23:10 UTC (mid-morning in Sydney). One run sends at most
one issue, oldest first, through `broadcast`, whose ledger makes a send exactly-once and resumable. It is fail-closed:
nothing is sent without `CRON_SECRET`, `NEWSLETTER_ENABLED` and `NEWSLETTER_AUTOSEND=1`, and until `NEWSLETTER_PUBLIC=1`
only allowlisted addresses receive anything. An issue that falls due with nobody to send to is closed and is not
emailed to people who join later. To see what the next run would do without sending, call the route with the bearer and
`?dry-run=1`; it answers with slugs and counts only.

Subscribers choose how often (owner decision, 23 November 2026). Weekly is the default: the Monday run (Sydney) sends
one digest of the flagged updates dated in the seven days before it, keyed by that Monday so it goes once. Daily
subscribers get each update on its day as above. Every email carries a signed link to switch (`/newsletter/frequency`,
a one-button page like unsubscribe). Nothing is sent until the first confirmed subscriber outside
`NEWSLETTER_ALLOWED_RECIPIENTS` exists; issues and digests that fall due before then are closed, not saved up.
`scripts/newsletter-remove-internal.ts` (owner-run, dry run by default) removes the internal test addresses before launch.

### Health and uptime

`/api/health` answers 200 with a small JSON report: which build is answering, whether the site is indexable, which
newsletter switches are on and how many updates and videos are published. It holds no secret, address or subscriber
count (`lib/health.ts`, `tests/health-videos-prompts.test.ts`).

`.github/workflows/marketing-uptime.yml` runs `tests/live-check.mjs` against the live site once an hour. It reads public
pages only. A failed run opens the issue "Marketing site check is failing" (or comments on the open one) and a later
passing run closes it. Run it by hand with `node tests/live-check.mjs`; set `LIVE_ORIGIN` to check another address.

### Watch page

`/watch` lists the videos in `lib/videos.ts`. Videos are hosted on YouTube and nothing is loaded from YouTube until the
visitor presses play (`components/VideoEmbed.tsx`, the no-cookie player). A `draft` video shows only on previews and
local builds; publishing one is the owner's decision. The Watch link in the header and footer and the sitemap entry
appear once a video is published.

### Image prompt log

`lib/image-prompts.ts` records the exact prompt behind every generated image on the site; the rules and the scoring
rubric are in `docs/IMAGE_PROMPTS.md`. A file under `public/art/` with no logged run fails the tests.

## Vercel

Create a separate Vercel project with **Root Directory `apps/marketing`**, framework Next.js, Node 24. `vercel.json`
here sets the install and build commands and skips builds when nothing under this directory changed. Creating the
project, setting variables and pointing a domain at it are owner steps.

### Analytics (consent first)

PostHog, ported from the BattleBlocks site, in `lib/analytics/` with the choice in `components/Consent.tsx`. It is inert
without `NEXT_PUBLIC_POSTHOG_KEY`. With a key, nothing is loaded, sent or stored before the visitor chooses; the
library is a dynamic import behind the first accepted category.

- Two categories. Acquisition: the landing page view with allowlisted campaign fields and the referring host. Product:
  page views (path only), `outbound_link` (host only), the four signup steps and `update_opened` (slug), with a random
  anonymous ID in localStorage. No cookies, autocapture, session recording, surveys or feature flags.
- Only events and properties listed in `lib/analytics/taxonomy.ts` can leave the browser; PostHog's `before_send` hook
  re-checks every event. Never add an email address, wallet address, token or full URL as a property.
- Campaign links use `utm_source`, `utm_medium`, `utm_campaign` and `utm_content`; values outside the allowlist in
  `lib/analytics/campaign.ts` are discarded. Add a source or campaign there before using it in a post.
- Withdrawing a category stops collection at once and removes PostHog's keys from the browser.
- Tests: `tests/analytics.test.ts` and `tests/analytics-hardening.test.ts` run the whole behaviour against a fake PostHog.

## Not in this first slice

A health endpoint and uptime alert, and video pages. The BattleBlocks site has each of these and they can be ported the same way.
