import "server-only";

import { supabaseOrigin } from "@/lib/supabase/config";

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export type ProfileWrite = { ok: true } | { ok: false; status: 409 | 503; code: "wallet_taken" | "store_unavailable" };

/**
 * Records which wallet a signed-in user proved, with the server's own
 * credentials. The browser has no write access to this table. Both values come
 * from the auth service, never from the request body.
 */
export async function recordProfile(
  userId: string,
  wallet: string,
  deps: { url?: string; serviceKey?: string; fetchImpl?: FetchLike } = {},
): Promise<ProfileWrite> {
  const origin = supabaseOrigin(deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = (deps.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!origin || !serviceKey) return { ok: false, status: 503, code: "store_unavailable" };
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const response = await fetchImpl(`${origin}/rest/v1/profiles?on_conflict=user_id`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        // Same user signing in again is a no-op. A wallet already tied to another user is a conflict.
        prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ user_id: userId, wallet }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return { ok: true };
    if (response.status === 409) return { ok: false, status: 409, code: "wallet_taken" };
    return { ok: false, status: 503, code: "store_unavailable" };
  } catch {
    return { ok: false, status: 503, code: "store_unavailable" };
  }
}
