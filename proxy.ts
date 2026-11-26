import { NextResponse, type NextRequest } from "next/server";
import { isV1Path, v1RoutesOnly } from "./lib/v1-routes";
import { devnetAppOrigin, isDevnetOnlyApi, isDevnetOnlyPage, isMainnetEnv } from "./lib/config/mainnet-provider-guard";

function notFound(pathname: string) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new NextResponse("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
}

function proxyEnv(): Record<string, string | undefined> {
  return {
    NETWORK_PROFILE: process.env.NETWORK_PROFILE,
    NEXT_PUBLIC_BUILD_NETWORK_PROFILE: process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE,
    NEXT_PUBLIC_NETWORK_PROFILE: process.env.NEXT_PUBLIC_NETWORK_PROFILE,
    DEVNET_APP_ORIGIN: process.env.DEVNET_APP_ORIGIN,
  };
}

/**
 * Serves only the V1 launch surface in a production build (issue #1149).
 * Anything else answers a plain 404 that does not say why.
 *
 * On a mainnet build (#1203) the devnet sandbox providers' pages go to the devnet app
 * (`DEVNET_APP_ORIGIN`), or answer 404 when none is set, and their API routes answer 404:
 * the mainnet app holds no provider key, ledger or payout job.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const env = proxyEnv();
  if (isMainnetEnv(env)) {
    if (isDevnetOnlyApi(pathname)) return notFound(pathname);
    if (isDevnetOnlyPage(pathname)) {
      const origin = devnetAppOrigin(env);
      return origin ? NextResponse.redirect(`${origin}${pathname}${search}`, 307) : notFound(pathname);
    }
  }
  if (!v1RoutesOnly()) return NextResponse.next();
  if (isV1Path(pathname)) return NextResponse.next();
  return notFound(pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
