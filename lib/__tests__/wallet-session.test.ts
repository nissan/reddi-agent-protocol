import { authenticateWalletRequest, bearerToken, ownsWallet, walletFromAuthUser } from "@/lib/auth/wallet-session";
import { supabaseOrigin, supabasePublicConfig } from "@/lib/supabase/config";

const WALLET_A = "7Y6oUj3vCz7xqGmJmT7Q7m4mGkq3rq9t7u7Hq3iJ1dQp";
const WALLET_B = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const USER_ID = "3f2c1a7e-0b6d-4c1e-9a55-2f0f6a1d9b10";
const TOKEN = "a".repeat(40);
const config = { url: "https://project.supabase.example", anonKey: "public-anon-key" };

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    // A signed-in user can edit this, so it must never decide the wallet.
    user_metadata: { custom_claims: { address: WALLET_B }, sub: `web3:solana:${WALLET_B}` },
    identities: [{ provider: "web3", provider_id: `web3:solana:${WALLET_A}`, identity_data: { sub: `web3:solana:${WALLET_A}` } }],
    ...overrides,
  };
}

function authService(status: number, body: unknown) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

const headers = (value?: string) => new Headers(value ? { authorization: value } : {});

describe("wallet sign-in session (#740)", () => {
  it("accepts only a bare https origin for the project", () => {
    expect(supabaseOrigin("https://project.supabase.example/")).toBe("https://project.supabase.example");
    for (const bad of [undefined, "", "http://x.example", "https://u:p@x.example", "https://x.example/path", "https://x.example?a=1", "nope"]) {
      expect(supabaseOrigin(bad)).toBeUndefined();
    }
    expect(supabasePublicConfig(undefined, "k")).toBeUndefined();
    expect(supabasePublicConfig("https://x.example", " ")).toBeUndefined();
    expect(supabasePublicConfig("https://x.example", "k")).toEqual({ url: "https://x.example", anonKey: "k" });
  });

  it("reads the wallet from the recorded sign-in identity, never from editable metadata", () => {
    expect(walletFromAuthUser(user())).toBe(WALLET_A);
    expect(walletFromAuthUser(user({ identities: [] }))).toBeUndefined();
    expect(walletFromAuthUser(user({ identities: undefined }))).toBeUndefined();
    expect(walletFromAuthUser(user({ identities: [{ provider: "email", provider_id: `web3:solana:${WALLET_A}` }] }))).toBeUndefined();
    expect(walletFromAuthUser(user({ identities: [{ provider: "web3", provider_id: "web3:ethereum:0xabc" }] }))).toBeUndefined();
    expect(walletFromAuthUser(user({ identities: [{ provider: "web3", provider_id: "web3:solana:not-base58!" }] }))).toBeUndefined();
    // Two different wallets on one account is ambiguous, so neither is used.
    expect(
      walletFromAuthUser(user({ identities: [{ provider: "web3", provider_id: `web3:solana:${WALLET_A}` }, { provider: "web3", provider_id: `web3:solana:${WALLET_B}` }] })),
    ).toBeUndefined();
    expect(walletFromAuthUser(null)).toBeUndefined();
  });

  it("parses only a well-formed bearer token", () => {
    expect(bearerToken(headers(`Bearer ${TOKEN}`))).toBe(TOKEN);
    expect(bearerToken(headers())).toBeUndefined();
    expect(bearerToken(headers(`Basic ${TOKEN}`))).toBeUndefined();
    expect(bearerToken(headers("Bearer short"))).toBeUndefined();
    expect(bearerToken(headers(`Bearer ${TOKEN} extra`))).toBeUndefined();
  });

  it("refuses a request with no session without calling the auth service (S3)", async () => {
    const auth = authService(200, user());
    await expect(authenticateWalletRequest(headers(), { config, fetchImpl: auth.fetchImpl })).resolves.toMatchObject({ ok: false, status: 401, code: "no_session" });
    expect(auth.calls).toHaveLength(0);
  });

  it("is unavailable, not open, when sign-in is not configured", async () => {
    const before = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      await expect(authenticateWalletRequest(headers(`Bearer ${TOKEN}`))).resolves.toMatchObject({ ok: false, status: 503, code: "sign_in_unavailable" });
    } finally {
      if (before.url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = before.url;
      if (before.key !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = before.key;
    }
  });

  it("returns the wallet the auth service vouches for", async () => {
    const auth = authService(200, user());
    const session = await authenticateWalletRequest(headers(`Bearer ${TOKEN}`), { config, fetchImpl: auth.fetchImpl });
    expect(session).toEqual({ ok: true, userId: USER_ID, wallet: WALLET_A, accessToken: TOKEN });
    expect(auth.calls[0].url).toBe("https://project.supabase.example/auth/v1/user");
    expect(auth.calls[0].headers).toEqual({ apikey: "public-anon-key", authorization: `Bearer ${TOKEN}` });
  });

  it.each([
    ["an expired or forged token", 401, {}, 401, "invalid_session"],
    ["an auth service error", 500, {}, 503, "sign_in_unavailable"],
    ["a user with no id", 200, user({ id: undefined }), 401, "invalid_session"],
    ["a user who did not sign in with a wallet", 200, user({ identities: [{ provider: "email", provider_id: "x" }] }), 401, "no_wallet_identity"],
  ])("refuses %s", async (_name, status, body, expectedStatus, code) => {
    const auth = authService(status as number, body);
    await expect(authenticateWalletRequest(headers(`Bearer ${TOKEN}`), { config, fetchImpl: auth.fetchImpl })).resolves.toMatchObject({ ok: false, status: expectedStatus, code });
  });

  it("fails closed when the auth service cannot be reached", async () => {
    const fetchImpl = async () => {
      throw new Error("network");
    };
    await expect(authenticateWalletRequest(headers(`Bearer ${TOKEN}`), { config, fetchImpl })).resolves.toMatchObject({ ok: false, status: 503 });
  });

  it("lets a wallet act only on its own record (S2)", () => {
    const session = { ok: true as const, userId: USER_ID, wallet: WALLET_A, accessToken: TOKEN };
    expect(ownsWallet(session, WALLET_A)).toBe(true);
    expect(ownsWallet(session, WALLET_B)).toBe(false);
    expect(ownsWallet(session, "")).toBe(false);
  });
});
