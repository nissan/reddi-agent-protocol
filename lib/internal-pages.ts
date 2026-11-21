/**
 * Operator and tester pages that stay out of the public app.
 *
 * They render only when the build sets NEXT_PUBLIC_SHOW_INTERNAL_PAGES=true
 * (local dev and the Playwright web server do; production does not). When the
 * flag is off, each page's layout returns a 404, carries a noindex robots tag,
 * and public pages drop their links to it.
 */
export const INTERNAL_PAGE_PREFIXES = ["/manager", "/dogfood", "/testers"] as const;

// Read as a literal so Next inlines it into the client bundle at build time.
const SHOW_INTERNAL_PAGES = process.env.NEXT_PUBLIC_SHOW_INTERNAL_PAGES;

export function internalPagesEnabled(flag: string | undefined = SHOW_INTERNAL_PAGES): boolean {
  return flag === "true";
}

export function isInternalPath(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  return INTERNAL_PAGE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Drops links to internal pages unless they are enabled. */
export function withoutInternalLinks<T extends { href: string }>(
  links: readonly T[],
  enabled: boolean = internalPagesEnabled(),
): T[] {
  return enabled ? [...links] : links.filter((link) => !isInternalPath(link.href));
}
