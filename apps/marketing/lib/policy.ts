// Policy text facts. The contact address comes from NEXT_PUBLIC_CONTACT_EMAIL, which the owner sets; nothing is invented
// here. Without it the pages point to the public repository for contact.
export const POLICY = { version: "1.0", date: "20 November 2026", pendingDays: 7 } as const;
const raw = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
export const CONTACT_EMAIL: string | null = raw && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(raw) ? raw : null;
