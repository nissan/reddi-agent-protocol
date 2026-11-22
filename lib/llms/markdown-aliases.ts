/**
 * Markdown versions of key pages, per the llms.txt proposal (https://llmstxt.org): a page's URL with `.md` appended
 * serves a clean Markdown version an agent can read without rendering the page. Each maps to a file under public/.
 */
export const MARKDOWN_PAGE_ALIASES: Record<string, string> = {
  "/agent-setup.md": "/skill.md",
  "/register.md": "/provider.md",
  "/adl.md": "/downloads/ADL-v0.3.md",
};

export function markdownPageRewrites(): { source: string; destination: string }[] {
  return Object.entries(MARKDOWN_PAGE_ALIASES).map(([source, destination]) => ({ source, destination }));
}
