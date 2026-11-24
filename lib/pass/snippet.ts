/** What the pass page gives the person to paste into their assistant (#1048). Safe for the browser. */
export function passAgentSnippet(input: { baseUrl: string; key: string; models: string[] }): string {
  return [
    "You have a Reddi agent pass: a budget your person locked for you on Solana devnet.",
    "Use it to call these paid models through an OpenAI-style API:",
    "",
    `Base URL: ${input.baseUrl}`,
    `API key: ${input.key}`,
    `Models: ${input.models.join(", ")}`,
    "",
    "Send POST {Base URL}/chat/completions with the header Authorization: Bearer {API key} and a body of",
    '{"model": "<one of the models>", "messages": [{"role": "user", "content": "..."}]}.',
    "Each answer has a rap_pass block: what the call cost, what is left, and the provider's signed receipt.",
    "GET {Base URL}/models shows what is left on each model. If a call is refused with budget_reached,",
    "pass_expired or over_call_cap, stop and tell your person; nothing was charged for that call.",
    "Keep the API key private. Do not paste it into chats or files other people can read.",
  ].join("\n");
}
