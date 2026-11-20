/**
 * Server-side check of a wallet sign-in session (#740).
 *
 * The browser signs in with its wallet through the auth service and sends the
 * resulting access token as a bearer token. This module asks the auth service
 * who the token belongs to and reads the wallet from the sign-in identity the
 * auth service recorded. It never trusts a wallet address sent by the browser,
 * and never reads `user_metadata`, which a signed-in user can edit.
 */

import { supabasePublicConfig, type SupabasePublicConfig } from "@/lib/supabase/config";

export type WalletSession = { ok: true; userId: string; wallet: string; accessToken: string };
export type WalletSessionRefusal = { ok: false; status: 401 | 503; code: "no_session" | "invalid_session" | "no_wallet_identity" | "sign_in_unavailable"; message: string };

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOLANA_IDENTITY = "web3:solana:";

function refuse(status: 401 | 503, code: WalletSessionRefusal["code"], message: string): WalletSessionRefusal {
  return { ok: false, status, code, message };
}

/**
 * The Solana wallet a user signed in with, from the identities the auth service
 * recorded. The identity id has the form `web3:solana:<address>`. Returns
 * undefined unless there is exactly one such wallet.
 */
export function walletFromAuthUser(user: unknown): string | undefined {
  if (!user || typeof user !== "object") return undefined;
  const identities = (user as { identities?: unknown }).identities;
  if (!Array.isArray(identities)) return undefined;
  const wallets = new Set<string>();
  for (const identity of identities) {
    if (!identity || typeof identity !== "object") continue;
    const record = identity as { provider?: unknown; provider_id?: unknown; identity_data?: { sub?: unknown } | null };
    if (record.provider !== "web3") continue;
    for (const candidate of [record.provider_id, record.identity_data?.sub]) {
      if (typeof candidate === "string" && candidate.startsWith(SOLANA_IDENTITY)) {
        const address = candidate.slice(SOLANA_IDENTITY.length);
        if (WALLET.test(address)) wallets.add(address);
      }
    }
  }
  return wallets.size === 1 ? [...wallets][0] : undefined;
}

export function bearerToken(headers: Headers): string | undefined {
  const value = headers.get("authorization");
  const match = value ? /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(value) : null;
  return match?.[1];
}

export interface WalletSessionDeps {
  config?: SupabasePublicConfig;
  fetchImpl?: FetchLike;
}

/** Who is calling, according to the auth service. Refuses unless a wallet sign-in session is proven. */
export async function authenticateWalletRequest(headers: Headers, deps: WalletSessionDeps = {}): Promise<WalletSession | WalletSessionRefusal> {
  const config = deps.config ?? supabasePublicConfig();
  if (!config) return refuse(503, "sign_in_unavailable", "Sign-in is not configured on this deployment.");
  const token = bearerToken(headers);
  if (!token) return refuse(401, "no_session", "Sign in with your wallet first.");

  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  let user: unknown;
  try {
    const response = await fetchImpl(`${config.url}/auth/v1/user`, {
      method: "GET",
      headers: { apikey: config.anonKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401 || response.status === 403) return refuse(401, "invalid_session", "Your session has ended. Sign in again.");
    if (!response.ok) return refuse(503, "sign_in_unavailable", "Sign-in could not be checked right now.");
    user = await response.json();
  } catch {
    return refuse(503, "sign_in_unavailable", "Sign-in could not be checked right now.");
  }

  const userId = user && typeof user === "object" ? (user as { id?: unknown }).id : undefined;
  if (typeof userId !== "string" || !USER_ID.test(userId)) return refuse(401, "invalid_session", "Your session has ended. Sign in again.");
  const wallet = walletFromAuthUser(user);
  if (!wallet) return refuse(401, "no_wallet_identity", "This account did not sign in with a Solana wallet.");
  return { ok: true, userId, wallet, accessToken: token };
}

/** True when the signed-in wallet owns the record. Every write to an owned record goes through this. */
export function ownsWallet(session: WalletSession, recordWallet: string): boolean {
  return typeof recordWallet === "string" && recordWallet.length > 0 && session.wallet === recordWallet;
}
