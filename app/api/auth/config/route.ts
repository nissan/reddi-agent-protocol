import { supabasePublicConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/config
 * Where a wallet signs in, for clients that are not this site's own pages (the
 * provider kit's `rap-provider register`). Returns only what every browser
 * already receives: the auth service's address and its publishable key. The
 * service role key is never read here.
 */
export async function GET() {
  const config = supabasePublicConfig();
  if (!config) {
    return Response.json({ ok: false, error: { code: "sign_in_unavailable", message: "Sign-in is not configured on this deployment." } }, { status: 503 });
  }
  return Response.json({ ok: true, authUrl: config.url, publishableKey: config.anonKey });
}
