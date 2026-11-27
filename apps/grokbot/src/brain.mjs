// Grokbot's own thinking: qwen3 on rtwin1 through an OpenAI-compatible chat endpoint on the local network
// (Ollama's /v1), never a public one. Every answer it gives is checked before Grokbot acts on it.

/** The first JSON object in a model answer (qwen3 may wrap it in a think block or a code fence). */
export function firstJson(text) {
  const s = String(text).replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("the brain gave no JSON");
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("the brain's JSON was cut off");
}

export function createBrain({ url, model, fetchImpl = fetch, log = () => {} }) {
  const base = url.replace(/\/+$/, "");
  async function ask(system, user, { maxTokens = 1200 } = {}) {
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: `${system}\n/no_think` }, { role: "user", content: user }], temperature: 0.4, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw new Error(`the brain answered ${response.status}`);
    const body = await response.json();
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("the brain's answer had no text");
    return text;
  }
  return {
    model,
    async json(system, user, options) {
      let last;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return firstJson(await ask(system, user, options));
        } catch (error) {
          last = error;
          log({ event: "brain_retry", attempt, error: error.message });
        }
      }
      throw last;
    },
  };
}

/** Asks the brain to pick one provider per role from the listed candidates; checks every pick. */
export async function chooseTeam(brain, brief, candidates) {
  const menu = Object.fromEntries(
    Object.entries(candidates).map(([role, list]) => [role, list.map((c) => ({ wallet: c.wallet, name: c.displayName, price_per_million_output: c.priceOutputPerMillionBaseUnits, health: c.healthStatus }))]),
  );
  const system = "You are Grokbot, a buyer agent that hires providers on Reddi Agent Protocol. Pick one provider per role for the job. Prefer healthy providers, then the lowest price. Answer with JSON only: {\"script\": \"<wallet>\", \"voice\": \"<wallet>\", \"video\": \"<wallet>\", \"stitch\": \"<wallet>\", \"why\": \"<one sentence>\"}.";
  const answer = await brain.json(system, `Job: ${brief}\n\nCandidates by role:\n${JSON.stringify(menu, null, 2)}`);
  const team = {};
  for (const [role, list] of Object.entries(candidates)) {
    const pick = list.find((c) => c.wallet === answer[role]);
    if (!pick) throw new Error(`the brain picked ${JSON.stringify(answer[role])} for ${role}, which is not a listed candidate`);
    team[role] = pick;
  }
  return { team, why: typeof answer.why === "string" ? answer.why.slice(0, 300) : "" };
}

/** Asks the brain for the Script desk's prompt from the brief. */
export async function scriptPrompt(brain, brief) {
  const answer = await brain.json(
    "You are Grokbot. Turn a marketing brief into one clear instruction for a scriptwriter. Answer with JSON only: {\"prompt\": \"<the instruction, at most 900 characters>\"}.",
    brief,
  );
  if (typeof answer.prompt !== "string" || !answer.prompt.trim()) throw new Error("the brain gave no script prompt");
  return answer.prompt.trim().slice(0, 3500);
}

/** Asks the brain to restructure a script that did not parse. */
export async function restructure(brain, text) {
  return brain.json(
    "Restructure this video script. Answer with JSON only: {\"title\": \"...\", \"voiceover\": \"<45 to 55 words>\", \"shots\": [{\"image\": \"<still frame>\", \"motion\": \"<5 s of motion>\"}, {...}, {...}]} with exactly three shots.",
    text.slice(0, 6000),
  );
}
