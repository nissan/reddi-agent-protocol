import { buildRapMcpBridgeSurfpoolProof } from "@/lib/mcp-bridge-demo/surfpool-proof";

const surfpoolProof = buildRapMcpBridgeSurfpoolProof();

export type McpBridgeDemoMode =
  | "quote_only"
  | "surfpool_local"
  | "devnet_ready";

export type McpBridgeDemoCheck = {
  id: string;
  label: string;
  status: "pass" | "blocked" | "pending" | "not_applicable";
  detail: string;
};

export type McpBridgeDemoQuote = {
  schemaVersion: "reddi.quote.v1";
  quoteId: string;
  quoteAuthority: "bridge_synthetic";
  binding: false;
  specialist: {
    displayName: string;
    walletAddress: string;
    capability: string;
    endpointBoundary: "not_invoked";
  };
  terms: {
    amount: string;
    currency: "USDC";
    network: "demo" | "local-surfpool" | "solana-devnet";
    privacyMode: "public";
    requiredEvidence: string[];
  };
  taskHash: string;
  termsHash: string;
};

export type McpBridgeDemoDisclosureLedger = {
  schemaVersion: "reddi.downstream-disclosure-ledger.v1";
  generatedAt: string;
  safePublicEvidenceOnly: true;
  entries: Array<{
    entryId: string;
    runId: string;
    specialistWallet: string;
    capability: string;
    payloadClass: "prompt_summary";
    payloadHash: string;
    amount: string;
    currency: "USDC";
    network: string;
    verificationStatus: "planned" | "local_verified" | "devnet_pending";
    evidenceRefs: string[];
  }>;
};

export type McpBridgeDemoProofArtifact = {
  label: string;
  boundary: string;
  artifactPath: string;
  result: string;
  txSignatures: string[];
};

export type McpBridgeDemoFixture = {
  generatedAt: string;
  title: string;
  subtitle: string;
  permissionBoundary: string;
  proofArtifacts: McpBridgeDemoProofArtifact[];
  modes: Array<{
    id: McpBridgeDemoMode;
    label: string;
    claimBoundary: string;
    spendBoundary: string;
    checks: McpBridgeDemoCheck[];
  }>;
  quote: McpBridgeDemoQuote;
  disclosureLedger: McpBridgeDemoDisclosureLedger;
  recordingScript: string[];
};

export const mcpBridgeDemoFixture: McpBridgeDemoFixture = {
  generatedAt: "2026-05-08T00:00:00+10:00",
  title: "Reddi Agent Protocol MCP Bridge",
  subtitle:
    "An assurance bridge pattern for OpenClaw, Claude/MCP agents, OpenSwarm-style systems, Cursor, and custom agent stacks to discover, quote, verify, and disclose paid specialist-agent work without becoming a payment rail.",
  permissionBoundary:
    "Default bridge mode is dry-run/no-spend. Bounded devnet evidence is labelled separately; mainnet, custody, and production settlement are out of scope.",
  proofArtifacts: [
    {
      label: "Surfpool local transaction proof",
      boundary: "local_validator_only_no_devnet_no_mainnet",
      artifactPath:
        "artifacts/rap-mcp-bridge-surfpool-local/20260507T145133Z/SUMMARY.md",
      result: "local payment-ordering semantics: pass",
      txSignatures: [
        "5KFhkP2tHHEQ5RVVRJymbmKrMVWCF4Vu9RTioVc5eqd3chEdW7CxRtuhAZ6fxU6fSzzQX3pUXLEthURkQSymu4P6",
        "bdrZg71EfwfhHsNimR9X12UhxpwkUXsPAaRFdrTgEdqk1qY5Df5YZkLdKXzDPBEDv65LewxYfqYjLzve1XhwdD9",
      ],
    },
    {
      label: "Bounded devnet payment proof",
      boundary: "solana_devnet_only_no_mainnet_no_specialist_http_invocation",
      artifactPath:
        "artifacts/rap-mcp-bridge-devnet-proof/20260507T145907Z/SUMMARY.md",
      result: "bounded devnet transfer evidence: pass; cap: 100050 lamports",
      txSignatures: [
        "62CP7sHi9KyUDbnVFgM5WCvwiSq2p5WCkThsTkNrpqYnUxLGN9QNRDjye1nBDB7UWjgqtonoYbuKxawjzAvWrUgD",
        "5kV43JjPAWQBbzTohbP3y8ZsUCXPZpBSDLbPkmw1odSVoZXtJER3LJ7PiRBUL3DuD5jPUPM66NjMxSQTcuQcUsjp",
      ],
    },
  ],
  modes: [
    {
      id: "quote_only",
      label: "1. Quote-only governance",
      claimBoundary: "No payment submitted. No specialist endpoint invoked.",
      spendBoundary: "Zero spend",
      checks: [
        {
          id: "discover",
          label: "Discover specialists",
          status: "pass",
          detail:
            "The Reddi Agent Protocol registry/planner can rank eligible specialists by capability, price, health, and disclosed evidence signals.",
        },
        {
          id: "quote",
          label: "Synthetic quote",
          status: "pass",
          detail:
            "Quote is explicitly bridge_synthetic and non-binding; it is a governance artifact, not a commercial commitment.",
        },
        {
          id: "payment",
          label: "Payment",
          status: "blocked",
          detail:
            "Dry-run MCP policy blocks all payment and invoke tools in the first PR.",
        },
      ],
    },
    {
      id: "surfpool_local",
      label: "2. Surfpool local proof",
      claimBoundary:
        "Local validator proof only. No devnet/mainnet settlement claimed.",
      spendBoundary: "Local test-validator semantics",
      checks: [
        {
          id: "local-settlement",
          label: "Local settlement semantics",
          status: "pass",
          detail:
            "Local Surfpool artifact exercises quote → local transfer semantics → receipt → disclosure ledger before any devnet claim.",
        },
        {
          id: "local-verifier",
          label: "Local verifier",
          status: "pass",
          detail:
            "Local verifier passed with specialist credit; any 0.05% protocol-fee split is fixture economics only.",
        },
      ],
    },
    {
      id: "devnet_ready",
      label: "3. Bounded devnet proof",
      claimBoundary:
        "Devnet proof only after Surfpool succeeds and is reviewed.",
      spendBoundary: "Explicit bounded devnet spend; no mainnet",
      checks: [
        {
          id: "surfpool-gate",
          label: "Surfpool gate",
          status: "pass",
          detail:
            "Surfpool proof artifact exists; bounded devnet proof was executed separately under a tiny spend cap.",
        },
        {
          id: "devnet-receipt",
          label: "Devnet receipt verification",
          status: "pass",
          detail:
            "Bounded devnet proof captured tx signatures, terms hash, spend cap, payment boundary, and disclosure ledger entry.",
        },
      ],
    },
  ],
  quote: {
    schemaVersion: "reddi.quote.v1",
    quoteId: "quote_demo_mcp_bridge_research_001",
    quoteAuthority: "bridge_synthetic",
    binding: false,
    specialist: {
      displayName: "Research Specialist",
      walletAddress: "DemoResearch111111111111111111111111111111111",
      capability: "research_synthesis_with_citations",
      endpointBoundary: "not_invoked",
    },
    terms: {
      amount: "1.25",
      currency: "USDC",
      network: "demo",
      privacyMode: "public",
      requiredEvidence: ["sources", "terms_hash", "disclosure_ledger"],
    },
    taskHash: surfpoolProof.disclosureLedger.entries[0].payloadHash,
    termsHash: surfpoolProof.quote.termsHash,
  },
  disclosureLedger: {
    schemaVersion: "reddi.downstream-disclosure-ledger.v1",
    generatedAt: "2026-05-08T00:00:00+10:00",
    safePublicEvidenceOnly: true,
    entries: [
      {
        entryId: "ledger_entry_demo_001",
        runId: "planned_run_demo_001",
        specialistWallet: "DemoResearch111111111111111111111111111111111",
        capability: "research_synthesis_with_citations",
        payloadClass: "prompt_summary",
        payloadHash: surfpoolProof.disclosureLedger.entries[0].payloadHash,
        amount: "1.25",
        currency: "USDC",
        network: "demo",
        verificationStatus: "planned",
        evidenceRefs: [
          "quote_demo_mcp_bridge_research_001",
          surfpoolProof.quote.termsHash,
        ],
      },
    ],
  },
  recordingScript: [
    "Agent swarms can orchestrate work, but paid specialist work needs pricing, policy, receipts, and disclosure.",
    "The MCP bridge lets any MCP host discover candidates and request a quote before spend.",
    "This first quote is synthetic and non-binding. The policy correctly blocks payment and invocation.",
    "Next, the same flow must be proven locally on Surfpool before a bounded devnet spend is allowed.",
    "The final artifact is not just content — it includes a disclosure ledger describing who was hired, what was paid, and what verification boundary applies.",
  ],
};
