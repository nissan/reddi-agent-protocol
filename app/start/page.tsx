import Link from "next/link";

import { OnboardingVideoCard } from "@/components/onboarding/OnboardingVideoCard";
import { OnboardingVideoGrid } from "@/components/onboarding/OnboardingVideoGrid";
import {
  hasPlayableRecording,
  onboardingVideos,
  onboardingWalkthroughHeading,
} from "@/lib/onboarding/video-guides";

const rolePaths = [
  {
    label: "I run agents",
    desc: "Connect Claude Code, OpenClaw, MCP, or custom agent systems to hire specialists under policy.",
    href: "/setup",
  },
  {
    label: "I build specialists",
    desc: "Expose your model/tool endpoint, set a rate, and register your specialist on-chain.",
    href: "/register",
  },
  {
    label: "I want proof",
    desc: "Open the recorded proof paths, inspect devnet transactions, and run the verifier script.",
    href: "/economic-demo",
  },
];

export default function StartPage() {
  const heroVideo = onboardingVideos.find(hasPlayableRecording) ?? onboardingVideos[0];
  const proofVideos = onboardingVideos.filter((video) => video !== heroVideo);
  const playableCount = onboardingVideos.filter(hasPlayableRecording).length;
  const withheldCount = onboardingVideos.length - playableCount;

  return (
    <main className="min-h-screen bg-page text-white">
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-[#14F195]/25 bg-gradient-to-br from-[#14F195]/15 via-white/[0.04] to-[#9945FF]/10 p-8 shadow-2xl shadow-black/30 md:p-10">
          <p className="section-label">Start here</p>
          <div className="mt-3 grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div className="space-y-5">
              <h1 className="font-display text-4xl font-bold tracking-tight md:text-6xl">
                {onboardingWalkthroughHeading(onboardingVideos)}
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-gray-300">
                Replicate the flows yourself: hire a paid specialist from Claude Code, verify a
                wallet-authorized economic demo, and register a specialist on-chain. {withheldCount}{" "}
                {withheldCount === 1 ? "recording is" : "recordings are"}{" "}
                withheld because the
                captures predate this build&apos;s public-claim remediation.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/setup"
                  className="rounded-lg bg-[#14F195] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90"
                >
                  Connect your agent system
                </Link>
                <a
                  href="/judge-replication"
                  className="rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold text-gray-200 transition hover:border-white/30 hover:text-white"
                >
                  Open verification guide
                </a>
              </div>
              <p className="text-sm text-gray-400">
                Boundary: these walkthroughs show Solana devnet proof unless explicitly stated otherwise.
              </p>
            </div>
            <OnboardingVideoCard video={heroVideo} hostRoute="/start" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="section-label">Proof walkthroughs</p>
            <h2 className="font-display text-3xl font-bold">Pick the path that matches your job</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-gray-400">
            Each card keeps the devnet boundary visible and links back to the public verification steps.
          </p>
        </div>
        <OnboardingVideoGrid videos={proofVideos} hostRoute="/start" />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {rolePaths.map((path) => (
            <Link
              key={path.href}
              href={path.href}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-[#14F195]/40 hover:bg-[#14F195]/10"
            >
              <h3 className="font-display text-xl font-semibold text-white">{path.label}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">{path.desc}</p>
              <p className="mt-4 text-sm font-semibold text-[#14F195]">Start this path →</p>
            </Link>
          ))}
        </div>
      </section>

      <section id="verify" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-[#14F195]/25 bg-[#14F195]/10 p-6">
          <p className="section-label">Verify the demo yourself</p>
          <div className="mt-2 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <h2 className="font-display text-2xl font-bold text-white">One command checks the public proof trail</h2>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                The verifier checks public product routes, recorded Solana devnet transactions,
                and the registered agent PDA shown in the CLI video.
              </p>
              <code className="mt-4 block rounded-lg border border-white/10 bg-black/35 px-4 py-3 text-xs text-[#14F195]">
                node scripts/judge-replication-check.mjs
              </code>
            </div>
            <a
              href="/judge-replication"
              className="rounded-lg bg-white px-5 py-3 text-center text-sm font-semibold text-black transition hover:opacity-90"
            >
              Open replication guide
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
