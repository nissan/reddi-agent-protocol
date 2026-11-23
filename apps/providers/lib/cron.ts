import { timingSafeEqual } from "node:crypto";

/** True only for `Bearer <secret>` with a secret set; compared in constant time. */
export function authorised(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
