/**
 * Per instance: one small database pool, and each desk built once on its first request. A desk that
 * could not be built is not cached, so a fixed setting takes effect without a redeploy.
 */
import pg from "pg";
import { redactLogEvent, type PgPool } from "@redditech/provider-kit";
import { loadDesk, type Loaded } from "./desks.ts";
import type { Desk } from "./studio-upstream.ts";

let pool: PgPool | undefined;
const built = new Map<Desk, Loaded>();

function sharedPool(): PgPool | undefined {
  const url = process.env.PROVIDER_KIT_DATABASE_URL?.trim();
  if (!url) return undefined;
  pool ??= new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 }) as unknown as PgPool;
  return pool;
}

/** One JSON line per event, with any URL in it redacted (download links are signed). */
export const log = (event: Record<string, unknown>) => {
  console.log(JSON.stringify(redactLogEvent({ source: "rap-studio", ...event })));
};

export function desk(name: Desk): Loaded {
  const cached = built.get(name);
  if (cached) return cached;
  const loaded = loadDesk(name, process.env, sharedPool, log);
  if (loaded.ok) built.set(name, loaded);
  else log({ event: "desk_not_configured", desk: name, reason: loaded.message });
  return loaded;
}
