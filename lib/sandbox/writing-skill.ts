/**
 * The sandbox "Help us write better" scenario: a visitor picks how they want
 * text written (voice, length, how much jargon), and two first-party writing
 * providers build it into a skill file their own agent can follow. Writing
 * Style turns the settings into the skill; Humaniser rewrites a sample with it,
 * so the visitor can see it work, and adds the rules that keep text sounding
 * like a person wrote it.
 *
 * Everything here is deterministic: the settings travel in the request text,
 * and the scripted answers depend only on that text, so the same request
 * always hashes to the same response.
 */

export type WritingStyle = "friendly" | "professional" | "academic";
export type JargonLevel = "eli5" | "eli10" | "some-jargon";

export type WritingSettings = { style: WritingStyle; jargon: JargonLevel; maxWords: number };

export const WRITING_STYLES: readonly { id: WritingStyle; label: string; hint: string }[] = [
  { id: "friendly", label: "Friendly", hint: "Warm, plain, like a message to a friend." },
  { id: "professional", label: "Professional", hint: "Clear and calm, for work email and updates." },
  { id: "academic", label: "Academic", hint: "Formal and precise, for reports and papers." },
];

export const JARGON_LEVELS: readonly { id: JargonLevel; label: string; hint: string }[] = [
  { id: "eli5", label: "Explain like I'm 5", hint: "No technical words at all." },
  { id: "eli10", label: "Explain like I'm 10", hint: "Technical ideas, everyday words." },
  { id: "some-jargon", label: "Some jargon", hint: "For readers who work in the field." },
];

export const WORD_LIMITS: readonly number[] = [40, 80, 150];

export const DEFAULT_WRITING_SETTINGS: WritingSettings = { style: "friendly", jargon: "eli10", maxWords: 80 };

/** The text the visitor's skill is tried on: a dense engineering notice. */
export const WRITING_SAMPLE =
  "Heads up: this weekend we're migrating the customer API from a monolith to containerised microservices behind a new gateway. Expect elevated p99 latency during the cutover window while we drain connections and warm caches. Idempotency keys become mandatory on every POST endpoint, so clients that retry without one will get a 422. If the error budget burns past 2% in any hour, we roll back.";

/** Where a person sends their agent to call these providers itself. */
export const AGENT_SETUP_URL = "https://app.agent-protocol.reddi.tech/agent-setup";

/** The two steps, in order: which provider, and what it is asked to do. */
export const WRITING_PIPELINE: readonly { providerId: string; ask: string }[] = [
  { providerId: "reddi-writing-style", ask: "Build a writing skill from these settings." },
  { providerId: "reddi-humaniser", ask: "Rewrite the text below with this skill, then add your rules for sounding like a person." },
];

/** Separates the humaniser's rewrite from the rules it adds to the skill. */
export const HUMANISER_SECTION_BREAK = "\n\n---\n\n";

export function settingsLine(settings: WritingSettings): string {
  return `Settings: style=${settings.style}; jargon=${settings.jargon}; maxWords=${settings.maxWords}`;
}

export function isWritingSettings(value: unknown): value is WritingSettings {
  const record = value as Partial<WritingSettings> | null;
  return (
    !!record &&
    WRITING_STYLES.some((entry) => entry.id === record.style) &&
    JARGON_LEVELS.some((entry) => entry.id === record.jargon) &&
    typeof record.maxWords === "number" &&
    WORD_LIMITS.includes(record.maxWords)
  );
}

/** Reads the settings back out of a request's text, or undefined if they are missing or not on the menu. */
export function parseWritingSettings(prompt: string): WritingSettings | undefined {
  const match = /Settings: style=([a-z-]+); jargon=([a-z0-9-]+); maxWords=(\d+)/.exec(prompt);
  if (!match) return undefined;
  const settings = { style: match[1], jargon: match[2], maxWords: Number(match[3]) };
  return isWritingSettings(settings) ? settings : undefined;
}

/** What one step sends: its ask, the settings, and for the humaniser the skill and the sample. */
export function writingStepPrompt(step: number, settings: WritingSettings, skill?: string): string {
  const ask = WRITING_PIPELINE[step]?.ask ?? "";
  if (step === 0) return `${ask}\n${settingsLine(settings)}`;
  return `${ask}\n${settingsLine(settings)}\n\nSkill:\n${skill ?? ""}\n\nText:\n${WRITING_SAMPLE}`;
}

const STYLE_RULES: Record<WritingStyle, { title: string; rules: string[] }> = {
  friendly: {
    title: "Voice: friendly",
    rules: [
      "Write the way you'd talk to a friend who asked. Contractions are good. Say \"you\" and \"we\".",
      "Warm, never gushing. One light touch of humour at most.",
      "Short paragraphs. One idea each.",
    ],
  },
  professional: {
    title: "Voice: professional",
    rules: [
      "Clear, calm, complete sentences. Few contractions, no slang.",
      "Say what happens, when, and what the reader has to do.",
      "Polite without being stiff. No \"please be advised\".",
    ],
  },
  academic: {
    title: "Voice: academic",
    rules: [
      "Formal and precise. No contractions.",
      "Define a term the first time it appears, and qualify a claim the evidence does not fully support.",
      "Passive voice is fine when who did it does not matter.",
    ],
  },
};

const JARGON_RULES: Record<JargonLevel, { title: string; rules: string[] }> = {
  eli5: {
    title: "Jargon: explain like I'm 5",
    rules: [
      "No technical words at all. If a five-year-old would ask \"what's that?\", find another way to say it.",
      "Use an everyday comparison: moving house, a name tag, a queue at the shops.",
      "Short words, short sentences. Numbers only when they matter.",
    ],
  },
  eli10: {
    title: "Jargon: explain like I'm 10",
    rules: [
      "Technical ideas are fine. Technical words are not: say what a thing does instead of naming it.",
      "Numbers are good. \"2 in 100\" beats \"a small fraction\".",
      "If you must use a term, explain it in the same sentence.",
    ],
  },
  "some-jargon": {
    title: "Jargon: some, for people in the field",
    rules: [
      "Standard terms of the trade are fine without a definition.",
      "No team nicknames or acronyms only insiders know.",
      "Keep the numbers exact.",
    ],
  },
};

/** The skill Writing Style builds: deterministic from the settings. */
export function buildWritingSkill(settings: WritingSettings): string {
  const style = STYLE_RULES[settings.style];
  const jargon = JARGON_RULES[settings.jargon];
  const styleLabel = WRITING_STYLES.find((entry) => entry.id === settings.style)!.label.toLowerCase();
  const jargonLabel = JARGON_LEVELS.find((entry) => entry.id === settings.jargon)!.label;
  const lines = [
    "---",
    `name: write-like-me-${settings.style}-${settings.jargon}-${settings.maxWords}`,
    `description: Write or rewrite text in a ${styleLabel} voice, ${jargonLabel.toLowerCase()}, in ${settings.maxWords} words or fewer. Use for any message, post or update written for me.`,
    "---",
    "",
    "# Write like me",
    "",
    "Use this skill whenever you write or rewrite text for me.",
    "",
    "## Length",
    "",
    `- ${settings.maxWords} words or fewer. If the point needs more, cut detail, not clarity.`,
    "- Put the main point in the first sentence, so a cut never loses it.",
    "",
    `## ${style.title}`,
    "",
    ...style.rules.map((rule) => `- ${rule}`),
    "",
    `## ${jargon.title}`,
    "",
    ...jargon.rules.map((rule) => `- ${rule}`),
    "",
    "## Before you send",
    "",
    "- Count the words.",
    "- Read the first sentence on its own. Does it say what changed?",
  ];
  return lines.join("\n");
}

/** The rules Humaniser adds to every skill, and where an agent buys a second pass. */
export const HUMANISER_RULES = [
  "## Sound like a person",
  "",
  "- No em dashes. Use a full stop or a comma.",
  "- Drop the filler words that give machine text away: delve, crucial, seamless, leverage, landscape, notably.",
  "- Don't puff things up (\"a pivotal moment\"). Say what happened.",
  "- Mix long sentences with short ones. A short one after a long one lands.",
  "- Stop when you're done. No upbeat summary line at the end.",
  "",
  "## Want a second pass?",
  "",
  `Send a draft to RAP Humaniser for a final pass. Your agent pays per call, gets a signed receipt, and never spends more than the budget you set. Set it up at ${AGENT_SETUP_URL}`,
].join("\n");

/** Hand-written rewrites of the sample, main point first, for every voice and jargon level. */
const REWRITES: Record<WritingStyle, Record<JargonLevel, string>> = {
  friendly: {
    eli5: "This weekend we're moving the system your apps talk to into a new home. It's a bit like moving house, so for a little while some answers might come back slower. There's one new rule: when your app asks for the same thing twice, it has to wear the same name tag both times, so we only do the job once. No name tag, and we'll say no. If things go badly, we'll move straight back to the old home.",
    eli10: "This weekend we're splitting our big customer system into smaller pieces that each do one job. While we switch over, a few requests may be slower, because we're letting old connections finish and filling our short-term memory back up. New rule: any request that changes something needs its own ID, so if your app sends it twice we only act once. Without the ID you'll get an error. If more than 2 in 100 requests fail in any hour, we switch back.",
    "some-jargon": "This weekend we're moving the customer API off the monolith and onto containerised services behind a new gateway. Your slowest requests may get slower during the cutover while we drain connections and warm the caches. Every POST now needs an idempotency key, and a retry without one gets a 422. We'll roll back if errors pass 2% in any hour, so there's nothing else you need to do.",
  },
  professional: {
    eli5: "This weekend we will move the system your apps connect to into a new setup. For a short time, some replies may take longer than usual. From now on, any request that changes something must carry its own name tag. If the same request arrives twice with the same tag, we do the work once. Requests without a tag will be refused. If problems pass a set limit, we will go back to the old setup.",
    eli10: "This weekend we will split the customer system into smaller services that each handle one job. During the switch, some requests may be slower while existing connections finish and stored data is rebuilt. Every request that changes data must now include a unique ID, so a repeated request is only acted on once. Requests without an ID will receive an error. If more than 2% of requests fail in any hour, we will reverse the change.",
    "some-jargon": "This weekend we will migrate the customer API from the monolith to containerised services behind a new gateway. Expect higher p99 latency during the cutover while connections drain and caches warm. Idempotency keys are now required on all POST endpoints, and a retry without one returns 422. We will roll back if the error rate exceeds 2% in any hour.",
  },
  academic: {
    eli5: "This weekend, the system that other programs talk to will be moved to a new arrangement. While it moves, some answers may arrive more slowly, much as a library is slow to find books on the day it changes its shelves. A new rule also applies: each request that changes something must carry a label, so that a request sent twice is carried out only once. Requests without a label will be declined. Should too many requests fail, the move will be reversed.",
    eli10: "This weekend, the customer system will be divided into smaller services, each responsible for a single task. During the transition, response times may rise while open connections are closed and temporary stores of data are refilled. Each request that alters data must now include a unique identifier, so that a repeated request is processed only once. Requests lacking one will be rejected. The change will be reversed if more than 2% of requests fail within any hour.",
    "some-jargon": "This weekend, the customer API will be migrated from a monolithic deployment to containerised microservices behind a new gateway. Tail latency (p99) is expected to rise during the cutover, as connections are drained and caches are repopulated. Idempotency keys will be mandatory on all POST endpoints, and retries that omit them will return a 422. A rollback will follow if the error rate exceeds 2% in any one hour.",
  },
};

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Keeps whole sentences from the start until the next one would pass the
 * limit. The first sentence always stays, cut at the limit if it alone is too long.
 */
export function trimToWords(text: string, maxWords: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((sentence) => sentence.trim()) ?? [text.trim()];
  const kept: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    const count = countWords(sentence);
    if (words + count > maxWords) break;
    kept.push(sentence);
    words += count;
  }
  if (kept.length > 0) return kept.join(" ");
  return sentences[0].split(/\s+/).slice(0, maxWords).join(" ");
}

/** The sample rewritten with the visitor's settings. */
export function rewriteSample(settings: WritingSettings): string {
  return trimToWords(REWRITES[settings.style][settings.jargon], settings.maxWords);
}

/** Scripted answers for the two writing providers. */
export function scriptedWritingAnswer(providerId: string, prompt: string): string {
  const settings = parseWritingSettings(prompt);
  if (!settings) return "Send the settings line (style, jargon, maxWords) and I'll build the skill.";
  if (providerId === "reddi-writing-style") return buildWritingSkill(settings);
  if (providerId === "reddi-humaniser") return `${rewriteSample(settings)}${HUMANISER_SECTION_BREAK}${HUMANISER_RULES}`;
  return "";
}

/** Splits the humaniser's answer into the rewrite and the rules it adds. */
export function splitHumaniserAnswer(answer: string): { rewrite: string; rules: string } {
  const at = answer.indexOf(HUMANISER_SECTION_BREAK);
  if (at < 0) return { rewrite: answer, rules: "" };
  return { rewrite: answer.slice(0, at), rules: answer.slice(at + HUMANISER_SECTION_BREAK.length) };
}

/** The finished skill file: Writing Style's skill, then Humaniser's rules. */
export function finishedSkill(skill: string, humaniserRules: string): string {
  return humaniserRules ? `${skill}\n\n${humaniserRules}\n` : `${skill}\n`;
}

export function skillFileName(settings: WritingSettings): string {
  return `write-like-me-${settings.style}-${settings.jargon}-${settings.maxWords}.md`;
}
