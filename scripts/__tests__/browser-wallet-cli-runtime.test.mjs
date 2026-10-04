import assert from "node:assert/strict";
import test from "node:test";
import {
  isBrowserWalletNodeVersionSupported,
  loadBrowserWalletRegisterHooks,
} from "../lib/browser-wallet-cli-runtime.mjs";

test("browser-wallet CLI runtime comparator accepts the capability floor and newer releases", () => {
  for (const version of ["22.18.0", "22.18.1", "23.0.0", "24.20.0", "26.0.0"]) {
    assert.equal(isBrowserWalletNodeVersionSupported(version), true, version);
  }
});

test("browser-wallet CLI runtime comparator rejects older, prerelease-floor, and malformed releases", () => {
  for (const version of ["20.20.0", "22.17.9", "22.18", "v24.20.0", "not-a-version"]) {
    assert.equal(isBrowserWalletNodeVersionSupported(version), false, version);
  }
});

test("actual runtime exposes the required native TypeScript and registerHooks capabilities", async () => {
  const registerHooks = await loadBrowserWalletRegisterHooks();
  assert.equal(typeof registerHooks, "function");
  assert.equal(process.features?.typescript, "strip");
});
