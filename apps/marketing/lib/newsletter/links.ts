// Links inside newsletter emails. The "catch up" link points at the status page, which always says what exists today.
export const CATCH_UP_PATH = "/status";
export const CATCH_UP_LABEL = "See what exists today";

export function catchUpLink(siteUrl: string): string {
  return `${siteUrl}${CATCH_UP_PATH}`;
}
