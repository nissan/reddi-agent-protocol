import type { Metadata } from "next";
import { DEFAULT_DESCRIPTION, SITE_NAME, X_HANDLE } from "./copy.ts";

// Per-page metadata with a canonical URL on the one public origin and matching social cards.
export function pageMetadata(siteUrl: string, page: { path: string; title?: string; description?: string }): Metadata {
  const description = page.description ?? DEFAULT_DESCRIPTION;
  const title = page.title ?? `${SITE_NAME}: receipted AI inference on Solana`;
  const url = `${siteUrl}${page.path === "/" ? "" : page.path}`;
  return {
    ...(page.title ? { title: page.title } : {}),
    description,
    alternates: { canonical: url || siteUrl },
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: url || siteUrl, images: [{ url: "/brand/share.png", width: 1200, height: 630, alt: "Reddi Agent Protocol: get the receipt for paid AI inference" }] },
    twitter: { card: "summary_large_image", site: X_HANDLE, creator: X_HANDLE, title, description, images: ["/brand/share.png"] },
  };
}
