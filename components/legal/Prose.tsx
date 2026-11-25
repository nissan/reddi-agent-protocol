import type { ReactNode } from "react";

/** Plain long-form page: one heading, an eyebrow line, then sections. Used by Docs, Terms and Privacy. */
export function Prose({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-3xl px-4 pb-20 pt-12 sm:px-6 lg:px-8">
        <p className="section-label">{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">{title}</h1>
        <p className="mt-5 text-lg leading-8 text-gray-300">{lead}</p>
        <div className="mt-10 space-y-10">{children}</div>
      </div>
    </div>
  );
}

export function ProseSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 text-base leading-7 text-gray-300 [&_a]:underline [&_a:hover]:text-white [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-white">
      <h2 id={id} className="font-display text-2xl font-bold text-white">{title}</h2>
      {children}
    </section>
  );
}
