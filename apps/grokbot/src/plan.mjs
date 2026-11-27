// What Grokbot knows before it starts: the four roles a short video needs, how many charged calls each
// takes and the most each may cost, so the Budget slices are planned from the listed prices, not guessed.

/** The roles, the listing task type that marks a provider for each, and the most each charged call may bill. */
export const ROLES = {
  script: { taskType: "scriptwriting", label: "script", collects: [1000] },
  voice: { taskType: "voiceover", label: "voiceover", collects: [30_000] },
  // Three start frames (billed 0) and three 5 s clips (81 frames at 16 fps is 5.0625 s).
  video: { taskType: "animation", label: "video clips", collects: [1, 1, 1, 5_100, 5_100, 5_100] },
  stitch: { taskType: "editing", label: "final cut", collects: [30_000] },
};

export const ROLE_NAMES = /** @type {(keyof typeof ROLES)[]} */ (Object.keys(ROLES));

/** max_tokens for the calls that bill nothing (start, status). */
export const FREE_CALL_MAX_TOKENS = 1;

/** Base units of one call of `outputTokens` at `outputPerMillion` base units per million (the listing's figure), rounded up. */
export function callCost(outputTokens, outputPerMillion) {
  const n = BigInt(outputTokens) * BigInt(outputPerMillion);
  return (n + 999_999n) / 1_000_000n;
}

/**
 * The slice to reserve for a role: every charged call at its most, every free call (one start and a status
 * poll budget each) at one token, plus a small margin, never below the program's 1% floor.
 */
export function sliceFor(role, outputPerMillion, total, { freeCalls = 200, margin = 20_000n } = {}) {
  const charged = ROLES[role].collects.reduce((sum, t) => sum + callCost(t, outputPerMillion), 0n);
  const free = BigInt(freeCalls) * callCost(FREE_CALL_MAX_TOKENS, outputPerMillion);
  const want = charged + free + margin;
  const floor = (total + 99n) / 100n;
  return want > floor ? want : floor;
}

/** Slices for all four roles, checked against the Budget and the per-provider cap (half the total). */
export function planSlices(prices, total) {
  const slices = {};
  let sum = 0n;
  for (const role of ROLE_NAMES) {
    const slice = sliceFor(role, prices[role], total);
    if (slice > total / 2n) throw new Error(`the ${role} slice (${slice}) is above the per-provider cap (${total / 2n})`);
    slices[role] = slice;
    sum += slice;
  }
  if (sum > total) throw new Error(`the slices (${sum}) do not fit the Budget (${total})`);
  return { slices, sum };
}

/** USDC base units as text, such as 1.53. */
export function usdc(baseUnits) {
  const v = BigInt(baseUnits);
  const sign = v < 0n ? "-" : "";
  const a = v < 0n ? -v : v;
  const whole = a / 1_000_000n;
  const frac = (a % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac.length < 2 ? frac.padEnd(2, "0") : frac}` : ".00"}`;
}

/** The jobs, as the gateway's templates take them (apps/gpu-gateway/src/templates.js). */
export const JOBS = {
  script: (prompt, system) => ({ kind: "text", prompt, params: { system, num_predict: 900 } }),
  voice: (text) => ({ kind: "speech", prompt: text }),
  frame: (prompt, seed) => ({ kind: "image", prompt, params: { seed } }),
  clip: (prompt, frame, seed) => ({ kind: "video", prompt, image_from: frame, params: { frames: 81, seed } }),
  stitch: (clips, audio) => ({ kind: "stitch", prompt: "final cut", params: { clips, audio } }),
};
