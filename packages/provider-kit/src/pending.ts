/**
 * Keeps the settles of single calls that were sent but whose outcome was not
 * known, one JSON line per change, so a restart can still find out whether
 * each one landed. The last line for an escrow wins. Opened only by the process
 * that holds the payment memory's lock (see replay.ts).
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PendingSettle } from "@redditech/x402-solana";

export interface PendingCallSettle extends PendingSettle {
  escrow: string;
  /** SHA-256 of the request body the settle pays for: only the same request may collect the answer. */
  requestHash: string;
  /** `pending`: outcome not known. `landed`: it landed. `dropped`: it cannot land, and nothing was charged by it. */
  status: "pending" | "landed" | "dropped";
}

export interface PendingSettleStore {
  load(): PendingCallSettle[];
  /** Durable before it returns. */
  save(record: PendingCallSettle): void;
}

const isRecord = (value: unknown): value is PendingCallSettle => {
  const r = value as Partial<PendingCallSettle> | null;
  return Boolean(r) && typeof r!.escrow === "string" && typeof r!.signature === "string" && typeof r!.transaction === "string" && typeof r!.status === "string" && typeof r!.requestHash === "string";
};

export class FilePendingSettleStore implements PendingSettleStore {
  private fd: number | undefined;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.fd = openSync(path, "a", 0o600);
  }

  load(): PendingCallSettle[] {
    const latest = new Map<string, PendingCallSettle>();
    if (!existsSync(this.path)) return [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isRecord(parsed)) latest.set(parsed.escrow, parsed);
      } catch {
        // A line cut short by a crash: the one before it for that escrow stands.
      }
    }
    return [...latest.values()];
  }

  save(record: PendingCallSettle): void {
    if (this.fd === undefined) throw new Error("pending settle store is closed");
    appendFileSync(this.fd, `${JSON.stringify(record)}\n`);
    fsyncSync(this.fd);
  }

  close(): void {
    if (this.fd === undefined) return;
    closeSync(this.fd);
    this.fd = undefined;
  }
}

/** An in-memory store, for tests and for a handler run without a file. */
export class MemoryPendingSettleStore implements PendingSettleStore {
  readonly records = new Map<string, PendingCallSettle>();
  load(): PendingCallSettle[] {
    return [...this.records.values()];
  }
  save(record: PendingCallSettle): void {
    this.records.set(record.escrow, { ...record });
  }
}
