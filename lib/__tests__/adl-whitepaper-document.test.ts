import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ADL whitepaper technical depth", () => {
  const whitepaper = readFileSync(
    join(process.cwd(), "docs/ADL-WHITEPAPER-v0.1.md"),
    "utf8",
  );

  it("documents the ADL hierarchy and major parameter groups", () => {
    expect(whitepaper).toContain("## Document Model");
    expect(whitepaper).toContain("## Top-Level Parameters");
    expect(whitepaper).toContain("## Model Section");
    expect(whitepaper).toContain("## Harness Section");
    expect(whitepaper).toContain("## Extensions");
    expect(whitepaper).toContain("## Validation Rules");
  });

  it("includes worked examples for implementers", () => {
    expect(whitepaper).toContain("## Worked Example 1: Minimal Read-Only Agent");
    expect(whitepaper).toContain("## Worked Example 2: Tool-Enabled Source Checker");
    expect(whitepaper).toContain("## Worked Example 3: Paid Specialist Researcher");
    expect(whitepaper).toContain("## Worked Example 4: Attested Code Review Specialist");
    expect(whitepaper).toContain("## Worked Example 5: Export-Oriented Agent");
  });

  it("keeps live payment and mainnet activation bounded", () => {
    expect(whitepaper).toContain("Production payment, credential, wallet, hosted runtime, devnet, and mainnet activation require separate operator gates.");
    expect(whitepaper).toContain("It is not yet a blanket approval for live runtime activation, production payment rails, wallet operations, or mainnet actions.");
  });
});
