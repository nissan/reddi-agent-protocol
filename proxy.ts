import { NextResponse, type NextRequest } from "next/server";
import { isV1Path, v1RoutesOnly } from "./lib/v1-routes";

/**
 * Serves only the V1 launch surface in a production build (issue #1149).
 * Anything else answers a plain 404 that does not say why.
 */
export function proxy(request: NextRequest) {
  if (!v1RoutesOnly()) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (isV1Path(pathname)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new NextResponse("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
