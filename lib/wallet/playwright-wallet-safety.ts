import { isLoopbackRpcUrl } from "@/lib/config/loopback-endpoint";

export const PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE =
  "Playwright wallet signer secret is refused outside disposable local-surfpool loopback tests" as const;

export type PlaywrightWalletSignerPreflightCode =
  | "no_secret_configured"
  | "allowed_local_surfpool_loopback"
  | "profile_not_local_surfpool"
  | "rpc_not_loopback"
  | "websocket_not_loopback";

export type PlaywrightWalletSignerPreflightInput = {
  secretPresent: boolean;
  networkProfileName?: string;
  rpcHttp?: string;
  rpcWs?: string;
};

export type PlaywrightWalletSignerPreflightResult =
  | { ok: true; code: "no_secret_configured" | "allowed_local_surfpool_loopback"; message: string }
  | { ok: false; code: Exclude<PlaywrightWalletSignerPreflightCode, "no_secret_configured" | "allowed_local_surfpool_loopback">; message: string };

/**
 * Pure preflight for the only remaining browser-exposed signer-secret boundary.
 *
 * `NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY` is already public to the browser when set, so this
 * guard treats it as disposable local-only test material and refuses before parsing or signing unless
 * the effective app profile is the local Surfpool profile and every effective endpoint is loopback.
 * The returned message deliberately never includes env values, endpoint strings, public keys, or raw
 * secret material so callers can surface it safely in UI/test errors.
 */
export function checkPlaywrightWalletSignerPreflight(
  input: PlaywrightWalletSignerPreflightInput,
): PlaywrightWalletSignerPreflightResult {
  if (!input.secretPresent) {
    return { ok: true, code: "no_secret_configured", message: "no Playwright signer secret configured" };
  }
  if (input.networkProfileName !== "local-surfpool") {
    return { ok: false, code: "profile_not_local_surfpool", message: PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE };
  }
  if (!isLoopbackRpcUrl(input.rpcHttp, "http:")) {
    return { ok: false, code: "rpc_not_loopback", message: PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE };
  }
  if (input.rpcWs && !isLoopbackRpcUrl(input.rpcWs, "ws:")) {
    return { ok: false, code: "websocket_not_loopback", message: PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE };
  }
  return { ok: true, code: "allowed_local_surfpool_loopback", message: "Playwright signer secret is limited to local-surfpool loopback" };
}
