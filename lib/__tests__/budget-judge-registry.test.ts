import { createHash } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { checkJudgeRegistry, JUDGE_ALERT_EVERY_MS, JUDGE_REGISTERED_TTL_MS, JUDGE_UNREGISTERED_TTL_MS, judgeAgentAddress, judgeRegistryState, resetJudgeRegistryCache } from "@/lib/budget/judge-registry";

const PROGRAM = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
const judge = Keypair.generate().publicKey;

/** An agent record as the program writes it: head, model name, terms, padded to 150 bytes. */
function record(owner: PublicKey, agentType: number, active: number, model = "rap-budget-judge"): Uint8Array {
  const data = Buffer.alloc(150);
  createHash("sha256").update("account:AgentAccount").digest().copy(data, 0, 0, 8);
  owner.toBuffer().copy(data, 8);
  data.writeUInt8(agentType, 40);
  data.writeUInt32LE(model.length, 41);
  data.write(model, 45);
  const terms = 45 + model.length;
  data.writeBigUInt64LE(BigInt(1000), terms);
  data.writeUInt8(active, terms + 35);
  return Uint8Array.from(data);
}

const good = { owner: PROGRAM, data: record(judge, 1, 1) };

describe("RAP judge: the registry record a Budget open needs", () => {
  beforeEach(resetJudgeRegistryCache);

  it("derives the record at [agent, judge]", () => {
    // The devnet judge and its record, as registered on 26 November 2026.
    expect(judgeAgentAddress(new PublicKey("9Zv4HWNRt5WzSjBkbmJnGPtAT7vrcG8NxTzcd2iGF576"), PROGRAM).toBase58()).toBe("J5zeR6m9ZSdyjqPeS7QNFkqvpLQRPMqKfwCWX43W5kdt");
  });

  it("reads the record the way open_budget does", () => {
    expect(judgeRegistryState(good, judge, PROGRAM)).toBe("registered");
    expect(judgeRegistryState({ owner: PROGRAM, data: record(judge, 2, 1) }, judge, PROGRAM)).toBe("registered");
    expect(judgeRegistryState(null, judge, PROGRAM)).toBe("missing");
    expect(judgeRegistryState({ owner: Keypair.generate().publicKey, data: good.data }, judge, PROGRAM)).toBe("wrong_owner");
    expect(judgeRegistryState({ owner: PROGRAM, data: record(judge, 0, 1) }, judge, PROGRAM)).toBe("not_a_judge");
    expect(judgeRegistryState({ owner: PROGRAM, data: record(judge, 1, 0) }, judge, PROGRAM)).toBe("inactive");
    expect(judgeRegistryState({ owner: PROGRAM, data: record(Keypair.generate().publicKey, 1, 1) }, judge, PROGRAM)).toBe("malformed");
    expect(judgeRegistryState({ owner: PROGRAM, data: new Uint8Array(150) }, judge, PROGRAM)).toBe("malformed");
    expect(judgeRegistryState({ owner: PROGRAM, data: good.data.slice(0, 60) }, judge, PROGRAM)).toBe("malformed");
    const longName = Buffer.from(good.data);
    longName.writeUInt32LE(4000, 41);
    expect(judgeRegistryState({ owner: PROGRAM, data: longName }, judge, PROGRAM)).toBe("malformed");
  });

  it("lets a Budget with no judge through without reading the chain", async () => {
    const readAccount = jest.fn();
    expect(await checkJudgeRegistry(null, { chain: { readAccount }, programId: PROGRAM })).toEqual({ ok: true });
    expect(readAccount).not.toHaveBeenCalled();
  });

  it("passes a registered judge and asks the chain again only after a minute", async () => {
    const readAccount = jest.fn().mockResolvedValue(good);
    const alert = jest.fn();
    expect(await checkJudgeRegistry(judge, { chain: { readAccount }, programId: PROGRAM, nowMs: 0, alert })).toEqual({ ok: true });
    await checkJudgeRegistry(judge, { chain: { readAccount }, programId: PROGRAM, nowMs: JUDGE_REGISTERED_TTL_MS - 1, alert });
    expect(readAccount).toHaveBeenCalledTimes(1);
    expect(readAccount.mock.calls[0][0].toBase58()).toBe(judgeAgentAddress(judge, PROGRAM).toBase58());
    await checkJudgeRegistry(judge, { chain: { readAccount }, programId: PROGRAM, nowMs: JUDGE_REGISTERED_TTL_MS, alert });
    expect(readAccount).toHaveBeenCalledTimes(2);
    expect(alert).not.toHaveBeenCalled();
  });

  it("refuses an unregistered judge, tells the operator once an hour, and recovers as soon as it is registered", async () => {
    const readAccount = jest.fn().mockResolvedValue(null);
    const alert = jest.fn().mockResolvedValue(true);
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await checkJudgeRegistry(judge, { chain: { readAccount }, programId: PROGRAM, nowMs: 0, alert });
    expect(first).toMatchObject({ ok: false, state: "missing" });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toMatchObject({ audience: "operator", kind: "judge_not_registered", detail: { judge: judge.toBase58(), state: "missing" } });
    // Still unregistered a little later: read again, refused again, no second alert.
    expect((await checkJudgeRegistry(judge, { chain: { readAccount }, programId: PROGRAM, nowMs: JUDGE_UNREGISTERED_TTL_MS, alert })).ok).toBe(false);
    expect(readAccount).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledTimes(1);
    expect((await checkJudgeRegistry(judge, { chain: { readAccount }, programId: PROGRAM, nowMs: JUDGE_ALERT_EVERY_MS, alert })).ok).toBe(false);
    expect(alert).toHaveBeenCalledTimes(2);
    readAccount.mockResolvedValue(good);
    expect(await checkJudgeRegistry(judge, { chain: { readAccount }, programId: PROGRAM, nowMs: JUDGE_ALERT_EVERY_MS + JUDGE_UNREGISTERED_TTL_MS, alert })).toEqual({ ok: true });
    log.mockRestore();
  });

  it("refuses when the record cannot be read, without caching or alerting", async () => {
    const readAccount = jest.fn().mockRejectedValueOnce(new Error("rpc down")).mockResolvedValue(good);
    const alert = jest.fn();
    expect(await checkJudgeRegistry(judge, { chain: { readAccount }, programId: PROGRAM, nowMs: 0, alert })).toMatchObject({ ok: false, state: "unreadable" });
    expect(alert).not.toHaveBeenCalled();
    expect(await checkJudgeRegistry(judge, { chain: { readAccount }, programId: PROGRAM, nowMs: 1, alert })).toEqual({ ok: true });
  });

  it("still refuses when the operator alert itself fails", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const check = await checkJudgeRegistry(judge, { chain: { readAccount: async () => null }, programId: PROGRAM, alert: async () => Promise.reject(new Error("mail down")) });
    expect(check.ok).toBe(false);
    log.mockRestore();
  });
});
