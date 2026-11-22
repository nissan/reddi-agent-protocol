import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time check of an `Authorization: Bearer <secret>` header (audit S2-claude-06).
 * Both sides are hashed first so the comparison runs on equal-length buffers.
 */
export function bearerMatchesSecret(header: string | null, secret: string): boolean {
  if (!secret) return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const actual = createHash("sha256").update(header ?? "").digest();
  return timingSafeEqual(expected, actual);
}
