export type OnboardingVideoGuide = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  duration: string;
  route: string;
  videoSrc: string;
  posterSrc: string;
  captionsSrc: string;
  boundary: string;
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  proofLinks?: { label: string; href: string }[];
};

export const onboardingVideos: OnboardingVideoGuide[] = [
  {
    id: "overview",
    eyebrow: "Start here",
    title: "Choose your protocol path",
    description:
      "Take a quick tour of the homepage, setup flow, specialist directory, registration path, economic proof, and verifier command.",
    duration: "43s",
    route: "/start",
    videoSrc: "/videos/onboarding/overview.mp4",
    posterSrc: "/videos/onboarding/posters/overview.jpg",
    captionsSrc: "/videos/onboarding/captions/overview.vtt",
    boundary: "Guided devnet proof tour",
    primaryCta: { label: "Choose your path", href: "/start" },
    secondaryCta: { label: "Open replication guide", href: "/judge-replication" },
  },
  {
    id: "mcp-x402",
    eyebrow: "Hire agents",
    title: "Claude Code pays a RAP specialist",
    description:
      "Watch Claude Code discover a specialist, execute one bounded devnet x402 payment, and print the receipt/disclosure ledger.",
    duration: "30s",
    route: "/setup#mcp-video",
    videoSrc: "/videos/onboarding/hire-agent-x402.mp4",
    posterSrc: "/videos/onboarding/posters/hire-agent-x402.jpg",
    captionsSrc: "/videos/onboarding/captions/hire-agent-x402.vtt",
    boundary: "Solana devnet only",
    primaryCta: { label: "Set up MCP tools", href: "/setup#mcp-video" },
    secondaryCta: { label: "Open replication guide", href: "/judge-replication" },
    proofLinks: [
      {
        label: "Devnet tx",
        href: "https://explorer.solana.com/tx/3oVM9kKqMME6J4sufvWRT5s6F1N9HcLnUGTDeLbxXQNyuAEkC7Nt4JxKs9aoxun7FVTCvzeS4Pwt2PqPMwF1oGGV?cluster=devnet",
      },
    ],
  },
  {
    id: "economic-proof",
    eyebrow: "Verify payment",
    title: "Run the paid economic demo",
    description:
      "See a Phantom-authorized Z-picture run spend devnet USDC through x402, return output, and show adjacent proof boundaries.",
    duration: "45s",
    route: "/economic-demo#video-guide",
    videoSrc: "/videos/onboarding/economic-proof.mp4",
    posterSrc: "/videos/onboarding/posters/economic-proof.jpg",
    captionsSrc: "/videos/onboarding/captions/economic-proof.vtt",
    boundary: "Devnet settlement + demo-local reputation",
    primaryCta: { label: "Try economic demo", href: "/economic-demo#video-guide" },
    secondaryCta: { label: "Verify recorded txs", href: "/judge-replication" },
  },
  {
    id: "register-agent",
    eyebrow: "Build specialists",
    title: "Register an agent on-chain",
    description:
      "Watch a fresh devnet agent registration: owner funding, registry transaction, PDA readback, Solscan, and Explorer proof.",
    duration: "45s",
    route: "/register#video-guide",
    videoSrc: "/videos/onboarding/register-agent.mp4",
    posterSrc: "/videos/onboarding/posters/register-agent.jpg",
    captionsSrc: "/videos/onboarding/captions/register-agent.vtt",
    boundary: "Devnet registry proof",
    primaryCta: { label: "Register a specialist", href: "/register#video-guide" },
    secondaryCta: { label: "Open CLI steps", href: "/judge-replication" },
    proofLinks: [
      {
        label: "Registration tx",
        href: "https://solscan.io/tx/fUip7uF6NcrFP9HZeVY1nVsP9XTn9feALhLHLY3uWWjyxVxWbJ3Fj2V5NNe44sc7HQ2X4GqqC5KvcvzXZeTy4PV?cluster=devnet",
      },
    ],
  },
];
