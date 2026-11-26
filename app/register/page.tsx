"use client";

import { Suspense } from "react";
import { useEffect, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Connection, Transaction } from "@solana/web3.js";
import {
  REGISTRY_PROGRAM_ID,
  DEVNET_RPC,
  AGENT_TYPE_ENUM,
  PROGRAM_TARGET,
  PROGRAM_COMPATIBILITY,
  PROGRAM_SUBMISSION_READY,
  PROGRAM_KNOWN_GAPS,
  PROGRAM_KNOWN_LIMITATIONS,
  PROGRAM_DEPLOYMENT_STATUS,
  SUBMISSION_BLOCKED,
  SUBMISSION_BLOCKED_LABEL,
  SUBMISSION_BLOCKED_REASON,
  agentPda,
} from "@/lib/program";
import { toExplorerTxUrl } from "@/lib/config/explorer";
import { buildAgentRegistrationInstruction } from "@/lib/register/registration-instruction";
import {
  INITIAL_EXISTING_AGENT_STATE,
  agentDetailHref,
  isAlreadyRegisteredError,
  type ExistingAgentState,
} from "@/lib/register/existing-agent";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import LinkButton from "@/components/LinkButton";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import StepIndicator from "@/components/StepIndicator";
import GuidedSetupModal from "@/components/GuidedSetupModal";
import { showToast } from "@/components/ui/toast";
import { ProviderPriceFields } from "@/components/onboarding/ProviderPriceFields";
import { currentAccessToken } from "@/components/auth/WalletSignIn";
import { publishListing } from "@/lib/listings/listing-client";
import { resolveNetworkProfileName } from "@/lib/config/network";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { perTokenPriceProblem, registryRateLamports, sellsAnswers } from "@/lib/register/provider-pricing";
import { LimitNotice } from "@/components/ui/limit-notice";
import { internalPagesEnabled } from "@/lib/internal-pages";
import { legacyPagesEnabled } from "@/lib/legacy-pages";

// Same switch as the legacy pages (#1148): the launch build shows the provider kit path only,
// without the older local-model wizard.
const LEGACY_WIZARD = legacyPagesEnabled();
import ProviderKitGuide from "@/components/onboarding/ProviderKitGuide";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

type Step = 1 | 2 | 3;
type AgentType = "primary" | "attestation" | "both";
type PrivacyTier = "local" | "tee" | "cloud";
type EndpointProbeStatus =
  | "idle"
  | "checking"
  | "reachable"
  | "no_ollama"
  | "unreachable";
type HelpItem = { text: string; href?: string; code?: string };
type HelpStep = { title: string; items: HelpItem[] };

interface FormData {
  name: string;
  agentType: AgentType;
  endpoint: string;
  model: string;
  privacyTier: PrivacyTier;
  inputPerMillionUsd: string;
  outputPerMillionUsd: string;
  attestationRate: string;
  minConsumerRep: number;
  acceptUnrated: boolean;
  description: string;
}

const INITIAL_FORM: FormData = {
  name: "",
  agentType: "primary",
  endpoint: "",
  model: "",
  privacyTier: "local",
  inputPerMillionUsd: "3",
  outputPerMillionUsd: "15",
  attestationRate: "0.0005",
  minConsumerRep: 0,
  acceptUnrated: true,
  description: "",
};

const REGISTRATION_FEE_SOL = 0.01;
const RENT_SOL = 0.00057;

function truncateMiddle(value: string, max = 240) {
  if (value.length <= max) return value;
  const head = Math.floor((max - 3) / 2);
  const tail = max - 3 - head;
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}

function formatSimulationError(err: unknown, logs?: string[] | null) {
  const base = typeof err === "string" ? err : JSON.stringify(err);
  const logTail = (logs ?? []).slice(-8);

  let hint = "";
  if (/InvalidInstructionData/i.test(base)) {
    hint =
      "\nHint: Program/instruction layout mismatch. Check that NEXT_PUBLIC_ESCROW_PROGRAM_ID points to the current deployed program for this app build.";
  } else if (/AccountNotFound/i.test(base)) {
    hint =
      "\nHint: One required account is missing on this RPC (often wrong cluster/RPC or unfunded wallet). Verify RPC endpoint + wallet balance on the same network.";
  }

  if (logTail.length === 0)
    return truncateMiddle(`Simulation failed: ${base}${hint}`);
  return truncateMiddle(
    `Simulation failed: ${base}${hint}\nLogs:\n${logTail.join("\n")}`,
    1200,
  );
}

function formatRegisterError(err: unknown) {
  if (err instanceof Error) return truncateMiddle(err.message, 1200);
  return truncateMiddle(String(err), 1200);
}

const ENDPOINT_HELP_STEPS: HelpStep[] = [
  {
    title: "Install and start Ollama",
    items: [
      { text: "Download Ollama", href: "https://ollama.com/download" },
      { text: "Pull a model", code: "ollama pull qwen2.5:7b" },
      { text: "Ollama runs at http://localhost:11434 by default" },
    ],
  },
  {
    title: "Expose it with ngrok (recommended)",
    items: [
      { text: "Install", href: "https://ngrok.com/download" },
      { text: "Run", code: "ngrok http 11434" },
      { text: "Copy the https:// forwarding URL" },
      { text: "Use token-gated proxy if available before exposing endpoint" },
    ],
  },
  {
    title: "Fallback: localtunnel (less stable)",
    items: [
      { text: "Install", code: "npm install -g localtunnel" },
      { text: "Run", code: "lt --port 11434 --subdomain my-agent" },
      { text: "Your endpoint will be", code: "https://my-agent.loca.lt" },
      { text: "Note: localtunnel URLs expire when the process stops" },
    ],
  },
  {
    title: "Paste the public URL below",
    items: [{ text: "Then probe it to confirm the endpoint is reachable." }],
  },
];

function RegisterInner() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection: walletConnection } = useConnection();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [registering, setRegistering] = useState(false);
  const [success, setSuccess] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [listingNote, setListingNote] = useState<{ published: boolean; message: string } | null>(null);
  const [publishingListing, setPublishingListing] = useState(false);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [endpointProbeStatus, setEndpointProbeStatus] =
    useState<EndpointProbeStatus>("idle");
  const [endpointProbeMessage, setEndpointProbeMessage] = useState("");
  const [endpointProbeModels, setEndpointProbeModels] = useState<string[]>([]);
  const [existingAgent, setExistingAgent] = useState<ExistingAgentState>(
    INITIAL_EXISTING_AGENT_STATE,
  );
  const endpointProbeTimeoutRef = useRef<number | null>(null);
  const endpointProbeRequestRef = useRef(0);
  const endpointCompliancePassed = endpointProbeStatus === "reachable";
  const priceProblem = perTokenPriceProblem(form);
  const canAdvanceToReview = Boolean(
    form.name && form.model && form.endpoint.trim() && endpointCompliancePassed && !priceProblem,
  );

  // The per-token price lives in the listing, published under the signed-in wallet.
  const publishProviderListing = async () => {
    if (!publicKey || !sellsAnswers(form.agentType)) return;
    if (!getBrowserSupabase()) {
      setListingNote({ published: false, message: "Listings are not switched on for this deployment yet." });
      return;
    }
    setPublishingListing(true);
    try {
      const outcome = await publishListing(
        {
          walletAddress: publicKey.toBase58(),
          endpointUrl: form.endpoint,
          perCallUsd: "",
          inputPerMillionUsd: form.inputPerMillionUsd,
          outputPerMillionUsd: form.outputPerMillionUsd,
          taskTypes: [],
          inputModes: [],
          outputModes: [],
          privacyModes: [],
          tags: [],
          profile: resolveNetworkProfileName(),
        },
        await currentAccessToken().catch(() => undefined),
      );
      setListingNote(outcome);
    } finally {
      setPublishingListing(false);
    }
  };

  const runEndpointProbe = async (rawEndpoint: string) => {
    const endpoint = rawEndpoint.trim();
    if (!endpoint) {
      setEndpointProbeStatus("idle");
      setEndpointProbeMessage("");
      setEndpointProbeModels([]);
      return;
    }

    const requestId = ++endpointProbeRequestRef.current;
    setEndpointProbeStatus("checking");
    setEndpointProbeMessage("");
    setEndpointProbeModels([]);

    try {
      const res = await fetch("/api/register/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, requireX402: true }),
      });
      const data = await res.json().catch(() => null);
      if (requestId !== endpointProbeRequestRef.current) return;

      if (!data) {
        setEndpointProbeStatus("unreachable");
        setEndpointProbeMessage(
          "Could not reach endpoint. Use a public https URL from ngrok (recommended) or localtunnel.",
        );
        return;
      }

      if (!res.ok) {
        setEndpointProbeStatus("unreachable");
        setEndpointProbeMessage(
          data.error ||
            "Could not reach endpoint. Use a public https URL from ngrok (recommended) or localtunnel.",
        );
        return;
      }

      if (data.status === "ollama_detected") {
        setEndpointProbeStatus("reachable");
        setEndpointProbeModels(Array.isArray(data.models) ? data.models : []);
        const base =
          Array.isArray(data.models) && data.models.length > 0
            ? `Endpoint reachable, models: ${data.models.slice(0, 3).join(", ")}`
            : "Endpoint reachable.";
        setEndpointProbeMessage(
          data.warning ? `${base} ${data.warning}` : base,
        );
        return;
      }

      if (data.status === "reachable") {
        setEndpointProbeStatus("no_ollama");
        setEndpointProbeMessage(
          "Endpoint is reachable. It did not list its models, so check the model name below by hand.",
        );
        return;
      }

      setEndpointProbeStatus("unreachable");
      setEndpointProbeMessage(
        data.error ||
          "Could not reach endpoint. Use a public https URL from ngrok (recommended) or localtunnel.",
      );
    } catch {
      if (requestId !== endpointProbeRequestRef.current) return;
      setEndpointProbeStatus("unreachable");
      setEndpointProbeMessage(
        "Could not reach endpoint. Use a public https URL from ngrok (recommended) or localtunnel.",
      );
    }
  };

  useEffect(() => {
    const endpoint = searchParams.get("endpoint")?.trim();
    const model = searchParams.get("model")?.trim();
    const name = searchParams.get("name")?.trim();
    const inputPerMillion = searchParams.get("inputPerMillion")?.trim();
    const outputPerMillion = searchParams.get("outputPerMillion")?.trim();
    const attestationRate = searchParams.get("attestationRate")?.trim();

    if (!endpoint && !model && !name && !inputPerMillion && !outputPerMillion && !attestationRate)
      return;

    setForm((prev) => ({
      ...prev,
      endpoint: endpoint || prev.endpoint,
      model: model || prev.model,
      name: name || prev.name,
      inputPerMillionUsd: inputPerMillion || prev.inputPerMillionUsd,
      outputPerMillionUsd: outputPerMillion || prev.outputPerMillionUsd,
      attestationRate: attestationRate || prev.attestationRate,
    }));
  }, [searchParams]);

  const applyQuickSetup = (nextEndpoint: string, nextModel: string) => {
    setForm((prev) => ({
      ...prev,
      endpoint: nextEndpoint,
      model: nextModel,
      name: prev.name.trim() ? prev.name : "My First Agent",
      privacyTier: "local",
    }));
    setStep(2);
  };

  useEffect(() => {
    if (endpointProbeTimeoutRef.current) {
      window.clearTimeout(endpointProbeTimeoutRef.current);
    }

    const endpoint = form.endpoint.trim();
    if (!endpoint) {
      setEndpointProbeStatus("idle");
      setEndpointProbeMessage("");
      setEndpointProbeModels([]);
      return;
    }

    endpointProbeTimeoutRef.current = window.setTimeout(() => {
      void runEndpointProbe(endpoint);
    }, 800);

    return () => {
      if (endpointProbeTimeoutRef.current) {
        window.clearTimeout(endpointProbeTimeoutRef.current);
      }
    };
  }, [form.endpoint]);

  useEffect(() => {
    if (!publicKey) {
      setExistingAgent(INITIAL_EXISTING_AGENT_STATE);
      return;
    }

    let cancelled = false;
    const pda = agentPda(publicKey);
    setExistingAgent({ status: "checking", pda: pda.toBase58() });

    async function checkExistingAgent() {
      try {
        const conn =
          walletConnection ?? new Connection(DEVNET_RPC, "confirmed");
        const account = await conn.getAccountInfo(pda, "confirmed");
        if (cancelled) return;
        setExistingAgent({
          status: account ? "registered" : "not_registered",
          pda: pda.toBase58(),
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setExistingAgent({
          status: "error",
          pda: pda.toBase58(),
          error:
            error instanceof Error
              ? error.message
              : "Could not check existing registration",
        });
      }
    }

    void checkExistingAgent();
    return () => {
      cancelled = true;
    };
  }, [publicKey, walletConnection]);

  const isJudge = form.agentType === "attestation" || form.agentType === "both";
  const activeRpc = DEVNET_RPC;
  const activeProgramId = REGISTRY_PROGRAM_ID.toBase58();
  const myAgentHref = publicKey ? agentDetailHref(publicKey) : "/agents";
  const alreadyRegistered = existingAgent.status === "registered";

  const handleRegister = async () => {
    if (!publicKey || !sendTransaction) return;
    if (SUBMISSION_BLOCKED) {
      setTxError(SUBMISSION_BLOCKED_REASON);
      return;
    }
    if (alreadyRegistered) {
      setTxError(
        "This wallet is already registered. Open My Agent to view the existing registration, or deregister before creating a fresh registration with the same wallet.",
      );
      return;
    }
    setRegistering(true);
    setTxError(null);

    try {
      // Use wallet connection (adapter-configured) or fall back to devnet
      const conn = walletConnection ?? new Connection(DEVNET_RPC, "confirmed");

      const agentTypeByte =
        form.agentType === "primary"
          ? AGENT_TYPE_ENUM.Primary
          : form.agentType === "attestation"
            ? AGENT_TYPE_ENUM.Attestation
            : AGENT_TYPE_ENUM.Both;

      const rateLamports = registryRateLamports(form);

      const modelName = form.model || "unknown";
      const minRep = form.minConsumerRep ?? 0;

      const ix = buildAgentRegistrationInstruction({
        target: PROGRAM_TARGET,
        programId: REGISTRY_PROGRAM_ID,
        owner: publicKey,
        agentType: agentTypeByte,
        model: modelName,
        rateLamports,
        minReputation: minRep,
      });

      const { blockhash } = await conn.getLatestBlockhash();
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      tx.add(ix);

      try {
        const sim = await conn.simulateTransaction(tx);

        if (sim.value.err) {
          throw new Error(formatSimulationError(sim.value.err, sim.value.logs));
        }
      } catch (simErr: unknown) {
        const simMsg =
          simErr instanceof Error ? simErr.message : String(simErr);
        if (!/invalid arguments/i.test(simMsg)) {
          throw simErr;
        }
        // Some local RPC harnesses reject simulateTransaction config args. In that case,
        // continue to wallet send + confirmation so local Surfpool flows can still proceed.
      }

      const sig = await sendTransaction(tx, conn);
      const confirmation = await conn.confirmTransaction(sig, "confirmed");
      if (confirmation.value.err) {
        const txMeta = await conn
          .getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          })
          .catch(() => null);

        throw new Error(
          formatSimulationError(
            confirmation.value.err,
            txMeta?.meta?.logMessages,
          ),
        );
      }

      setTxSig(sig);
      setSuccess(true);
      showToast("Registration confirmed", "success");
      void publishProviderListing();
    } catch (err: unknown) {
      const msg = formatRegisterError(err);
      setTxError(msg);
      if (isAlreadyRegisteredError(msg) && publicKey) {
        setExistingAgent({
          status: "registered",
          pda: agentPda(publicKey).toBase58(),
        });
      }
      setTxSig(null);
      setSuccess(false);
      showToast(
        isAlreadyRegisteredError(msg)
          ? "Wallet already registered"
          : "Registration failed",
        "error",
      );
    } finally {
      setRegistering(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-6 bg-page">
        <div className="text-5xl">{txError ? "⚠️" : "🎉"}</div>
        <h1 className="text-3xl font-bold sol-gradient-text">
          {txError ? "Transaction failed." : "Your agent is live."}
        </h1>
        <p className="text-muted-foreground">
          {txError ? (
            "The on-chain transaction could not be submitted. Check your wallet balance and try again."
          ) : (
            <>
              <strong className="text-foreground">{form.name}</strong> has been
              registered on-chain. Your endpoint is ready to receive requests.
            </>
          )}
        </p>
        {txError && (
          <LimitNotice tone="warning" title="The on-chain transaction failed." className="text-left">
            The signature below is simulated.
            <span className="mt-1 block break-all font-mono text-xs text-ink-muted">{txError}</span>
          </LimitNotice>
        )}
        {txSig && (
          <div className="p-4 rounded-lg border border-border bg-surface/80 text-left">
            <p className="text-xs text-muted-foreground mb-1">
              {txError ? "Transaction (simulated)" : "Transaction"}
            </p>
            {!txError ? (
              <a
                href={toExplorerTxUrl(txSig)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs break-all text-brand-green hover:underline"
              >
                {txSig}
              </a>
            ) : (
              <p className="font-mono text-xs break-all text-brand-green">
                {txSig}
              </p>
            )}
          </div>
        )}
        {!txError && sellsAnswers(form.agentType) && (
          <div className="p-4 rounded-lg border border-border bg-surface/80 text-left" data-testid="register-listing">
            <p className="text-xs text-muted-foreground mb-1">Your listing</p>
            <p className="text-sm text-foreground">
              ${form.inputPerMillionUsd} per million input tokens, ${form.outputPerMillionUsd} per million output tokens (USDC).
            </p>
            <p className="mt-2 text-sm text-ink-muted" role="status">
              {publishingListing ? "Publishing your listing..." : listingNote?.message ?? ""}
            </p>
            {listingNote && !listingNote.published && !publishingListing ? (
              <Button className="mt-3" size="sm" variant="outline" onClick={() => void publishProviderListing()}>
                Publish listing
              </Button>
            ) : null}
          </div>
        )}
        {form.endpoint && (
          <div className="p-4 rounded-lg border border-border bg-surface/80 text-left">
            <p className="text-xs text-muted-foreground mb-1">Your endpoint</p>
            <p className="font-mono text-sm text-foreground">{form.endpoint}</p>
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <LinkButton
            href="/docs"
            style={{
              background: "var(--color-ink)",
              color: "var(--color-paper)",
              fontWeight: 600,
            }}
          >
            Open the docs →
          </LinkButton>
          <LinkButton
            href="/agents"
            variant="outline"
            className="border-white/10"
          >
            Browse providers
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-8 bg-page font-sans">
      <GuidedSetupModal
        open={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        onComplete={(ep, mdl) => {
          applyQuickSetup(ep, mdl);
          setSetupModalOpen(false);
        }}
      />
      <PageHeader
        label="Run a provider"
        title={
          alreadyRegistered
            ? "Your wallet already has an agent"
            : "Describe your provider"
        }
        subtitle={
          alreadyRegistered
            ? "Open your existing agent profile, update details, or deregister before creating a fresh registration with this wallet."
            : "Set your model, your endpoint and your price per million input and output tokens. Registering puts you on the Solana registry and publishes your listing, so buyers can find you and pay per token with a receipt for every call."
        }
      />
      <ProviderKitGuide />
      {internalPagesEnabled() && (
        <Card
          className="flex flex-col gap-2 p-4 text-sm border-brand-violet/20 bg-brand-violet/5 sm:flex-row sm:items-center sm:justify-between"
          data-testid="register-intake-entry"
        >
          <span className="text-muted-foreground">
            Already have an MCP server, OpenAPI service, A2A card, AI Catalog entry, or bare endpoint?
            Let the onboarding assistant draft the profile from it. Static analysis, no live calls.
          </span>
          <LinkButton href="/onboarding/intake" variant="outline" className="shrink-0 border-brand-violet/40">
            Open guided intake →
          </LinkButton>
        </Card>
      )}
      <h2 className="font-display text-2xl font-bold text-white" id="register-here">Or register from this page</h2>
      <p className="-mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
        Already running an endpoint that answers unpaid requests with a 402 price? Connect the wallet that will be paid, describe the
        provider and sign one transaction. It does the same as <code className="font-mono">rap-provider register</code>.
      </p>
      {(PROGRAM_TARGET === "quasar" || !PROGRAM_SUBMISSION_READY || PROGRAM_KNOWN_GAPS.length > 0) && (
        <Card
          className={`space-y-2 p-4 text-sm ${PROGRAM_SUBMISSION_READY ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-50" : "border-amber-400/25 bg-amber-500/10 text-amber-50"}`}
        >
          <p className="font-semibold">
            {PROGRAM_TARGET === "quasar"
              ? PROGRAM_SUBMISSION_READY
                ? "Quasar mode is active and marked submission-ready."
                : "Quasar mode is active, but submission readiness is still blocked."
              : PROGRAM_SUBMISSION_READY
                ? "Readiness gaps are recorded for the active network profile."
                : "Submission readiness is blocked for the active network profile."}
          </p>
          <p className="text-xs opacity-85">
            Target: <span className="font-mono">{PROGRAM_TARGET}</span> ·
            Compatibility:{" "}
            <span className="font-mono">{PROGRAM_COMPATIBILITY}</span> ·
            Deployment:{" "}
            <span className="font-mono">{PROGRAM_DEPLOYMENT_STATUS}</span>.
            {SUBMISSION_BLOCKED
              ? ` ${SUBMISSION_BLOCKED_REASON}`
              : PROGRAM_TARGET === "quasar"
                ? " Registration instruction construction uses the Quasar registry layout, but wallet submission should wait for the full proof chain unless you are deliberately testing this path."
                : " Wallet submission is not blocked on this profile; the gaps listed below are advisory."}
          </p>
          {PROGRAM_KNOWN_GAPS.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-xs opacity-85">
              {PROGRAM_KNOWN_GAPS.slice(0, 3).map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          )}
          {PROGRAM_KNOWN_LIMITATIONS.length > 0 && (
            <>
              <p className="text-xs font-semibold opacity-85">
                Known limitations of the deployed programs:
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs opacity-85">
                {PROGRAM_KNOWN_LIMITATIONS.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      {existingAgent.status === "checking" && (
        <Card className="border-blue-400/20 bg-blue-500/10 p-4 text-sm text-blue-100">
          Checking whether this wallet already has an on-chain agent
          registration…
        </Card>
      )}
      {alreadyRegistered && (
        <Card className="space-y-3 border-emerald-400/25 bg-emerald-500/10 p-4 text-sm text-emerald-50">
          <p className="font-semibold">This wallet is already registered.</p>
          <p className="text-emerald-100/80">
            Registering again would fail because each wallet maps to one
            deterministic agent account. Use My Agent to view the existing
            profile, or deregister first if you need a fresh registration.
          </p>
          <div className="flex flex-wrap gap-3">
            <LinkButton
              href={myAgentHref}
              className="!bg-emerald-400 !text-black hover:!bg-emerald-300"
            >
              My Agent →
            </LinkButton>
            <LinkButton
              href="/faq"
              variant="outline"
              className="border-emerald-300/30 text-emerald-100"
            >
              Read FAQ
            </LinkButton>
          </div>
        </Card>
      )}
      {LEGACY_WIZARD && <div className="space-y-4">
        <Button
          type="button"
          onClick={() => setSetupModalOpen(true)}
          className="w-full py-3 px-4 bg-ink hover:bg-brand-violet text-paper font-semibold rounded-xl transition flex items-center justify-center gap-2 mb-6"
        >
          <span>🚀</span> Set up my first specialist (guided)
        </Button>
        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mb-6">
          Already have Ollama, OpenOnion, or a hosted specialist running? Fill
          in the form below.
        </p>
      </div>}

      {/* Step indicators */}
      <div className="space-y-3">
        <StepIndicator
          number={1}
          title="Connect Wallet"
          status={
            connected ? "complete" : step === 1 ? "in-progress" : "not-started"
          }
          description="Connect your Solana wallet to sign the registration transaction"
        />
        <StepIndicator
          number={2}
          title="Agent Details"
          status={
            step === 2 ? "in-progress" : step === 3 ? "complete" : "not-started"
          }
          description="Configure capabilities, pricing, and assurance policy"
        />
        <StepIndicator
          number={3}
          title="Register On-Chain"
          status={step === 3 ? "in-progress" : "not-started"}
          description="Pay 0.01 SOL · List your provider in the registry"
        />
      </div>

      {/* Step 1: Connect */}
      {step === 1 && (
        <div className="rounded-2xl border border-border bg-surface/80 p-6 shadow-card space-y-4">
          <h2 className="text-lg font-semibold">Connect Your Wallet</h2>
          <p className="text-sm text-muted-foreground">
            Your wallet address becomes the owner keypair for your agent PDA.
            You&apos;ll need it to update your agent settings or withdraw funds.
          </p>
          {connected && publicKey ? (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-brand-green/10 border border-brand-green/20">
                <p className="text-xs text-muted-foreground">
                  Connected wallet
                </p>
                <p
                  className="font-mono text-sm text-brand-green truncate cursor-default"
                  title={publicKey.toBase58()}
                >
                  {publicKey.toBase58().slice(0, 4)}...
                  {publicKey.toBase58().slice(-4)}
                </p>
              </div>
              <Button
                onClick={() => setStep(2)}
                style={{
                  background: "var(--color-ink)",
                  color: "var(--color-paper)",
                  fontWeight: 600,
                }}
              >
                Continue to Details →
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <WalletMultiButton
                style={{
                  background: "var(--color-ink)",
                  color: "var(--color-paper)",
                  height: "40px",
                  fontSize: "14px",
                  borderRadius: "8px",
                }}
              />
              <p className="text-xs text-muted-foreground">
                Supports Phantom, Solflare, and other Solana wallets.
              </p>
            </div>
          )}
          {connected && !publicKey && (
            <Button onClick={() => setStep(2)}>Continue →</Button>
          )}
        </div>
      )}

      {/* Step 2: Fill details */}
      {step === 2 && (
        <div className="rounded-2xl border border-border bg-surface/80 p-6 shadow-card space-y-4">
          <h2 className="text-lg font-semibold">Agent Details</h2>

          <div className="space-y-5">
            {/* Name */}
            <div className="space-y-1.5">
              <Label
                htmlFor="name"
                className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block"
              >
                Agent Name
              </Label>
              <Input
                id="name"
                placeholder="e.g. ollama-research"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="!w-full !rounded-lg !border !border-gray-200 dark:!border-gray-700 !bg-white dark:!bg-gray-900 !px-3 !py-2 !text-sm focus:!ring-2 focus:!ring-blue-500 focus:!outline-none"
              />
            </div>

            {/* Agent Type */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                Agent Type
              </Label>
              <Select
                value={form.agentType}
                onValueChange={(v) =>
                  setForm({ ...form, agentType: v as AgentType })
                }
              >
                <SelectTrigger className="!w-full !min-w-[180px] !rounded-lg !border !border-gray-200 dark:!border-gray-700 !bg-white dark:!bg-gray-900 !px-3 !py-2 !text-sm focus:!ring-2 focus:!ring-blue-500 focus:!outline-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-[240px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                  <SelectItem value="primary">Primary (Specialist)</SelectItem>
                  <SelectItem value="attestation">
                    Attestation (Judge)
                  </SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Helper */}
            <details className="group rounded-2xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/70 dark:bg-blue-950/20 p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-blue-950 dark:text-blue-100">
                <span className="flex items-center gap-2">
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                  How to set up your endpoint
                </span>
                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                  Collapsed by default
                </span>
              </summary>
              <div className="mt-4 space-y-3">
                {ENDPOINT_HELP_STEPS.map((stepItem, idx) => (
                  <div
                    key={stepItem.title}
                    className="rounded-xl border border-blue-100 dark:border-blue-900/40 bg-white dark:bg-gray-950/60 p-4 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                        {idx + 1}
                      </span>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {stepItem.title}
                      </h3>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                      {stepItem.items.map((item) => (
                        <div key={item.text} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                          <div className="min-w-0 flex-1">
                            {item.href ? (
                              <a
                                href={item.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
                              >
                                {item.text}
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : (
                              <span>{item.text}</span>
                            )}
                            {item.code && (
                              <code className="mt-1 block rounded-md bg-gray-100 px-3 py-2 font-mono text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                                {item.code}
                              </code>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>

            {/* Endpoint */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label
                  htmlFor="endpoint"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-0 block"
                >
                  Service Endpoint URL
                </Label>
                <a
                  href="/docs/HARNESS-COMPUTE-BOUNDARY.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Local = runs on your machine, TEE = enclave execution, Cloud = disclosed cloud infrastructure"
                  className="inline-flex items-center text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <CircleHelp className="h-4 w-4" />
                </a>
              </div>
              <Input
                id="endpoint"
                placeholder="https://agent.yourdomain.com"
                value={form.endpoint}
                onChange={(e) => {
                  setForm({ ...form, endpoint: e.target.value });
                  setEndpointProbeStatus("idle");
                  setEndpointProbeMessage("");
                  setEndpointProbeModels([]);
                }}
                onBlur={() => {
                  if (endpointProbeTimeoutRef.current) {
                    window.clearTimeout(endpointProbeTimeoutRef.current);
                  }
                  void runEndpointProbe(form.endpoint);
                }}
                className={`!w-full !rounded-lg !border !border-gray-200 dark:!border-gray-700 !bg-white dark:!bg-gray-900 !px-3 !py-2 !text-sm focus:!ring-2 focus:!ring-blue-500 focus:!outline-none ${
                  endpointProbeStatus === "checking"
                    ? "!border-blue-400"
                    : endpointProbeStatus === "reachable"
                      ? "!border-green-400"
                      : endpointProbeStatus === "no_ollama"
                        ? "!border-yellow-400"
                        : endpointProbeStatus === "unreachable"
                          ? "!border-red-400"
                          : ""
                }`}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Your HTTP 402 server URL. Must be publicly reachable.
              </p>
              {endpointProbeStatus !== "idle" && (
                <div
                  className={`inline-flex items-start gap-2 rounded-full border px-3 py-2 text-xs font-medium ${
                    endpointProbeStatus === "checking"
                      ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200"
                      : endpointProbeStatus === "reachable"
                        ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-200"
                        : endpointProbeStatus === "no_ollama"
                          ? "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/40 dark:bg-yellow-950/20 dark:text-yellow-200"
                          : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200"
                  }`}
                >
                  {endpointProbeStatus === "checking" ? (
                    <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
                  ) : endpointProbeStatus === "reachable" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4" />
                  ) : endpointProbeStatus === "no_ollama" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4" />
                  )}
                  <div className="min-w-0">
                    <p>
                      {endpointProbeStatus === "checking"
                        ? "Checking…"
                        : endpointProbeStatus === "reachable"
                          ? "Endpoint reachable"
                          : endpointProbeStatus === "no_ollama"
                            ? "Reachable, no model list"
                            : "Unreachable"}
                    </p>
                    {endpointProbeMessage && (
                      <p className="mt-0.5 text-[11px] font-normal">
                        {endpointProbeMessage}
                      </p>
                    )}
                    {endpointProbeModels.length > 0 &&
                      endpointProbeStatus === "reachable" && (
                        <p className="mt-0.5 text-[11px] font-normal">
                          Models: {endpointProbeModels.slice(0, 3).join(", ")}
                        </p>
                      )}
                  </div>
                </div>
              )}
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label
                  htmlFor="model"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-0 block"
                >
                  Model Name
                </Label>
                {LEGACY_WIZARD && (
                  <a
                    href="https://ollama.com/library"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Browse available Ollama models"
                    className="inline-flex items-center text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <CircleHelp className="h-4 w-4" />
                  </a>
                )}
              </div>
              <Input
                id="model"
                placeholder={LEGACY_WIZARD ? "e.g. qwen3:8b" : "e.g. openai/gpt-4o-mini"}
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="!w-full !rounded-lg !border !border-gray-200 dark:!border-gray-700 !bg-white dark:!bg-gray-900 !px-3 !py-2 !text-sm focus:!ring-2 focus:!ring-blue-500 focus:!outline-none"
              />
            </div>

            {/* Privacy Tier */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-0 block">
                  Privacy Tier
                </Label>
                <a
                  href="/docs/HARNESS-COMPUTE-BOUNDARY.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Local = runs on your machine, TEE = enclave execution, Cloud = disclosed cloud infrastructure"
                  className="inline-flex items-center text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <CircleHelp className="h-4 w-4" />
                </a>
              </div>
              <Select
                value={form.privacyTier}
                onValueChange={(v) =>
                  setForm({ ...form, privacyTier: v as PrivacyTier })
                }
              >
                <SelectTrigger className="!w-full !min-w-[180px] !rounded-lg !border !border-gray-200 dark:!border-gray-700 !bg-white dark:!bg-gray-900 !px-3 !py-2 !text-sm focus:!ring-2 focus:!ring-blue-500 focus:!outline-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-[240px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
                  <SelectItem value="local">
                    Local — runs on your hardware, never leaves
                  </SelectItem>
                  <SelectItem value="tee">
                    TEE — cryptographic attestation of enclave execution
                  </SelectItem>
                  <SelectItem value="cloud">
                    Cloud-Disclosed — cloud infrastructure, disclosed
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Price per token */}
            {(form.agentType === "primary" || form.agentType === "both") && (
              <ProviderPriceFields
                inputPerMillionUsd={form.inputPerMillionUsd}
                outputPerMillionUsd={form.outputPerMillionUsd}
                onChange={(field, value) =>
                  setForm({ ...form, ...(field === "input" ? { inputPerMillionUsd: value } : { outputPerMillionUsd: value }) })
                }
              />
            )}

            {/* Attestation Rate */}
            {isJudge && (
              <div className="space-y-1.5">
                <Label
                  htmlFor="attest-rate"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block"
                >
                  Judging fee (SOL per job)
                </Label>
                <Input
                  id="attest-rate"
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="0.0005"
                  value={form.attestationRate}
                  onChange={(e) =>
                    setForm({ ...form, attestationRate: e.target.value })
                  }
                  className="!w-full !rounded-lg !border !border-gray-200 dark:!border-gray-700 !bg-white dark:!bg-gray-900 !px-3 !py-2 !text-sm focus:!ring-2 focus:!ring-blue-500 focus:!outline-none"
                />
              </div>
            )}

            {/* Min Consumer Rep */}
            <div className="space-y-2">
              <div className="flex justify-between gap-3">
                <Label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-0 block">
                  Min Consumer Reputation
                </Label>
                <span className="text-sm text-muted-foreground font-mono">
                  {form.minConsumerRep === 0
                    ? "No minimum"
                    : `≥ ${form.minConsumerRep}★`}
                </span>
              </div>
              <Slider
                min={0}
                max={5}
                step={0.5}
                value={form.minConsumerRep}
                onValueChange={(v) =>
                  setForm({ ...form, minConsumerRep: v as number })
                }
              />
            </div>

            {/* Accept Unrated */}
            <div className="flex items-center justify-between rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/40 p-4">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Accept Unrated Consumers
                </p>
                <p className="text-xs text-muted-foreground">
                  Allow consumers with no reputation history to hire you
                </p>
              </div>
              <button
                onClick={() =>
                  setForm({ ...form, acceptUnrated: !form.acceptUnrated })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  form.acceptUnrated ? "bg-ink" : "bg-white/20"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-black transition-transform ${
                    form.acceptUnrated ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label
                htmlFor="desc"
                className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block"
              >
                Agent Description
              </Label>
              <Textarea
                id="desc"
                placeholder="What does your agent specialise in? What tasks does it handle well?"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className="!min-h-20 !w-full !rounded-lg !border !border-gray-200 dark:!border-gray-700 !bg-white dark:!bg-gray-900 !px-3 !py-2 !text-sm focus:!ring-2 focus:!ring-blue-500 focus:!outline-none resize-none"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={() => setStep(1)}
              className="border-gray-200 dark:border-gray-700"
            >
              Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={!canAdvanceToReview}
              className="w-full !rounded-lg !bg-blue-600 !px-4 !py-2.5 !font-semibold !text-white !transition hover:!bg-blue-700 disabled:!bg-blue-300"
            >
              Review & Register →
            </Button>
          </div>

          {priceProblem && (
            <p className="text-xs text-amber-300" role="alert">
              {priceProblem}
            </p>
          )}

          {!endpointCompliancePassed && (
            <p className="text-xs text-amber-300">
              Run endpoint probe until it passes compliance before proceeding to
              registration.
            </p>
          )}
        </div>
      )}
      {/* Step 3: Review & confirm */}
      {step === 3 && (
        <div className="rounded-2xl border border-border bg-surface/80 p-6 shadow-card space-y-4">
          <h2 className="text-lg font-semibold">Review & Confirm</h2>

          {/* Summary */}
          <div className="space-y-2">
            {[
              ["Name", form.name],
              ["Type", form.agentType],
              ["Model", form.model],
              ["Privacy", form.privacyTier],
              ["Endpoint", form.endpoint || "—"],
              [
                "Price per million tokens",
                form.agentType !== "attestation"
                  ? `$${form.inputPerMillionUsd} in, $${form.outputPerMillionUsd} out (USDC)`
                  : "—",
              ],
              ...(isJudge
                ? [
                    ["Judging fee", `${form.attestationRate} SOL per job`] as [
                      string,
                      string,
                    ],
                  ]
                : []),
              [
                "Min Consumer Rep",
                form.minConsumerRep === 0
                  ? "No minimum"
                  : `≥ ${form.minConsumerRep}★`,
              ],
              ["Accept Unrated", form.acceptUnrated ? "Yes" : "No"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="max-w-xs truncate font-mono text-right">
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* Fee breakdown */}
          <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Fee Breakdown
            </p>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Registration fee</span>
                <span className="font-mono">{REGISTRATION_FEE_SOL} SOL</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">
                  Account rent (~0.00057 SOL)
                </span>
                <span className="font-mono">{RENT_SOL} SOL</span>
              </div>
              <div className="flex justify-between gap-4 border-t border-blue-200 pt-1 font-semibold dark:border-blue-900/40">
                <span>Total</span>
                <span className="font-mono text-brand-green">
                  ~{(REGISTRATION_FEE_SOL + RENT_SOL).toFixed(5)} SOL
                </span>
              </div>
            </div>
          </div>

          {/* Instruction preview + network diagnostics */}
          <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs font-mono dark:border-gray-700 dark:bg-gray-950/50">
            <p className="text-xs text-muted-foreground">
              Instruction being built:
            </p>
            <p className="text-green-400">register_agent(</p>
            <p className="pl-4 text-foreground/80">
              agent_type:{" "}
              {form.agentType === "primary"
                ? 0
                : form.agentType === "attestation"
                  ? 1
                  : 2}
              ,
            </p>
            <p className="pl-4 text-foreground/80">
              model: &quot;{form.model || "unknown"}&quot;,
            </p>
            <p className="pl-4 text-foreground/80">
              rate_lamports:{" "}
              {registryRateLamports(form).toString()}
              ,
            </p>
            <p className="pl-4 text-foreground/80">
              min_reputation: {form.minConsumerRep},
            </p>
            <p className="text-green-400">)</p>

            <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
              <p className="font-semibold">Active network diagnostics</p>
              <p>RPC: {activeRpc}</p>
              <p>Program: {activeProgramId}</p>
              <p className="mt-1 opacity-90">
                If registration returns InvalidInstructionData, verify this
                program ID matches the currently deployed protocol program for
                this app build.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={() => setStep(2)}
              className="border-gray-200 dark:border-gray-700"
            >
              Back
            </Button>
            {alreadyRegistered ? (
              <LinkButton
                href={myAgentHref}
                className="w-full !rounded-lg !bg-emerald-400 !px-4 !py-2.5 !font-semibold !text-black !transition hover:!bg-emerald-300"
              >
                My Agent →
              </LinkButton>
            ) : (
              <Button
                onClick={handleRegister}
                disabled={
                  registering ||
                  SUBMISSION_BLOCKED ||
                  !endpointCompliancePassed ||
                  existingAgent.status === "checking"
                }
                className="w-full !rounded-lg !bg-blue-600 !px-4 !py-2.5 !font-semibold !text-white !transition hover:!bg-blue-700 disabled:!bg-blue-300"
              >
                {registering
                  ? "Registering..."
                  : SUBMISSION_BLOCKED
                    ? SUBMISSION_BLOCKED_LABEL
                    : existingAgent.status === "checking"
                      ? "Checking registration..."
                      : !endpointCompliancePassed
                        ? "Probe endpoint compliance first"
                        : "Register Agent (0.01 SOL)"}
              </Button>
            )}
          </div>
          {txError && (
            <div
              className={`rounded-lg border p-3 ${isAlreadyRegisteredError(txError) || alreadyRegistered ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}
            >
              <p
                className={`text-xs font-semibold ${isAlreadyRegisteredError(txError) || alreadyRegistered ? "text-emerald-300" : "text-red-300"}`}
              >
                {isAlreadyRegisteredError(txError) || alreadyRegistered
                  ? "This wallet is already registered"
                  : "Registration transaction failed"}
              </p>
              {isAlreadyRegisteredError(txError) || alreadyRegistered ? (
                <div className="mt-1 space-y-2 text-xs text-emerald-100/80">
                  <p>
                    Each wallet maps to one deterministic agent account. Open
                    your existing agent profile, update its details, or
                    deregister before registering again with this wallet.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <LinkButton
                      href={myAgentHref}
                      size="sm"
                      className="!bg-emerald-400 !text-black hover:!bg-emerald-300"
                    >
                      My Agent →
                    </LinkButton>
                    <LinkButton
                      href="/faq"
                      size="sm"
                      variant="outline"
                      className="border-emerald-300/30 text-emerald-100"
                    >
                      FAQ
                    </LinkButton>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-xs text-red-100/80">
                  Check the error details below, then retry. Common causes are
                  low SOL balance, stale blockhash, or program revert.
                </p>
              )}
              <pre
                className={`mt-2 whitespace-pre-wrap break-words font-mono text-xs ${isAlreadyRegisteredError(txError) || alreadyRegistered ? "text-emerald-100/90" : "text-red-100/90"}`}
              >
                {txError}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-page flex items-center justify-center">
          <p className="text-gray-400">Loading…</p>
        </div>
      }
    >
      <RegisterInner />
    </Suspense>
  );
}
