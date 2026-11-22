export type SpecialistRole = "specialist" | "attestor" | "consumer";

export type SafetyMode = "standard" | "regulated-informational" | "attestation";

export interface SpecialistPrice {
  currency: "USDC" | "SOL" | "AUDD" | "PYUSD" | "USDG";
  amount: string;
  unit: "request" | "1k_tokens";
}

/** A per-token price: per million input and output tokens, in the profile's currency, and the most output tokens one call may use. */
export interface PerTokenPrice {
  inputPerMillion: string;
  outputPerMillion: string;
  maxOutputTokens?: number;
}

export interface SpecialistProfile {
  id: string;
  displayName: string;
  description: string;
  walletAddress: string;
  endpointPath: string;
  capabilities: string[];
  roles: SpecialistRole[];
  /** Flat price of one direct per-call payment. */
  price: SpecialistPrice;
  /**
   * Per-token price for metered calls, in `price.currency`. Every first-party
   * profile has one (the mid tier unless it sets its own); the operator's
   * `X402_INPUT_PER_MILLION` / `X402_OUTPUT_PER_MILLION` override it.
   */
  meteredPrice?: PerTokenPrice;
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
   * Accepted mint address per token currency (USDC, AUDD, PYUSD, USDG). A
   * currency with no mint here cannot be verified, so it cannot be paid in.
   * Operator configuration only.
   */
  paymentMints?: Record<string, string>;
  /**
   * Treasury owner address for the protocol fee on per-call payments. When set,
   * challenges state the fee split and real receipts must include the fee
   * transfer. Operator configuration only.
   */
  protocolFeeTreasury?: string;
  /**
   * Per-token price for metered calls, in the profile's currency, overriding
   * the profile's own `meteredPrice`, and the escrow program the buyer locks
   * the maximum in. A price (from either) and the program are needed, with a
   * settle signer in `RuntimeDeps`, before metered payment is offered.
   * Operator configuration only.
   */
  meteredPrice?: PerTokenPrice;
  escrowProgramId?: string;
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
