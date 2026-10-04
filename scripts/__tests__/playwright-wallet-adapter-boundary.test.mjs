import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const walletBaseStub = `data:text/javascript,${encodeURIComponent(`
  export class BaseMessageSignerWalletAdapter { emit() {} }
  export class WalletName {}
  export const WalletReadyState = { Installed: "Installed" };
`)}`;
const web3Stub = `data:text/javascript,${encodeURIComponent(`
  export class Connection {}
  export class PublicKey { constructor(value) { this.value = value; } }
  export class SendOptions {}
  export class TransactionSignature {}
  export class Transaction {}
  export class VersionedTransaction {}
  export class Keypair {
    static fromSecretKey() { throw new Error("synthetic key parsing effect reached"); }
  }
`)}`;

function sourceCandidate(path) {
  for (const candidate of [path, `${path}.ts`, path.endsWith(".js") ? path.replace(/\.js$/, ".ts") : null].filter(Boolean)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@solana/wallet-adapter-base") return { url: walletBaseStub, shortCircuit: true };
    if (specifier === "@solana/web3.js") return { url: web3Stub, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const target = sourceCandidate(resolvePath(root, specifier.slice(2)));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const target = sourceCandidate(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { PlaywrightWalletAdapter } = await import("../../lib/wallet/playwright-wallet-adapter.ts");
const { PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE } = await import("../../lib/wallet/playwright-wallet-safety.ts");

test("real adapter refuses mismatched caller HTTP before parse, sign, serialize, or send effects", async () => {
  let serializeCalls = 0;
  let sendCalls = 0;
  const transaction = { serialize() { serializeCalls += 1; throw new Error("serialize effect reached"); } };
  const connection = {
    rpcEndpoint: "http://127.0.0.1:19001",
    sendRawTransaction() { sendCalls += 1; throw new Error("send effect reached"); },
  };
  const adapter = new PlaywrightWalletAdapter({
    networkProfileName: "local-surfpool",
    rpcHttp: "http://127.0.0.1:18999",
    rpcWs: "ws://127.0.0.1:19000",
    signerSecretJson: "SYNTHETIC_INVALID_NON_KEYPAIR_SENTINEL",
  });

  await assert.rejects(
    adapter.sendTransaction(transaction, connection),
    (error) => error instanceof Error && error.message === PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE,
  );
  assert.equal(serializeCalls, 0);
  assert.equal(sendCalls, 0);

  const inertAdapter = new PlaywrightWalletAdapter({
    networkProfileName: "local-surfpool",
    rpcHttp: "http://127.0.0.1:18999",
    rpcWs: "ws://127.0.0.1:19000",
    signerSecretJson: "",
  });
  assert.equal(await inertAdapter.sendTransaction(transaction, {
    rpcEndpoint: "http://127.0.0.1:18999",
    sendRawTransaction() { sendCalls += 1; },
  }), "playwright-mock-signature");
  assert.equal(serializeCalls, 0);
  assert.equal(sendCalls, 0);
});
