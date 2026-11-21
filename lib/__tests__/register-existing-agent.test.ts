import { PublicKey } from "@solana/web3.js";

import { agentDetailHref, isAlreadyRegisteredError } from "@/lib/register/existing-agent";

describe("register existing-agent helpers", () => {
  it("classifies Anchor/System Program duplicate registration logs", () => {
    const message = `Simulation failed: {"InstructionError":[0,{"Custom":0}]}
Logs:
Program DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu invoke [1]
Program log: Instruction: RegisterAgent
Program 11111111111111111111111111111111 invoke [2]
Allocate: account Address { address: GSNdtc9Lg8U2UWUQBDFeyZCbtpz6TpdHhBQ7sMrdDiNG, base: None } already in use
Program 11111111111111111111111111111111 failed: custom program error: 0x0`;

    expect(isAlreadyRegisteredError(message)).toBe(true);
  });

  it("classifies account-initialized variants", () => {
    expect(isAlreadyRegisteredError("AccountAlreadyInitialized during register_agent")).toBe(true);
    expect(isAlreadyRegisteredError("AlreadyInUse: account already in use")).toBe(true);
  });

  it("does not classify unrelated registration failures", () => {
    expect(isAlreadyRegisteredError("Blockhash not found")).toBe(false);
    expect(isAlreadyRegisteredError("AccountNotFound: wallet missing lamports")).toBe(false);
    expect(isAlreadyRegisteredError("InvalidInstructionData")).toBe(false);
  });

  it("builds agent detail links from public keys and strings", () => {
    const key = new PublicKey("11111111111111111111111111111111");
    expect(agentDetailHref(key)).toBe("/agents/11111111111111111111111111111111");
    expect(agentDetailHref("wallet abc")).toBe("/agents/wallet%20abc");
  });
});
