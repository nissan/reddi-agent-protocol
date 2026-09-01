jest.mock("dotenv");

import { PublicKey } from "@solana/web3.js";

import { IX } from "../../../../lib/program";
import { buildDemoRegisterAgentInstruction, encodeDemoRegisterAgent } from "../registration-instruction";

describe("demo-agent registration instruction target selection", () => {
  const owner = new PublicKey("11111111111111111111111111111112");
  const anchorProgramId = new PublicKey("794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD");
  const quasarProgramId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");

  it("keeps legacy demo-agent registration Anchor encoded", () => {
    const data = encodeDemoRegisterAgent("legacy-anchor", 0, "qwen3:8b", 1_000_000n, 0);
    expect(data.subarray(0, 8).equals(IX.register_agent)).toBe(true);
  });

  it("switches demo-agent registration to Quasar data in Quasar mode", () => {
    const ix = buildDemoRegisterAgentInstruction({
      target: "quasar",
      programId: quasarProgramId,
      owner,
      agentType: 1,
      model: "claude-haiku",
      rateLamports: 500_000n,
      minReputation: 0,
    });

    expect(ix.programId.toBase58()).toBe(quasarProgramId.toBase58());
    expect(ix.data[0]).toBe(0);
    expect(ix.data.length).toBe(76);
    expect(ix.data.subarray(0, 8).equals(IX.register_agent)).toBe(false);
  });

  it("preserves selected program id for legacy instruction construction", () => {
    const ix = buildDemoRegisterAgentInstruction({
      target: "legacy-anchor",
      programId: anchorProgramId,
      owner,
      agentType: 0,
      model: "qwen3:8b",
      rateLamports: 1_000_000n,
      minReputation: 0,
    });

    expect(ix.programId.toBase58()).toBe(anchorProgramId.toBase58());
    expect(ix.data.subarray(0, 8).equals(IX.register_agent)).toBe(true);
  });
});
