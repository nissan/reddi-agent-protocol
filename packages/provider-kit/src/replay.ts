/**
 * Remembers which escrows have already paid for a call, in a file, so the
 * memory survives a restart. One lock pays for one call.
 *
 * This is for a single provider process. Two processes must not share a file:
 * the second refuses to open it. A provider that runs several instances needs
 * a shared database store instead (`DatabaseReplayStore` in the SDK).
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { NonceReplayStore } from "@redditech/x402-solana";

const KEY = /^[\x21-\x7e]{1,200}$/;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class FileReplayStore implements NonceReplayStore {
  private readonly seen = new Set<string>();
  private fd: number | undefined;
  private readonly lockPath: string;

  constructor(private readonly path: string) {
    this.lockPath = `${path}.lock`;
    mkdirSync(dirname(path), { recursive: true });
    this.takeLock();
    try {
      if (existsSync(path)) {
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (KEY.test(line)) this.seen.add(line);
        }
      }
      this.fd = openSync(path, "a", 0o600);
    } catch (error) {
      this.releaseLock();
      throw error;
    }
  }

  private takeLock(): void {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        writeFileSync(this.lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const owner = Number.parseInt(readFileSync(this.lockPath, "utf8"), 10);
        if (Number.isSafeInteger(owner) && owner > 0 && owner !== process.pid && processAlive(owner)) {
          throw new Error(`another provider process (pid ${owner}) is using ${this.path}`);
        }
        // The process that held the lock is gone.
        unlinkSync(this.lockPath);
      }
    }
    throw new Error(`could not lock ${this.path}`);
  }

  private releaseLock(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      // Already gone.
    }
  }

  /** True the first time a key is seen. The key is on disk before this returns true. */
  checkAndStore(key: string): boolean {
    if (this.fd === undefined) throw new Error("replay store is closed");
    if (!KEY.test(key)) throw new Error("replay key must be printable text without spaces");
    if (this.seen.has(key)) return false;
    appendFileSync(this.fd, `${key}\n`);
    fsyncSync(this.fd);
    this.seen.add(key);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }

  close(): void {
    if (this.fd === undefined) return;
    closeSync(this.fd);
    this.fd = undefined;
    this.releaseLock();
  }
}
