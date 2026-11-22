/**
 * Starter tasks for the try page (#925). Fixed prompts, so a ticket names a
 * task by id and nothing a visitor types reaches a provider or a QR code.
 * Browser-safe.
 */
import { REVIEW_PROMPT, SANDBOX_PROVIDERS, type SandboxProvider } from "@/lib/sandbox/catalog";

export type TryTask = {
  id: string;
  title: string;
  /** One line on what the visitor gets back. */
  blurb: string;
  prompt: string;
  providerId: string;
};

export const TRY_TASKS: readonly TryTask[] = [
  {
    id: "code-review",
    title: "Review a function before it ships",
    blurb: "A careful reviewer reads a short discount function and lists what would break.",
    prompt: REVIEW_PROMPT,
    providerId: "atlas-review",
  },
  {
    id: "security-check",
    title: "Spot a security risk",
    blurb: "A fast model explains, in one sentence, why one storage choice is risky.",
    prompt: "Summarise the risk in one sentence: we store session tokens in localStorage.",
    providerId: "swift-infer",
  },
  {
    id: "explain",
    title: "Explain an idea in two sentences",
    blurb: "A quick explainer of exponential backoff, the kind an agent asks for all day.",
    prompt: "Explain exponential backoff in two sentences.",
    providerId: "swift-infer",
  },
];

export function findTryTask(id: unknown): TryTask | undefined {
  return typeof id === "string" ? TRY_TASKS.find((task) => task.id === id) : undefined;
}

export function tryTaskProvider(task: TryTask): SandboxProvider {
  const provider = SANDBOX_PROVIDERS.find((p) => p.id === task.providerId);
  if (!provider) throw new Error(`unknown try provider ${task.providerId}`);
  return provider;
}
