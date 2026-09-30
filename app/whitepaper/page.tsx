import Link from "next/link";

const phases = [
  { phase: "Phase 0", title: "Scope and evidence baseline", status: "Complete" },
  { phase: "Phase 1", title: "Research and decomposition", status: "Complete" },
  { phase: "Phase 2", title: "Whitepaper draft", status: "Complete (v1 draft)" },
  { phase: "Phase 3", title: "Screenshot evidence", status: "Complete (initial pack)" },
  { phase: "Phase 4", title: "Web integration", status: "Complete (this page)" },
  { phase: "Phase 5", title: "QA and publication", status: "Complete (v1.0 candidate package)" },
];

type Screenshot = {
  src: string;
  title: string;
  route: string;
  /** Capture predates this repository's public-claim remediation, so it is withheld. */
  imageStale?: true;
};

const screenshots: Screenshot[] = [
  { src: "/whitepaper/landing-overview.png", title: "Landing overview", route: "/", imageStale: true },
  { src: "/whitepaper/marketplace-discovery.png", title: "Directory discovery", route: "/agents", imageStale: true },
  { src: "/whitepaper/planner-consumption.png", title: "Planner consumption", route: "/planner", imageStale: true },
  { src: "/whitepaper/register-onboarding.png", title: "Register onboarding", route: "/register", imageStale: true },
  { src: "/whitepaper/dogfood-operator-ui.png", title: "Dogfood operator UI", route: "/dogfood", imageStale: true },
];

export default function WhitepaperPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8 space-y-10">
        <header className="space-y-4">
          <p className="section-label">Protocol Documentation</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold">Reddi Agent Protocol Whitepaper</h1>
          <p className="max-w-3xl text-gray-300">
            Candidate documentation for RAP Assurance: payments prove transfer; RAP Assurance proves paid work.
            Current claims are local/offline or explicitly devnet-bounded, not production or mainnet readiness.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="https://github.com/nissan/reddi-agent-protocol/blob/main/docs/whitepaper/WHITEPAPER-v1.md" className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium">
              Read whitepaper v1.0 candidate
            </Link>
            <Link href="https://x.com/reddiagent" className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90">
              Follow @reddiagent on X
            </Link>
            <Link href="https://github.com/nissan/reddi-agent-protocol/blob/main/docs/whitepaper/APPENDIX-THREAT-MODEL.md" className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90">
              Threat model appendix
            </Link>
            <Link href="https://github.com/nissan/reddi-agent-protocol/blob/main/docs/whitepaper/APPENDIX-BENCHMARK-METHODOLOGY.md" className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90">
              Benchmark appendix
            </Link>
            <Link href="https://github.com/nissan/reddi-agent-protocol/tree/main/docs/whitepaper" className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90">
              Open docs folder
            </Link>
            <Link href="https://github.com/nissan/reddi-agent-protocol/blob/main/docs/whitepaper/CLAIMS-TRACEABILITY.md" className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90">
              Claims matrix
            </Link>
            <Link href="https://github.com/nissan/reddi-agent-protocol/blob/main/docs/whitepaper/GLOSSARY.md" className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/90">
              Glossary
            </Link>
            <Link href="/adl" className="rounded-lg border border-[#14F195]/40 bg-[#14F195]/10 px-4 py-2 text-sm font-medium text-[#14F195]">
              ADL whitepaper and demo
            </Link>
          </div>
        </header>

        <section className="space-y-4">
          <h2 className="font-display text-2xl font-semibold">Phase progress</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {phases.map((p) => (
              <div key={p.phase} className="rounded-xl border border-white/10 bg-card/40 p-4">
                <div className="text-xs text-indigo-300 mb-1">{p.phase}</div>
                <div className="font-semibold text-white">{p.title}</div>
                <div className="text-sm text-gray-300 mt-1">{p.status}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-2xl font-semibold">Evidence screenshots</h2>
          <p className="text-sm text-gray-300">Initial screenshot pack used for bounded technical walkthroughs; screenshots are not production-readiness evidence. Captures that still assert retired claims are withheld until they are retaken.</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {screenshots.map((shot) => (
              <figure key={shot.src} className="rounded-xl border border-white/10 bg-card/40 overflow-hidden">
                {shot.imageStale ? (
                  <div className="flex h-44 w-full items-center justify-center bg-[#1a1a2e] px-5 text-center">
                    <span className="max-w-xs text-xs leading-relaxed text-white/25">
                      Screenshot withheld: the committed capture predates this repository&apos;s
                      public-claim remediation and still shows retired wording. Open{" "}
                      <Link href={shot.route} className="underline hover:text-white/50">
                        {shot.route}
                      </Link>{" "}
                      on this build for the current copy.
                    </span>
                  </div>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={shot.src} alt={shot.title} className="w-full h-44 object-cover" />
                )}
                <figcaption className="p-3">
                  <div className="text-sm font-medium text-white">{shot.title}</div>
                  <div className="text-xs text-gray-400 mt-1">Route: {shot.route}</div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-card/30 p-5 space-y-3">
          <h2 className="font-display text-2xl font-semibold">What is next</h2>
          <ul className="list-disc pl-5 text-sm text-gray-300 space-y-1">
            <li>Run final technical review pass and sign-off on claim wording.</li>
            <li>Attach dated benchmark result snapshots to Appendix B.</li>
            <li>Keep any release announcement gated on current evidence, not roadmap intent.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
