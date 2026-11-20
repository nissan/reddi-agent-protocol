// Build updates (the devlog). One typed record per update, kept in this file so a change is reviewed like code and the
// public-claim test (tests/claims.test.ts) reads every word. The same records feed /updates, each update's page, the
// sitemap and the newsletter issue that announces an update.
//
// Rules, enforced by tests/updates.test.ts:
//  - `status: "draft"` is shown only where reviewers look (previews and local builds; resolveShowDrafts in lib/site.ts).
//    Only "published" updates appear on the public site, in the sitemap or in an email.
//  - `newsletterSend: true` asks for the update to be emailed to confirmed subscribers once it is published and its
//    date has arrived. The reviewed, merged change that sets it is the owner's approval. Never set it without the owner.
//  - every update names at least one link where a reader can check what it says.
export type UpdateStatus = "draft" | "published";
export type Update = {
  slug: string;        // lower-case words joined by hyphens; the address is /updates/<slug>
  date: string;        // YYYY-MM-DD, meant as a calendar day in Sydney
  title: string;
  summary: string;     // one or two sentences; this is the body of the email
  body: readonly string[]; // paragraphs of plain text
  links: readonly { label: string; href: string }[];
  status: UpdateStatus;
  newsletterSend?: boolean;
};

export const UPDATES: readonly Update[] = [
  {
    slug: "devnet-sandbox-open",
    date: "2026-11-20",
    title: "The devnet sandbox is open",
    summary: "You can now walk through four short scenarios in the browser and see the receipt each one produces. Payments are simulated by default and nothing is on mainnet yet.",
    body: [
      "The sandbox is the first thing you can try. It runs four short scenarios: buy a code review, shop around between providers, try to cheat, and see what happens when a provider goes dark. Each one ends with the receipt the protocol produces, so you can read what was asked, what was paid and what came back.",
      "The default payment is simulated, so you do not need a wallet. A Solana devnet wallet is optional. The sandbox providers answer from a script, not from a running model, and every receipt says so.",
      "Nothing is on mainnet yet. The status page lists what exists today, what is being built and what is only planned.",
    ],
    links: [
      { label: "Open the sandbox", href: "https://agent-protocol.reddi.tech/sandbox" },
      { label: "Read the source", href: "https://github.com/nissan/reddi-agent-protocol" },
    ],
    status: "draft",
  },
];

const byNewest = (a: Update, b: Update) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug));

// What a visitor may see: published updates everywhere, drafts only where drafts are shown. Newest first.
export function visibleUpdates(showDrafts: boolean, updates: readonly Update[] = UPDATES): Update[] {
  return updates.filter((u) => u.status === "published" || showDrafts).sort(byNewest);
}

export function findUpdate(slug: string, showDrafts: boolean, updates: readonly Update[] = UPDATES): Update | null {
  return visibleUpdates(showDrafts, updates).find((u) => u.slug === slug) ?? null;
}

// Problems with the records, as readable lines; an empty list means they are valid. Run by the tests, so a bad record
// fails CI before it can reach a page or an email.
export function validateUpdates(updates: readonly Update[] = UPDATES): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const u of updates) {
    const at = u.slug || "(no slug)";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(u.slug)) problems.push(`${at}: slug must be lower-case words joined by hyphens`);
    if (seen.has(u.slug)) problems.push(`${at}: slug is used twice`);
    seen.add(u.slug);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u.date) || Number.isNaN(Date.parse(`${u.date}T00:00:00Z`))) problems.push(`${at}: date must be YYYY-MM-DD`);
    if (u.title.trim().length < 8 || u.title.length > 90) problems.push(`${at}: title must be 8 to 90 characters`);
    if (u.summary.trim().length < 40 || u.summary.length > 320) problems.push(`${at}: summary must be 40 to 320 characters`);
    if (u.body.length === 0 || u.body.some((p) => p.trim().length === 0)) problems.push(`${at}: body needs at least one paragraph and no empty ones`);
    if (u.links.length === 0) problems.push(`${at}: at least one link where the reader can check it`);
    for (const l of u.links) if (!/^https:\/\/[^\s]+$/.test(l.href) || l.label.trim().length === 0) problems.push(`${at}: link "${l.label}" must be a labelled https address`);
    if (u.status !== "draft" && u.status !== "published") problems.push(`${at}: status must be draft or published`);
  }
  return problems;
}
