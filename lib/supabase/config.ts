/**
 * Public database settings for the browser (#740). The URL and the publishable
 * (anon) key are safe to ship: row level security decides what they can read.
 * The service role key is never read here.
 */

export type SupabasePublicConfig = { url: string; anonKey: string };

/** A bare https origin, or undefined. No path, credentials, query or fragment. */
export function supabaseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
  if (url.pathname !== "/" && url.pathname !== "") return undefined;
  return url.origin;
}

/** Undefined until the operator has configured the project, which leaves sign-in switched off. */
export function supabasePublicConfig(
  url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
): SupabasePublicConfig | undefined {
  const origin = supabaseOrigin(url);
  const key = anonKey?.trim();
  if (!origin || !key) return undefined;
  return { url: origin, anonKey: key };
}
