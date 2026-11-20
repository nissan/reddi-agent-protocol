// The devnet sandbox is built separately. This site only links to it: NEXT_PUBLIC_SANDBOX_URL (an https address, set at
// build time) turns the "opens soon" state into a link. Anything else, including an http or malformed value, keeps it closed.
export function resolveSandboxUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try { const u = new URL(raw.trim()); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}
export const sandboxUrl: string | null = resolveSandboxUrl(process.env.NEXT_PUBLIC_SANDBOX_URL);
