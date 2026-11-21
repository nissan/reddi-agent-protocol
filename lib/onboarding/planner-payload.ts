/**
 * The chat request the planner sends a provider for a prompt. Shared by the
 * server, which sends it, and the browser, whose session key signs its exact
 * bytes (#863): both must produce the same text.
 */

export const PLANNER_MODEL = "ollama-local";

export function plannerChatPayload(prompt: string) {
  return {
    model: PLANNER_MODEL,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };
}

/** The exact request body sent to the provider. */
export function plannerChatBody(prompt: string): string {
  return JSON.stringify(plannerChatPayload(prompt));
}
