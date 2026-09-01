import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDD_DECIMALS,
  AUDD_DETERMINISTIC_FIXTURE_MINT,
  AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
  AUDD_RAIL_CONFIG,
  SOLANA_DEVNET_CAIP2,
  SOLANA_MAINNET_BETA_CAIP2,
  SPL_TOKEN_PROGRAM_ID,
  validateAuddRailIdentity,
} from '../dist/index.js';

describe('AUDD rail configuration and identity validation', () => {
  it('records the verified official Solana mainnet AUDD identity without enabling mainnet by default', () => {
    const mainnet = AUDD_RAIL_CONFIG.environments['mainnet-gated'];

    assert.equal(AUDD_RAIL_CONFIG.schemaVersion, 'reddi.audd-rail-config.v1');
    assert.equal(AUDD_RAIL_CONFIG.decimals, AUDD_DECIMALS);
    assert.equal(mainnet.mint, AUDD_OFFICIAL_SOLANA_MAINNET_MINT);
    assert.equal(mainnet.tokenProgram, SPL_TOKEN_PROGRAM_ID);
    assert.equal(mainnet.decimals, 6);
    assert.equal(mainnet.caip2, SOLANA_MAINNET_BETA_CAIP2);
    assert.equal(mainnet.defaultEnabled, false);
    assert.equal(mainnet.grantEligibility, 'pending_partner_acceptance');
    assert.ok(mainnet.provenance.some((item) => item.confidence === 'verified-public-mainnet'));
    assert.ok(mainnet.activationRequires?.some((item) => item.includes('separate exact captain approval')));
    for (const environment of Object.values(AUDD_RAIL_CONFIG.environments)) {
      for (const provenance of environment.provenance) {
        assert.equal(provenance.sources.some((source) => source.startsWith('/home/')), false);
      }
    }

    const result = validateAuddRailIdentity({
      environment: 'mainnet-gated',
      network: 'solana-mainnet-beta',
      caip2: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: 6,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reasonCodes.includes('mainnet_audd_disabled_by_default'));
      assert.equal(result.identity?.mint, AUDD_OFFICIAL_SOLANA_MAINNET_MINT);
    }
  });

  it('classifies deterministic fixture AUDD separately from any official devnet mint', () => {
    const result = validateAuddRailIdentity({
      environment: 'deterministic-fixture',
      network: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: 6,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.identity.defaultEnabled, true);
      assert.equal(result.identity.evidenceEnvironment, 'deterministic-fixture');
      assert.equal(result.identity.grantEligibility, 'non_eligible');
      assert.match(result.identity.notes.join(' '), /not a devnet settlement asset/);
    }
  });

  it('keeps Solana devnet AUDD explicitly unverified and blocked with no invented mint', () => {
    const devnet = AUDD_RAIL_CONFIG.environments['devnet-unverified'];
    assert.deepEqual(devnet.mints, []);
    assert.equal(devnet.defaultEnabled, false);

    const result = validateAuddRailIdentity({
      environment: 'devnet-unverified',
      network: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      mint: 'AnyDevnetMintWouldNeedPartnerEvidence111111111',
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: 6,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.reasonCodes, ['devnet_unverified_blocked']);
      assert.match(result.auditNotes.join(' '), /no official AUDD devnet mint/i);
    }
  });

  it('accepts generated local test mints but rejects official or fixture mints in that slot', () => {
    const local = validateAuddRailIdentity({
      environment: 'local-test-mint',
      mint: 'LocalGeneratedAuddTestMint1111111111111111111',
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: 6,
    });
    assert.equal(local.ok, true);

    for (const mint of [AUDD_OFFICIAL_SOLANA_MAINNET_MINT, AUDD_DETERMINISTIC_FIXTURE_MINT]) {
      const result = validateAuddRailIdentity({
        environment: 'local-test-mint',
        mint,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.reasonCodes.includes('wrong_mint'));
    }
  });

  it('fails closed for wrong mint, token program, decimals, and network identity', () => {
    const wrongMint = validateAuddRailIdentity({
      environment: 'mainnet-gated',
      network: 'solana-mainnet-beta',
      caip2: SOLANA_MAINNET_BETA_CAIP2,
      mint: 'SpoofedAUDDMint1111111111111111111111111111',
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: 6,
      enableGatedMainnet: true,
    });
    assert.equal(wrongMint.ok, false);
    if (!wrongMint.ok) assert.ok(wrongMint.reasonCodes.includes('wrong_mint'));

    const wrongProgram = validateAuddRailIdentity({
      environment: 'mainnet-gated',
      network: 'solana-mainnet-beta',
      caip2: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: 'Token2022WrongForAUDDFixture111111111111111111',
      decimals: 6,
      enableGatedMainnet: true,
    });
    assert.equal(wrongProgram.ok, false);
    if (!wrongProgram.ok) assert.ok(wrongProgram.reasonCodes.includes('wrong_token_program'));

    const wrongDecimals = validateAuddRailIdentity({
      environment: 'mainnet-gated',
      network: 'solana-mainnet-beta',
      caip2: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: 9,
      enableGatedMainnet: true,
    });
    assert.equal(wrongDecimals.ok, false);
    if (!wrongDecimals.ok) assert.ok(wrongDecimals.reasonCodes.includes('wrong_decimals'));

    const wrongNetwork = validateAuddRailIdentity({
      environment: 'mainnet-gated',
      network: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: 6,
      enableGatedMainnet: true,
    });
    assert.equal(wrongNetwork.ok, false);
    if (!wrongNetwork.ok) {
      assert.ok(wrongNetwork.reasonCodes.includes('wrong_network'));
      assert.ok(wrongNetwork.reasonCodes.includes('wrong_caip2_network'));
    }
  });
});
