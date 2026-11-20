// Videos shown on /watch. One typed record per video, kept here so a change is reviewed like code and the public-claim
// test (tests/claims.test.ts) reads every title and summary. Videos are hosted on YouTube; the page loads nothing from
// YouTube until the visitor presses play (components/VideoEmbed.tsx).
//
// Rules, enforced by tests/videos.test.ts:
//  - `status: "draft"` is shown only where reviewers look (previews and local builds). Publishing a video is the
//    owner's decision, like publishing an update.
//  - `youtubeId` is the eleven-character id from the video's address, never a full link.
export type Video = {
  slug: string;        // lower-case words joined by hyphens
  date: string;        // YYYY-MM-DD, a calendar day in Sydney
  title: string;
  summary: string;     // one or two sentences shown under the title
  youtubeId: string;
  minutes: number;     // running time rounded to the nearest minute, at least 1
  status: "draft" | "published";
};

export const VIDEOS: readonly Video[] = [];

const byNewest = (a: Video, b: Video) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug));

export function visibleVideos(showDrafts: boolean, videos: readonly Video[] = VIDEOS): Video[] {
  return videos.filter((v) => v.status === "published" || showDrafts).sort(byNewest);
}

export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
// The privacy-enhanced player: YouTube sets no cookie until playback starts.
export const youtubeEmbedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;

// Problems with the records, as readable lines; an empty list means they are valid.
export function validateVideos(videos: readonly Video[] = VIDEOS): string[] {
  const problems: string[] = [];
  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const v of videos) {
    const at = v.slug || "(no slug)";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.slug)) problems.push(`${at}: slug must be lower-case words joined by hyphens`);
    if (slugs.has(v.slug)) problems.push(`${at}: slug is used twice`);
    slugs.add(v.slug);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || Number.isNaN(Date.parse(`${v.date}T00:00:00Z`))) problems.push(`${at}: date must be YYYY-MM-DD`);
    if (v.title.trim().length < 8 || v.title.length > 90) problems.push(`${at}: title must be 8 to 90 characters`);
    if (v.summary.trim().length < 40 || v.summary.length > 320) problems.push(`${at}: summary must be 40 to 320 characters`);
    if (!/^[A-Za-z0-9_-]{11}$/.test(v.youtubeId)) problems.push(`${at}: youtubeId must be the eleven-character video id`);
    if (ids.has(v.youtubeId)) problems.push(`${at}: youtubeId is used twice`);
    ids.add(v.youtubeId);
    if (!Number.isInteger(v.minutes) || v.minutes < 1 || v.minutes > 240) problems.push(`${at}: minutes must be a whole number from 1 to 240`);
    if (v.status !== "draft" && v.status !== "published") problems.push(`${at}: status must be draft or published`);
  }
  return problems;
}
