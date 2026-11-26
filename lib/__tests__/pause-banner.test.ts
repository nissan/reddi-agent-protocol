import { PAUSED_MESSAGE, isPausedError } from "@redditech/x402-solana/pause";
import { pauseNotice, readPauseStatusBody } from "@/lib/pause/banner";

describe("emergency pause notice", () => {
  const at = (paused: boolean, missing: boolean, pausedUntilSlot: bigint, slot: bigint) => ({ paused, missing, pausedUntilSlot, slot });

  it("says nothing when not paused, not readable, or before the pause account exists", () => {
    expect(pauseNotice(null)).toBeNull();
    expect(pauseNotice(at(false, false, BigInt(0), BigInt(100)))).toBeNull();
    // Before init_pause the program refuses gated calls, but that is an operator's window, not a pause to announce.
    expect(pauseNotice(at(true, true, BigInt(0), BigInt(100)))).toBeNull();
  });

  it("names the pause, what still works, and when it ends at the latest", () => {
    const week = pauseNotice(at(true, false, BigInt(1_512_100), BigInt(100)));
    expect(week?.title).toBe("Payments are paused.");
    expect(week?.body).toContain(PAUSED_MESSAGE);
    expect(week?.body).toContain("refunds and closing a Budget still work");
    expect(week?.body).toContain("about 7 days");
    expect(pauseNotice(at(true, false, BigInt(1_000), BigInt(100)))?.body).toContain("about 1 hour");
    expect(pauseNotice(at(true, false, BigInt(100 + 9_000 * 5), BigInt(100)))?.body).toContain("about 5 hours");
  });

  it("recognises the program's pause refusal in a send error", () => {
    expect(isPausedError(new Error("Transaction simulation failed: Error processing Instruction 0: custom program error: 0x17d5"))).toBe(true);
    expect(isPausedError(new Error("custom program error: 0x17d6"))).toBe(false);
  });

  it("reads the status route's answer, and nothing else", () => {
    expect(readPauseStatusBody({ ok: true, paused: true, missing: false, pausedUntilSlot: "1512100", slot: "100" })).toEqual({ paused: true, missing: false, pausedUntilSlot: BigInt(1512100), slot: BigInt(100) });
    expect(readPauseStatusBody({ ok: false, code: "rpc_unavailable" })).toBeNull();
    expect(readPauseStatusBody({ ok: true, paused: "yes", missing: false, pausedUntilSlot: "1", slot: "1" })).toBeNull();
    expect(readPauseStatusBody({ ok: true, paused: true, missing: false, pausedUntilSlot: "-1", slot: "1" })).toBeNull();
    expect(readPauseStatusBody(null)).toBeNull();
  });
});
