"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SellerWrapperConfigPreview } from "@/components/onboarding/SellerWrapperConfigPreview";
import StepIndicator from "@/components/StepIndicator";
import { showToast } from "@/components/ui/toast";
import { RUNTIME_CAPABILITIES } from "@/lib/capabilities/taxonomy";
import { toExplorerTxUrl } from "@/lib/config/explorer";
import { emitOnboardingCompletedEvent } from "@/lib/onboarding/torque-onboarding";
import {
  AGENT_TYPE_ENUM,
  agentPda,
  attestationPda,
  buildConfirmAttestationData,
  buildDisputeAttestationData,
  buildRegisterAgentData,
  DEVNET_RPC,
  ESCROW_PROGRAM_ID,
  REGISTRY_PROGRAM_ID,
  ATTESTATION_PROGRAM_ID,
  INCINERATOR,
  PROGRAM_TARGET,
  SUBMISSION_BLOCKED,
  SUBMISSION_BLOCKED_REASON,
} from "@/lib/program";
import {
  buildQuasarConfirmAttestationInstruction,
  buildQuasarDisputeAttestationInstruction,
  buildQuasarRegisterAgentInstruction,
  quasarAgentPda,
  quasarAttestationPda,
} from "@/lib/quasar/instructions";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

type WizardState = {
  consentExposeEndpoint: boolean;
  consentProtocolOps: boolean;
  runtimeType: "ollama" | "openai_local";
  platform: "macos" | "ubuntu" | "windows";
  ollamaPort: string;
  protocolDomain: string;
  runtimeReady: boolean;
  runtimeNote: string;
  runtimeTokenStored: boolean;
  hasWallet: "yes" | "no";
  walletAddress: string;
  walletPassphrase: string;
  walletBackupConfirmed: boolean;
  walletStatusNote: string;
  sponsorshipReady: boolean;
  sponsorshipNote: string;
  sponsorshipLamports: number;
  endpointUrl: string;
  endpointStatus: "pending" | "online" | "offline";
  endpointNote: string;
  endpointTunnelCommand: string;
  endpointProxyCommand: string;
  endpointProxyPort: number;
  endpointAuthHeader: string;
  endpointAuthTokenPreview: string;
  endpointAuthToken: string;
  healthcheckStatus: "pending" | "pass" | "fail";
  healthcheckNote: string;
  attested: boolean;
  attestationNote: string;
  attestationJobIdHex: string;
  attestationPda: string;
  attestationOperator: string;
  attestationConsumer: string;
  attestationResolution: "pending" | "confirmed" | "disputed";
  attestationResolutionSig: string;
  attestationOperatorReady: boolean;
  attestationOperatorState: "missing" | "invalid" | "ready" | "stale";
  attestationOperatorCheckedAt: string;
  attestationOperatorStatusNote: string;
  capabilityTaskTypes: string;
  capabilityInputModes: string;
  capabilityOutputModes: string;
  capabilityPrivacyModes: string;
  capabilityTags: string;
  capabilityRuntimeCapabilities: string[];
  capabilityContextRequirements: {
    key: string;
    type: "text" | "url" | "file_ref" | "number" | "boolean" | "json";
    required: boolean;
    description: string;
  }[];
  capabilityBaseUsd: string;
  capabilityPerCallUsd: string;
  capabilitySaved: boolean;
  capabilityNote: string;
  registrationCompleted: boolean;
  registrationTxSig: string;
  plannerPrompt: string;
  plannerRunId: string;
  plannerStatus: "idle" | "running" | "completed" | "failed";
  plannerNote: string;
  plannerResponsePreview: string;
  plannerX402Tx: string;
  plannerFeedbackScore: string;
  plannerFeedbackNote: string;
  plannerFeedbackSent: boolean;
  plannerFeedbackNote2: string;
  onboardingCompletedEventSent: boolean;
};

const STORAGE_KEY = "reddi-onboarding-wizard-v1";

const INITIAL_STATE: WizardState = {
  consentExposeEndpoint: false,
  consentProtocolOps: false,
  runtimeType: "ollama",
  platform: "macos",
  ollamaPort: "11434",
  protocolDomain: "https://reddi.tech",
  runtimeReady: false,
  runtimeNote: "",
  runtimeTokenStored: false,
  hasWallet: "yes",
  walletAddress: "",
  walletPassphrase: "",
  walletBackupConfirmed: false,
  walletStatusNote: "",
  sponsorshipReady: false,
  sponsorshipNote: "",
  sponsorshipLamports: 0,
  endpointUrl: "",
  endpointStatus: "pending",
  endpointNote: "",
  endpointTunnelCommand: "",
  endpointProxyCommand: "",
  endpointProxyPort: 0,
  endpointAuthHeader: "x-reddi-agent-token",
  endpointAuthTokenPreview: "",
  endpointAuthToken: "",
  healthcheckStatus: "pending",
  healthcheckNote: "",
  attested: false,
  attestationNote: "",
  attestationJobIdHex: "",
  attestationPda: "",
  attestationOperator: "",
  attestationConsumer: "",
  attestationResolution: "pending",
  attestationResolutionSig: "",
  attestationOperatorReady: false,
  attestationOperatorState: "missing",
  attestationOperatorCheckedAt: "",
  attestationOperatorStatusNote: "",
  capabilityTaskTypes: "summarize, classify",
  capabilityInputModes: "text",
  capabilityOutputModes: "text",
  capabilityPrivacyModes: "public, per",
  capabilityTags: "onboarding, default",
  capabilityRuntimeCapabilities: [],
  capabilityContextRequirements: [],
  capabilityBaseUsd: "0",
  capabilityPerCallUsd: "0",
  capabilitySaved: false,
  capabilityNote: "",
  registrationCompleted: false,
  registrationTxSig: "",
  plannerPrompt: "Summarise the key risks in deploying an AI agent with on-chain payment capabilities.",
  plannerRunId: "",
  plannerStatus: "idle",
  plannerNote: "",
  plannerResponsePreview: "",
  plannerX402Tx: "",
  plannerFeedbackScore: "8",
  plannerFeedbackNote: "",
  plannerFeedbackSent: false,
  plannerFeedbackNote2: "",
  onboardingCompletedEventSent: false,
};

const STEPS = [
  "Consent",
  "Runtime",
  "Endpoint",
  "Wallet",
  "Register",
  "Healthcheck",
  "Attestation",
  "Try Planner",
];

const OPERATOR_STATUS_STALE_MS = 10 * 60 * 1000;

function mockWalletAddress() {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 44; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function hexToJobId(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error("Invalid attestation job id.");
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const RUNTIME_CAPABILITY_LABELS: Record<string, string> = {
  code_execution: "Can execute code",
  file_read: "Can read files/documents",
  file_write: "Produces file artifacts",
  web_search: "Can search the web",
  stateful: "Supports resumable sessions",
  long_running: "Handles long tasks (>30s)",
  multimodal: "Accepts images/audio/video",
  streaming: "Streams responses",
};

const CONTEXT_REQUIREMENT_TYPES = ["text", "url", "file_ref", "number", "boolean", "json"] as const;

function createRequirement() {
  return {
    key: "",
    type: "text" as const,
    required: true,
    description: "",
  };
}

export default function OnboardingPage() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection: walletConnection } = useConnection();
  const [step, setStep] = useState(1);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [endpointHeartbeatLoading, setEndpointHeartbeatLoading] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const [sponsorshipLoading, setSponsorshipLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerPreflightLoading, setRegisterPreflightLoading] = useState(false);
  const [registerPreflight, setRegisterPreflight] = useState<{
    ok: boolean;
    error?: string;
    unitsConsumed?: number;
    logs?: string[];
    rateLamports: bigint;
    agentPda: string;
    estimatedCostSol: number;
  } | null>(null);
  const [operatorPreflightLoading, setOperatorPreflightLoading] = useState(false);
  const [operatorPreflight, setOperatorPreflight] = useState<{
    ok: boolean;
    checkedAt: string;
    blockingFailures: number;
    checks: {
      id: string;
      label: string;
      status: "pass" | "fail";
      blocking: boolean;
      detail: string;
      fix?: string;
    }[];
    error?: string;
  } | null>(null);
  const [healthcheckLoading, setHealthcheckLoading] = useState(false);
  const [attestationLoading, setAttestationLoading] = useState(false);
  const [attestationOperatorCheckLoading, setAttestationOperatorCheckLoading] = useState(false);
  const [capabilityLoading, setCapabilityLoading] = useState(false);
  const prevStepRef = useRef(step);

  useEffect(() => {
    if (prevStepRef.current !== step) {
      showToast(`Onboarding step ${step} complete`, "success");
      prevStepRef.current = step;
    }
  }, [step]);

  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WizardState>;
        setState((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore storage errors
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage errors
    }
  }, [hydrated, state]);

  useEffect(() => {
    if (!publicKey) return;
    const walletBase58 = publicKey.toBase58();
    setState((prev) =>
      prev.walletAddress === walletBase58
        ? prev
        : {
            ...prev,
            walletAddress: walletBase58,
            capabilitySaved: false,
            capabilityNote: "",
            registrationCompleted: false,
            registrationTxSig: "",
          }
    );
  }, [publicKey]);

  const endpointPreview = useMemo(() => {
    if (!state.ollamaPort || !state.consentExposeEndpoint) return "Not configured";
    return state.endpointUrl || `https://your-subdomain.ngrok-free.app (maps to :${state.ollamaPort})`;
  }, [state.ollamaPort, state.consentExposeEndpoint, state.endpointUrl]);

  const operatorStatusState = useMemo<"missing" | "invalid" | "ready" | "stale">(() => {
    if (state.attestationOperatorState === "ready" && state.attestationOperatorCheckedAt) {
      const checked = Date.parse(state.attestationOperatorCheckedAt);
      if (Number.isFinite(checked) && Date.now() - checked > OPERATOR_STATUS_STALE_MS) {
        return "stale";
      }
    }
    return state.attestationOperatorState;
  }, [state.attestationOperatorState, state.attestationOperatorCheckedAt]);

  const operatorReadyForAttestation = operatorStatusState === "ready";

  const canContinue = useMemo(() => {
    if (step === 1) return state.consentExposeEndpoint && state.consentProtocolOps;
    if (step === 2) {
      if (state.runtimeType === "ollama") return Number(state.ollamaPort) > 0 && state.runtimeReady;
      return state.runtimeReady;
    }
    if (step === 3) return state.endpointStatus === "online";
    if (step === 4) {
      const walletOk = state.walletAddress.length > 0;
      const backupOk = state.hasWallet === "yes" ? true : state.walletBackupConfirmed;
      return walletOk && backupOk && state.sponsorshipReady;
    }
    if (step === 5) return state.registrationCompleted && state.capabilitySaved;
    if (step === 6) return state.healthcheckStatus === "pass";
    if (step === 7) return state.attested;
    if (step === 8) return state.plannerStatus === "completed" || state.plannerFeedbackSent;
    return false;
  }, [step, state]);

  const buildRegisterDraft = () => {
    if (!publicKey) {
      throw new Error("Connect wallet before registration.");
    }

    const agentTypeByte = AGENT_TYPE_ENUM.Primary;
    const modelName = "ollama-local";
    const minRep = 0;
    const rateLamports = BigInt(Math.round(0.001 * 1_000_000_000));
    const pda = PROGRAM_TARGET === "quasar" ? quasarAgentPda(publicKey, REGISTRY_PROGRAM_ID) : agentPda(publicKey);
    const ix = PROGRAM_TARGET === "quasar"
      ? buildQuasarRegisterAgentInstruction({
          programId: REGISTRY_PROGRAM_ID,
          owner: publicKey,
          agentType: agentTypeByte,
          model: modelName,
          rateLamports,
          minReputation: minRep,
          agentPda: pda,
          feeCollector: INCINERATOR,
        })
      : new TransactionInstruction({
          programId: ESCROW_PROGRAM_ID,
          keys: [
            { pubkey: pda, isSigner: false, isWritable: true },
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: INCINERATOR, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: buildRegisterAgentData(agentTypeByte, modelName, rateLamports, minRep),
        });

    return { pda, rateLamports, ix };
  };

  const handleSimulateRegisterSpecialist = async () => {
    if (!publicKey) return;

    setRegisterPreflightLoading(true);
    setRegisterPreflight(null);

    try {
      const conn = walletConnection ?? new Connection(DEVNET_RPC, "confirmed");
      const { pda, rateLamports, ix } = buildRegisterDraft();

      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = publicKey;
      tx.add(ix);

      const sim = await (conn as unknown as {
        simulateTransaction: (
          txArg: Transaction,
          options?: {
            sigVerify?: boolean;
            replaceRecentBlockhash?: boolean;
            commitment?: "processed" | "confirmed" | "finalized";
          }
        ) => Promise<{
          value: {
            err: unknown;
            logs?: string[];
            unitsConsumed?: number;
          };
        }>;
      }).simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "processed",
      });

      const estimatedCostSol = Number(rateLamports) / 1_000_000_000 + 0.01057;

      setRegisterPreflight({
        ok: !sim.value.err,
        error: sim.value.err ? JSON.stringify(sim.value.err) : undefined,
        logs: sim.value.logs,
        unitsConsumed: sim.value.unitsConsumed,
        rateLamports,
        agentPda: pda.toBase58(),
        estimatedCostSol,
      });
    } catch (error: unknown) {
      setRegisterPreflight({
        ok: false,
        error: error instanceof Error ? error.message : "Preflight simulation failed",
        rateLamports: BigInt(Math.round(0.001 * 1_000_000_000)),
        agentPda: publicKey ? (PROGRAM_TARGET === "quasar" ? quasarAgentPda(publicKey, REGISTRY_PROGRAM_ID) : agentPda(publicKey)).toBase58() : "",
        estimatedCostSol: 0.01157,
      });
    } finally {
      setRegisterPreflightLoading(false);
    }
  };

  const handleRegisterSpecialist = async () => {
    if (!publicKey || !sendTransaction) return;
    if (SUBMISSION_BLOCKED) {
      setRegisterError(SUBMISSION_BLOCKED_REASON);
      return;
    }

    setRegistering(true);
    setRegisterError(null);
    setState((s) => ({
      ...s,
      registrationCompleted: false,
      registrationTxSig: "",
    }));

    try {
      const conn = walletConnection ?? new Connection(DEVNET_RPC, "confirmed");
      const { ix } = buildRegisterDraft();

      const { blockhash } = await conn.getLatestBlockhash();
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      tx.add(ix);

      const sig = await sendTransaction(tx, conn);
      await conn.confirmTransaction(sig, "confirmed");

      setState((s) => ({
        ...s,
        registrationCompleted: true,
        registrationTxSig: sig,
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Registration failed";
      setRegisterError(msg);
      setState((s) => ({
        ...s,
        registrationCompleted: false,
        registrationTxSig: "",
      }));
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Specialist Onboarding Wizard</h1>
        <p className="text-sm text-muted-foreground">
          Zero-to-registered flow, consent-first. Installs local runtime, exposes endpoint, then registers and verifies your specialist.
        </p>
        <p className="text-sm text-muted-foreground" data-testid="onboarding-intake-entry">
          Onboarding an existing MCP/OpenAPI/A2A/AI-Catalog source instead?{" "}
          <Link href="/onboarding/intake" className="text-[#14F195] hover:text-emerald-200">
            Use the guided intake flow →
          </Link>
        </p>
      </div>

      <div className="space-y-3">
        {STEPS.map((title, idx) => {
          const number = idx + 1;
          const status = number < step ? "complete" : number === step ? "in-progress" : "not-started";
          return <StepIndicator key={title} number={number} title={title} status={status} />;
        })}
      </div>

      <SellerWrapperConfigPreview />

      <div className="rounded-xl border border-white/10 bg-card/30 p-6 space-y-5">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">1. Consent</h2>
            <p className="text-sm text-muted-foreground">
              We only proceed if you explicitly approve network exposure and protocol-managed onboarding actions.
            </p>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={state.consentExposeEndpoint}
                onChange={(e) => setState((s) => ({ ...s, consentExposeEndpoint: e.target.checked }))}
                className="mt-1 accent-[#9945FF]"
              />
              <span>I consent to exposing my local runtime API through a tunnel endpoint.</span>
            </label>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={state.consentProtocolOps}
                onChange={(e) => setState((s) => ({ ...s, consentProtocolOps: e.target.checked }))}
                className="mt-1 accent-[#9945FF]"
              />
              <span>I consent to protocol-funded onboarding transactions (rent + registration fee only).</span>
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">2. Runtime setup</h2>
            <p className="text-sm text-muted-foreground">Wizard checks/install steps for Ollama or OpenAI-compatible local runtimes.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1 block">Runtime type</Label>
                <select
                  value={state.runtimeType}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      runtimeType: e.target.value as WizardState["runtimeType"],
                      runtimeReady: false,
                      runtimeNote: "",
                    }))
                  }
                  className="w-full bg-background border border-white/10 rounded-md px-3 py-2 text-sm"
                >
                  <option value="ollama">Ollama</option>
                  <option value="openai_local">OpenAI-compatible local server (llama.cpp / vLLM / LM Studio)</option>
                </select>
              </div>
              <div>
                <Label className="mb-1 block">Platform</Label>
                <select
                  value={state.platform}
                  onChange={(e) =>
                    setState((s) => ({ ...s, platform: e.target.value as WizardState["platform"] }))
                  }
                  className="w-full bg-background border border-white/10 rounded-md px-3 py-2 text-sm"
                >
                  <option value="macos">macOS</option>
                  <option value="ubuntu">Ubuntu</option>
                  <option value="windows">Windows</option>
                </select>
              </div>
              <div>
                <Label className="mb-1 block">Local runtime API port</Label>
                <Input
                  value={state.ollamaPort}
                  onChange={(e) =>
                    setState((s) => ({ ...s, ollamaPort: e.target.value, runtimeReady: false, runtimeNote: "" }))
                  }
                  placeholder="11434"
                />
              </div>
            </div>
            {state.runtimeType === "openai_local" && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className="text-[#14F195]">Quick starts (OpenAI-compatible local server):</p>
                <p className="font-mono">llama.cpp: ./llama-server -m /path/to/model.gguf --port 8080</p>
                <p className="font-mono">vLLM: python -m vllm.entrypoints.openai.api_server --model /path/to/model</p>
                <p>LM Studio: Local Server tab → select model → Start Server.</p>
              </div>
            )}
            <div>
              <Label className="mb-1 block">Protocol CORS allowlist domain</Label>
              <Input
                value={state.protocolDomain}
                onChange={(e) =>
                  setState((s) => ({ ...s, protocolDomain: e.target.value, runtimeReady: false, runtimeNote: "" }))
                }
                placeholder="https://reddi.tech"
              />
            </div>
            {state.runtimeType === "ollama" ? (
              <Button
                variant="outline"
                disabled={
                  runtimeLoading ||
                  !state.consentExposeEndpoint ||
                  !state.consentProtocolOps ||
                  Number(state.ollamaPort) <= 0
                }
                onClick={async () => {
                  setRuntimeLoading(true);
                  try {
                    const res = await fetch("/api/onboarding/runtime", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        platform: state.platform,
                        port: Number(state.ollamaPort),
                        protocolDomain: state.protocolDomain,
                        consentExposeEndpoint: state.consentExposeEndpoint,
                        consentProtocolOps: state.consentProtocolOps,
                      }),
                    });
                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                      setState((s) => ({
                        ...s,
                        runtimeReady: false,
                        runtimeTokenStored: false,
                        runtimeNote: data.error || "Runtime bootstrap failed",
                      }));
                      return;
                    }

                    const noteParts = [
                      data.result.ollama.running ? "Ollama running" : "Ollama not running",
                      data.result.token.storedInKeychain ? "token stored in keychain" : "token not stored in keychain",
                      data.result.installHint ? `hint: ${data.result.installHint}` : null,
                      data.result.token.note || null,
                    ].filter(Boolean);

                    setState((s) => ({
                      ...s,
                      runtimeReady: Boolean(data.result.ready),
                      runtimeTokenStored: Boolean(data.result.token.storedInKeychain),
                      runtimeNote: noteParts.join(" · "),
                    }));
                  } catch {
                    setState((s) => ({
                      ...s,
                      runtimeReady: false,
                      runtimeTokenStored: false,
                      runtimeNote: "Runtime bootstrap failed",
                    }));
                  } finally {
                    setRuntimeLoading(false);
                  }
                }}
              >
                {runtimeLoading ? "Bootstrapping runtime..." : "Run runtime bootstrap"}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    runtimeReady: true,
                    runtimeTokenStored: false,
                    runtimeNote:
                      "Manual runtime mode enabled for OpenAI-compatible local server (llama.cpp/vLLM/LM Studio).",
                  }))
                }
              >
                Mark runtime ready (manual)
              </Button>
            )}

            {state.runtimeNote && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground">
                <p className={state.runtimeReady ? "text-[#14F195]" : "text-yellow-400"}>
                  {state.runtimeReady ? "Runtime ready" : "Runtime not ready"}
                </p>
                <p className="mt-1">{state.runtimeNote}</p>
              </div>
            )}
            <div className="rounded-lg border border-[#14F195]/20 bg-[#14F195]/5 p-3 text-xs font-mono text-muted-foreground">
              Installer command (planned): curl -fsSL https://reddi.tech/install-specialist | bash
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">3. Endpoint setup</h2>
            <p className="text-sm text-muted-foreground">Configure token-gated proxy + tunnel endpoint mapped to your local runtime port (ngrok-first, localtunnel fallback).</p>
            <div>
              <Label className="mb-1 block">Tunnel endpoint (optional override)</Label>
              <Input
                value={state.endpointUrl}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    endpointUrl: e.target.value,
                    endpointStatus: "pending",
                    endpointNote: "",
                    endpointTunnelCommand: "",
                    endpointProxyCommand: "",
                    endpointProxyPort: 0,
                    endpointAuthTokenPreview: "",
                    endpointAuthToken: "",
                  }))
                }
                placeholder="https://your-subdomain.ngrok-free.app"
              />
            </div>
            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm">
              <p className="text-muted-foreground text-xs">Effective endpoint</p>
              <p className="font-mono text-[#14F195] break-all">{endpointPreview}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={endpointLoading || !state.consentExposeEndpoint || Number(state.ollamaPort) <= 0}
                onClick={async () => {
                  setEndpointLoading(true);
                  try {
                    const res = await fetch("/api/onboarding/endpoint", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "create",
                        consentExposeEndpoint: state.consentExposeEndpoint,
                        port: Number(state.ollamaPort),
                        endpointUrl: state.endpointUrl || undefined,
                      }),
                    });

                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                      setState((s) => ({
                        ...s,
                        endpointStatus: "offline",
                        endpointNote: data.error || "Endpoint creation failed",
                      }));
                      return;
                    }

                    setState((s) => ({
                      ...s,
                      endpointUrl: data.result.endpointUrl,
                      endpointStatus: data.result.status,
                      endpointNote: data.result.note || "",
                      endpointTunnelCommand: data.result.tunnelCommand || "",
                      endpointProxyCommand: data.result.proxyCommand || "",
                      endpointProxyPort: data.result.proxyPort || 0,
                      endpointAuthHeader: data.result.authHeaderName || "x-reddi-agent-token",
                      endpointAuthTokenPreview: data.result.authTokenPreview || "",
                      endpointAuthToken: data.result.authToken || "",
                    }));
                  } catch {
                    setState((s) => ({
                      ...s,
                      endpointStatus: "offline",
                      endpointNote: "Endpoint creation failed",
                    }));
                  } finally {
                    setEndpointLoading(false);
                  }
                }}
              >
                {endpointLoading ? "Creating endpoint..." : "Create tunnel endpoint"}
              </Button>

              <Button
                variant="outline"
                disabled={endpointHeartbeatLoading || Number(state.ollamaPort) <= 0 || !state.endpointUrl}
                onClick={async () => {
                  setEndpointHeartbeatLoading(true);
                  try {
                    const res = await fetch("/api/onboarding/endpoint", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "heartbeat",
                        port: Number(state.ollamaPort),
                        endpointUrl: state.endpointUrl,
                      }),
                    });

                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                      setState((s) => ({
                        ...s,
                        endpointStatus: "offline",
                        endpointNote: data.error || "Heartbeat failed",
                      }));
                      return;
                    }

                    setState((s) => ({
                      ...s,
                      endpointStatus: data.result.status,
                      endpointNote: data.result.note || "",
                      endpointTunnelCommand: data.result.tunnelCommand || "",
                      endpointProxyCommand: data.result.proxyCommand || s.endpointProxyCommand,
                      endpointProxyPort: data.result.proxyPort || s.endpointProxyPort,
                      endpointAuthHeader: data.result.authHeaderName || s.endpointAuthHeader,
                      endpointAuthTokenPreview:
                        data.result.authTokenPreview || s.endpointAuthTokenPreview,
                    }));
                  } catch {
                    setState((s) => ({
                      ...s,
                      endpointStatus: "offline",
                      endpointNote: "Heartbeat failed",
                    }));
                  } finally {
                    setEndpointHeartbeatLoading(false);
                  }
                }}
              >
                {endpointHeartbeatLoading ? "Checking heartbeat..." : "Run endpoint heartbeat"}
              </Button>

              {state.runtimeType === "openai_local" && state.endpointUrl && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      endpointStatus: "online",
                      endpointNote:
                        "Manual endpoint mode enabled for OpenAI-compatible runtime. Proceeding without Ollama-specific endpoint bootstrap.",
                    }))
                  }
                >
                  Mark endpoint online (manual)
                </Button>
              )}
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground">
              <p
                className={
                  state.endpointStatus === "online"
                    ? "text-[#14F195]"
                    : state.endpointStatus === "offline"
                    ? "text-red-400"
                    : "text-yellow-400"
                }
              >
                Endpoint status: {state.endpointStatus.toUpperCase()}
              </p>
              {state.endpointNote && <p className="mt-1">{state.endpointNote}</p>}
              {state.endpointAuthToken && (
                <p className="mt-1 font-mono break-all">
                  auth token (save now): {state.endpointAuthToken}
                </p>
              )}
              {state.endpointAuthTokenPreview && !state.endpointAuthToken && (
                <p className="mt-1 font-mono">
                  auth token: {state.endpointAuthTokenPreview} (stored in profile)
                </p>
              )}
              {state.endpointProxyCommand && (
                <p className="mt-1 font-mono break-all">start token proxy: {state.endpointProxyCommand}</p>
              )}
              <p className="mt-1 font-mono">x402 public paths: /v1/*, /x402/*, /healthz (no token)</p>
              {state.endpointTunnelCommand && (
                <p className="mt-1 font-mono break-all">quick fix: {state.endpointTunnelCommand}</p>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">4. Wallet path</h2>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="wallet"
                  checked={state.hasWallet === "yes"}
                  onChange={() =>
                    setState((s) => ({
                      ...s,
                      hasWallet: "yes",
                      walletBackupConfirmed: false,
                      walletStatusNote: "",
                      sponsorshipReady: false,
                      sponsorshipNote: "",
                      sponsorshipLamports: 0,
                    }))
                  }
                  className="accent-[#9945FF]"
                />
                I already have a wallet
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="wallet"
                  checked={state.hasWallet === "no"}
                  onChange={() =>
                    setState((s) => ({
                      ...s,
                      hasWallet: "no",
                      walletAddress: s.walletAddress || mockWalletAddress(),
                      walletBackupConfirmed: false,
                      walletStatusNote: "",
                      sponsorshipReady: false,
                      sponsorshipNote: "",
                      sponsorshipLamports: 0,
                    }))
                  }
                  className="accent-[#9945FF]"
                />
                Create local non-custodial wallet
              </label>
            </div>
            <div>
              <Label className="mb-1 block">Wallet address</Label>
              <Input
                value={state.walletAddress}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    walletAddress: e.target.value,
                    sponsorshipReady: false,
                    sponsorshipNote: "",
                    sponsorshipLamports: 0,
                  }))
                }
                placeholder="Paste wallet or use generated address"
              />
            </div>
            {state.hasWallet === "no" && (
              <>
                <div>
                  <Label className="mb-1 block">Wallet encryption passphrase</Label>
                  <Input
                    type="password"
                    value={state.walletPassphrase}
                    onChange={(e) => setState((s) => ({ ...s, walletPassphrase: e.target.value }))}
                    placeholder="Minimum 12 characters"
                  />
                </div>
                <label className="flex items-start gap-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={state.walletBackupConfirmed}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        walletBackupConfirmed: e.target.checked,
                        sponsorshipReady: false,
                        sponsorshipNote: "",
                        sponsorshipLamports: 0,
                      }))
                    }
                    className="mt-0.5 accent-[#14F195]"
                  />
                  <span>Backup checkpoint complete: I saved recovery material before continuing.</span>
                </label>
                <Button
                  variant="outline"
                  disabled={walletLoading || !state.walletBackupConfirmed || state.walletPassphrase.length < 12}
                  onClick={async () => {
                    setWalletLoading(true);
                    try {
                      const res = await fetch("/api/onboarding/wallet", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "create",
                          backupConfirmed: state.walletBackupConfirmed,
                          passphrase: state.walletPassphrase,
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok || !data.ok) {
                        setState((s) => ({ ...s, walletStatusNote: data.error || "Wallet creation failed" }));
                        return;
                      }
                      setState((s) => ({
                        ...s,
                        walletAddress: data.result.walletAddress,
                        walletStatusNote: data.result.note || "Wallet created",
                        sponsorshipReady: false,
                        sponsorshipNote: "",
                        sponsorshipLamports: 0,
                      }));
                    } catch {
                      setState((s) => ({ ...s, walletStatusNote: "Wallet creation failed" }));
                    } finally {
                      setWalletLoading(false);
                    }
                  }}
                >
                  {walletLoading ? "Creating local wallet..." : "Create encrypted local wallet"}
                </Button>
              </>
            )}

            <Button
              variant="outline"
              disabled={sponsorshipLoading || !state.walletAddress || !state.consentProtocolOps}
              onClick={async () => {
                setSponsorshipLoading(true);
                try {
                  const res = await fetch("/api/onboarding/wallet", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "sponsorship",
                      walletAddress: state.walletAddress,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok || !data.ok) {
                    setState((s) => ({
                      ...s,
                      sponsorshipReady: false,
                      sponsorshipNote: data.error || "Sponsorship setup failed",
                    }));
                    return;
                  }
                  setState((s) => ({
                    ...s,
                    sponsorshipReady: true,
                    sponsorshipNote: data.result.note || "Sponsorship prepared",
                    sponsorshipLamports: data.result.lamportsApproved || 0,
                  }));
                } catch {
                  setState((s) => ({
                    ...s,
                    sponsorshipReady: false,
                    sponsorshipNote: "Sponsorship setup failed",
                  }));
                } finally {
                  setSponsorshipLoading(false);
                }
              }}
            >
              {sponsorshipLoading ? "Preparing sponsorship..." : "Prepare sponsorship (rent + registration fee cap)"}
            </Button>

            {(state.walletStatusNote || state.sponsorshipNote) && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground">
                {state.walletStatusNote && <p>{state.walletStatusNote}</p>}
                {state.sponsorshipNote && <p className="mt-1">{state.sponsorshipNote}</p>}
                {state.sponsorshipLamports > 0 && (
                  <p className="mt-1 font-mono">approved lamports: {state.sponsorshipLamports.toLocaleString()}</p>
                )}
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">5. Register specialist</h2>
            <p className="text-sm text-muted-foreground">
              Submit `register_agent` directly from the wizard using your connected wallet and endpoint metadata.
            </p>
            <div className="w-full">
              <WalletMultiButton className="!bg-[#9945FF] hover:!bg-[#7f34df] !text-white !rounded-md !h-10" />
            </div>
            <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs font-mono space-y-1">
              <p>wallet: {state.walletAddress || "(missing)"}</p>
              <p>endpoint: {endpointPreview}</p>
              <p>sponsorship: protocol rent + registration fee only</p>
              <p>instruction: register_agent (Primary, ollama-local, 0.001 SOL/call)</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleSimulateRegisterSpecialist}
                disabled={
                  registerPreflightLoading ||
                  !connected ||
                  !state.walletAddress ||
                  state.endpointStatus !== "online" ||
                  !state.sponsorshipReady
                }
              >
                {registerPreflightLoading ? "Simulating..." : "Run preflight simulation"}
              </Button>
            </div>

            {registerPreflight && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground space-y-1">
                <p className={registerPreflight.ok ? "text-[#14F195]" : "text-red-400"}>
                  {registerPreflight.ok ? "Preflight PASS" : "Preflight FAIL"}
                </p>
                <p className="font-mono break-all">agent PDA: {registerPreflight.agentPda}</p>
                <p className="font-mono">rate lamports: {registerPreflight.rateLamports.toString()}</p>
                <p className="font-mono">estimated cost: ~{registerPreflight.estimatedCostSol.toFixed(5)} SOL</p>
                {typeof registerPreflight.unitsConsumed === "number" && (
                  <p className="font-mono">compute units: {registerPreflight.unitsConsumed.toLocaleString()}</p>
                )}
                {registerPreflight.error && <p className="text-red-300">{registerPreflight.error}</p>}
                {registerPreflight.logs && registerPreflight.logs.length > 0 && (
                  <details>
                    <summary className="cursor-pointer">simulation logs</summary>
                    <div className="mt-1 space-y-1">
                      {registerPreflight.logs.slice(0, 8).map((line, idx) => (
                        <p key={`${idx}-${line}`} className="font-mono break-all">
                          {line}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            <Button
              onClick={handleRegisterSpecialist}
              disabled={
                registering ||
                SUBMISSION_BLOCKED ||
                !connected ||
                !state.walletAddress ||
                state.endpointStatus !== "online" ||
                !state.sponsorshipReady
              }
              style={{ background: "linear-gradient(135deg, #9945FF, #14F195)", color: "#000" }}
            >
              {SUBMISSION_BLOCKED
                ? "Blocked: no audited mainnet deployment"
                : registering
                  ? "Registering on-chain..."
                  : "Register specialist on-chain"}
            </Button>

            {registerError && (
              <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-300">
                {registerError}
              </div>
            )}

            {state.registrationTxSig && (
              <div className="rounded-lg border border-[#14F195]/30 bg-[#14F195]/10 p-3 text-xs">
                <p className="text-[#14F195]">Registration submitted</p>
                <a
                  href={toExplorerTxUrl(state.registrationTxSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono break-all hover:underline"
                >
                  {state.registrationTxSig}
                </a>
              </div>
            )}

            <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Capability profile (required before continuing)
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                <Input
                  value={state.capabilityTaskTypes}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      capabilityTaskTypes: e.target.value,
                      capabilitySaved: false,
                      capabilityNote: "",
                    }))
                  }
                  placeholder="task types (comma separated)"
                />
                <Input
                  value={state.capabilityInputModes}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      capabilityInputModes: e.target.value,
                      capabilitySaved: false,
                      capabilityNote: "",
                    }))
                  }
                  placeholder="input modes (comma separated)"
                />
                <Input
                  value={state.capabilityOutputModes}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      capabilityOutputModes: e.target.value,
                      capabilitySaved: false,
                      capabilityNote: "",
                    }))
                  }
                  placeholder="output modes (comma separated)"
                />
                <Input
                  value={state.capabilityPrivacyModes}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      capabilityPrivacyModes: e.target.value,
                      capabilitySaved: false,
                      capabilityNote: "",
                    }))
                  }
                  placeholder="privacy modes (public, per, vanish)"
                />
                <Input
                  value={state.capabilityBaseUsd}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      capabilityBaseUsd: e.target.value,
                      capabilitySaved: false,
                      capabilityNote: "",
                    }))
                  }
                  placeholder="base USD"
                />
                <Input
                  value={state.capabilityPerCallUsd}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      capabilityPerCallUsd: e.target.value,
                      capabilitySaved: false,
                      capabilityNote: "",
                    }))
                  }
                  placeholder="per-call USD"
                />
              </div>
              <Input
                value={state.capabilityTags}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    capabilityTags: e.target.value,
                    capabilitySaved: false,
                    capabilityNote: "",
                  }))
                }
                placeholder="tags (comma separated)"
              />

              <details className="rounded-lg border border-white/10 bg-black/20 p-3">
                <summary className="cursor-pointer text-sm font-medium">Runtime capabilities</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {RUNTIME_CAPABILITIES.map((capability) => (
                    <label key={capability} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={state.capabilityRuntimeCapabilities.includes(capability)}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            capabilityRuntimeCapabilities: e.target.checked
                              ? Array.from(new Set([...s.capabilityRuntimeCapabilities, capability]))
                              : s.capabilityRuntimeCapabilities.filter((item) => item !== capability),
                            capabilitySaved: false,
                            capabilityNote: "",
                          }))
                        }
                        className="accent-[#9945FF]"
                      />
                      <span>{RUNTIME_CAPABILITY_LABELS[capability] ?? capability}</span>
                    </label>
                  ))}
                </div>
              </details>

              <details className="rounded-lg border border-white/10 bg-black/20 p-3">
                <summary className="cursor-pointer text-sm font-medium">Context requirements</summary>
                <div className="mt-3 space-y-3">
                  {state.capabilityContextRequirements.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Optional, add only if this specialist needs structured inputs.</p>
                  ) : (
                    state.capabilityContextRequirements.map((req, idx) => (
                      <div key={`${idx}-${req.key}`} className="grid gap-2 rounded-md border border-white/10 bg-black/30 p-3">
                        <div className="grid sm:grid-cols-4 gap-2">
                          <Input
                            value={req.key}
                            onChange={(e) =>
                              setState((s) => ({
                                ...s,
                                capabilityContextRequirements: s.capabilityContextRequirements.map((item, itemIdx) =>
                                  itemIdx === idx ? { ...item, key: e.target.value } : item
                                ),
                                capabilitySaved: false,
                                capabilityNote: "",
                              }))
                            }
                            placeholder="key"
                          />
                          <select
                            value={req.type}
                            onChange={(e) =>
                              setState((s) => ({
                                ...s,
                                capabilityContextRequirements: s.capabilityContextRequirements.map((item, itemIdx) =>
                                  itemIdx === idx ? { ...item, type: e.target.value as typeof req.type } : item
                                ),
                                capabilitySaved: false,
                                capabilityNote: "",
                              }))
                            }
                            className="w-full bg-background border border-white/10 rounded-md px-3 py-2 text-sm"
                          >
                            {CONTEXT_REQUIREMENT_TYPES.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={req.required}
                              onChange={(e) =>
                                setState((s) => ({
                                  ...s,
                                  capabilityContextRequirements: s.capabilityContextRequirements.map((item, itemIdx) =>
                                    itemIdx === idx ? { ...item, required: e.target.checked } : item
                                  ),
                                  capabilitySaved: false,
                                  capabilityNote: "",
                                }))
                              }
                              className="accent-[#9945FF]"
                            />
                            Required
                          </label>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              setState((s) => ({
                                ...s,
                                capabilityContextRequirements: s.capabilityContextRequirements.filter((_, itemIdx) => itemIdx !== idx),
                                capabilitySaved: false,
                                capabilityNote: "",
                              }))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                        <Input
                          value={req.description}
                          onChange={(e) =>
                            setState((s) => ({
                              ...s,
                              capabilityContextRequirements: s.capabilityContextRequirements.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, description: e.target.value } : item
                              ),
                              capabilitySaved: false,
                              capabilityNote: "",
                            }))
                          }
                          placeholder="description (optional)"
                        />
                      </div>
                    ))
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={state.capabilityContextRequirements.length >= 5}
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        capabilityContextRequirements: [...s.capabilityContextRequirements, createRequirement()],
                        capabilitySaved: false,
                        capabilityNote: "",
                      }))
                    }
                  >
                    + Add requirement
                  </Button>
                </div>
              </details>

              <Button
                variant="outline"
                disabled={capabilityLoading || !state.walletAddress || !state.registrationCompleted}
                onClick={async () => {
                  setCapabilityLoading(true);
                  try {
                    const splitList = (v: string) =>
                      v
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean);

                    const res = await fetch("/api/onboarding/capabilities", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        walletAddress: state.walletAddress,
                        taskTypes: splitList(state.capabilityTaskTypes),
                        inputModes: splitList(state.capabilityInputModes),
                        outputModes: splitList(state.capabilityOutputModes),
                        privacyModes: splitList(state.capabilityPrivacyModes),
                        tags: splitList(state.capabilityTags),
                        context_requirements: state.capabilityContextRequirements.map((req) => ({
                          key: req.key,
                          type: req.type,
                          required: req.required,
                          description: req.description || undefined,
                        })),
                        runtime_capabilities: state.capabilityRuntimeCapabilities,
                        endpointUrl: state.endpointUrl,
                        healthcheckStatus: state.healthcheckStatus,
                        attested: state.attested,
                        pricing: {
                          baseUsd: Number(state.capabilityBaseUsd || "0"),
                          perCallUsd:
                            state.capabilityPerCallUsd.trim().length > 0
                              ? Number(state.capabilityPerCallUsd)
                              : undefined,
                        },
                      }),
                    });

                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                      setState((s) => ({
                        ...s,
                        capabilitySaved: false,
                        capabilityNote: data.error || "Capability save failed",
                      }));
                      return;
                    }

                    setState((s) => ({
                      ...s,
                      capabilitySaved: true,
                      capabilityNote: "Capability profile saved.",
                    }));
                  } catch {
                    setState((s) => ({
                      ...s,
                      capabilitySaved: false,
                      capabilityNote: "Capability save failed",
                    }));
                  } finally {
                    setCapabilityLoading(false);
                  }
                }}
              >
                {capabilityLoading ? "Saving capabilities..." : "Save capability profile"}
              </Button>
              {state.capabilityNote && (
                <p className={`text-xs ${state.capabilitySaved ? "text-[#14F195]" : "text-red-400"}`}>
                  {state.capabilityNote}
                </p>
              )}
            </div>

            <Link
              href={`/register?endpoint=${encodeURIComponent(endpointPreview.startsWith("https://") ? endpointPreview : state.endpointUrl || "")}`}
              className="inline-block"
            >
              <Button variant="outline">
                Open full registration page (fallback)
              </Button>
            </Link>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">6. x402 healthcheck</h2>
            <p className="text-sm text-muted-foreground">
              Runs through reddi-x402 to confirm endpoint is reachable and payment flow is healthy.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={healthcheckLoading || !state.endpointUrl || !state.walletAddress}
                onClick={async () => {
                  setHealthcheckLoading(true);
                  try {
                    const res = await fetch("/api/onboarding/healthcheck", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        endpointUrl: state.endpointUrl,
                        walletAddress: state.walletAddress,
                      }),
                    });

                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                      setState((s) => ({
                        ...s,
                        healthcheckStatus: "fail",
                        healthcheckNote: data.error || "Healthcheck failed",
                        attested: false,
                      }));
                      return;
                    }

                    setState((s) => ({
                      ...s,
                      healthcheckStatus: data.result.status === "pass" ? "pass" : "fail",
                      healthcheckNote: data.result.note || "",
                      attested: false,
                      attestationJobIdHex: "",
                      attestationPda: "",
                      attestationOperator: "",
                      attestationConsumer: "",
                      attestationResolution: "pending",
                      attestationResolutionSig: "",
                    }));
                  } catch {
                    setState((s) => ({
                      ...s,
                      healthcheckStatus: "fail",
                      healthcheckNote: "Healthcheck failed",
                      attested: false,
                      attestationJobIdHex: "",
                      attestationPda: "",
                      attestationOperator: "",
                      attestationConsumer: "",
                      attestationResolution: "pending",
                      attestationResolutionSig: "",
                    }));
                  } finally {
                    setHealthcheckLoading(false);
                  }
                }}
              >
                {healthcheckLoading ? "Running healthcheck..." : "Run healthcheck"}
              </Button>
              <span
                className={`text-sm self-center ${
                  state.healthcheckStatus === "pass"
                    ? "text-[#14F195]"
                    : state.healthcheckStatus === "fail"
                    ? "text-red-400"
                    : "text-muted-foreground"
                }`}
              >
                {state.healthcheckStatus === "pending"
                  ? "Not run"
                  : state.healthcheckStatus === "pass"
                  ? "PASS"
                  : "FAIL"}
              </span>
            </div>
            {state.healthcheckNote && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground">
                {state.healthcheckNote}
              </div>
            )}
          </div>
        )}

        {step === 7 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">7. Attestation</h2>
            <p className="text-sm text-muted-foreground">Operator attests onboarding quality once healthcheck passes.</p>
            <Button
              variant="outline"
              disabled={attestationOperatorCheckLoading}
              onClick={async () => {
                setAttestationOperatorCheckLoading(true);
                try {
                  const res = await fetch("/api/onboarding/attestation-operator");
                  const data = await res.json();
                  if (!res.ok || !data.ok) {
                    setState((s) => ({
                      ...s,
                      attestationOperatorReady: false,
                      attestationOperatorState: "invalid",
                      attestationOperatorCheckedAt: new Date().toISOString(),
                      attestationOperatorStatusNote: data.error || "Operator status check failed",
                    }));
                    return;
                  }

                  setState((s) => ({
                    ...s,
                    attestationOperatorReady: Boolean(data.result.ready),
                    attestationOperatorState: data.result.state || (data.result.ready ? "ready" : "invalid"),
                    attestationOperatorCheckedAt: data.result.checkedAt || new Date().toISOString(),
                    attestationOperatorStatusNote: data.result.operatorPubkey
                      ? `${data.result.note} (${data.result.operatorPubkey})`
                      : data.result.note || data.result.nextAction || "",
                  }));
                } catch {
                  setState((s) => ({
                    ...s,
                    attestationOperatorReady: false,
                    attestationOperatorState: "invalid",
                    attestationOperatorCheckedAt: new Date().toISOString(),
                    attestationOperatorStatusNote: "Operator status check failed",
                  }));
                } finally {
                  setAttestationOperatorCheckLoading(false);
                }
              }}
            >
              {attestationOperatorCheckLoading ? "Checking operator key..." : "Check attestor key status"}
            </Button>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Operator key status:</span>
              <span
                className={`rounded-full border px-2 py-0.5 font-medium ${
                  operatorStatusState === "ready"
                    ? "border-[#14F195]/50 text-[#14F195]"
                    : operatorStatusState === "stale"
                    ? "border-yellow-500/50 text-yellow-300"
                    : "border-red-500/40 text-red-300"
                }`}
              >
                {operatorStatusState.toUpperCase()}
              </span>
              {state.attestationOperatorCheckedAt && (
                <span className="text-muted-foreground">
                  checked: {new Date(state.attestationOperatorCheckedAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  const template = 'ONBOARDING_ATTEST_OPERATOR_SECRET_KEY="[12,34,...,64 bytes total]"';
                  try {
                    await navigator.clipboard.writeText(template);
                    showToast("Copied operator key env template", "success");
                  } catch {
                    showToast("Could not copy template. Paste manually from the setup guide.", "error");
                  }
                }}
              >
                Copy env template
              </Button>
              <Link
                href="https://github.com/nissan/reddi-agent-protocol/blob/main/docs/ONBOARDING-OPERATOR-KEY-ROTATION-RUNBOOK.md"
                className="inline-flex items-center rounded-md border border-white/15 px-3 py-2 text-xs text-muted-foreground hover:text-white"
              >
                Open rotation runbook
              </Link>
            </div>

            <Button
              variant="outline"
              disabled={
                attestationLoading ||
                state.healthcheckStatus !== "pass" ||
                !state.walletAddress ||
                !operatorReadyForAttestation
              }
              onClick={async () => {
                setAttestationLoading(true);
                try {
                  const res = await fetch("/api/onboarding/attestation", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      walletAddress: state.walletAddress,
                      endpointUrl: state.endpointUrl,
                      healthcheckStatus: state.healthcheckStatus,
                      operator: "wizard-operator",
                    }),
                  });

                  const data = await res.json();
                  if (!res.ok || !data.ok) {
                    setState((s) => ({
                      ...s,
                      attested: false,
                      attestationNote: data.error || "Attestation failed",
                    }));
                    return;
                  }

                  setState((s) => ({
                    ...s,
                    attested: true,
                    attestationJobIdHex: data.result?.onchain?.jobIdHex || "",
                    attestationPda: data.result?.onchain?.attestationPda || "",
                    attestationOperator: data.result?.onchain?.operator || "",
                    attestationConsumer: data.result?.onchain?.consumer || "",
                    attestationResolution: "pending",
                    attestationResolutionSig: "",
                    attestationNote: data.result?.onchain?.signature
                      ? `Attestation recorded on-chain: ${data.result.onchain.signature}`
                      : data.result?.note || "Attestation recorded",
                  }));
                } catch {
                  setState((s) => ({
                    ...s,
                    attested: false,
                    attestationNote: "Attestation failed",
                  }));
                } finally {
                  setAttestationLoading(false);
                }
              }}
            >
              {attestationLoading ? "Recording attestation..." : "Record operator attestation"}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  !state.attested ||
                  !state.attestationJobIdHex ||
                  SUBMISSION_BLOCKED ||
                  !connected ||
                  !publicKey ||
                  publicKey.toBase58() !== state.attestationConsumer ||
                  state.attestationResolution !== "pending"
                }
                onClick={async () => {
                  if (SUBMISSION_BLOCKED) return;
                  if (!publicKey || !sendTransaction || !state.attestationJobIdHex || !state.attestationOperator) {
                    return;
                  }

                  try {
                    const conn = walletConnection ?? new Connection(DEVNET_RPC, "confirmed");
                    const jobId = hexToJobId(state.attestationJobIdHex);

                    const operatorPubkey = new PublicKey(state.attestationOperator);
                    const ix = PROGRAM_TARGET === "quasar"
                      ? buildQuasarConfirmAttestationInstruction({
                          programId: ATTESTATION_PROGRAM_ID,
                          consumer: publicKey,
                          judge: operatorPubkey,
                          jobId,
                          attestationPda: state.attestationPda ? new PublicKey(state.attestationPda) : quasarAttestationPda(jobId, ATTESTATION_PROGRAM_ID),
                          judgeAgentPda: quasarAgentPda(operatorPubkey, REGISTRY_PROGRAM_ID),
                        })
                      : new TransactionInstruction({
                          programId: ESCROW_PROGRAM_ID,
                          keys: [
                            {
                              pubkey: state.attestationPda
                                ? new PublicKey(state.attestationPda)
                                : attestationPda(jobId),
                              isSigner: false,
                              isWritable: true,
                            },
                            { pubkey: agentPda(operatorPubkey), isSigner: false, isWritable: true },
                            { pubkey: publicKey, isSigner: true, isWritable: false },
                          ],
                          data: buildConfirmAttestationData(jobId),
                        });

                    const { blockhash } = await conn.getLatestBlockhash();
                    const tx = new Transaction();
                    tx.recentBlockhash = blockhash;
                    tx.feePayer = publicKey;
                    tx.add(ix);

                    const sig = await sendTransaction(tx, conn);
                    await conn.confirmTransaction(sig, "confirmed");

                    setState((s) => ({
                      ...s,
                      attestationResolution: "confirmed",
                      attestationResolutionSig: sig,
                      attestationNote: `Attestation confirmed by consumer: ${sig}`,
                    }));
                  } catch (error: unknown) {
                    setState((s) => ({
                      ...s,
                      attestationNote:
                        error instanceof Error ? error.message : "Confirm attestation failed",
                    }));
                  }
                }}
              >
                {SUBMISSION_BLOCKED
                  ? "Confirm attestation — blocked"
                  : "Confirm attestation (consumer)"}
              </Button>
              <Button
                variant="outline"
                disabled={
                  !state.attested ||
                  !state.attestationJobIdHex ||
                  SUBMISSION_BLOCKED ||
                  !connected ||
                  !publicKey ||
                  publicKey.toBase58() !== state.attestationConsumer ||
                  state.attestationResolution !== "pending"
                }
                onClick={async () => {
                  if (SUBMISSION_BLOCKED) return;
                  if (!publicKey || !sendTransaction || !state.attestationJobIdHex || !state.attestationOperator) {
                    return;
                  }

                  try {
                    const conn = walletConnection ?? new Connection(DEVNET_RPC, "confirmed");
                    const jobId = hexToJobId(state.attestationJobIdHex);

                    const operatorPubkey = new PublicKey(state.attestationOperator);
                    const ix = PROGRAM_TARGET === "quasar"
                      ? buildQuasarDisputeAttestationInstruction({
                          programId: ATTESTATION_PROGRAM_ID,
                          consumer: publicKey,
                          judge: operatorPubkey,
                          jobId,
                          attestationPda: state.attestationPda ? new PublicKey(state.attestationPda) : quasarAttestationPda(jobId, ATTESTATION_PROGRAM_ID),
                          judgeAgentPda: quasarAgentPda(operatorPubkey, REGISTRY_PROGRAM_ID),
                        })
                      : new TransactionInstruction({
                          programId: ESCROW_PROGRAM_ID,
                          keys: [
                            {
                              pubkey: state.attestationPda
                                ? new PublicKey(state.attestationPda)
                                : attestationPda(jobId),
                              isSigner: false,
                              isWritable: true,
                            },
                            { pubkey: agentPda(operatorPubkey), isSigner: false, isWritable: true },
                            { pubkey: publicKey, isSigner: true, isWritable: false },
                          ],
                          data: buildDisputeAttestationData(jobId),
                        });

                    const { blockhash } = await conn.getLatestBlockhash();
                    const tx = new Transaction();
                    tx.recentBlockhash = blockhash;
                    tx.feePayer = publicKey;
                    tx.add(ix);

                    const sig = await sendTransaction(tx, conn);
                    await conn.confirmTransaction(sig, "confirmed");

                    setState((s) => ({
                      ...s,
                      attestationResolution: "disputed",
                      attestationResolutionSig: sig,
                      attestationNote: `Attestation disputed by consumer: ${sig}`,
                    }));
                  } catch (error: unknown) {
                    setState((s) => ({
                      ...s,
                      attestationNote:
                        error instanceof Error ? error.message : "Dispute attestation failed",
                    }));
                  }
                }}
              >
                {SUBMISSION_BLOCKED
                  ? "Dispute attestation — blocked"
                  : "Dispute attestation (consumer)"}
              </Button>
            </div>
            {SUBMISSION_BLOCKED && (
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                {SUBMISSION_BLOCKED_REASON}
              </p>
            )}
            {state.attested && state.attestationConsumer && (
              <p className="text-xs text-muted-foreground">
                Consumer follow-through wallet: <span className="font-mono">{state.attestationConsumer}</span>
              </p>
            )}
            {state.attestationResolution !== "pending" && state.attestationResolutionSig && (
              <a
                href={toExplorerTxUrl(state.attestationResolutionSig)}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs font-mono break-all text-[#14F195] hover:underline"
              >
                resolution tx: {state.attestationResolutionSig}
              </a>
            )}
            {state.healthcheckStatus !== "pass" && (
              <p className="text-xs text-yellow-400">Healthcheck must pass before attestation can be recorded.</p>
            )}
            {operatorStatusState !== "ready" && (
              <>
                <p className="text-xs text-yellow-400">
                  {operatorStatusState === "stale"
                    ? "Operator signer status is stale. Re-check before recording attestation."
                    : "Operator signer key must be configured before recording attestation."}
                </p>
                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                  <p className="mb-1">Quick fix: set <span className="font-mono">ONBOARDING_ATTEST_OPERATOR_SECRET_KEY</span> as a 64-byte JSON array, restart the app, then click &quot;Check attestor key status&quot; again.</p>
                  <p className="font-mono break-all">Example format: [12,34,56,...,64 bytes total]</p>
                  <Link href="https://github.com/nissan/reddi-agent-protocol/blob/main/docs/ONBOARDING-ATTESTATION-OPERATOR-SETUP.md" className="mt-2 inline-block underline">
                    Operator setup and recovery guide →
                  </Link>
                </div>
              </>
            )}
            {state.attestationOperatorStatusNote && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground">
                {state.attestationOperatorStatusNote}
              </div>
            )}
            {state.attestationNote && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground">
                {state.attestationNote}
              </div>
            )}
          </div>
        )}

        {step === 8 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your specialist endpoint is live and registered. Use the planner to run a real task against it — the system will select a candidate, negotiate payment (x402), and execute the call.
            </p>

            {/* Prompt input */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Prompt</Label>
              <textarea
                rows={3}
                className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-purple-500"
                value={state.plannerPrompt}
                onChange={(e) => setState((s) => ({ ...s, plannerPrompt: e.target.value }))}
                disabled={state.plannerStatus === "running"}
              />
            </div>

            {/* Policy toggles */}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="rounded-full border border-white/10 px-2 py-0.5 bg-black/30">policy: requiresHealthPass=true</span>
              <span className="rounded-full border border-white/10 px-2 py-0.5 bg-black/30">auto-selects best available candidate</span>
            </div>

            {/* Operator preflight gate */}
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-muted-foreground">
                Required before execution. Run preflight first, fix any blocking failures, then run the specialist call.
              </div>
              <div className="text-[11px] text-muted-foreground/80">
                Checks: operator key, endpoint/runtime health, RPC+program consistency, wallet balance floor.
              </div>
              <Button
                variant="outline"
                className="w-full"
                disabled={operatorPreflightLoading || state.plannerStatus === "running"}
                onClick={async () => {
                  setOperatorPreflightLoading(true);
                  setOperatorPreflight(null);
                  try {
                    const res = await fetch("/api/onboarding/preflight", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        endpointUrl: state.endpointUrl,
                        walletAddress: state.walletAddress,
                      }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      setOperatorPreflight({
                        ok: false,
                        checkedAt: new Date().toISOString(),
                        blockingFailures: 1,
                        checks: [],
                        error: data?.error || "Preflight failed",
                      });
                      return;
                    }

                    setOperatorPreflight({
                      ok: Boolean(data?.ok),
                      checkedAt: data?.result?.checkedAt || new Date().toISOString(),
                      blockingFailures: Number(data?.result?.blockingFailures || 0),
                      checks: Array.isArray(data?.result?.checks) ? data.result.checks : [],
                    });
                  } catch (error) {
                    setOperatorPreflight({
                      ok: false,
                      checkedAt: new Date().toISOString(),
                      blockingFailures: 1,
                      checks: [],
                      error: error instanceof Error ? error.message : "Preflight failed",
                    });
                  } finally {
                    setOperatorPreflightLoading(false);
                  }
                }}
              >
                {operatorPreflightLoading ? "Running preflight..." : "Run operator preflight (required)"}
              </Button>

              {operatorPreflight && (
                <div className={`rounded-md border p-3 text-xs ${operatorPreflight.ok ? "border-green-500/30 bg-green-950/20 text-green-300" : "border-red-500/30 bg-red-950/20 text-red-300"}`}>
                  <div className="font-medium">{operatorPreflight.ok ? "Preflight PASS" : "Preflight FAIL"}</div>
                  <div className="opacity-80">blocking failures: {operatorPreflight.blockingFailures}</div>
                  <div className="opacity-70">checked: {new Date(operatorPreflight.checkedAt).toLocaleString()}</div>
                  {operatorPreflight.error && <div className="mt-1">{operatorPreflight.error}</div>}
                  {operatorPreflight.checks.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {operatorPreflight.checks.map((check) => (
                        <div key={check.id} className="rounded border border-white/10 bg-black/30 p-2">
                          <div className="font-medium">{check.status === "pass" ? "✓" : "✗"} {check.label}</div>
                          <div className="opacity-90">{check.detail}</div>
                          {check.fix && check.status === "fail" && <div className="mt-1 opacity-80">fix: {check.fix}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Execute button */}
            <Button
              className="w-full"
              disabled={
                state.plannerStatus === "running" ||
                !state.plannerPrompt.trim() ||
                !operatorPreflight ||
                !operatorPreflight.ok
              }
              onClick={async () => {
                setState((s) => ({ ...s, plannerStatus: "running", plannerNote: "Routing to specialist...", plannerRunId: "", plannerResponsePreview: "", plannerX402Tx: "" }));
                try {
                  const res = await fetch("/api/onboarding/planner/execute", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ prompt: state.plannerPrompt }),
                  });
                  const data = await res.json();
                  if (data.ok) {
                    setState((s) => ({
                      ...s,
                      plannerStatus: "completed",
                      plannerRunId: data.result?.result?.runId || "",
                      plannerResponsePreview: data.result?.result?.responsePreview || "(no preview)",
                      plannerX402Tx: data.result?.result?.x402TxSignature || "",
                      plannerNote: "✓ Planner call completed.",
                    }));
                  } else {
                    setState((s) => ({
                      ...s,
                      plannerStatus: "failed",
                      plannerNote: `Planner call failed: ${data.error || "unknown error"}`,
                    }));
                  }
                } catch (e) {
                  setState((s) => ({ ...s, plannerStatus: "failed", plannerNote: `Request error: ${e instanceof Error ? e.message : String(e)}` }));
                }
              }}
            >
              {state.plannerStatus === "running" ? "Running..." : "Run specialist call"}
            </Button>
            {(!operatorPreflight || !operatorPreflight.ok) && (
              <p className="text-xs text-yellow-400">Specialist execution is locked until preflight passes.</p>
            )}

            {/* Result */}
            {state.plannerNote && (
              <div className={`rounded-lg border p-3 text-xs ${
                state.plannerStatus === "completed" ? "border-green-500/30 bg-green-950/20 text-green-300" :
                state.plannerStatus === "failed" ? "border-red-500/30 bg-red-950/20 text-red-300" :
                "border-white/10 bg-black/30 text-muted-foreground"
              }`}>
                <div>{state.plannerNote}</div>
                {state.plannerRunId && <div className="mt-1 font-mono opacity-60">run: {state.plannerRunId}</div>}
                {state.plannerX402Tx && <div className="mt-1 font-mono opacity-60">x402 tx: {state.plannerX402Tx}</div>}
                {state.plannerResponsePreview && (
                  <div className="mt-2 border-t border-white/10 pt-2 whitespace-pre-wrap opacity-80">{state.plannerResponsePreview}</div>
                )}
              </div>
            )}

            {/* Feedback */}
            {(state.plannerStatus === "completed" || state.plannerStatus === "failed") && state.plannerRunId && !state.plannerFeedbackSent && (
              <div className="space-y-3 border border-white/10 rounded-lg p-4 bg-black/20">
                <p className="text-xs font-medium text-white">Rate this specialist call (1–10)</p>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    className="w-20 text-center"
                    value={state.plannerFeedbackScore}
                    onChange={(e) => setState((s) => ({ ...s, plannerFeedbackScore: e.target.value }))}
                  />
                  <Input
                    placeholder="Optional notes"
                    value={state.plannerFeedbackNote}
                    onChange={(e) => setState((s) => ({ ...s, plannerFeedbackNote: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    try {
                      const score = Math.max(1, Math.min(10, parseInt(state.plannerFeedbackScore, 10) || 5));
                      const res = await fetch("/api/onboarding/planner/feedback", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          runId: state.plannerRunId,
                          score,
                          agreesWithAttestation: state.attested,
                          notes: state.plannerFeedbackNote || undefined,
                        }),
                      });
                      const data = await res.json();
                      setState((s) => ({
                        ...s,
                        plannerFeedbackSent: true,
                        plannerFeedbackNote2: data.ok
                          ? `✓ Feedback saved${data.result?.reputationCommit?.ok ? " + reputation committed on-chain" : " (off-chain only — operator key not configured)"}.`
                          : `Feedback save failed: ${data.error || "unknown"}`,
                      }));
                    } catch (e) {
                      setState((s) => ({
                        ...s,
                        plannerFeedbackSent: true,
                        plannerFeedbackNote2: `Request error: ${e instanceof Error ? e.message : String(e)}`,
                      }));
                    }
                  }}
                >
                  Submit feedback
                </Button>
              </div>
            )}

            {state.plannerFeedbackNote2 && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-muted-foreground">
                {state.plannerFeedbackNote2}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between pt-2 border-t border-white/10">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
            Back
          </Button>
          {step < STEPS.length ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
              Next
            </Button>
          ) : (
            <Button
              disabled={!state.attested}
              style={{ background: "linear-gradient(135deg, #9945FF, #14F195)", color: "#000" }}
              onClick={async () => {
                if (state.onboardingCompletedEventSent) {
                  showToast("Onboarding already completed", "success");
                  return;
                }

                const userPubkey = state.walletAddress || publicKey?.toBase58();
                if (!userPubkey) {
                  showToast("Connect wallet to finalize onboarding", "error");
                  return;
                }

                try {
                  await emitOnboardingCompletedEvent({
                    userPubkey,
                    attested: state.attested,
                    plannerStatus: state.plannerStatus,
                    feedbackSent: state.plannerFeedbackSent,
                  });
                } catch {
                  // Torque is non-critical; completion should not be blocked
                }

                setState((s) => ({ ...s, onboardingCompletedEventSent: true }));
                showToast("Onboarding complete", "success");
              }}
            >
              Onboarding complete ✓
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
