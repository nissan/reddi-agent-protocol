// Bot control for the signup endpoint (security review C2). Vercel BotID classifies the request from signals its
// client script attached (instrumentation-client.ts protects POST /api/subscribe). Fail-closed on Vercel: a bot is
// refused, and a check that throws (no OIDC token, BotID unreachable) refuses too, so signup never runs unguarded.
// Off Vercel (local runs, CI, unit tests) BotID cannot run, so the check is skipped; the site is only served from Vercel.
import { checkBotId } from "botid/server";
import { logStoreFailure } from "./http.ts";

export type BotVerdict = "human" | "bot" | "unavailable";
type Checker = () => Promise<{ isBot: boolean }>;

export async function verifyHuman(env: Record<string, string | undefined> = process.env, check: Checker = () => checkBotId()): Promise<BotVerdict> {
  if (env.VERCEL !== "1") return "human";
  try {
    return (await check()).isBot ? "bot" : "human";
  } catch (error) {
    logStoreFailure("bot-check", error);
    return "unavailable";
  }
}
