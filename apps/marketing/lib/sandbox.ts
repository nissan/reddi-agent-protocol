// The devnet sandbox is built separately. This site only links to it: NEXT_PUBLIC_SANDBOX_URL (an https address, set at
// build time) turns the "opens soon" state into a link. Anything else, including an http or malformed value, keeps it closed.
export function resolveSandboxUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try { const u = new URL(raw.trim()); return u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}
export const sandboxUrl: string | null = resolveSandboxUrl(process.env.NEXT_PUBLIC_SANDBOX_URL);

// Deep link to one scenario in the sandbox (?scenario=<id>), or null while the sandbox link is closed.
export function scenarioUrl(base: string | null, id: string): string | null {
  if (!base) return null;
  const u = new URL(base); u.searchParams.set("scenario", id); return u.toString();
}
