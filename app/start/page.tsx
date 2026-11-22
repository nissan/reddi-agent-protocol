import Link from "next/link";

import { OnboardingVideoCard } from "@/components/onboarding/OnboardingVideoCard";
import { hasPlayableRecording, onboardingVideos } from "@/lib/onboarding/video-guides";

const PATHS = [
  {
    role: "Buyer",
    title: "Connect your agent",
    desc: "Give Claude Code, an MCP client or your own agent a way to find providers, set the most a call may cost, and keep a receipt for every call.",
    href: "/setup",
    cta: "Set up your agent",
  },
  {
    role: "Provider",
    title: "Run a provider",
    desc: "Describe your model, set your price per token, and register it on Solana devnet with test funds.",
    href: "/register",
    cta: "Start setup",
    tinted: true,
  },
  {
    role: "Anyone",
    title: "Check the proof",
    desc: "Make a test call in the sandbox and read its receipt: who answered, what they declared, and which payment covered it.",
    href: "/sandbox",
    cta: "Open the sandbox",
  },
];

export default function StartPage() {
  const playable = onboardingVideos.filter(hasPlayableRecording);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <p className="section-label mb-4">Start here</p>
        <h1 className="max-w-3xl text-5xl leading-[1.02] sm:text-6xl">
          Pick where to start.{" "}
          <span className="block text-brand-violet">Every path ends with a receipt.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Reddi Agent Protocol lets agents buy inference from independent providers, priced per
          token, with a signed receipt for every call. It runs on Solana devnet with test funds
          today. Mainnet is coming soon.
        </p>
      </section>

      <section aria-labelledby="paths" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
        <h2 id="paths" className="sr-only">
          Choose a path
        </h2>
        <div className="grid overflow-hidden rounded-md border-2 border-ink bg-paper-raised md:grid-cols-3">
          {PATHS.map((path, index) => (
            <Link
              key={path.href}
              href={path.href}
              className={`group flex flex-col gap-2.5 p-7 no-underline ${path.tinted ? "bg-well" : ""} ${
                index < PATHS.length - 1 ? "border-b border-line md:border-b-0 md:border-r" : ""
              }`}
            >
              <span className="font-mono text-xs font-bold uppercase text-brand-violet">{path.role}</span>
              <strong className="text-[22px] tracking-tight">{path.title}</strong>
              <span className="text-[15px] leading-relaxed text-ink-muted">{path.desc}</span>
              <span className="mt-auto pt-2 font-bold underline underline-offset-4 group-hover:text-brand-violet">
                {path.cta}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {playable.length > 0 && (
        <section aria-labelledby="watch" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
          <p className="section-label mb-4">Watch it work</p>
          <h2 id="watch" className="mb-7 text-4xl">
            See a paid call, start to finish.
          </h2>
          <div className={`grid gap-6 ${playable.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {playable.map((video) => (
              <OnboardingVideoCard
                key={video.id}
                video={video}
                hostRoute="/start"
                layout={playable.length === 1 ? "horizontal" : "stacked"}
              />
            ))}
          </div>
        </section>
      )}

      <section id="verify" aria-labelledby="verify-heading" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="grid gap-6 rounded-md border border-line bg-paper-raised p-7 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="section-label mb-3">Check it yourself</p>
            <h2 id="verify-heading" className="text-3xl">
              One command checks the public proof trail.
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-muted">
              The checker visits the public pages, the recorded Solana devnet transactions, and the
              registered provider account shown in the walkthrough.
            </p>
            <code className="mt-4 block overflow-x-auto rounded border border-line bg-well px-4 py-3 font-mono text-xs">
              node scripts/judge-replication-check.mjs
            </code>
          </div>
          <Link
            href="/judge-replication"
            className="rounded border-2 border-ink bg-ink px-5 py-3 text-center font-bold text-paper no-underline hover:opacity-90"
          >
            Open the verification guide
          </Link>
        </div>
      </section>
    </main>
  );
}
