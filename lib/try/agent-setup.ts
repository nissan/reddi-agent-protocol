/**
 * The "hand it to your agent" snippets (#925). Browser-safe and pure, so the
 * try page, the agent setup page and tests share one copy.
 */
export type AgentSetupTab = { id: string; label: string; intro: string; snippet: string; language: "text" | "bash" | "ts" };

export function agentSetupTabs(origin: string): AgentSetupTab[] {
  const skill = `${origin}/skill.md`;
  return [
    {
      id: "prompt",
      label: "Any agent",
      intro: "Paste this into your agent's chat. It reads the skill file and sets itself up.",
      language: "text",
      snippet: [
        `Read ${skill} and set yourself up to buy inference through Reddi Agent Protocol.`,
        "Pay from the Budget key I give you (it starts with rap_budget_), using the \"Paying from a Budget key\" section. Keep the key out of anything you share.",
        "Tell me which provider you used and what each call cost, and show me the first receipt.",
      ].join("\n"),
    },
    {
      id: "claude-code",
      label: "Claude Code",
      intro: "Save it as a skill, so Claude Code picks it up whenever a task needs a paid model.",
      language: "bash",
      snippet: [
        "mkdir -p ~/.claude/skills/reddi-agent-protocol",
        `curl -fsSL ${skill} -o ~/.claude/skills/reddi-agent-protocol/SKILL.md`,
      ].join("\n"),
    },
    {
      id: "agents-md",
      label: "Codex, Cursor and others",
      intro: "Add one line to the AGENTS.md (or rules file) in your project.",
      language: "text",
      snippet: `When a task needs a paid AI model or specialist, follow ${skill}. Pay from the Budget key in RAP_BUDGET_KEY and stop when it refuses a call.`,
    },
    {
      id: "code",
      label: "Your own code",
      intro: "Building your own agent? These two packages do the paying and the receipt check.",
      language: "bash",
      snippet: [
        "npm install @redditech/x402-solana @redditech/agent-protocol @solana/web3.js",
        "# Worked example: one quote, one lock, one paid call, one checked receipt",
        "curl -fsSLO https://raw.githubusercontent.com/nissan/reddi-agent-protocol/main/packages/provider-kit/examples/paid-call.mjs",
      ].join("\n"),
    },
  ];
}
