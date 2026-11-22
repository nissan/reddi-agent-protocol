import Link from "next/link";

import { hasPlayableRecording, type OnboardingVideoGuide } from "@/lib/onboarding/video-guides";

type Props = {
  video: OnboardingVideoGuide;
  layout?: "stacked" | "horizontal";
  /** Route this card is rendered on, so a withheld capture of this same page does not link to itself. */
  hostRoute?: string;
};

function isExternal(href: string) {
  return href.startsWith("http://") || href.startsWith("https://");
}

function samePage(a: string, b: string) {
  return a.split("#")[0] === b.split("#")[0];
}

function CtaLink({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  const className = primary
    ? "rounded border-2 border-ink bg-ink px-4 py-2 text-sm font-bold text-paper no-underline transition hover:opacity-90"
    : "rounded border-2 border-ink px-4 py-2 text-sm font-bold text-ink no-underline transition hover:border-brand-violet hover:text-brand-violet";

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

export function OnboardingVideoCard({ video, layout = "stacked", hostRoute }: Props) {
  const horizontal = layout === "horizontal";
  const capturesHostPage = hostRoute !== undefined && samePage(hostRoute, video.route);

  return (
    <article
      className={`overflow-hidden rounded-md border border-line bg-paper-raised ${
        horizontal ? "grid gap-0 lg:grid-cols-[1.2fr_1fr]" : ""
      }`}
    >
      <div className="relative bg-black">
        {hasPlayableRecording(video) ? (
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
        ) : (
          <div className="flex aspect-video h-full w-full flex-col items-center justify-center gap-2 bg-well px-6 text-center">
            <span
              data-testid="withheld-recording-notice"
              className="max-w-sm text-xs leading-relaxed text-ink-muted"
            >
              Recording not shown: this capture predates the public-claim remediation and still
              shows retired marketplace/payment wording.{" "}
              {video.multiRouteRecording ? (
                <>It toured several routes, so no single page reproduces it; browse this build for the current copy.</>
              ) : capturesHostPage ? (
                <>The current copy is what this page renders.</>
              ) : (
                <>
                  Open{" "}
                  <Link href={video.route} className="underline hover:text-brand-violet">
                    {video.route}
                  </Link>{" "}
                  on this build for the current copy.
                </>
              )}
            </span>
          </div>
        )}
        <div className="absolute left-3 top-3 rounded-full border border-brand-green/30 bg-black/70 px-3 py-1 text-xs font-semibold text-brand-green backdrop-blur">
          {hasPlayableRecording(video) ? `${video.duration} · ${video.boundary}` : video.boundary}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <div className="space-y-2">
          <p className="section-label">{video.eyebrow}</p>
          <h3 className="text-2xl font-bold text-ink">{video.title}</h3>
          <p className="text-sm leading-6 text-ink-muted">{video.description}</p>
        </div>

        {video.proofLinks && video.proofLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {video.proofLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-line bg-paper px-3 py-1 text-xs text-ink-muted hover:border-brand-violet hover:text-brand-violet"
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
