/**
 * Keeps sessions in a file, one JSON line per change, so a restart can go on
 * with a session or settle it. The last line for an escrow wins. Opened only
 * by the process that holds the payment memory's lock (see replay.ts), so two
 * processes never share it.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionState, SessionStore } from "@reddi/x402-solana";

const isState = (value: unknown): value is SessionState => {
  const s = value as Partial<SessionState> | null;
  return Boolean(s) && typeof s!.escrow === "string" && typeof s!.payer === "string" && typeof s!.nonce === "string" && typeof s!.maxBaseUnits === "string" && typeof s!.sequence === "number" && typeof s!.status === "string";
};

export class FileSessionStore implements SessionStore {
  private fd: number | undefined;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.fd = openSync(path, "a", 0o600);
  }

  load(): SessionState[] {
    const latest = new Map<string, SessionState>();
    if (!existsSync(this.path)) return [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isState(parsed)) latest.set(parsed.escrow, parsed);
      } catch {
        // A line cut short by a crash: the one before it for that escrow stands.
      }
    }
    return [...latest.values()];
  }

  /** On disk before it returns. */
  save(state: SessionState): void {
    if (this.fd === undefined) throw new Error("session store is closed");
    appendFileSync(this.fd, `${JSON.stringify(state)}\n`);
    fsyncSync(this.fd);
  }

  close(): void {
    if (this.fd === undefined) return;
    closeSync(this.fd);
    this.fd = undefined;
  }
}
