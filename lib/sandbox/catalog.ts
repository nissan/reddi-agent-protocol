/**
 * Devnet sandbox catalog: scripted providers and guided scenarios.
 *
 * Everything here is sandbox data. Providers answer from a script, not from a
 * running model, so each declared model id carries the `sandbox/` prefix and no
 * receipt names a model that did not run. Payee addresses are devnet-only
 * wallets whose keys the sandbox server holds (`SANDBOX_DEVNET_PAYEE_KEYS`), so
 * a provider can settle a metered escrow after it answers. They hold devnet SOL only.
 */

export const SANDBOX_NETWORK = "solana-devnet" as const;
export const SANDBOX_CURRENCY = "SOL" as const;
export const SANDBOX_ENDPOINT_PATH = "/api/sandbox/v1/chat/completions";
export const SANDBOX_MODELS_PATH = "/api/sandbox/v1/models";

export type SandboxProviderBehaviour = "honest" | "fails-spot-check" | "offline";

export type SandboxProvider = {
  id: string;
  /** OpenAI-style model id a client sends in the request body. */
  model: string;
  name: string;
  tagline: string;
  /**
   * Per-token price in US dollars per million tokens, as exact decimal strings,
   * and the output limit that sets the most one call can cost. Modelled on what
   * comparable hosted models charge; the sandbox pays the dollar amount in devnet
   * SOL at a fixed demo rate.
   */
  pricing: { inputPerMillionUsd: string; outputPerMillionUsd: string; maxOutputTokens: number };
  /** Devnet wallet that receives wallet-mode payments and signs the metered settle. */
  payTo: string;
  behaviour: SandboxProviderBehaviour;
  /** Starting sandbox reputation, shown before the visitor's own calls. */
  reputation: { score: number; receipts: number };
};

export const SANDBOX_PROVIDERS: readonly SandboxProvider[] = [
  {
    id: "atlas-review",
    model: "sandbox/atlas-coder-large",
    name: "Atlas Review",
    tagline: "Careful, slower, priced for depth.",
    pricing: { inputPerMillionUsd: "5", outputPerMillionUsd: "25", maxOutputTokens: 5000 },
    payTo: "i63cUYvKsdECVoyYV7LYHTa3tCvjGnJR6yxrKPAyYdq",
    behaviour: "honest",
    reputation: { score: 4.8, receipts: 212 },
  },
  {
    id: "swift-infer",
    model: "sandbox/swift-coder-small",
    name: "Swift Inference",
    tagline: "Fast and cheap, shorter answers.",
    pricing: { inputPerMillionUsd: "0.2", outputPerMillionUsd: "0.8", maxOutputTokens: 1000 },
    payTo: "33McXcKFvwmNJTBpz54mtrWVec8vC96ZdtUm5MdzSvuk",
    behaviour: "honest",
    reputation: { score: 4.1, receipts: 57 },
  },
  {
    id: "bargain-models",
    model: "sandbox/bargain-general-small",
    name: "Bargain Models",
    tagline: "Lowest price on the list.",
    pricing: { inputPerMillionUsd: "0.05", outputPerMillionUsd: "0.2", maxOutputTokens: 1000 },
    payTo: "DgXFCQKjajCyWu7npaDS74kYsQa3LtYTjdVita9vBMok",
    behaviour: "fails-spot-check",
    reputation: { score: 3.2, receipts: 18 },
  },
  {
    id: "night-owl",
    model: "sandbox/night-owl-medium",
    name: "Night Owl Compute",
    tagline: "Listed, but not answering right now.",
    pricing: { inputPerMillionUsd: "0.6", outputPerMillionUsd: "2.4", maxOutputTokens: 2000 },
    payTo: "5mXHtZM5dzHo8ZrkcFDwqPySw49bHJjDmb2id44exRjq",
    behaviour: "offline",
    reputation: { score: 4.4, receipts: 96 },
  },
];

export function findSandboxProviderByModel(model: unknown): SandboxProvider | undefined {
  return typeof model === "string" ? SANDBOX_PROVIDERS.find((provider) => provider.model === model) : undefined;
}

export function findSandboxProviderById(id: unknown): SandboxProvider | undefined {
  return typeof id === "string" ? SANDBOX_PROVIDERS.find((provider) => provider.id === id) : undefined;
}

export type SandboxScenarioId = "buy-a-review" | "shop-around" | "run-a-session" | "try-to-cheat" | "provider-offline";

export type SandboxScenario = {
  id: SandboxScenarioId;
  title: string;
  persona: string;
  hook: string;
  /** What the visitor should come away having seen. */
  takeaway: string;
  prompt: string;
  /** Providers offered in this scenario, first is preselected. */
  providerIds: readonly string[];
};

export const REVIEW_PROMPT = [
  "Review this function before I ship it:",
  "",
  "function applyDiscount(price, percent) {",
  "  return price - price * percent / 100;",
  "}",
].join("\n");

export const SANDBOX_SCENARIOS: readonly SandboxScenario[] = [
  {
    id: "buy-a-review",
    title: "Buy a code review",
    persona: "You are a developer whose agent needs a second opinion before a release.",
    hook: "One request, one small payment, one receipt you can check yourself.",
    takeaway: "A paid call comes back with a receipt that names the provider, the declared model, and hashes of what was asked and answered.",
    prompt: REVIEW_PROMPT,
    providerIds: ["atlas-review"],
  },
  {
    id: "shop-around",
    title: "Shop around",
    persona: "You run an agent on a budget and three providers will take the same request.",
    hook: "Same prompt, three prices, three track records. Pick one, then pick another.",
    takeaway: "Receipts feed reputation. The cheapest provider here fails a spot check, and its score drops where you can see it.",
    prompt: REVIEW_PROMPT,
    providerIds: ["atlas-review", "swift-infer", "bargain-models"],
  },
  {
    id: "run-a-session",
    title: "Run a session",
    persona: "Your agent makes many small calls to one provider, each worth a fraction of a cent.",
    hook: "Ten calls, one lock, one settle. Watch the running total.",
    takeaway: "One lock pays for a whole session. Each receipt carries the running total and chains to the one before, and the provider settles once, so network fees stop eating small calls.",
    prompt: "Name one risk of retrying a payment without an idempotency key.",
    providerIds: ["swift-infer"],
  },
  {
    id: "try-to-cheat",
    title: "Try to cheat",
    persona: "You are the adversary. Reuse a payment, underpay, pay the wrong wallet, or edit the answer after the fact.",
    hook: "Four ways to cheat, and what each one runs into.",
    takeaway: "A payment settles one call, the amount and payee are checked against the challenge, and an edited answer no longer matches its receipt.",
    prompt: "Summarise the risk in one sentence: we store session tokens in localStorage.",
    providerIds: ["swift-infer"],
  },
  {
    id: "provider-offline",
    title: "Provider goes dark",
    persona: "Your agent calls a provider that is listed but not answering.",
    hook: "What happens to your money when nobody is home?",
    takeaway: "No challenge is issued for a provider that cannot answer, so nothing is paid and no receipt is written.",
    prompt: "Explain exponential backoff in two sentences.",
    providerIds: ["night-owl", "swift-infer"],
  },
];

export function findSandboxScenario(id: unknown): SandboxScenario | undefined {
  return typeof id === "string" ? SANDBOX_SCENARIOS.find((scenario) => scenario.id === id) : undefined;
}

/**
 * Scripted answers. The reply depends only on the provider and the prompt text,
 * so the same request always hashes to the same response.
 */
export function scriptedSandboxAnswer(provider: SandboxProvider, prompt: string): string {
  const text = prompt.toLowerCase();
  const about = text.includes("applydiscount")
    ? "discount"
    : text.includes("localstorage")
      ? "tokens"
      : text.includes("backoff")
        ? "backoff"
        : "general";

  if (provider.id === "atlas-review") {
    if (about === "discount") {
      return [
        "Three issues before this ships.",
        "1. No input checks: a percent above 100 returns a negative price, and a negative percent raises it.",
        "2. Floating point: 19.99 at 15 percent gives 16.991500000000002. Work in integer cents and round once.",
        "3. No test covers 0, 100, or a non-numeric value.",
        "Suggested shape: validate 0 <= percent <= 100, compute in cents, return an integer.",
      ].join("\n");
    }
    if (about === "tokens") return "Any script that runs on the page, including an injected one, can read localStorage and take the session; prefer an HttpOnly, Secure, SameSite cookie.";
    if (about === "backoff") return "Exponential backoff retries a failed call after a wait that doubles each time, usually with random jitter. It stops many clients from retrying in step and overloading a service that is recovering.";
    return "Scripted sandbox answer from Atlas Review. Pick a scenario prompt to see a fuller reply; live models arrive with the V1 gateway.";
  }
  if (provider.id === "swift-infer") {
    if (about === "discount") return "Works for normal input. Add a range check on percent (0 to 100) and round the result to cents; floats will drift otherwise.";
    if (about === "tokens") return "Session tokens in localStorage are readable by any injected script, so one XSS bug becomes account takeover.";
    if (about === "backoff") return "Wait longer after each failed retry, doubling the delay. Add jitter so clients do not retry together.";
    return "Scripted sandbox answer from Swift Inference. Pick a scenario prompt to see a fuller reply.";
  }
  if (provider.id === "bargain-models") {
    if (about === "discount") return "Looks good to me. Ship it.";
    return "Looks fine.";
  }
  return "";
}

export type SandboxSpotCheck = { passed: boolean; note: string };

/**
 * Simulated attestor spot check. In the sandbox the outcome is fixed per provider
 * so the reputation step is repeatable; it is not a judgement of a real model.
 */
export function simulatedSpotCheck(provider: SandboxProvider): SandboxSpotCheck {
  if (provider.behaviour === "fails-spot-check") {
    return { passed: false, note: "Simulated attestor spot check: the answer missed the input-validation and rounding defects a reference review finds." };
  }
  return { passed: true, note: "Simulated attestor spot check: the answer matches the reference review on the defects that matter." };
}
