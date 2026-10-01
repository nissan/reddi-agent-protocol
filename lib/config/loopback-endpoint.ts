/**
 * Single owner of "is this endpoint provably local?".
 *
 * Local-surfpool Quasar is the only configuration that may resolve to the Quasar target, and it is
 * only meaningful against a Surfnet the lane started on loopback. Every caller consults this one
 * predicate rather than reimplementing it, so they cannot drift apart and let one of them route
 * Quasar-encoded instructions at a live cluster or bundle a browser-exposed Playwright signer secret
 * against a non-local endpoint: the web resolver (`lib/config/network.ts`), the demo-agent gate
 * (`packages/demo-agents/src/quasar-target-gate.ts`), the Playwright signer preflight
 * (`lib/wallet/playwright-wallet-safety.ts`), the build-time signer guard (`next.config.ts`), and the
 * Playwright web-server precondition check (`scripts/check-browser-wallet-command-preconditions.mjs`).
 *
 * Deliberately strict: anything that is not unambiguously a loopback address under URL parsing is
 * refused rather than interpreted.
 */

/**
 * True only for an `http://` or `ws://` URL with an explicit port, no credentials, and a host that
 * is `localhost`, an IPv4 address in `127.0.0.0/8`, or IPv6 `::1`. Callers that know whether they
 * are validating an HTTP RPC URL or a WebSocket URL pass `expectedProtocol` so a loopback URL with
 * the wrong scheme is refused. A malformed URL, a hostname that merely contains a loopback-looking
 * substring, and any DNS name that would have to be resolved to know where it points are all
 * refused.
 */
export function isLoopbackRpcUrl(raw?: string, expectedProtocol?: "http:" | "ws:"): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (expectedProtocol) {
    if (url.protocol !== expectedProtocol) return false;
  } else if (url.protocol !== "http:" && url.protocol !== "ws:") return false;
  if (!url.port) return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
    return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[0] === 127;
  }

  if (!host.includes(":")) return false;
  return expandIpv6(host) === "0:0:0:0:0:0:0:1";
}

/** Normalises an IPv6 host to eight explicit hextets, or undefined when it is not a plain IPv6 literal. */
function expandIpv6(host: string): string | undefined {
  if (host.includes("%")) return undefined;
  const halves = host.split("::");
  if (halves.length > 2) return undefined;

  const parse = (part: string): string[] | undefined => {
    if (part === "") return [];
    const hextets = part.split(":");
    if (hextets.some((hextet) => !/^[0-9a-f]{1,4}$/.test(hextet))) return undefined;
    return hextets;
  };

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return undefined;

  let hextets: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return undefined;
    hextets = [...head, ...Array.from({ length: fill }, () => "0"), ...tail];
  } else {
    hextets = head;
  }
  if (hextets.length !== 8) return undefined;

  return hextets.map((hextet) => hextet.replace(/^0+(?=.)/, "")).join(":");
}
