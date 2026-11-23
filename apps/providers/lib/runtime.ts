/**
 * Per instance: one small database pool, and each provider built once on its
 * first request. A provider that could not be built is not cached, so a fixed
 * setting takes effect without a redeploy of the code.
 */
import pg from "pg";
import type { PgPool } from "@redditech/provider-kit";
import { loadProvider, type Loaded, type ProviderName } from "./providers.ts";

let pool: PgPool | undefined;
const built = new Map<ProviderName, Loaded>();

function sharedPool(): PgPool | undefined {
  const url = process.env.PROVIDER_KIT_DATABASE_URL?.trim();
  if (!url) return undefined;
  // A serverless instance serves one request at a time; a few connections cover the sweep and the settle.
  pool ??= new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 }) as unknown as PgPool;
  return pool;
}

export const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ source: "rap-provider", ...event }));

export function provider(name: ProviderName): Loaded {
  const cached = built.get(name);
  if (cached) return cached;
  const loaded = loadProvider(name, process.env, sharedPool, log);
  if (loaded.ok) built.set(name, loaded);
  else log({ event: "provider_not_configured", provider: name, reason: loaded.message, alert: true });
  return loaded;
}
