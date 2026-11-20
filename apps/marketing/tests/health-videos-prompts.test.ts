// The health report, the video records behind /watch and the image prompt log.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { healthReport } from "../lib/health.ts";
import { IMAGE_PROMPTS, STYLES, fullPrompt, validateImagePrompts, type ImagePrompt } from "../lib/image-prompts.ts";
import { VIDEOS, validateVideos, visibleVideos, youtubeEmbedUrl, type Video } from "../lib/videos.ts";
import type { Update } from "../lib/updates.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0);
const update: Update = { slug: "a-note", date: "2026-11-20", title: "A note for tests", summary: "A summary long enough to pass the length rule in the validator.", body: ["One."], links: [{ label: "Check", href: "https://example.com/x" }], status: "published" };
const video: Video = { slug: "what-is-a-receipt", date: "2026-11-27", title: "What is a receipt for inference?", summary: "A summary long enough to pass the length rule in the validator.", youtubeId: "abcDEF123_-", minutes: 3, status: "published" };

test("health: everything off reads off, and the report names the build", () => {
  const r = healthReport({ NODE_ENV: "production" }, NOW, [], []);
  assert.equal(r.status, "ok");
  assert.equal(r.time, "2026-11-20T12:00:00.000Z");
  assert.deepEqual(r.build, { environment: "production", commit: null });
  assert.equal(r.indexable, false);
  assert.deepEqual(r.newsletter, { enabled: false, signupForm: false, publicCollection: false, autosend: false });
  assert.deepEqual(r.updates, { published: 0, latest: null });
  assert.deepEqual(r.videos, { published: 0 });
});

test("health: switches and counts follow the environment and the records; drafts are not counted", () => {
  const env = { VERCEL_ENV: "production", NODE_ENV: "production", SITE_PUBLIC: "1", NEWSLETTER_ENABLED: "1", NEXT_PUBLIC_NEWSLETTER_FORM: "1", NEWSLETTER_PUBLIC: "1", NEWSLETTER_AUTOSEND: "1", VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" };
  const r = healthReport(env, NOW, [update, { ...update, slug: "later", date: "2026-11-25" }, { ...update, slug: "hidden", date: "2026-12-01", status: "draft" }], [video, { ...video, slug: "draft-one", youtubeId: "abcDEF123_0", status: "draft" }]);
  assert.deepEqual(r.build, { environment: "production", commit: "0123456" });
  assert.equal(r.indexable, true);
  assert.deepEqual(r.newsletter, { enabled: true, signupForm: true, publicCollection: true, autosend: true });
  assert.deepEqual(r.updates, { published: 2, latest: "2026-11-25" });
  assert.deepEqual(r.videos, { published: 1 });
});

test("health: a switch is on only for exactly 1, and no secret can appear in the report", () => {
  const r = healthReport({ NEWSLETTER_ENABLED: "true", NEWSLETTER_AUTOSEND: "yes", RESEND_API_KEY: "re_secretvalue", CRON_SECRET: "cronsecretvalue", NEWSLETTER_SIGNING_SECRET: "signingsecretvalue", NEWSLETTER_ALLOWED_RECIPIENTS: "someone@example.com" }, NOW, [], []);
  assert.equal(r.newsletter.enabled, false);
  assert.equal(r.newsletter.autosend, false);
  assert.doesNotMatch(JSON.stringify(r), /secretvalue|example\.com/);
});

test("videos: the committed records are valid, and the validator catches each kind of mistake", () => {
  assert.deepEqual(validateVideos(), []);
  assert.deepEqual(validateVideos([video]), []);
  const bad = (patch: Partial<Video>) => validateVideos([{ ...video, ...patch }]).length > 0;
  assert.ok(bad({ slug: "Has Spaces" }));
  assert.ok(bad({ date: "27 November" }));
  assert.ok(bad({ title: "short" }));
  assert.ok(bad({ summary: "too short" }));
  assert.ok(bad({ youtubeId: "https://www.youtube.com/watch?v=abcDEF123_-" }));
  assert.ok(bad({ youtubeId: "short" }));
  assert.ok(bad({ minutes: 0 }));
  assert.ok(bad({ minutes: 2.5 }));
  assert.ok(validateVideos([video, video]).some((p) => /twice/.test(p)));
});

test("videos: drafts show only where drafts are shown, newest first, and the player is the no-cookie one", () => {
  const set: Video[] = [{ ...video, slug: "older", date: "2026-11-01", youtubeId: "aaaaaaaaaaa" }, { ...video, slug: "draft-one", status: "draft", youtubeId: "bbbbbbbbbbb" }, { ...video, slug: "newer", date: "2026-12-01", youtubeId: "ccccccccccc" }];
  assert.deepEqual(visibleVideos(false, set).map((v) => v.slug), ["newer", "older"]);
  assert.deepEqual(visibleVideos(true, set).map((v) => v.slug), ["newer", "draft-one", "older"]);
  assert.match(youtubeEmbedUrl("abcDEF123_-"), /^https:\/\/www\.youtube-nocookie\.com\/embed\/abcDEF123_-\?/);
  for (const v of VIDEOS) assert.notEqual(v.status === "published" && v.youtubeId.length !== 11, true, v.slug);
});

function artFiles(): string[] {
  const root = join(import.meta.dirname, "..", "public");
  const walk = (dir: string): string[] => !existsSync(join(root, dir)) ? [] : readdirSync(join(root, dir)).flatMap((n) => statSync(join(root, dir, n)).isDirectory() ? walk(`${dir}/${n}`) : [`${dir}/${n}`]);
  return walk("art");
}

test("image prompts: the committed log is valid and accounts for every image under public/art", () => {
  assert.deepEqual(validateImagePrompts(IMAGE_PROMPTS, artFiles()), []);
  assert.ok(IMAGE_PROMPTS.length >= 6);
});

test("image prompts: every prompt forbids text and marks through its style block and builds one reproducible text", () => {
  for (const s of Object.values(STYLES)) assert.match(s, /No text, letters, numbers, logos or brand marks/);
  const p = IMAGE_PROMPTS[0];
  assert.equal(fullPrompt(p), `${STYLES[p.style]}\n\n${p.prompt}\n\nSize: ${p.size} pixels.`);
});

test("image prompts: the validator catches each kind of mistake", () => {
  const base: ImagePrompt = { id: "SITE-01", version: 1, purpose: "Home page hero, beside the headline", size: "1600x1200", style: "site-v1", prompt: "A long paper receipt curling out of a small plain box that stands for a computer program.", runs: [] };
  const run = { date: "2026-11-21", provider: "OpenAI Images", model: "a-model", file: "art/site-01-v1-openai.webp", score: 4, notes: "" };
  assert.deepEqual(validateImagePrompts([base], []), []);
  assert.deepEqual(validateImagePrompts([{ ...base, runs: [run] }], [run.file]), []);
  const bad = (prompts: ImagePrompt[], files: string[] = []) => validateImagePrompts(prompts, files).length > 0;
  assert.ok(bad([{ ...base, id: "IMG-1" }]));
  assert.ok(bad([{ ...base, version: 2 }]), "a first record must be version 1");
  assert.ok(bad([base, base]), "the same version twice");
  assert.ok(bad([base, { ...base, version: 3 }]), "a skipped version");
  assert.ok(bad([{ ...base, size: "big" }]));
  assert.ok(bad([{ ...base, prompt: "a receipt" }]));
  assert.ok(bad([{ ...base, runs: [{ ...run, score: 6 }] }], [run.file]));
  assert.ok(bad([{ ...base, runs: [{ ...run, provider: "" }] }], [run.file]));
  assert.ok(bad([{ ...base, runs: [run] }], []), "a run names a file that is not there");
  assert.ok(bad([{ ...base, runs: [run, run] }], [run.file]), "two runs claim one file");
  assert.ok(bad([base], ["art/stray.webp"]), "an image no run produced");
  assert.ok(bad([{ ...base, runs: [{ ...run, file: "brand/icon.png" }] }], ["brand/icon.png"]), "a kept image lives under art/");
});
