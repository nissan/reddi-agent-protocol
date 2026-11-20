// Newsletter configuration (WEB-07). Everything is read from environment variables that the owner sets
// in Vercel from 1Password; nothing here is a secret and no secret is ever logged or sent to the client.
export type NewsletterEnv = Partial<Record<"NEWSLETTER_ENABLED" | "NEWSLETTER_PUBLIC" | "NEWSLETTER_SIGNING_SECRET" | "NEWSLETTER_ALLOWED_RECIPIENTS" | "NEWSLETTER_FROM" | "NEWSLETTER_REPLY_TO" | "RESEND_API_KEY" | "BLOB_READ_WRITE_TOKEN" | "BLOB_STORE_ID" | "NEXT_PUBLIC_SITE_URL" | "VERCEL_PROJECT_PRODUCTION_URL" | "VERCEL_URL", string>>;

export type NewsletterConfig = {
  enabled: boolean;            // NEWSLETTER_ENABLED=1: endpoints accept requests (default off: 503 as before)
  publicCollection: boolean;   // NEWSLETTER_PUBLIC=1 only after the WEB-04 approval is recorded; otherwise the allowlist applies
  allowedRecipients: string[]; // lower-case addresses or @domains the owner controls (partial-start contract)
  signingSecret: string;
  from: string;
  replyTo: string | undefined;
  resendApiKey: string;
  // Which Vercel Blob credential the environment provides (never the credential itself). "oidc": BLOB_STORE_ID is set, so the
  // SDK authenticates with the deployment's short-lived OIDC token; "token": only the legacy BLOB_READ_WRITE_TOKEN. With both,
  // the SDK itself prefers OIDC when it can obtain an OIDC token and otherwise falls back to the legacy token, so "oidc" is
  // reported (docs/project/WEB_BLOB_OIDC_EVIDENCE.md).
  blobAuth: BlobAuthMode;
};
export type BlobAuthMode = "token" | "oidc";

export type ConfigResult = { ok: true; config: NewsletterConfig } | { ok: false; reason: string };

export function readConfig(env: NewsletterEnv): ConfigResult {
  if (env.NEWSLETTER_ENABLED !== "1") return { ok: false, reason: "disabled" };
  const missing = (["NEWSLETTER_SIGNING_SECRET", "NEWSLETTER_FROM", "RESEND_API_KEY"] as const).filter((k) => !env[k]);
  const blobAuth: BlobAuthMode | null = env.BLOB_STORE_ID?.trim() ? "oidc" : env.BLOB_READ_WRITE_TOKEN?.trim() ? "token" : null;
  const absent: string[] = [...missing, ...(blobAuth ? [] : ["BLOB_STORE_ID (OIDC) or BLOB_READ_WRITE_TOKEN (legacy)"])];
  if (absent.length) return { ok: false, reason: `missing ${absent.join(", ")}` };
  if ((env.NEWSLETTER_SIGNING_SECRET ?? "").length < 32) return { ok: false, reason: "NEWSLETTER_SIGNING_SECRET must be at least 32 characters" };
  const publicCollection = env.NEWSLETTER_PUBLIC === "1";
  const allowedRecipients = (env.NEWSLETTER_ALLOWED_RECIPIENTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!publicCollection && allowedRecipients.length === 0) return { ok: false, reason: "NEWSLETTER_ALLOWED_RECIPIENTS is required until NEWSLETTER_PUBLIC=1" };
  return { ok: true, config: { enabled: true, publicCollection, allowedRecipients, signingSecret: env.NEWSLETTER_SIGNING_SECRET!, from: env.NEWSLETTER_FROM!, replyTo: env.NEWSLETTER_REPLY_TO || undefined, resendApiKey: env.RESEND_API_KEY!, blobAuth: blobAuth! } };
}

// Under the partial-start contract only owner-controlled mailboxes may be stored or emailed.
export function recipientAllowed(config: NewsletterConfig, email: string): boolean {
  if (config.publicCollection) return true;
  const e = email.toLowerCase();
  return config.allowedRecipients.some((a) => (a.startsWith("@") ? e.endsWith(a) : e === a));
}
