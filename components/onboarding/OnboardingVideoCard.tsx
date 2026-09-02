import Link from "next/link";

import type { OnboardingVideoGuide } from "@/lib/onboarding/video-guides";

type Props = {
  video: OnboardingVideoGuide;
  layout?: "stacked" | "horizontal";
};

function isExternal(href: string) {
  return href.startsWith("http://") || href.startsWith("https://");
}

function CtaLink({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  const className = primary
    ? "rounded-lg bg-[#14F195] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
    : "rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:border-white/30 hover:text-white";

  if (isExternal(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

export function OnboardingVideoCard({ video, layout = "stacked" }: Props) {
  const horizontal = layout === "horizontal";

  return (
    <article
      className={`overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/20 ${
        horizontal ? "grid gap-0 lg:grid-cols-[1.2fr_1fr]" : ""
      }`}
    >
      <div className="relative bg-black">
        {video.mediaStale ? (
          <div className="flex aspect-video h-full w-full flex-col items-center justify-center gap-2 bg-[#1a1a2e] px-6 text-center">
            <span className="text-sm font-semibold text-white/40">{video.title}</span>
            <span className="max-w-sm text-xs leading-relaxed text-white/25">
              Recording withheld: this capture predates the public-claim remediation and still shows
              retired marketplace/payment wording. Open{" "}
              <Link href={video.route} className="underline hover:text-white/50">
                {video.route}
              </Link>{" "}
              on this build for the current copy.
            </span>
          </div>
        ) : (
          <video
            aria-label={`${video.title} onboarding video`}
            className="aspect-video h-full w-full object-cover"
            controls
            playsInline
            preload="metadata"
            poster={video.posterSrc}
          >
            <source src={video.videoSrc} type="video/mp4" />
            <track
              default
              kind="captions"
              label="English captions"
              src={video.captionsSrc}
              srcLang="en"
            />
          </video>
        )}
        <div className="absolute left-3 top-3 rounded-full border border-[#14F195]/30 bg-black/70 px-3 py-1 text-xs font-semibold text-[#14F195] backdrop-blur">
          {video.mediaStale ? video.boundary : `${video.duration} · ${video.boundary}`}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <div className="space-y-2">
          <p className="section-label">{video.eyebrow}</p>
          <h3 className="font-display text-2xl font-bold text-white">{video.title}</h3>
          <p className="text-sm leading-6 text-gray-300">{video.description}</p>
        </div>

        {video.proofLinks && video.proofLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {video.proofLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-gray-300 hover:border-[#14F195]/40 hover:text-[#14F195]"
              >
                {link.label} ↗
              </a>
            ))}
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-3">
          <CtaLink href={video.primaryCta.href} label={video.primaryCta.label} primary />
          {video.secondaryCta && <CtaLink href={video.secondaryCta.href} label={video.secondaryCta.label} />}
        </div>
      </div>
    </article>
  );
}
