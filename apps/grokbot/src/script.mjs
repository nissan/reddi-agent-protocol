// The script format Grokbot asks the Script desk for, and the parser that turns it into the voiceover and
// the three shots. A script that does not parse is handed to the brain to restructure.

export const SCRIPT_SYSTEM = [
  "You write scripts for 15 to 20 second product videos.",
  "Answer in exactly this format and nothing else:",
  "TITLE: <a short title>",
  "VOICEOVER: <45 to 55 words of narration, plain sentences, no stage directions>",
  "SHOT 1 IMAGE: <one sentence describing a still frame, visual only, no text or logos in the picture>",
  "SHOT 1 MOTION: <one sentence describing the camera or subject motion over 5 seconds>",
  "SHOT 2 IMAGE: ...",
  "SHOT 2 MOTION: ...",
  "SHOT 3 IMAGE: ...",
  "SHOT 3 MOTION: ...",
].join("\n");

const LINE = /^\s*(?:\*\*)?(TITLE|VOICEOVER|SHOT\s+([1-3])\s+(IMAGE|MOTION))\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.+?)\s*$/i;

/** { title, voiceover, shots: [{ image, motion } x3] }, or throws naming what is missing. */
export function parseScript(text) {
  const out = { title: "", voiceover: "", shots: [{}, {}, {}] };
  for (const raw of String(text).split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const value = m[4].replace(/^["']|["']$/g, "").trim();
    const key = m[1].toUpperCase();
    if (key === "TITLE") out.title ||= value;
    else if (key === "VOICEOVER") out.voiceover ||= value;
    else out.shots[Number(m[2]) - 1][m[3].toLowerCase()] ||= value;
  }
  return checkScript(out);
}

/** Checks a parsed or brain-made script and trims it to what the desks take. */
export function checkScript(script) {
  const missing = [];
  if (!script?.voiceover?.trim()) missing.push("VOICEOVER");
  const shots = Array.isArray(script?.shots) ? script.shots.slice(0, 3) : [];
  for (let i = 0; i < 3; i++) {
    if (!shots[i]?.image?.trim()) missing.push(`SHOT ${i + 1} IMAGE`);
    if (!shots[i]?.motion?.trim()) missing.push(`SHOT ${i + 1} MOTION`);
  }
  if (missing.length) throw new Error(`the script has no ${missing.join(", ")}`);
  const words = script.voiceover.trim().split(/\s+/);
  return {
    title: String(script.title || "Untitled").trim().slice(0, 120),
    // About 2.6 words a second: 70 words is the most that fits 30 s of voice billing.
    voiceover: words.slice(0, 70).join(" ").slice(0, 1800),
    shots: shots.map((s) => ({ image: s.image.trim().slice(0, 1200), motion: s.motion.trim().slice(0, 1200) })),
  };
}
