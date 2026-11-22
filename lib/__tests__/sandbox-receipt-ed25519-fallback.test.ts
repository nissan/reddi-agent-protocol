/**
 * A browser without Ed25519 in WebCrypto (Chrome before 137, e.g. older Android Chrome and
 * some in-app wallet browsers) must still verify a valid sandbox receipt, and still refuse a
 * tampered one. Found on the /try Solflare run of 22 November 2026 (Android Chrome 124).
 */
import { canonicalizeSandboxReceipt, sandboxReceiptSignatureValid, type SandboxReceipt } from "@/lib/sandbox/receipt";
import { sandboxProviderAddress, signAsSandboxProvider } from "@/lib/sandbox/keys";

async function signedReceipt(): Promise<SandboxReceipt> {
  const receipt = {
    schemaVersion: "rap.sandbox.simulated.v1",
    providerId: await sandboxProviderAddress("swift-infer"),
    declaredModel: "swift-infer-1",
    requestHash: "a".repeat(64),
    responseHash: "b".repeat(64),
  } as unknown as SandboxReceipt["receipt"];
  const { signature } = await signAsSandboxProvider("swift-infer", canonicalizeSandboxReceipt(receipt));
  return { receipt, proof: { type: "ed25519", signature } } as unknown as SandboxReceipt;
}

describe("sandbox receipt signature without Ed25519 in WebCrypto", () => {
  const subtle = globalThis.crypto.subtle;
  const realImport = subtle.importKey.bind(subtle);
  let spy: jest.SpyInstance | undefined;

  afterEach(() => spy?.mockRestore());

  function withoutEd25519Verify() {
    spy = jest.spyOn(subtle, "importKey").mockImplementation(((format: string, keyData: BufferSource, algorithm: AlgorithmIdentifier, extractable: boolean, usages: KeyUsage[]) => {
      const name = typeof algorithm === "string" ? algorithm : algorithm.name;
      if (format === "raw" && name === "Ed25519") return Promise.reject(new DOMException("Algorithm: Unrecognized name", "NotSupportedError"));
      return realImport(format as "raw", keyData, algorithm, extractable, usages);
    }) as typeof subtle.importKey);
  }

  it("verifies a valid receipt with the fallback", async () => {
    const value = await signedReceipt();
    expect(await sandboxReceiptSignatureValid(value)).toBe(true);
    withoutEd25519Verify();
    expect(await sandboxReceiptSignatureValid(value)).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it("still refuses a tampered receipt with the fallback", async () => {
    const value = await signedReceipt();
    withoutEd25519Verify();
    const tampered = { ...value, receipt: { ...value.receipt, responseHash: "c".repeat(64) } } as SandboxReceipt;
    expect(await sandboxReceiptSignatureValid(tampered)).toBe(false);
  });
});
