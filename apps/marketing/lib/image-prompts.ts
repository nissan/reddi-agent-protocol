// The image prompt log for site collateral. Every image on the site that came from an image model is listed here with
// the exact prompt that made it, so providers can be compared over time and any image can be made again.
//
// Rules, enforced by tests/image-prompts.test.ts and explained in docs/IMAGE_PROMPTS.md:
//  - A prompt that has been run is never edited in place. To change the wording, add a new record with the same id and
//    the next version; the old one stays.
//  - Every run names the provider, the model, the day and the file it produced. A run whose image is used on the site
//    names that file under public/, and the file must exist.
//  - Every image under public/art/ belongs to exactly one run. An image nobody can trace is not shipped.
//  - `score` is the owner's or reviewer's mark out of 5 against the rubric in the document, or null before review.
export type ImageRun = {
  date: string;          // YYYY-MM-DD
  provider: string;      // for example "OpenAI Images" or "Google Nano Banana"
  model: string;         // the model name as the provider states it
  file: string | null;   // path under public/ when the image is kept in the site, else null
  score: number | null;  // 1 to 5, or null before review
  notes: string;
};
export type ImagePrompt = {
  id: string;            // SITE-01, SITE-02 ...
  version: number;       // 1, 2, 3 ... per id
  purpose: string;       // where on the site the image is meant to go
  size: string;          // width x height in pixels
  style: keyof typeof STYLES;
  prompt: string;        // the subject, written after the style block
  runs: readonly ImageRun[];
};

// Shared style blocks, prepended to every prompt that names them. Palette and type come from app/globals.css.
// A style block that has been used in a run is frozen too: add a new key to change it.
export const STYLES = {
  "site-v1": "Flat editorial illustration for a technical product site. Palette only: night #101216, paper #f4f0e6, card #fffdf7, ink #14161a, violet #6a35d9 as the single strong accent, mint #14f195 for small highlights, green #0b7a4b sparingly. Thick, even ink outlines, simple geometric shapes, generous empty space, no gradients, no glow, no 3D rendering, no photorealism. No text, letters, numbers, logos or brand marks anywhere in the image. No people's faces. No coins, charts going up or other symbols of financial gain.",
} as const;

export const IMAGE_PROMPTS: readonly ImagePrompt[] = [
  { id: "SITE-01", version: 1, purpose: "Home page hero, beside the headline", size: "1600x1200", style: "site-v1", runs: [],
    prompt: "A long paper receipt curling out of a small plain box that stands for a computer program. The receipt has four blank ruled sections, the last one stamped with a simple violet seal. Paper background, the box in ink outline, one mint tick beside the seal." },
  { id: "SITE-02", version: 1, purpose: "Home page, the Ask, Pay, Get the receipt, Build the record steps", size: "2000x800", style: "site-v1", runs: [],
    prompt: "Four simple panels in a row joined by one thin ink line. First: a speech bubble leaving a small box. Second: a single token passing along the line. Third: a receipt arriving back at the box. Fourth: a short stack of receipts with a violet seal on the top one. Paper background, equal spacing, nothing else in frame." },
  { id: "SITE-03", version: 1, purpose: "Share card background for links posted to social sites", size: "1200x630", style: "site-v1", runs: [],
    prompt: "A single receipt lying at a slight angle on a night background, drawn in paper and ink with one violet seal. The left two thirds of the frame are empty night colour so a headline can be set over it later." },
  { id: "SITE-04", version: 1, purpose: "Watch page poster shown before a video is played", size: "1920x1080", style: "site-v1", runs: [],
    prompt: "A plain browser window in ink outline on a night background, showing a receipt in the centre where a video would play. One small mint triangle sits beside the window as a play mark. Wide empty margins." },
  { id: "SITE-05", version: 1, purpose: "The numbers page, above the market size section", size: "1600x900", style: "site-v1", runs: [],
    prompt: "Three nested outlined circles on a paper background, the largest in ink, the middle in green, the smallest filled violet, with a tiny receipt resting on the smallest. No labels, no axes, no arrows." },
  { id: "SITE-06", version: 1, purpose: "Sandbox page, the Try to cheat scenario card", size: "1200x900", style: "site-v1", runs: [],
    prompt: "A receipt with one corner torn off and a small ink magnifying glass held over the tear. The torn piece lies beside it and does not fit back. Paper background, one violet outline around the magnifying glass." },
];

// The full text sent to a provider: the style block, then the subject, then the size.
export function fullPrompt(p: Pick<ImagePrompt, "style" | "prompt" | "size">): string {
  return `${STYLES[p.style]}\n\n${p.prompt}\n\nSize: ${p.size} pixels.`;
}

// Problems with the log, as readable lines; an empty list means it is valid. `artFiles` is the list of files found
// under public/art (paths relative to public/), supplied by the test.
export function validateImagePrompts(prompts: readonly ImagePrompt[] = IMAGE_PROMPTS, artFiles: readonly string[] = []): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const latest = new Map<string, number>();
  const used = new Map<string, string>();
  for (const p of prompts) {
    const at = `${p.id} v${p.version}`;
    if (!/^SITE-\d{2}$/.test(p.id)) problems.push(`${at}: id must look like SITE-01`);
    if (!Number.isInteger(p.version) || p.version < 1) problems.push(`${at}: version must be a whole number from 1`);
    if (seen.has(at)) problems.push(`${at}: listed twice`);
    seen.add(at);
    if (p.version !== (latest.get(p.id) ?? 0) + 1) problems.push(`${at}: versions of one id must be listed in order with none skipped`);
    latest.set(p.id, p.version);
    if (!(p.style in STYLES)) problems.push(`${at}: unknown style block`);
    if (!/^\d{3,4}x\d{3,4}$/.test(p.size)) problems.push(`${at}: size must be width x height in pixels`);
    if (p.purpose.trim().length < 10) problems.push(`${at}: say where the image goes`);
    if (p.prompt.trim().length < 60) problems.push(`${at}: prompt is too short to be reproducible`);
    for (const r of p.runs) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number.isNaN(Date.parse(`${r.date}T00:00:00Z`))) problems.push(`${at}: run date must be YYYY-MM-DD`);
      if (r.provider.trim().length === 0 || r.model.trim().length === 0) problems.push(`${at}: a run names its provider and model`);
      if (r.score !== null && (!Number.isInteger(r.score) || r.score < 1 || r.score > 5)) problems.push(`${at}: score must be 1 to 5 or null`);
      if (r.file !== null) {
        if (!/^art\/[a-z0-9][a-z0-9./-]*\.(png|webp|jpg|svg)$/.test(r.file)) problems.push(`${at}: file must be a lower-case path under art/`);
        if (used.has(r.file)) problems.push(`${at}: ${r.file} is already claimed by ${used.get(r.file)}`);
        used.set(r.file, at);
        if (!artFiles.includes(r.file)) problems.push(`${at}: ${r.file} is not in public/`);
      }
    }
  }
  for (const f of artFiles) if (!used.has(f)) problems.push(`${f}: no logged run produced this image`);
  return problems;
}
