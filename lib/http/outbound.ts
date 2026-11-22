/**
 * Outbound requests to caller-influenced URLs (provider endpoints, probe targets).
 *
 * Security audit round 1, S2-claude-02 (condition C3): the server must not be usable to
 * reach loopback, private, link-local, CGNAT or metadata addresses, and must not follow a
 * redirect from a public endpoint to such an address. `checkOutboundUrl` parses the URL,
 * resolves its host and refuses any non-public address; `fetchOutbound` runs the check
 * and fetches with `redirect: "manual"`, so a 3xx comes back to the caller as a failure.
 *
 * DNS rebinding: the connection is pinned to the addresses that passed the check. The
 * request goes through an undici dispatcher whose `lookup` returns those addresses, so a
 * name that resolves to a public address for the check and a private one a moment later
 * cannot redirect the connection. TLS still verifies the certificate for the URL's host.
 */
import { lookup } from "dns/promises";
import type { LookupAddress } from "dns";
import { BlockList, isIP } from "net";
import { Agent, fetch as undiciFetch } from "undici";

const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4 embeds an IPv4 address that can be private
  ["fec0::", 10], // deprecated site-local
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

/** True when `address` (an IPv4 or IPv6 literal) is not a public unicast address. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0];
  const family = isIP(bare);
  if (family === 4) return BLOCKED.check(bare, "ipv4");
  if (family === 6) {
    const lower = bare.toLowerCase();
    // IPv4-mapped and IPv4-compatible forms: judge the embedded IPv4 address.
    const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return BLOCKED.check(mapped[1], "ipv4");
    const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return BLOCKED.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, "ipv4");
    }
    if (lower.startsWith("::ffff:")) return true;
    return BLOCKED.check(bare, "ipv6");
  }
  return true;
}

export type OutboundCheck = { ok: true; url: URL; addresses: string[] } | { ok: false; reason: string };

type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

export type OutboundOptions = {
  /** Allow http:// as well as https:// (local development only). */
  allowHttp?: boolean;
  resolve?: Resolver;
};

/** Parses and checks a URL the server is about to fetch for a caller. */
export async function checkOutboundUrl(raw: string | URL, options: OutboundOptions = {}): Promise<OutboundCheck> {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : new URL(raw.toString());
  } catch {
    return { ok: false, reason: "The URL is not valid." };
  }
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    return { ok: false, reason: "Only https URLs can be reached." };
  }
  if (url.username || url.password) return { ok: false, reason: "URLs with user info are refused." };
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    return { ok: false, reason: "Local and private network addresses are refused." };
  }
  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = await (options.resolve ?? defaultResolver)(hostname);
    } catch {
      return { ok: false, reason: "The host name does not resolve." };
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    return { ok: false, reason: "Local and private network addresses are refused." };
  }
  return { ok: true, url, addresses: addresses.map((address) => address.replace(/^\[|\]$/g, "")) };
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A `dns.lookup` stand-in that only ever answers with the checked addresses. */
export function pinnedLookup(addresses: readonly string[]) {
  const entries: LookupAddress[] = addresses.map((address) => ({ address, family: isIP(address) }));
  return (_hostname: string, options: { all?: boolean } | undefined, callback: LookupCallback) => {
    if (entries.length === 0) {
      callback(Object.assign(new Error("No checked address to connect to."), { code: "ENOTFOUND" }), []);
      return;
    }
    if (options?.all) callback(null, entries);
    else callback(null, entries[0].address, entries[0].family);
  };
}

/**
 * Fetches `url` with the connection pinned to `addresses` (already checked). One dispatcher
 * per request; it is closed once the request, body included, has finished.
 */
export async function fetchPinned(url: URL, init: RequestInit, addresses: readonly string[]): Promise<Response> {
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses) as never } });
  try {
    const response = await undiciFetch(url.toString(), { ...(init as Parameters<typeof undiciFetch>[1]), redirect: "manual", dispatcher });
    void dispatcher.close().catch(() => undefined);
    return response as unknown as Response;
  } catch (error) {
    void dispatcher.destroy().catch(() => undefined);
    throw error;
  }
}

export class OutboundRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "OutboundRefusedError";
  }
}

/**
 * Checks the URL, then fetches it without following redirects, connected only to the checked
 * addresses. A refused URL throws `OutboundRefusedError`; a 3xx answer is returned as is.
 * `fetchImpl` replaces the pinned transport (tests only).
 */
export async function fetchOutbound(
  raw: string | URL,
  init: RequestInit = {},
  options: OutboundOptions & { fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const checked = await checkOutboundUrl(raw, options);
  if (!checked.ok) throw new OutboundRefusedError(checked.reason);
  if (options.fetchImpl) return options.fetchImpl(checked.url.toString(), { ...init, redirect: "manual" });
  return outboundTransport(checked.url, init, checked.addresses);
}

type Transport = (url: URL, init: RequestInit, addresses: readonly string[]) => Promise<Response>;
let outboundTransport: Transport = fetchPinned;

/** Test seam: swap the pinned transport. Returns a function that restores the previous one. */
export function setOutboundTransportForTests(transport: Transport): () => void {
  const previous = outboundTransport;
  outboundTransport = transport;
  return () => {
    outboundTransport = previous;
  };
}

/** http:// is allowed for outbound calls only in local development on a non-production build. */
export function outboundAllowsHttp(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "development";
}
