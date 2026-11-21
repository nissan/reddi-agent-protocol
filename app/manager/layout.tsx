import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { internalPagesEnabled } from "@/lib/internal-pages";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function InternalPageLayout({ children }: { children: React.ReactNode }) {
  if (!internalPagesEnabled()) notFound();
  return children;
}
