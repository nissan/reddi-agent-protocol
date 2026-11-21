import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isValidSolanaPublicKey } from "@redditech/x402-solana";
import { specialistProfiles } from "../src/profiles/index.js";

test("public wallet manifest matches all profiles and contains no secrets", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/wallet-manifest.json", `file://${process.cwd()}/tests/`), "utf8"));
  assert.equal(manifest.network, "solana-devnet");
  assert.equal(manifest.profiles.length, specialistProfiles.length);

  for (const [index, manifestProfile] of manifest.profiles.entries()) {
    const profile = specialistProfiles[index];
    assert.equal(manifestProfile.profileId, profile.id);
    assert.equal(manifestProfile.displayName, profile.displayName);
    assert.equal(manifestProfile.publicKey, profile.walletAddress);
    assert.ok(isValidSolanaPublicKey(manifestProfile.publicKey));
    assert.equal(manifestProfile.signerProvenance?.sourceEnv, "OPENROUTER_SPECIALIST_SIGNER_KEYPAIRS_JSON");
    assert.equal(manifestProfile.signerProvenance?.derivedFromSigner, true);
    assert.equal(manifestProfile.privateKey, undefined);
    assert.equal(manifestProfile.secretKey, undefined);
    assert.equal(manifestProfile.mnemonic, undefined);
  }
});
