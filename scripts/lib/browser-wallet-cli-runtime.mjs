const MINIMUM_BROWSER_WALLET_NODE = Object.freeze({ major: 22, minor: 18, patch: 0 });

/**
 * Browser-wallet source CLIs rely on Node's default TypeScript stripping and synchronous module
 * loader hooks. Node 22.18.0 is the first maintenance release where the required native TypeScript
 * execution is enabled by default without the experimental warning. The repository-local runtime
 * remains pinned separately in .mise.toml; this is only a minimum compatibility check, so newer
 * compatible Node releases are not rejected.
 */
export function isBrowserWalletNodeVersionSupported(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|\+)/.exec(version);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  const minimum = [MINIMUM_BROWSER_WALLET_NODE.major, MINIMUM_BROWSER_WALLET_NODE.minor, MINIMUM_BROWSER_WALLET_NODE.patch];
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

export async function loadBrowserWalletRegisterHooks() {
  if (!isBrowserWalletNodeVersionSupported(process.versions.node)) {
    throw new Error("browser-wallet safety CLIs require Node >=22.18.0 with native TypeScript stripping and module.registerHooks");
  }
  const moduleApi = await import("node:module");
  if (process.features?.typescript !== "strip" || typeof moduleApi.registerHooks !== "function") {
    throw new Error("browser-wallet safety CLIs require native TypeScript stripping and module.registerHooks");
  }
  return moduleApi.registerHooks;
}
