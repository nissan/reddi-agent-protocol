// One-off owner tool (owner decision, 23 November 2026): before launch, remove the owner's own test addresses from the
// newsletter list. "Internal" means matched by NEWSLETTER_ALLOWED_RECIPIENTS (addresses or @domains). Dry run by
// default: it prints counts only. With --delete it deletes each internal contact with a version check, so a record that
// changed since it was read is left alone. Never prints an address. Run it from apps/marketing:
//
//   vercel env pull .env.reset --environment=production --yes
//   node --env-file=.env.reset --experimental-strip-types scripts/newsletter-remove-internal.ts            # dry run
//   node --env-file=.env.reset --experimental-strip-types scripts/newsletter-remove-internal.ts --delete   # delete
//   rm .env.reset
import { isInternal } from "../lib/newsletter/issues.ts";
import { BlobStore, contactKey } from "../lib/newsletter/store.ts";

const allowed = (process.env.NEWSLETTER_ALLOWED_RECIPIENTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
if (allowed.length === 0) { console.error("NEWSLETTER_ALLOWED_RECIPIENTS is empty: nothing is marked internal, so nothing would be removed."); process.exit(1); }
const remove = process.argv.includes("--delete");
const store = new BlobStore();
const contacts = await store.listContacts();
const internal = contacts.filter((c) => isInternal({ allowedRecipients: allowed }, c.value.email));
console.log(`contacts: ${contacts.length}, internal: ${internal.length}, others kept: ${contacts.length - internal.length}`);
if (!remove) { console.log("Dry run. Run again with --delete to remove the internal contacts."); process.exit(0); }
let deleted = 0, skipped = 0;
for (const c of internal) {
  try { await store.deleteContact(contactKey(c.value.email), { version: c.version }); deleted++; }
  catch (error) { skipped++; console.error(`skipped one record: ${error instanceof Error ? error.name : "error"}`); }
}
console.log(`deleted: ${deleted}, skipped: ${skipped}`);
