export type SpecialistRole = "specialist" | "attestor" | "consumer";

export type SafetyMode = "standard" | "regulated-informational" | "attestation";

export interface SpecialistPrice {
  currency: "USDC" | "SOL";
  amount: string;
  unit: "request" | "1k_tokens";
}

export interface SpecialistProfile {
  id: string;
  displayName: string;
  description: string;
  walletAddress: string;
  endpointPath: string;
  capabilities: string[];
  roles: SpecialistRole[];
  price: SpecialistPrice;
  safetyMode: SafetyMode;
  preferredAttestors: string[];
  model: string;
  systemPrompt: string;
  tags: string[];
}

export interface RuntimeConfig {
  profileId: string;
  endpointBaseUrl: string;
  openRouterApiKey?: string;
  openRouterBaseUrl: string;
  mockOpenRouter: boolean;
  requirePayment: boolean;
  allowDemoPayment?: boolean;
  allowRealPayment?: boolean;
  solanaRpcUrl?: string;
  usdcDevnetMint?: string;
  /**
   * Treasury owner address for the protocol fee on per-call payments. When set,
   * challenges state the fee split and real receipts must include the fee
   * transfer. Operator configuration only.
   */
  protocolFeeTreasury?: string;
  enableAgentToAgentCalls?: boolean;
  enableLiveDelegationExecutor?: boolean;
  maxDownstreamCalls?: number;
  maxDownstreamLamports?: number;
  safetyMode?: SafetyMode;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

export type AttestationMode = "attestation";
export type AttestationCheckStatus = "pass" | "warn" | "fail";
export type AttestationRecommendedAction = "release" | "refund" | "dispute";

export interface AttestationReceiptLink {
  id: string;
  type: string;
  status?: string;
  amount?: string;
  currency?: string;
  txSignature?: string;
  evidenceHash?: string;
}

export interface AttestationRequest {
  mode: AttestationMode;
  subjectProfileId?: string;
  specialistOutput: string;
  receiptChain: AttestationReceiptLink[];
  domain?: string;
  constraints?: string[];
}

export interface AttestationCheck {
  id: string;
  label: string;
  status: AttestationCheckStatus;
  score: number;
  summary: string;
}

export interface AttestationVerdict {
  schemaVersion: "reddi.attestation.v1";
  attestorProfileId: string;
  subjectProfileId?: string;
  score: number;
  recommendedAction: AttestationRecommendedAction;
  checks: AttestationCheck[];
  summary: string;
  caveats: string[];
  receiptChain: AttestationReceiptLink[];
  semantics: Record<AttestationRecommendedAction, string>;
}

export interface AttestationPromptEnvelope {
  mode: AttestationMode;
  schemaVersion: "reddi.attestation.v1";
  messages: ChatMessage[];
}

export interface OpenRouterClient {
  readonly callCount: number;
  createChatCompletion(input: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    metadata: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

export interface RuntimeResponse {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
