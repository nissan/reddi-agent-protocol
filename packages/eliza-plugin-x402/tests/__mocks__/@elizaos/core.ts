/**
 * Minimal @elizaos/core mock — only what the plugin uses.
 * We don't install the real package since it would pull in all of ElizaOS.
 */

export interface Memory {
  content: unknown;
}

export interface State {}

export interface IAgentRuntime {}

export type HandlerCallback = (response: {
  text?: string;
  content?: Record<string, unknown>;
}) => void;

export interface Action {
  name: string;
  description: string;
  similes: string[];
  validate: (runtime: IAgentRuntime, message: Memory) => Promise<boolean>;
  handler: (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback
  ) => Promise<boolean>;
  examples: Array<Array<{ user: string; content: unknown }>>;
}

export interface Plugin {
  name: string;
  description: string;
  actions: Action[];
}
