/**
 * Devnet sandbox catalog: scripted providers and guided scenarios.
 *
 * Everything here is sandbox data. Providers answer from a script, not from a
 * running model, so each declared model id carries the `sandbox/` prefix and no
 * receipt names a model that did not run. Payee addresses are devnet-only
 * wallets whose keys the sandbox server holds (`SANDBOX_DEVNET_PAYEE_KEYS`), so
 * a provider can settle a metered escrow after it answers. They hold devnet SOL only.
 */
import { PR_REVIEW_ANSWER, PR_REVIEW_PROMPT } from "@/lib/try/pr-review";

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
  /**
   * Takes simulated payments only. The gateway refuses a devnet transfer or a
   * metered escrow for it before reading the chain, so no devnet SOL is ever
   * sent to its listed address. The studio providers are like this.
   */
  simulatedOnly?: boolean;
  /** An independent studio in the "Make a video" pipeline (#video-studio). */
  studio?: SandboxStudioListing;
};

/**
 * What an independent provider shows the market and what it keeps to itself.
 * The public side is what an ADL listing, a price and a receipt carry; the
 * private side never leaves the provider's own machines.
 */
export type SandboxStudioListing = {
  /** The pipeline step this provider does. */
  role: string;
  /** Who runs it, in a line. */
  who: string;
  /** What buyers see. */
  shows: string;
  /** What stays on the provider's machines. */
  keeps: string;
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
  // The "Make a video" pipeline: independent people and small teams who bought
  // their own GPUs and tuned their own models, selling results through one
  // listing each. Simulated payments only; see `simulatedOnly`.
  {
    id: "frame-foundry",
    model: "sandbox/frame-foundry-motion",
    name: "Frame Foundry",
    tagline: "Animation from a shot list, in a hand-drawn style.",
    pricing: { inputPerMillionUsd: "10", outputPerMillionUsd: "120", maxOutputTokens: 4000 },
    payTo: "B33rmWhYZ899EjnTXZmF4Pv1TqPjyCF2GHCJjCV9BiKs",
    behaviour: "honest",
    reputation: { score: 4.7, receipts: 64 },
    simulatedOnly: true,
    studio: {
      role: "Animation",
      who: "Two animators with four GPUs in a spare room and a motion model tuned on their own keyframes.",
      shows: "Its listing, its price per token, the clips it returns and every receipt.",
      keeps: "The model weights, the keyframes it learned from, and its prompts.",
    },
  },
  {
    id: "tidepool-audio",
    model: "sandbox/tidepool-score",
    name: "Tidepool Audio",
    tagline: "A music bed cut to your timings.",
    pricing: { inputPerMillionUsd: "4", outputPerMillionUsd: "40", maxOutputTokens: 3000 },
    payTo: "CiSkk42GnPLJgWcW16hRkQbZoBtm2815Tgxm9mDtHLDF",
    behaviour: "honest",
    reputation: { score: 4.6, receipts: 41 },
    simulatedOnly: true,
    studio: {
      role: "Music",
      who: "One producer with one GPU tower and a music model tuned on twenty years of their own stems.",
      shows: "Its listing, its price per token, the track it returns and every receipt.",
      keeps: "The model, the stems it learned from, and how it was tuned.",
    },
  },
  {
    id: "kettle-voice",
    model: "sandbox/kettle-guide-voice",
    name: "Kettle Voice",
    tagline: "A guide voice paced for you to record over.",
    pricing: { inputPerMillionUsd: "0.5", outputPerMillionUsd: "2", maxOutputTokens: 2000 },
    payTo: "CM71QZkajX2Am9Z35tBUphYufyBdhK3QrQyLpv9ufAs9",
    behaviour: "honest",
    reputation: { score: 4.5, receipts: 128 },
    simulatedOnly: true,
    studio: {
      role: "Guide voice",
      who: "A developer running a speech model on one desktop GPU, tuned to read scripts at a recordable pace.",
      shows: "Its listing, its price per token, the guide track and every receipt.",
      keeps: "The voice model, its tuning data, and its pacing rules.",
    },
  },
  {
    id: "booth-match",
    model: "sandbox/booth-match-align",
    name: "Booth Match",
    tagline: "Lines your own voice take up with the guide.",
    pricing: { inputPerMillionUsd: "1", outputPerMillionUsd: "6", maxOutputTokens: 2000 },
    payTo: "7HXsXx1i4JZTVyxjhkZ9Uj3tfUXFoqd1o3QTGtEQSj7z",
    behaviour: "honest",
    reputation: { score: 4.8, receipts: 37 },
    simulatedOnly: true,
    studio: {
      role: "Voice pass",
      who: "A sound engineer who built an alignment and clean-up model for their own podcast work.",
      shows: "Its listing, its price per token, the cleaned take and every receipt.",
      keeps: "The alignment model and the room profiles it learned.",
    },
  },
  {
    id: "splice-line",
    model: "sandbox/splice-line-stitch",
    name: "Splice Line",
    tagline: "Stitches picture, music and voice into one cut.",
    pricing: { inputPerMillionUsd: "0.2", outputPerMillionUsd: "0.8", maxOutputTokens: 1000 },
    payTo: "BmjF6v93F4DyDVbNvcrwdoNnyWBJjTqdqoRchPBD5Cz6",
    behaviour: "honest",
    reputation: { score: 4.4, receipts: 302 },
    simulatedOnly: true,
    studio: {
      role: "Final stitch",
      who: "A small team running render nodes, priced for volume.",
      shows: "Its listing, its price per token, the finished file and every receipt.",
      keeps: "Its render presets and loudness chain.",
    },
  },
];

export function findSandboxProviderByModel(model: unknown): SandboxProvider | undefined {
  return typeof model === "string" ? SANDBOX_PROVIDERS.find((provider) => provider.model === model) : undefined;
}

export function findSandboxProviderById(id: unknown): SandboxProvider | undefined {
  return typeof id === "string" ? SANDBOX_PROVIDERS.find((provider) => provider.id === id) : undefined;
}

export type SandboxScenarioId = "buy-a-review" | "shop-around" | "run-a-session" | "make-a-video" | "try-to-cheat" | "provider-offline";

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

/** The director agent's brief for the "Make a video" scenario. */
export const STUDIO_BRIEF = "A 30-second launch video for a payments protocol. Friendly, hand-drawn look. Three shots: a buyer agent asks, a provider answers, a receipt prints. Upbeat, warm music. One narrator.";

/**
 * The pipeline the director agent runs, in order: which studio it hires and
 * what it asks for. Each request carries the brief plus the step's own ask, so
 * every step's receipt hashes a different request.
 */
export const STUDIO_PIPELINE: readonly { providerId: string; ask: string }[] = [
  { providerId: "frame-foundry", ask: "Animate three shots from this brief, 10 seconds each, 1080p." },
  { providerId: "tidepool-audio", ask: "Score a 30-second music bed with a lift at 10 and 20 seconds." },
  { providerId: "kettle-voice", ask: "Read this narration as a guide track, 30 seconds: 'Your agent asks. A provider answers. A receipt proves it.'" },
  { providerId: "booth-match", ask: "Align the human narration take to the guide track timing and remove room noise." },
  { providerId: "splice-line", ask: "Stitch the three shots, the music bed and the aligned narration into one 30-second file, mixed for social video." },
];

/** The full prompt one pipeline step sends: the brief, then the step's ask. */
export function studioStepPrompt(ask: string): string {
  return `Brief: ${STUDIO_BRIEF}\n\nYour part: ${ask}`;
}

/** Scripted studio deliverables. Asset names are made up; nothing is rendered. */
const STUDIO_ANSWERS: Record<string, string> = {
  "frame-foundry": "Delivered: shots/01-ask.mp4, shots/02-answer.mp4, shots/03-receipt.mp4. 3 shots, 10 s each, 1080p, 24 fps, hand-drawn line style. Shot 3 holds 1 s on the printed receipt so the cut can land on it.",
  "tidepool-audio": "Delivered: music/bed-30s.wav. 30 s, 104 bpm, warm keys and soft drums, lifts at 0:10 and 0:20, ends on a clean button at 0:30.",
  "kettle-voice": "Delivered: voice/guide-30s.wav. 30 s guide read at 140 words a minute, with 2 s gaps before each shot change so a human take can match it.",
  "booth-match": "Delivered: voice/narration-aligned.wav. Your take aligned to the guide within 40 ms on every line, room noise down 18 dB, breaths kept.",
  "splice-line": "Delivered: final/launch-30s.mp4. 30 s, 1080p, shots cut on the music lifts, narration over the bed at -14 LUFS, captions burned in.",
};

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
    id: "make-a-video",
    title: "Make a video",
    persona: "Your director agent is making a 30-second launch video. It hires five independent studios, each running models they tuned on their own GPUs.",
    hook: "Five studios, five payments, five receipts. Their secrets stay theirs.",
    takeaway: "Each studio sold a result without showing how it made it: weights, training data and prompts stayed on its own machines. Your agent got a price before each call, a signed receipt after it, and rated every studio at the end.",
    prompt: STUDIO_BRIEF,
    providerIds: ["frame-foundry", "tidepool-audio", "kettle-voice", "booth-match", "splice-line"],
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
  if (provider.studio) return STUDIO_ANSWERS[provider.id] ?? "";
  if (prompt === PR_REVIEW_PROMPT) {
    if (provider.id === "atlas-review") return PR_REVIEW_ANSWER;
    return "Two things before this ships: a resent status check can hit the replay guard and show a paid call as failed, and the rating path still confirms over a websocket. Store the answer by escrow and poll for confirmations.";
  }
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
