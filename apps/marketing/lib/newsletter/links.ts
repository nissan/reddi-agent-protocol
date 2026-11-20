// Links inside newsletter emails. The "catch up" link points at the status page, which always says what exists today.
export const CATCH_UP_PATH = "/status";
export const CATCH_UP_LABEL = "See what exists today";

export function catchUpLink(siteUrl: string): string {
  return `${siteUrl}${CATCH_UP_PATH}`;
}

// The page of one build update. The slug is validated where updates are defined (lib/updates.ts); a malformed one is
// refused here too, so an email can never carry a link built from unexpected text.
export function updateLink(siteUrl: string, slug: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("update link refused: malformed slug");
  return `${siteUrl}/updates/${slug}`;
}
