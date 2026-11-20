// Newsletter issues. Vercel cron calls GET once a day (vercel.json, 23:10 UTC, mid-morning in Sydney) with
// `Authorization: Bearer <CRON_SECRET>`. An update flagged `newsletterSend: true` that is published, dated today
// (Sydney) or earlier and not yet completely sent goes to confirmed subscribers, at most one issue per run, oldest
// first. Needs NEWSLETTER_ENABLED and NEWSLETTER_AUTOSEND=1; otherwise it does nothing. Rules: lib/newsletter/issues.ts.
import { autosendHandler } from "../../../../lib/newsletter/autosend.ts";
import { UPDATES } from "../../../../lib/updates.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a send is one provider call and one ledger write per recipient

export async function GET(req: Request) {
  return autosendHandler(req, UPDATES);
}
