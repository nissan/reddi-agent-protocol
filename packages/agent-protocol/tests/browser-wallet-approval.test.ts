import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDD_DETERMINISTIC_FIXTURE_MINT,
  AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
  BROWSER_WALLET_APPROVAL_SCHEMA_VERSION,
  BROWSER_WALLET_IDENTITY_COPY_GUARD_SCHEMA_VERSION,
  DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT,
  SOLANA_DEVNET_CAIP2,
  SOLANA_MAINNET_BETA_CAIP2,
  SPL_TOKEN_PROGRAM_ID,
  validateBrowserWalletApprovalRecord,
  validateBrowserWalletIdentityCopyClaims,
  validateBrowserWalletTier1LocalHarnessContract,
  type BrowserWalletApprovalValidationErrorCode,
  type BrowserWalletApprovalValidationOptions,
  type BrowserWalletIdentityCopyGuardInput,
  type BrowserWalletSingleUseApprovalRecord,
} from '../dist/index.js';

const NOW = '2026-09-03T12:30:00.000Z';
const DEVNET_PROGRAM_ID = '794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD';
const WALLET_PUBLIC_KEY = 'So11111111111111111111111111111111111111112';
const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const VALIDATION_OPTIONS: BrowserWalletApprovalValidationOptions = {
  now: NOW,
  trustedDevnetProgramIds: {
    escrow: DEVNET_PROGRAM_ID,
    registry: DEVNET_PROGRAM_ID,
    reputation: DEVNET_PROGRAM_ID,
    attestation: DEVNET_PROGRAM_ID,
  },
};

function validApproval(overrides: Partial<BrowserWalletSingleUseApprovalRecord> = {}): BrowserWalletSingleUseApprovalRecord {
  return {
    schemaVersion: BROWSER_WALLET_APPROVAL_SCHEMA_VERSION,
    status: 'approved',
    approvalId: 'browser-wallet-approval:phantom-devnet-connect-20260903',
    approver: 'captain-reviewer',
    approvedAt: '2026-09-03T12:00:00.000Z',
    expiresAt: '2026-09-03T14:00:00.000Z',
    usage: {
      scope: 'single-use',
      approvedUseCount: 1,
      consumedUseCount: 0,
      nonce: 'browser-wallet-nonce:phantom-devnet-connect-20260903',
      reusePolicy: 'fresh-approval-required',
    },
    provider: {
      name: 'Phantom',
      version: '25.16.0',
      source: {
        kind: 'official-docs',
        url: 'https://docs.phantom.com/developer-powertools/testnet-mode',
        retrievedAt: '2026-09-03T11:00:00.000Z',
      },
      devnetSupport: 'verified-official-docs',
    },
    browserProfile: {
      id: 'browser-profile:phantom-devnet-manual-20260903',
      isolation: 'dedicated-disposable',
      syncDisabled: true,
      primaryProfile: false,
      onlyApprovedExtension: 'Phantom',
      automatedExtensionInstall: false,
      deleteAfterRun: true,
    },
    wallet: {
      publicKey: WALLET_PUBLIC_KEY,
      secretMaterial: false,
      productionSeedImported: false,
      custody: 'human-controlled-devnet-only',
    },
    network: {
      rapAlias: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      cluster: 'devnet',
      rpcHttp: 'https://api.devnet.solana.com',
      rpcWs: 'wss://api.devnet.solana.com',
    },
    uiAction: {
      route: '/register',
      action: 'connect-only',
      executionMode: 'manual-human-browser-wallet',
      defaultOff: true,
      exactOnce: true,
      devnetActionAvailableByDefault: false,
    },
    programs: {
      target: 'legacy-anchor',
      framework: 'anchor',
      source: 'resolved-network-profile',
      ids: {
        escrow: DEVNET_PROGRAM_ID,
        registry: DEVNET_PROGRAM_ID,
        reputation: DEVNET_PROGRAM_ID,
        attestation: DEVNET_PROGRAM_ID,
      },
      submissionReady: true,
    },
    funding: {
      source: 'human-capped-devnet',
      sourceRef: 'human-funding-approval:devnet-sol-cap',
      humanApproved: true,
      aiFaucetUse: false,
      autoTopUp: false,
      maxBalanceSol: 0.05,
    },
    caps: {
      perActionBaseUnits: '0',
      perSessionBaseUnits: '0',
      maxFeeLamports: '0',
      maxActions: 1,
    },
    retryPolicy: {
      allowed: false,
      maxRetries: 0,
      countsAgainstCaps: true,
    },
    asset: {
      symbol: 'SOL',
      railEnvironment: 'devnet-unverified',
      mint: null,
      tokenProgram: null,
      decimals: 9,
      source: 'devnet-sol-fee',
      official: false,
    },
    evidence: {
      destination: 'artifacts/browser-wallet-devnet/phantom-connect-20260903/evidence.json',
      redaction: {
        privateKeys: 'forbidden',
        seedPhrases: 'forbidden',
        signerArrays: 'forbidden',
        authHeaders: 'redact',
        cookies: 'redact',
        rawPaymentPayloads: 'redact',
        screenshots: 'redacted-only',
        includePublicKey: true,
        includeSignatures: 'devnet-only',
      },
    },
    rollback: {
      owner: 'captain-reviewer',
      disconnectRevoke: true,
      deleteBrowserProfile: true,
      deleteLocalState: true,
      preserveRedactedEvidence: true,
      incidentSuspend: true,
      freshApprovalRequired: true,
    },
    boundaries: {
      noMainnet: true,
      noProduction: true,
      noCustody: true,
      noSettlementFinality: true,
      noOfficialAuddDevnet: true,
      noLiveFunds: true,
      noAiFaucet: true,
      noPayShProduction: true,
      noAutomaticTopUp: true,
    },
    ...overrides,
  };
}

function codes(record: unknown): BrowserWalletApprovalValidationErrorCode[] {
  const result = validateBrowserWalletApprovalRecord(record, VALIDATION_OPTIONS);
  assert.equal(result.ok, false);
  return result.errors.map((entry) => entry.code);
}

function safeCopyRow(overrides: Partial<BrowserWalletIdentityCopyGuardInput> = {}): BrowserWalletIdentityCopyGuardInput {
  return {
    schemaVersion: BROWSER_WALLET_IDENTITY_COPY_GUARD_SCHEMA_VERSION,
    railEnvironment: 'local-test-mint',
    assetLabel: 'AUDD_TEST',
    networkAlias: 'local-surfpool',
    caip2: null,
    mint: 'LocalGeneratedMintPlaceholder11111111111111111',
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    decimals: 6,
    observationSource: 'local-validator',
    grantEligibility: 'non_eligible',
    x402Export: {
      state: 'expected',
      asset: 'AUDD_TEST',
      networkAlias: 'local-surfpool',
      caip2: null,
      mint: 'LocalGeneratedMintPlaceholder11111111111111111',
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: 6,
    },
    policy: {
      grantEligibility: 'non_eligible',
      controlledLive: false,
    },
    receipt: {
      claim: 'fixture-only',
      observationStatus: 'not-observed',
      settlementFinality: false,
      controlledLiveEvidence: false,
    },
    copy: {
      title: 'Local AUDD_TEST browser harness contract',
      summary: 'Dormant local-only TransferChecked contract for a per-run six-decimal test mint.',
      badges: ['local-test-mint', 'non_eligible', 'expected-only'],
      notes: ['Local test label only; no Devnet or mainnet settlement claim.'],
    },
    ...overrides,
  };
}

describe('manual Devnet browser-wallet approval schema', () => {
  it('validates a strict single-use Phantom Devnet connect-only approval without enabling execution', () => {
    const result = validateBrowserWalletApprovalRecord(validApproval(), VALIDATION_OPTIONS);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.provider.name, 'Phantom');
      assert.equal(result.record.uiAction.devnetActionAvailableByDefault, false);
      assert.equal(result.record.boundaries.noMainnet, true);
      assert.match(result.warnings.join('\n'), /does not install extensions/);
    }
  });

  it('fails closed for missing, unknown, malformed, and expired approval records', () => {
    const missingProvider = validApproval() as Record<string, unknown>;
    delete missingProvider.provider;
    assert.ok(codes(missingProvider).includes('missing_browser_wallet_approval_field'));

    const unknownTopLevel = { ...validApproval(), surprise: true };
    assert.ok(codes(unknownTopLevel).includes('unknown_browser_wallet_approval_field'));

    const unknownNested = validApproval({ wallet: { ...validApproval().wallet, secretMaterial: false } }) as Record<string, unknown>;
    (unknownNested.wallet as Record<string, unknown>).privateKey = 'DO_NOT_ECHO_TEST_SENTINEL';
    const result = validateBrowserWalletApprovalRecord(unknownNested, VALIDATION_OPTIONS);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((entry) => entry.path === '$.wallet.privateKey'));
      assert.doesNotMatch(JSON.stringify(result.errors), /DO_NOT_ECHO_TEST_SENTINEL/);
    }

    assert.ok(codes(validApproval({ approvedAt: 'not-an-iso-date' })).includes('malformed_browser_wallet_approval'));
    assert.ok(codes(validApproval({ approvedAt: '2026-09-03T12:30:00.001Z' })).includes('contradictory_browser_wallet_approval'));
    assert.ok(codes(validApproval({ expiresAt: '2026-09-03T12:29:59.000Z' })).includes('expired_browser_wallet_approval'));
  });

  it('rejects contradictory approval and source timestamp ordering', () => {
    assert.ok(codes(validApproval({ approvedAt: '2026-09-03T14:00:00.000Z', expiresAt: '2026-09-03T13:00:00.000Z' })).includes('contradictory_browser_wallet_approval'));
    assert.ok(codes(validApproval({ provider: { ...validApproval().provider, source: { ...validApproval().provider.source, retrievedAt: '2026-09-03T12:00:01.000Z' } } })).includes('contradictory_browser_wallet_approval'));
  });

  it('rejects non-single-use, overly broad, and contradictory authority', () => {
    assert.ok(codes(validApproval({ usage: { ...validApproval().usage, consumedUseCount: 1 as 0 } })).includes('non_single_use_browser_wallet_approval'));
    assert.ok(codes(validApproval({ provider: { ...validApproval().provider, version: 'latest' } })).includes('overly_broad_browser_wallet_approval'));
    assert.ok(codes(validApproval({ uiAction: { ...validApproval().uiAction, route: '/*' } })).includes('overly_broad_browser_wallet_approval'));
    assert.ok(codes(validApproval({ evidence: { ...validApproval().evidence, destination: 'artifacts/browser-wallet-devnet/*' } })).includes('overly_broad_browser_wallet_approval'));
    assert.ok(codes(validApproval({ funding: { ...validApproval().funding, maxBalanceSol: 2.5 } })).includes('overly_broad_browser_wallet_approval'));
    assert.ok(codes(validApproval({ caps: { ...validApproval().caps, perActionBaseUnits: '2', perSessionBaseUnits: '1' } })).includes('contradictory_browser_wallet_approval'));
    assert.ok(codes(validApproval({ retryPolicy: { ...validApproval().retryPolicy, maxRetries: 1 } })).includes('contradictory_browser_wallet_approval'));
    assert.ok(codes(validApproval({ browserProfile: { ...validApproval().browserProfile, onlyApprovedExtension: 'Solflare' } })).includes('contradictory_browser_wallet_approval'));
  });

  it('rejects unknown providers, secret/custody material, mainnet, and non-canonical identity drift', () => {
    assert.ok(codes(validApproval({ provider: { ...validApproval().provider, name: 'Solflare' as 'Phantom' } })).includes('unknown_browser_wallet_provider'));
    assert.ok(codes(validApproval({ wallet: { ...validApproval().wallet, publicKey: '11111111111111111111111111111111' } })).includes('non_canonical_browser_wallet_identity'));
    assert.ok(codes(validApproval({ wallet: { ...validApproval().wallet, secretMaterial: true as false } })).includes('secret_material_rejected'));
    assert.ok(codes(validApproval({ wallet: { ...validApproval().wallet, productionSeedImported: true as false } })).includes('secret_material_rejected'));
    assert.ok(codes(validApproval({ browserProfile: { ...validApproval().browserProfile, primaryProfile: true as false } })).includes('custody_browser_wallet_rejected'));
    assert.ok(codes(validApproval({ boundaries: { ...validApproval().boundaries, noSettlementFinality: false as true } })).includes('settlement_finality_rejected'));
    assert.ok(codes(validApproval({ funding: { ...validApproval().funding, aiFaucetUse: true as false } })).includes('ai_faucet_rejected'));

    const mainnet = validApproval({
      network: {
        rapAlias: 'solana-mainnet-beta' as 'solana-devnet',
        caip2: SOLANA_MAINNET_BETA_CAIP2 as typeof SOLANA_DEVNET_CAIP2,
        cluster: 'mainnet-beta' as 'devnet',
        rpcHttp: 'https://api.mainnet-beta.solana.com',
      },
    });
    assert.ok(codes(mainnet).includes('mainnet_browser_wallet_rejected'));

    const nonCanonical = validApproval({
      network: { ...validApproval().network, rapAlias: 'devnet' as 'solana-devnet' },
    });
    assert.ok(codes(nonCanonical).includes('non_canonical_browser_wallet_identity'));

    const quasar = validApproval({ programs: { ...validApproval().programs, target: 'quasar' as 'legacy-anchor', framework: 'quasar' as 'anchor' } });
    assert.ok(codes(quasar).includes('production_browser_wallet_rejected'));

    const mismatchedProgram = validApproval({
      programs: {
        ...validApproval().programs,
        ids: { ...validApproval().programs.ids, registry: WALLET_PUBLIC_KEY },
      },
    });
    const programMismatch = validateBrowserWalletApprovalRecord(mismatchedProgram, VALIDATION_OPTIONS);
    assert.equal(programMismatch.ok, false);
    if (!programMismatch.ok) {
      assert.ok(programMismatch.errors.some((entry) => entry.code === 'non_canonical_browser_wallet_identity' && entry.path === '$.programs.ids.registry'));
    }
    const missingTrustedPrograms = validateBrowserWalletApprovalRecord(validApproval(), { now: NOW });
    assert.equal(missingTrustedPrograms.ok, false);
    if (!missingTrustedPrograms.ok) {
      assert.ok(missingTrustedPrograms.errors.some((entry) => entry.path === '$.programs.ids.escrow'));
    }
  });

  it('keeps Devnet USDC narrow and official AUDD Devnet unavailable by default', () => {
    const usdc = validateBrowserWalletApprovalRecord(validApproval({
      uiAction: { ...validApproval().uiAction, route: '/economic-demo/paid-workflow', action: 'x402-devnet-usdc-payment' },
      caps: { ...validApproval().caps, perActionBaseUnits: '10000', perSessionBaseUnits: '10000', maxFeeLamports: '5000' },
      asset: {
        symbol: 'USDC',
        railEnvironment: 'devnet-unverified',
        mint: USDC_DEVNET_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        source: 'existing-gated-devnet-usdc-lane',
        official: false,
      },
    }), VALIDATION_OPTIONS);
    assert.equal(usdc.ok, true);

    const mainnetUsdc = validateBrowserWalletApprovalRecord(validApproval({
      uiAction: { ...validApproval().uiAction, route: '/economic-demo/paid-workflow', action: 'x402-devnet-usdc-payment' },
      caps: { ...validApproval().caps, perActionBaseUnits: '10000', perSessionBaseUnits: '10000', maxFeeLamports: '5000' },
      asset: {
        symbol: 'USDC',
        railEnvironment: 'devnet-unverified',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        source: 'existing-gated-devnet-usdc-lane',
        official: false,
      },
    }), VALIDATION_OPTIONS);
    assert.equal(mainnetUsdc.ok, false);
    if (!mainnetUsdc.ok) {
      assert.ok(mainnetUsdc.errors.some((entry) => entry.code === 'mainnet_browser_wallet_rejected' && entry.path === '$.asset.mint'));
      assert.ok(mainnetUsdc.errors.some((entry) => entry.code === 'non_canonical_browser_wallet_identity' && entry.path === '$.asset.mint'));
    }

    const wrongUsdcAction = validApproval({
      asset: {
        symbol: 'USDC',
        railEnvironment: 'devnet-unverified',
        mint: USDC_DEVNET_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        source: 'existing-gated-devnet-usdc-lane',
        official: false,
      },
    });
    assert.ok(codes(wrongUsdcAction).includes('contradictory_browser_wallet_approval'));

    const audd = validApproval({
      asset: {
        symbol: 'AUDD',
        railEnvironment: 'devnet-unverified',
        mint: 'AuddDevnetNeedsPartnerConfirmedMint1111111111',
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        source: 'partner-confirmed-audd-devnet',
        official: false,
      },
    });
    assert.ok(codes(audd).includes('official_audd_devnet_unavailable'));

    const partnerConfirmedAudd = validApproval({
      asset: {
        symbol: 'AUDD',
        railEnvironment: 'devnet-unverified',
        mint: USDC_DEVNET_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        source: 'partner-confirmed-audd-devnet',
        official: false,
        auddPartnerConfirmation: {
          sourceUrl: 'https://example.com/audd-devnet-confirmation.json',
          sourceRetrievedAt: '2026-09-03T11:30:00.000Z',
          confirmedMint: USDC_DEVNET_MINT,
          confirmedDecimals: 6,
          confirmedTokenProgram: SPL_TOKEN_PROGRAM_ID,
        },
        auddDevnetApprovalRef: 'audd-devnet-partner-approval:20260903',
      },
    });
    const selfAttestedAudd = validateBrowserWalletApprovalRecord(partnerConfirmedAudd, {
      ...VALIDATION_OPTIONS,
      allowFuturePartnerConfirmedAuddDevnet: true,
    });
    assert.equal(selfAttestedAudd.ok, false);
    if (!selfAttestedAudd.ok) {
      assert.ok(selfAttestedAudd.errors.some((entry) => entry.code === 'official_audd_devnet_unavailable'));
      assert.ok(selfAttestedAudd.errors.some((entry) => entry.code === 'non_canonical_browser_wallet_identity' && entry.path === '$.asset.mint'));
    }

    const untrustedUsdcAsAudd = validateBrowserWalletApprovalRecord(partnerConfirmedAudd, {
      ...VALIDATION_OPTIONS,
      allowFuturePartnerConfirmedAuddDevnet: true,
      trustedFutureAuddDevnetIdentity: {
        approvalRef: 'audd-devnet-partner-approval:20260903',
        sourceUrl: 'https://example.com/audd-devnet-confirmation.json',
        sourceRetrievedAt: '2026-09-03T11:30:00.000Z',
        mint: USDC_DEVNET_MINT,
        decimals: 6,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
      },
    });
    assert.equal(untrustedUsdcAsAudd.ok, false);
    if (!untrustedUsdcAsAudd.ok) {
      assert.ok(untrustedUsdcAsAudd.errors.some((entry) => entry.code === 'non_canonical_browser_wallet_identity' && entry.path === '$.asset.auddPartnerConfirmation.confirmedMint'));
    }

    const mismatchedPartnerConfirmedAudd = validApproval({
      asset: {
        ...partnerConfirmedAudd.asset,
        mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      },
    });
    const mismatch = validateBrowserWalletApprovalRecord(mismatchedPartnerConfirmedAudd, { ...VALIDATION_OPTIONS, allowFuturePartnerConfirmedAuddDevnet: true });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.ok(mismatch.errors.some((entry) => entry.code === 'contradictory_browser_wallet_approval' && entry.path === '$.asset.mint'));

    const mainnetMintOnBothSides = validApproval({
      asset: {
        ...partnerConfirmedAudd.asset,
        mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
        auddPartnerConfirmation: {
          sourceUrl: 'https://example.com/audd-devnet-confirmation.json',
          sourceRetrievedAt: '2026-09-03T11:30:00.000Z',
          confirmedMint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
          confirmedDecimals: 6,
          confirmedTokenProgram: SPL_TOKEN_PROGRAM_ID,
        },
      },
    });
    const mainnetMint = validateBrowserWalletApprovalRecord(mainnetMintOnBothSides, { ...VALIDATION_OPTIONS, allowFuturePartnerConfirmedAuddDevnet: true });
    assert.equal(mainnetMint.ok, false);
    if (!mainnetMint.ok) {
      assert.ok(mainnetMint.errors.some((entry) => entry.code === 'mainnet_browser_wallet_rejected' && entry.path === '$.asset.mint'));
      assert.ok(mainnetMint.errors.some((entry) => entry.code === 'mainnet_browser_wallet_rejected' && entry.path === '$.asset.auddPartnerConfirmation.confirmedMint'));
    }

    const localAuddTest = validApproval({
      asset: {
        symbol: 'AUDD_TEST',
        railEnvironment: 'local-test-mint',
        mint: 'LocalGeneratedMintPlaceholder11111111111111111',
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        source: 'local-test-only',
        official: false,
      },
    });
    assert.ok(codes(localAuddTest).includes('non_canonical_browser_wallet_identity'));
  });
});

describe('dormant Tier 1 local browser harness contract', () => {
  it('validates the built-in local-only contract without creating mint or key material', () => {
    const result = validateBrowserWalletTier1LocalHarnessContract(DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.enabledByDefault, false);
      assert.equal(result.record.network.rapAlias, 'local-surfpool');
      assert.equal(result.record.asset.label, 'AUDD_TEST');
      assert.equal(result.record.asset.mint, null);
      assert.equal(result.record.asset.grantEligibility, 'non_eligible');
      assert.equal(result.record.observation.instruction, 'TransferChecked');
      assert.equal(result.record.observation.expectedTermsAreObservedEvidence, false);
    }
  });

  it('blocks default-on, non-local, official-looking, or finality-claiming Tier 1 contracts', () => {
    for (const bad of [
      { ...DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT, enabledByDefault: true },
      { ...DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT, network: { ...DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT.network, rpcHttp: 'https://api.devnet.solana.com' } },
      { ...DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT, asset: { ...DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT.asset, label: 'AUDD', grantEligibility: 'eligible' } },
      { ...DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT, observation: { ...DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT.observation, expectedTermsAreObservedEvidence: true } },
    ]) {
      const result = validateBrowserWalletTier1LocalHarnessContract(bad);
      assert.equal(result.ok, false);
    }
  });

  it('returns a sanitized blocker instead of throwing when requiredFields is not a list', () => {
    const result = validateBrowserWalletTier1LocalHarnessContract({
      ...DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT,
      observation: { ...DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT.observation, requiredFields: { mint: true } },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((entry) => entry.path === '$.observation.requiredFields'));
    }
  });
});

describe('browser-wallet AUDD identity/copy guard', () => {
  it('accepts safe local AUDD_TEST expected-only copy with canonical x402/policy/receipt identity', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow());
    assert.equal(result.ok, true);
  });

  it('binds every local and Devnet copy row to a complete canonical rail identity', () => {
    for (const [field, value] of [
      ['networkAlias', 'solana-devnet'],
      ['caip2', SOLANA_DEVNET_CAIP2],
      ['mint', null],
      ['tokenProgram', null],
      ['decimals', null],
    ] as const) {
      const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
        [field]: value,
        x402Export: undefined,
      }));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.errors.some((entry) => entry.path === `$.${field}`));
      }
    }

    const wrongDevnetUsdc = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      railEnvironment: 'devnet-unverified',
      assetLabel: 'USDC',
      networkAlias: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      mint: 'UnverifiedDevnetAuddMint11111111111111111',
      observationSource: 'expected-only',
      x402Export: undefined,
    }));
    assert.equal(wrongDevnetUsdc.ok, false);
    if (!wrongDevnetUsdc.ok) {
      assert.ok(wrongDevnetUsdc.errors.some((entry) => entry.path === '$.mint'));
    }

    const usdcMintMislabelledAsAuddTest = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      mint: USDC_DEVNET_MINT,
      x402Export: undefined,
    }));
    assert.equal(usdcMintMislabelledAsAuddTest.ok, false);
    if (!usdcMintMislabelledAsAuddTest.ok) {
      assert.ok(usdcMintMislabelledAsAuddTest.errors.some((entry) => entry.path === '$.mint'));
    }
  });

  it('returns a sanitized blocker instead of throwing when copy badges or notes are not lists', () => {
    for (const copy of [
      { title: 'Local AUDD_TEST row', badges: { leaked: 'sentinel-value' } },
      { title: 'Local AUDD_TEST row', notes: 7 },
    ]) {
      const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({ copy: copy as unknown as BrowserWalletIdentityCopyGuardInput['copy'] }));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.errors.some((entry) => entry.code === 'malformed_browser_wallet_approval' && entry.path.startsWith('$.copy.')));
      }
    }
  });

  it('does not let a non_eligible badge suppress a grant overclaim in another copy clause', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      copy: {
        title: 'This local AUDD_TEST row is grant-eligible for AUDD grant volume',
        summary: 'Local-only expected terms.',
        badges: ['local-test-mint', 'non_eligible', 'expected-only'],
      },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((entry) => entry.code === 'non_canonical_browser_wallet_identity' && entry.path === '$.copy'));
    }
  });

  it('rejects official Solana mainnet mints on every non-live rail, not only local-test-mint', () => {
    for (const railEnvironment of ['local-test-mint', 'devnet-unverified'] as const) {
      for (const [assetLabel, mint] of [['AUDD_TEST', AUDD_OFFICIAL_SOLANA_MAINNET_MINT], ['USDC', MAINNET_USDC_MINT]] as const) {
        const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
          railEnvironment,
          assetLabel,
          networkAlias: railEnvironment === 'devnet-unverified' ? 'solana-devnet' : 'local-surfpool',
          caip2: null,
          mint,
          observationSource: 'expected-only',
          x402Export: undefined,
          copy: undefined,
        }));
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.ok(result.errors.some((entry) => entry.code === 'mainnet_browser_wallet_rejected' && entry.path === '$.mint'));
        }
      }
    }
  });

  it('does not let a bare non_eligible token in the same clause suppress a grant overclaim', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      copy: {
        title: 'grant-eligible (non_eligible)',
        summary: 'Local-only expected terms.',
      },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((entry) => entry.code === 'non_canonical_browser_wallet_identity' && entry.path === '$.copy'));
    }
  });

  it('still accepts a genuine negated grant-eligibility clause', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      copy: {
        title: 'Local AUDD_TEST browser harness contract',
        summary: 'This row is not grant-eligible.',
        badges: ['local-test-mint', 'non_eligible', 'expected-only'],
      },
    }));
    assert.equal(result.ok, true);
  });

  it('rejects official AUDD, grant-eligible, observed-settlement, and controlled-live overclaims for non-live rows', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      grantEligibility: 'eligible',
      policy: { grantEligibility: 'eligible', controlledLive: true },
      receipt: {
        claim: 'observed-settlement',
        observationStatus: 'local-observed',
        settlementFinality: true,
        controlledLiveEvidence: true,
      },
      copy: {
        title: 'official AUDD local test',
        summary: 'grant-eligible observed settlement with controlled-live evidence',
      },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      const resultCodes = result.errors.map((entry) => entry.code);
      assert.ok(resultCodes.includes('official_audd_devnet_unavailable'));
      assert.ok(resultCodes.includes('non_canonical_browser_wallet_identity'));
      assert.ok(resultCodes.includes('settlement_finality_rejected'));
    }
  });

  it('rejects a structurally live row even when its copy carries no forbidden terms', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      railEnvironment: 'controlled-live',
      assetLabel: 'AUDD',
      networkAlias: 'solana-live',
      caip2: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      observationSource: 'parsed-rpc-transaction',
      grantEligibility: 'eligible',
      x402Export: {
        state: 'observed',
        asset: 'AUDD',
        networkAlias: 'solana-live',
        caip2: SOLANA_MAINNET_BETA_CAIP2,
        mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
      },
      policy: { grantEligibility: 'eligible', controlledLive: true },
      receipt: {
        claim: 'observed-settlement',
        observationStatus: 'rpc-observed',
        settlementFinality: false,
        controlledLiveEvidence: true,
      },
      copy: undefined,
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      const resultCodes = result.errors.map((entry) => entry.code);
      assert.ok(resultCodes.includes('mainnet_browser_wallet_rejected'));
      assert.ok(resultCodes.includes('settlement_finality_rejected'));
      assert.ok(resultCodes.includes('non_canonical_browser_wallet_identity'));
    }
  });

  it('refuses to publish expected-only rows as observed receipts', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      railEnvironment: 'devnet-unverified',
      assetLabel: 'AUDD_TEST',
      networkAlias: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      mint: 'UnverifiedDevnetAuddMint11111111111111111',
      observationSource: 'expected-only',
      x402Export: {
        state: 'expected',
        asset: 'AUDD_TEST',
        networkAlias: 'solana-devnet',
        caip2: SOLANA_DEVNET_CAIP2,
        mint: 'UnverifiedDevnetAuddMint11111111111111111',
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
      },
      receipt: {
        claim: 'observed-transfer-checked',
        observationStatus: 'rpc-observed',
        settlementFinality: false,
        controlledLiveEvidence: false,
      },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      const paths = result.errors.filter((entry) => entry.code === 'settlement_finality_rejected').map((entry) => entry.path);
      assert.ok(paths.includes('$.receipt.claim'));
      assert.ok(paths.includes('$.receipt.observationStatus'));
    }
  });

  it('rejects a row that carries the Solana mainnet-beta chain identity', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      railEnvironment: 'devnet-unverified',
      assetLabel: 'AUDD_TEST',
      networkAlias: 'solana-devnet',
      caip2: SOLANA_MAINNET_BETA_CAIP2,
      mint: 'UnverifiedDevnetAuddMint11111111111111111',
      observationSource: 'expected-only',
      x402Export: undefined,
      receipt: { claim: 'expected-only', observationStatus: 'not-observed', settlementFinality: false, controlledLiveEvidence: false },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((entry) => entry.code === 'mainnet_browser_wallet_rejected' && entry.path === '$.caip2'));
    }
  });

  it('rejects a non-string row chain identity', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      caip2: 12345 as unknown as string,
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((entry) => entry.path === '$.caip2'));
    }
  });

  it('refuses an observation source stronger than its rail environment can produce', () => {
    const fixture = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      railEnvironment: 'deterministic-fixture',
      assetLabel: 'AUDD_TEST',
      networkAlias: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
      observationSource: 'parsed-rpc-transaction',
      x402Export: undefined,
      receipt: { claim: 'observed-transfer-checked', observationStatus: 'rpc-observed', settlementFinality: false, controlledLiveEvidence: false },
    }));
    assert.equal(fixture.ok, false);
    if (!fixture.ok) {
      assert.ok(fixture.errors.some((entry) => entry.code === 'settlement_finality_rejected' && entry.path === '$.observationSource'));
    }

    const localMint = validateBrowserWalletIdentityCopyClaims(safeCopyRow({ observationSource: 'parsed-rpc-transaction' }));
    assert.equal(localMint.ok, false);
    if (!localMint.ok) {
      assert.ok(localMint.errors.some((entry) => entry.code === 'settlement_finality_rejected' && entry.path === '$.observationSource'));
    }
  });

  it('keeps controlled-live copy claims prohibited until a future evidence-aware path exists', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      railEnvironment: 'controlled-live',
      assetLabel: 'AUDD',
      networkAlias: 'solana-mainnet-beta',
      caip2: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      observationSource: 'parsed-rpc-transaction',
      grantEligibility: 'eligible',
      x402Export: {
        state: 'observed',
        asset: 'AUDD',
        networkAlias: 'solana-mainnet-beta',
        caip2: SOLANA_MAINNET_BETA_CAIP2,
        mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
      },
      policy: { grantEligibility: 'eligible', controlledLive: true },
      receipt: {
        claim: 'observed-settlement',
        observationStatus: 'rpc-observed',
        settlementFinality: false,
        controlledLiveEvidence: true,
      },
      copy: {
        title: 'Official AUDD controlled-live evidence',
        summary: 'Grant-eligible row with observed settlement.',
      },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      const resultCodes = result.errors.map((entry) => entry.code);
      assert.ok(resultCodes.includes('official_audd_devnet_unavailable'));
      assert.ok(resultCodes.includes('non_canonical_browser_wallet_identity'));
      assert.ok(resultCodes.includes('settlement_finality_rejected'));
    }
  });

  it('keeps deterministic fixtures and unverified Devnet AUDD out of official/live evidence', () => {
    const fixture = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      railEnvironment: 'deterministic-fixture',
      assetLabel: 'AUDD',
      networkAlias: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
      observationSource: 'parsed-transaction-fixture',
      x402Export: {
        state: 'expected',
        asset: 'AUDD',
        networkAlias: 'solana-devnet',
        caip2: SOLANA_DEVNET_CAIP2,
        mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
      },
      receipt: { claim: 'fixture-only', observationStatus: 'fixture-observed', settlementFinality: false, controlledLiveEvidence: false },
    }));
    assert.equal(fixture.ok, true);

    const devnet = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      railEnvironment: 'devnet-unverified',
      assetLabel: 'AUDD',
      networkAlias: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      mint: 'UnverifiedDevnetAuddMint11111111111111111',
      observationSource: 'expected-only',
      x402Export: {
        state: 'observed',
        asset: 'AUDD',
        networkAlias: 'solana-devnet',
        caip2: SOLANA_DEVNET_CAIP2,
        mint: 'UnverifiedDevnetAuddMint11111111111111111',
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
      },
    }));
    assert.equal(devnet.ok, false);
    if (!devnet.ok) {
      assert.ok(devnet.errors.some((entry) => entry.code === 'official_audd_devnet_unavailable'));
      assert.ok(devnet.errors.some((entry) => entry.code === 'settlement_finality_rejected'));
    }
  });

  it('fails when x402 export identity drifts from policy/receipt row identity', () => {
    const result = validateBrowserWalletIdentityCopyClaims(safeCopyRow({
      x402Export: {
        state: 'expected',
        asset: 'AUDD_TEST',
        networkAlias: 'solana-devnet',
        caip2: SOLANA_DEVNET_CAIP2,
        mint: 'DifferentMint1111111111111111111111111111',
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
      },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((entry) => entry.code === 'non_canonical_browser_wallet_identity'));
  });
});
