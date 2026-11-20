"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { walletFromAuthUser } from "@/lib/auth/wallet-session";

export const SIGN_IN_STATEMENT = "Sign in to Reddi Agent Protocol. This proves you own this wallet. It does not move funds or approve any transaction.";

type State = { status: "signed_out" | "working" | "signed_in"; note?: string };

/**
 * Wallet sign-in control. Renders nothing until the project is configured and a
 * wallet is connected. Signing in asks the wallet to sign a message, never a
 * transaction.
 */
export function WalletSignIn() {
  const wallet = useWallet();
  const supabase = getBrowserSupabase();
  const [state, setState] = useState<State>({ status: "signed_out" });
  const address = wallet.publicKey?.toBase58();

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setState({ status: "signed_out" });
  }, [supabase]);

  // A session only counts while the same wallet is connected.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const sessionWallet = walletFromAuthUser(data.user);
      if (sessionWallet && address && sessionWallet === address) setState({ status: "signed_in" });
      else if (sessionWallet) void signOut();
      else setState((current) => (current.status === "working" ? current : { status: "signed_out" }));
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, address, signOut]);

  if (!supabase || !wallet.connected || !address) return null;

  async function signIn() {
    if (!supabase) return;
    setState({ status: "working" });
    try {
      const { data, error } = await supabase.auth.signInWithWeb3({ chain: "solana", statement: SIGN_IN_STATEMENT, wallet: wallet as never });
      const token = data?.session?.access_token;
      if (error || !token) {
        setState({ status: "signed_out", note: /reject|denied|cancel/i.test(error?.message ?? "") ? "You declined the sign-in message." : "Sign-in did not complete. Try again." });
        return;
      }
      const response = await fetch("/api/auth/session", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; wallet?: string; error?: { message?: string } } | null;
      if (!response.ok || !body?.ok || body.wallet !== address) {
        await supabase.auth.signOut();
        setState({ status: "signed_out", note: body?.error?.message ?? "Sign-in could not be confirmed. Try again." });
        return;
      }
      setState({ status: "signed_in" });
    } catch {
      setState({ status: "signed_out", note: "Sign-in did not complete. Try again." });
    }
  }

  return (
    <span className="flex items-center gap-2" data-testid="wallet-sign-in" data-status={state.status}>
      {state.status === "signed_in" ? (
        <button type="button" onClick={() => void signOut()} className="h-9 rounded-lg border border-white/15 px-3 text-sm text-gray-200 hover:bg-white/5">
          Sign out
        </button>
      ) : (
        <button
          type="button"
          disabled={state.status === "working"}
          onClick={() => void signIn()}
          className="h-9 rounded-lg border border-white/15 px-3 text-sm text-white hover:bg-white/5 disabled:opacity-60"
        >
          {state.status === "working" ? "Check your wallet…" : "Sign in"}
        </button>
      )}
      {state.note ? (
        <span role="status" className="max-w-[16rem] text-xs text-gray-400">
          {state.note}
        </span>
      ) : null}
    </span>
  );
}

/** The current access token for calling the app's write routes, or undefined when signed out. */
export async function currentAccessToken(): Promise<string | undefined> {
  const supabase = getBrowserSupabase();
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}
