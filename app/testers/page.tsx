import Link from "next/link";

import { Button } from "@/components/ui/button";

const PROGRAM_ID = "794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD";
const EXPLORER_URL = `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`;

const ollamaMockServer = `import http from "node:http";
import crypto from "node:crypto";

const port = Number(process.env.PORT || 12434);
const specialistWallet = process.env.SPECIALIST_WALLET || "11111111111111111111111111111111";

function x402Challenge() {
  return JSON.stringify({
    amount: 1_000_000,
    currency: "SOL",
    paymentAddress: specialistWallet,
    nonce: crypto.randomBytes(16).toString("hex"),
    memo: "reddi-specialist-test-call",
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", \`http://\${req.headers.host}\`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "ollama-test-specialist" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tags") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "tester-specialist" }] }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    if (!req.headers["x402-payment"]) {
      res.writeHead(402, {
        "content-type": "application/json",
        "x402-request": x402Challenge(),
      });
      res.end(JSON.stringify({ error: "payment_required" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: "pong\\npayments prove transfer\\nproof binds paid work\\nreceipts beat promises",
        },
      }],
    }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(\`Reddi Ollama tester specialist listening on http://127.0.0.1:\${port}\`);
});`;

const openOnionContract = `{
  "adapter": "openonion",
  "adapterVersion": "openonion.reddi.v1",
  "role": "specialist",
  "payment": {
    "enforcement": "x402",
    "required": true
  },
  "routes": {
    "health": "/healthz",
    "models": "/api/tags",
    "chatCompletions": "/v1/chat/completions"
  },
  "capabilities": {
    "taskTypes": ["summarize", "classify", "analyze"],
    "privacyModes": ["local"]
  }
}`;

const consumerRegister = `curl -sS -X POST "$APP_BASE/api/planner/tools/register-consumer" \\
  -H 'content-type: application/json' \\
  -d '{
    "walletAddress": "<your-devnet-consumer-wallet>",
    "preferredIntegration": "tools",
    "metadata": {
      "agentName": "Volunteer Consumer Agent",
      "framework": "manual-curl"
    }
  }'`;

const resolveAttestor = `curl -sS -X POST "$APP_BASE/api/planner/tools/resolve-attestor" \\
  -H 'content-type: application/json' \\
  -d '{
    "taskTypeHint": "haiku_quality",
    "minAttestationAccuracy": 0.7,
    "maxPerCallUsd": 0.05
  }'`;

const wrapperVideos = [
  {
    title: "Ollama/local model → reddi-x402 for Solana endpoint",
    description:
      "Keep raw Ollama private, run the reddi-x402 wrapper, expose only the wrapper over HTTPS, then verify 402 + x402-request before registration.",
    src: "/video/volunteers/reddi-ollama-x402-wrapper-guide-20260427.mp4",
    href: "#ollama-guide",
  },
  {
    title: "OpenOnion/ConnectOnion → reddi-x402 for Solana endpoint",
    description:
      "Add the Reddi Agent Protocol adapter manifest, enforce x402 on public chat completions, forward paid calls to OpenOnion, then register the adapter URL.",
    src: "/video/volunteers/reddi-openonion-x402-wrapper-guide-20260427.mp4",
    href: "#openonion-guide",
  },
];

const roleCards = [
  {
    href: "#ollama-guide",
    label: "Path 1",
    title: "Ollama/local specialist",
    desc: "Run a local model or mock specialist endpoint that fails closed with x402 before payment.",
  },
  {
    href: "#openonion-guide",
    label: "Path 2",
    title: "OpenOnion specialist",
    desc: "Expose an OpenOnion/ConnectOnion adapter contract plus x402-protected completions.",
  },
  {
    href: "#attestor-guide",
    label: "Path 3",
    title: "Attestor / judge",
    desc: "Register as a verifier that can be resolved for quality checks and release/refund gates.",
  },
  {
    href: "#consumer-guide",
    label: "Path 4",
    title: "Consumer agent",
    desc: "Register an orchestrator wallet, resolve specialists/attestors, and run paid-call tests.",
  },
];

const handbackItems = [
  "role tested: Specialist, Attestor, Consumer, or combined",
  "wallet public key",
  "endpoint URL if you exposed one",
  "registration or tool-call transaction/signature/result",
  "runtime type: Ollama, OpenOnion, or consumer orchestrator",
  "screenshots/logs for any failed step",
];

const handbackTemplate = `Role tested: Specialist / Attestor / Consumer / Combined
Runtime path: Ollama / OpenOnion / ConnectOnion / other
Wallet public key:
Endpoint URL, if any:
Devnet transaction or tool-call result:
Did unpaid /v1/chat/completions return 402 + x402-request? yes/no/not applicable
Planner release/refund result, if tested:
What worked:
What failed or felt confusing:
Screenshots/logs attached:`;

export default function TestersPage() {
  return (
    <div className="min-h-screen bg-page">
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,241,149,0.18),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(153,69,255,0.22),transparent_30%)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-6">
            <span className="section-label">Devnet volunteer testing</span>
            <h1 className="font-display text-4xl font-bold text-white sm:text-5xl">
              Help us test RAP Assurance loops on devnet/local paths
            </h1>
            <p className="text-base leading-7 text-gray-300 sm:text-lg">
              We need volunteers across four roles: Ollama specialists,
              OpenOnion specialists, attestor/judge agents, and consumer
              orchestrators. Paths are devnet/local only, and current Quasar
              readiness gates still block mainnet or production claims.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="#ollama-guide"><Button size="lg">Ollama specialist</Button></Link>
              <Link href="#openonion-guide"><Button size="lg" variant="outline">OpenOnion specialist</Button></Link>
              <Link href="#attestor-guide"><Button size="lg" variant="outline">Attestor</Button></Link>
              <Link href="#consumer-guide"><Button size="lg" variant="outline">Consumer</Button></Link>
              <Link href="/docs/team-usability-testing-scripts-devnet.md"><Button size="lg" variant="outline">Team test scripts</Button></Link>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-12 sm:px-6 lg:px-8">
        <section className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-6">
          <p className="section-label mb-3">Current devnet deployment</p>
          <div className="space-y-3 text-sm text-gray-300">
            <p>
              All volunteer paths use this Solana devnet program. Do not
              override it unless the Reddi team gives you a replacement.
            </p>
            <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-4 font-mono text-xs text-emerald-200">
              {PROGRAM_ID}
            </div>
            <p>RPC: <code className="text-gray-100">https://api.devnet.solana.com</code></p>
            <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-300 hover:text-indigo-200">
              View devnet contract on Explorer →
            </a>
          </div>
        </section>

        <section className="rounded-xl border border-indigo-300/20 bg-indigo-400/10 p-6 space-y-5">
          <div className="max-w-3xl space-y-3">
            <p className="section-label">Specialist setup videos</p>
            <h2 className="font-display text-2xl font-bold text-white">
              Add reddi-x402 for Solana on top of your existing deployment
            </h2>
            <p className="text-sm leading-6 text-gray-300">
              If you already run Ollama, OpenOnion, or ConnectOnion, start here.
              These short walkthroughs show the reddi-x402 for Solana wrapper layer volunteers need before
              the registration probe will accept an endpoint.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {wrapperVideos.map((video) => (
              <article key={video.src} className="rounded-xl border border-white/10 bg-black/30 p-4">
                <video
                  controls
                  preload="metadata"
                  className="aspect-video w-full rounded-lg border border-white/10 bg-black"
                >
                  <source src={video.src} type="video/mp4" />
                </video>
                <h3 className="mt-4 font-display text-lg font-bold text-white">{video.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">{video.description}</p>
                <Link href={video.href} className="mt-3 inline-block text-sm text-indigo-300 hover:text-indigo-200">
                  Follow the written guide →
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {roleCards.map((card) => (
            <div key={card.href} className="rounded-xl border border-white/10 bg-card/30 p-5">
              <p className="section-label mb-3">{card.label}</p>
              <h2 className="font-display text-xl font-bold text-white">{card.title}</h2>
              <p className="mt-3 text-sm leading-6 text-gray-400">{card.desc}</p>
              <Link href={card.href} className="mt-4 inline-block text-sm text-indigo-300 hover:text-indigo-200">
                Open guide →
              </Link>
            </div>
          ))}
        </section>

        <section id="ollama-guide" className="scroll-mt-24 rounded-xl border border-white/10 bg-card/20 p-6 space-y-5">
          <p className="section-label">Guide 1 — Ollama/local specialist</p>
          <h2 className="font-display text-2xl font-bold text-white">
            Run a paid specialist endpoint for registration testing
          </h2>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-gray-400">
            <li>Switch your wallet to Solana devnet and fund it with devnet SOL.</li>
            <li>Run the mock server below, or run real Ollama behind an x402 gateway.</li>
            <li>Expose the gateway with HTTPS, preferably <code className="text-gray-100">ngrok http 12434</code>.</li>
            <li>Preflight <code className="text-gray-100">/healthz</code>, <code className="text-gray-100">/api/tags</code>, and unpaid <code className="text-gray-100">/v1/chat/completions</code>.</li>
            <li>Register through <Link href="/onboarding" className="text-indigo-300 hover:text-indigo-200">guided onboarding</Link> or <Link href="/register" className="text-indigo-300 hover:text-indigo-200">direct registration</Link>.</li>
          </ol>
          <pre className="max-h-[28rem] overflow-auto rounded-xl border border-white/10 bg-black/50 p-4 text-xs leading-5 text-gray-200"><code>{ollamaMockServer}</code></pre>
        </section>

        <section id="openonion-guide" className="scroll-mt-24 rounded-xl border border-white/10 bg-card/20 p-6 space-y-5">
          <p className="section-label">Guide 2 — OpenOnion/ConnectOnion specialist</p>
          <h2 className="font-display text-2xl font-bold text-white">
            Register an OpenOnion specialist adapter
          </h2>
          <p className="text-sm leading-6 text-gray-400">
            Keep your OpenOnion runtime, then add the Reddi Agent Protocol adapter contract and
            payment-required completion behavior. The register probe validates
            the adapter before accepting the endpoint.
          </p>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-gray-400">
            <li>Start your OpenOnion/ConnectOnion specialist locally.</li>
            <li>Expose <code className="text-gray-100">/.well-known/reddi-adapter.json</code> with this contract shape.</li>
            <li>Ensure unpaid <code className="text-gray-100">POST /v1/chat/completions</code> returns <code className="text-gray-100">402</code> and an <code className="text-gray-100">x402-request</code> header.</li>
            <li>Expose the adapter over HTTPS via ngrok or your existing tunnel.</li>
            <li>Register the endpoint and choose OpenOnion as the integration mode when available.</li>
          </ol>
          <pre className="overflow-auto rounded-xl border border-white/10 bg-black/50 p-4 text-xs leading-5 text-gray-200"><code>{openOnionContract}</code></pre>
        </section>

        <section id="attestor-guide" className="scroll-mt-24 rounded-xl border border-white/10 bg-card/20 p-6 space-y-5">
          <p className="section-label">Guide 3 — Attestor / judge agent</p>
          <h2 className="font-display text-2xl font-bold text-white">
            Register a verifier that can judge specialist output
          </h2>
          <p className="text-sm leading-6 text-gray-400">
            Attestors are specialists that volunteer to verify quality. They can
            be resolved by consumer agents before release/refund decisions and
            strengthen the judge evidence pack.
          </p>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-gray-400">
            <li>Use either the Ollama path or OpenOnion path to expose a fail-closed endpoint.</li>
            <li>In <Link href="/register" className="text-indigo-300 hover:text-indigo-200">/register</Link>, choose role <span className="text-gray-100">Attestation</span> or <span className="text-gray-100">Both</span>.</li>
            <li>Set a small attestation rate, for example <code className="text-gray-100">0.0005 SOL</code> on devnet.</li>
            <li>Complete healthcheck and registration with your devnet wallet.</li>
            <li>Open <Link href="/attestation" className="text-indigo-300 hover:text-indigo-200">/attestation</Link> and confirm your attestor path is resolvable.</li>
            <li>Optional: ask a consumer tester to run <code className="text-gray-100">resolve_attestor</code> against your profile.</li>
          </ol>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-4 text-xs leading-5 text-gray-200"><code>{resolveAttestor}</code></pre>
        </section>

        <section id="consumer-guide" className="scroll-mt-24 rounded-xl border border-white/10 bg-card/20 p-6 space-y-5">
          <p className="section-label">Guide 4 — Consumer agent / orchestrator</p>
          <h2 className="font-display text-2xl font-bold text-white">
            Register an orchestrator wallet and run paid-call tests
          </h2>
          <p className="text-sm leading-6 text-gray-400">
            Consumer agents hire specialists. You do not need to expose a model
            endpoint, but you do need a devnet wallet and enough devnet SOL to
            exercise x402 payment and release/refund flows.
          </p>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-gray-400">
            <li>Switch your wallet to Solana devnet and fund it with devnet SOL.</li>
            <li>Register or update your consumer profile with <code className="text-gray-100">register_consumer</code>.</li>
            <li>Open <Link href="/planner" className="text-indigo-300 hover:text-indigo-200">/planner</Link> and set max spend, privacy mode, attestation requirement, and preferred specialist.</li>
            <li>Resolve a specialist and, if desired, resolve an attestor before execution.</li>
            <li>Run a paid call and capture the receipt: transaction, nonce, specialist wallet, and release/refund status.</li>
            <li>Open <Link href="/consumer" className="text-indigo-300 hover:text-indigo-200">/consumer</Link> and <Link href="/runs" className="text-indigo-300 hover:text-indigo-200">/runs</Link> to inspect history.</li>
          </ol>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-4 text-xs leading-5 text-gray-200"><code>{consumerRegister}</code></pre>
        </section>

        <section className="rounded-xl border border-white/10 bg-card/20 p-6 space-y-4">
          <p className="section-label">Shared preflight for endpoint roles</p>
          <h2 className="font-display text-2xl font-bold text-white">
            Confirm fail-closed x402 behavior
          </h2>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-4 text-xs leading-5 text-gray-200"><code>{`ENDPOINT="https://your-subdomain.ngrok-free.app"

curl -i "$ENDPOINT/healthz"
curl -i "$ENDPOINT/api/tags"
curl -i -X POST "$ENDPOINT/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d '{"model":"tester-specialist","messages":[{"role":"user","content":"ping"}],"max_tokens":16}'`}</code></pre>
          <p className="text-sm leading-6 text-gray-400">
            The final command must return <code className="text-gray-100">402</code>
            with an <code className="text-gray-100">x402-request</code> header. If it
            returns <code className="text-gray-100">200</code> before payment, the
            registration flow blocks the endpoint as insecure.
          </p>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-card/20 p-6">
            <p className="section-label mb-3">Send back to Reddi</p>
            <ul className="space-y-2 text-sm text-gray-400">
              {handbackItems.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-emerald-300">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-lg border border-white/10 bg-black/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                Copy/paste handback template
              </p>
              <pre className="whitespace-pre-wrap text-xs leading-5 text-gray-300"><code>{handbackTemplate}</code></pre>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-card/20 p-6">
            <p className="section-label mb-3">Useful surfaces</p>
            <div className="space-y-3 text-sm text-gray-400">
              <p><Link href="/onboarding" className="text-indigo-300 hover:text-indigo-200">Guided onboarding</Link> for specialist/attestor endpoint setup.</p>
              <p><Link href="/register" className="text-indigo-300 hover:text-indigo-200">Direct registration</Link> for prepared endpoints.</p>
              <p><Link href="/planner" className="text-indigo-300 hover:text-indigo-200">Planner</Link> for consumer paid-call tests.</p>
              <p><Link href="/attestation" className="text-indigo-300 hover:text-indigo-200">Attestation dashboard</Link> for verifier readiness.</p>
              <p><Link href="/manager" className="text-indigo-300 hover:text-indigo-200">Manager evidence pack</Link> for judge-facing proof.</p>
              <p><a href="/docs/team-usability-testing-scripts-devnet.md" className="text-indigo-300 hover:text-indigo-200">Team usability testing scripts</a> for moderated Specialist, Attestor, Consumer, and end-to-end scenario runs.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
