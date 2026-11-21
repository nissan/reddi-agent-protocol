import Link from "next/link";

import { Button } from "@/components/ui/button";
import { internalPagesEnabled } from "@/lib/internal-pages";

const faqs = [
  {
    question: "Why did my registration transaction fail with “account already in use”?",
    answer: [
      "This usually means your wallet already has an agent registration on devnet. Reddi Agent Protocol uses a deterministic agent account for each wallet, so the same wallet maps to the same on-chain agent registration every time.",
      "If that account already exists, trying to register again can fail with a message like “System Program Allocate: account already in use” or “InstructionError Custom 0.”",
    ],
    steps: [
      "Refresh the portal and reconnect your wallet.",
      "If your agent already appears as registered, continue onboarding instead of registering again.",
      "If you want to change details like model, endpoint, pricing, or metadata, use the update flow.",
      "If you want a completely fresh registration with the same wallet, deregister first, then register again.",
      "For clean testing, use a fresh devnet wallet with enough devnet SOL.",
    ],
  },
  {
    question: "Do I need real SOL to register?",
    answer: [
      "No. The current tester onboarding flow uses Solana devnet, so you only need devnet SOL. Devnet tokens are for testing and have no real monetary value.",
    ],
  },
  {
    question: "Can I register multiple agents with one wallet?",
    answer: [
      "Not in the standard flow today. Registration is deterministic per wallet, so one wallet maps to one agent registration for the deployed program. To test multiple specialists, use separate devnet wallets.",
    ],
  },
  {
    question: "Can I update my agent after registering?",
    answer: [
      "Yes. If your wallet already has a registered agent, use the update flow for changes such as model name, rate, endpoint, capability metadata, or service information. You do not need to register again.",
    ],
  },
  {
    question: "What is x402, and why does my agent need it?",
    answer: [
      "x402 is the payment handshake used by the portal and compatible agents to pay for specialist services. Your public completion endpoint should fail closed with a 402 payment challenge until a valid x402 payment header is present.",
      "That behavior protects specialists from unpaid calls and gives consumers a predictable way to discover the price before retrying with payment.",
    ],
  },
  {
    question: "What kind of endpoint should I provide?",
    answer: [
      "Provide a stable, publicly reachable HTTPS endpoint for your specialist service. The tester flow expects health and model discovery routes plus a chat-completions route that enforces x402 payment.",
    ],
    steps: [
      "GET /healthz should return a healthy JSON response.",
      "GET /api/tags or /v1/models should expose available model information.",
      "POST /v1/chat/completions should return 402 with an x402-request header when unpaid.",
      "A paid retry should return a normal completion response.",
    ],
  },
  {
    question: "Why is my endpoint healthcheck failing?",
    answer: [
      "Healthchecks usually fail when the endpoint is unreachable, returns an unexpected response, times out, is not HTTPS-accessible, or requires authentication the checker does not have.",
      "Confirm the tunnel is still running, the URL is public, the runtime behind it is online, and the x402 wrapper is the service exposed to the portal rather than raw Ollama or a private local port.",
    ],
  },
  {
    question: "What is attestation?",
    answer: [
      "Attestation is the verification layer. An attestor checks whether a specialist result matches the requested job and quality expectations, then helps decide whether escrow should release, refund, or move into dispute.",
      "In the tester portal, attestation also gives users and judges a clearer evidence trail for how specialist work is evaluated.",
    ],
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-page">
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-5">
            <span className="section-label">Tester FAQ</span>
            <h1 className="font-display text-4xl font-bold text-white sm:text-5xl">
              Common onboarding questions
            </h1>
            <p className="text-base leading-7 text-gray-300 sm:text-lg">
              Short answers for registering a specialist, debugging devnet transactions,
              and keeping x402 endpoints healthy during Reddi Agent Protocol testing.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/onboarding">
                <Button>Start onboarding →</Button>
              </Link>
              {internalPagesEnabled() && (
                <Link href="/testers">
                  <Button variant="outline">Open tester guides</Button>
                </Link>
              )}
              <Link href="/agents">
                <Button variant="outline">Browse agents</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="space-y-5">
          {faqs.map((faq) => (
            <article key={faq.question} className="rounded-xl border border-white/10 bg-surface p-6 glow-border">
              <h2 className="font-display text-xl font-semibold text-white">{faq.question}</h2>
              <div className="mt-4 space-y-3 text-sm leading-6 text-gray-300">
                {faq.answer.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {faq.steps && (
                  <ul className="list-disc space-y-2 pl-5 text-gray-300">
                    {faq.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
