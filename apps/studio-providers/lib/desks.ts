/**
 * The four RAP studio desks (Script, Voice, Video, Stitch), each on its own path of this one Vercel
 * project and each a separate registered provider with its own wallet. The configs are the reviewed
 * files in deploy/studio-providers; what differs per deployment comes from the environment:
 *
 * - STUDIO_PUBLIC_ORIGIN: where this project is served (https). Each desk is at /<desk>.
 * - STUDIO_GATEWAY_URL: the GPU gateway Worker (apps/gpu-gateway), https.
 * - PROVIDER_KIT_DATABASE_URL (sensitive): the provider_kit schema, as for the other RAP providers.
 * - STUDIO_<DESK>_WALLET, STUDIO_<DESK>_KEYPAIR (sensitive) and STUDIO_DESK_SECRET_<DESK> (sensitive,
 *   the HMAC secret the gateway holds for that desk) per desk, such as STUDIO_VOICE_WALLET.
 *
 * Devnet only: the GPU is one card on rtwin1 and the files are AI-generated demo media. A desk that is
 * not fully set up refuses calls with 503 and charges nothing.
 */
import { createServerlessProvider, type PgPool, type ProviderConfigFile, type ServerlessProvider } from "@redditech/provider-kit";
import { createGatewayClient, type GatewayClient } from "./gateway-client.ts";
import { createStudioUpstream, type Desk } from "./studio-upstream.ts";
import script from "../../../deploy/studio-providers/script.devnet.provider.json" with { type: "json" };
import voice from "../../../deploy/studio-providers/voice.devnet.provider.json" with { type: "json" };
import video from "../../../deploy/studio-providers/video.devnet.provider.json" with { type: "json" };
import stitch from "../../../deploy/studio-providers/stitch.devnet.provider.json" with { type: "json" };

export const DESKS = {
  script: { prefix: "SCRIPT", file: script },
  voice: { prefix: "VOICE", file: voice },
  video: { prefix: "VIDEO", file: video },
  stitch: { prefix: "STITCH", file: stitch },
} as const satisfies Record<Desk, unknown>;

export type Loaded = { ok: true; provider: ServerlessProvider } | { ok: false; message: string };
type Env = Record<string, string | undefined>;

export const isDesk = (name: string): name is Desk => Object.hasOwn(DESKS, name);

function httpsOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** One desk, built from its reviewed config and this deployment's environment. */
export function loadDesk(
  desk: Desk,
  env: Env,
  pool: () => PgPool | undefined,
  log?: (event: Record<string, unknown>) => void,
  gatewayFor: (origin: string, desk: Desk, secret: string) => GatewayClient = (origin, d, secret) => createGatewayClient({ origin, desk: d, secret }),
): Loaded {
  const base = httpsOrigin(env.STUDIO_PUBLIC_ORIGIN);
  if (!base) return { ok: false, message: "STUDIO_PUBLIC_ORIGIN must be an https origin" };
  const gatewayOrigin = httpsOrigin(env.STUDIO_GATEWAY_URL);
  if (!gatewayOrigin) return { ok: false, message: "STUDIO_GATEWAY_URL must be an https origin" };
  const entry = DESKS[desk];
  const wallet = env[`STUDIO_${entry.prefix}_WALLET`]?.trim();
  if (!wallet) return { ok: false, message: `STUDIO_${entry.prefix}_WALLET is not set` };
  const secret = env[`STUDIO_DESK_SECRET_${entry.prefix}`]?.trim();
  if (!secret || secret.length < 32) return { ok: false, message: `STUDIO_DESK_SECRET_${entry.prefix} must be set (32 characters or more)` };
  const db = pool();
  if (!db) return { ok: false, message: "PROVIDER_KIT_DATABASE_URL is not set" };
  if (entry.file.network !== "solana-devnet") return { ok: false, message: "the studio desks are devnet only" };

  const file = { ...entry.file, wallet, publicUrl: `${base}/${desk}` } as ProviderConfigFile;
  const gateway = gatewayFor(gatewayOrigin, desk, secret);
  return createServerlessProvider({
    file,
    env,
    pool: db,
    upstream: createStudioUpstream(desk, gateway, { markCollected: (task) => gateway.markCollected(task) }),
    keyEnv: `STUDIO_${entry.prefix}_KEYPAIR`,
    basePath: `/${desk}`,
    ...(log ? { log } : {}),
  });
}
