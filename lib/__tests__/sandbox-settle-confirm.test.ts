import { confirmByPolling } from "@/lib/sandbox/settle-signer";

type Status = { err: unknown; confirmationStatus?: string } | null;

function fakeConnection(statuses: Status[], heights: number[]) {
  let s = 0;
  let h = 0;
  return {
    calls: { status: 0 },
    getSignatureStatuses: jest.fn(async () => ({ context: { slot: 1 }, value: [statuses[Math.min(s++, statuses.length - 1)]] })),
    getBlockHeight: jest.fn(async () => heights[Math.min(h++, heights.length - 1)]),
  };
}

const noSleep = async () => {};

describe("confirmByPolling (settle confirmation without a websocket)", () => {
  it("returns confirmed once the status says so", async () => {
    const c = fakeConnection([null, { err: null, confirmationStatus: "processed" }, { err: null, confirmationStatus: "confirmed" }], [10]);
    await expect(confirmByPolling(c as never, "sig", 100, { sleep: noSleep })).resolves.toBe("confirmed");
    expect(c.getSignatureStatuses).toHaveBeenCalledTimes(3);
  });

  it("returns failed when the transaction failed", async () => {
    const c = fakeConnection([{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }], [10]);
    await expect(confirmByPolling(c as never, "sig", 100, { sleep: noSleep })).resolves.toBe("failed");
  });

  it("throws once the blockhash has expired without a confirmation", async () => {
    const c = fakeConnection([null], [99, 101]);
    await expect(confirmByPolling(c as never, "sig", 100, { sleep: noSleep })).rejects.toThrow("expired");
  });

  it("accepts a confirmation found on the last look after expiry", async () => {
    const c = fakeConnection([null, { err: null, confirmationStatus: "finalized" }], [101]);
    await expect(confirmByPolling(c as never, "sig", 100, { sleep: noSleep })).resolves.toBe("confirmed");
  });
});
