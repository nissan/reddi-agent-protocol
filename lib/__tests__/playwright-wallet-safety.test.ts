import {
  PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE,
  checkPlaywrightWalletSignerPreflight,
  checkPlaywrightWalletSignerSubmissionRpc,
} from "@/lib/wallet/playwright-wallet-safety";
import { PlaywrightWalletAdapter } from "@/lib/wallet/playwright-wallet-adapter";

describe("Playwright wallet signer safety", () => {
  it("allows ordinary mock wallet mode without a public signer secret on any profile", () => {
    const result = checkPlaywrightWalletSignerPreflight({
      secretPresent: false,
      networkProfileName: "devnet",
      rpcHttp: "https://api.devnet.solana.com",
    });

    expect(result.ok).toBe(true);
    expect(result.code).toBe("no_secret_configured");
  });

  it("rejects the public-prefixed signer secret before parsing when profile is not local-surfpool", async () => {
    const rawSecret = "DO_NOT_ECHO_PLAYWRIGHT_SIGNER_TEST_SENTINEL";
    const adapter = new PlaywrightWalletAdapter({
      networkProfileName: "devnet",
      rpcHttp: "https://api.devnet.solana.com",
      signerSecretJson: rawSecret,
    });

    await expect(adapter.connect()).rejects.toThrow(PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE);
    await expect(adapter.connect()).rejects.not.toThrow(rawSecret);
  });

  it("rejects the public-prefixed signer secret on local-surfpool when HTTP or WS is not loopback", () => {
    const http = checkPlaywrightWalletSignerPreflight({
      secretPresent: true,
      networkProfileName: "local-surfpool",
      rpcHttp: "https://api.devnet.solana.com",
      rpcWs: "ws://127.0.0.1:19000",
    });
    const ws = checkPlaywrightWalletSignerPreflight({
      secretPresent: true,
      networkProfileName: "local-surfpool",
      rpcHttp: "http://127.0.0.1:18999",
      rpcWs: "wss://api.devnet.solana.com",
    });

    expect(http).toEqual({ ok: false, code: "rpc_not_loopback", message: PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE });
    expect(ws).toEqual({ ok: false, code: "websocket_not_loopback", message: PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE });
  });

  it("allows signer parsing only after the effective profile and endpoints are local loopback", () => {
    const result = checkPlaywrightWalletSignerPreflight({
      secretPresent: true,
      networkProfileName: "local-surfpool",
      rpcHttp: "http://127.0.0.1:18999",
      rpcWs: "ws://localhost:19000",
    });

    expect(result.ok).toBe(true);
    expect(result.code).toBe("allowed_local_surfpool_loopback");
  });

  it("rejects a caller connection that differs from the approved loopback RPC before signer use", () => {
    const remote = checkPlaywrightWalletSignerSubmissionRpc({
      secretPresent: true,
      networkProfileName: "local-surfpool",
      rpcHttp: "http://127.0.0.1:18999",
      rpcWs: "ws://localhost:19000",
      submissionRpcHttp: "https://rpc.provider.example/v1/cluster",
    });
    const otherLoopback = checkPlaywrightWalletSignerSubmissionRpc({
      secretPresent: true,
      networkProfileName: "local-surfpool",
      rpcHttp: "http://127.0.0.1:18999",
      rpcWs: "ws://localhost:19000",
      submissionRpcHttp: "http://127.0.0.1:19001",
    });

    expect(remote).toEqual({ ok: false, code: "submission_rpc_mismatch", message: PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE });
    expect(otherLoopback).toEqual({ ok: false, code: "submission_rpc_mismatch", message: PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE });
  });

  it("refuses a mismatched caller endpoint before parsing, signing, serializing, or sending", async () => {
    const transaction = { serialize: jest.fn(() => { throw new Error("serialize effect reached"); }) };
    const connection = {
      rpcEndpoint: "http://127.0.0.1:19001",
      sendRawTransaction: jest.fn(() => { throw new Error("send effect reached"); }),
    };
    const adapter = new PlaywrightWalletAdapter({
      networkProfileName: "local-surfpool",
      rpcHttp: "http://127.0.0.1:18999",
      rpcWs: "ws://127.0.0.1:19000",
      signerSecretJson: "SYNTHETIC_INVALID_NON_KEYPAIR_SENTINEL",
    });

    await expect(adapter.sendTransaction(transaction as never, connection as never)).rejects.toThrow(PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE);
    expect(transaction.serialize).not.toHaveBeenCalled();
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();

    const inertAdapter = new PlaywrightWalletAdapter({
      networkProfileName: "local-surfpool",
      rpcHttp: "http://127.0.0.1:18999",
      rpcWs: "ws://127.0.0.1:19000",
      signerSecretJson: "",
    });
    const inertConnection = { rpcEndpoint: "http://127.0.0.1:18999", sendRawTransaction: jest.fn() };
    await expect(inertAdapter.sendTransaction(transaction as never, inertConnection as never)).resolves.toBe("playwright-mock-signature");
    expect(transaction.serialize).not.toHaveBeenCalled();
    expect(inertConnection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("emits the same effective build profile that the signer guard validates", async () => {
    const previous = { ...process.env };
    jest.resetModules();
    process.env.NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY = "presence-only-test-sentinel";
    process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE = "local-surfpool";
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "http://127.0.0.1:18999";
    process.env.NEXT_PUBLIC_RPC_WS_ENDPOINT = "ws://127.0.0.1:19000";
    delete process.env.NETWORK_PROFILE;
    try {
      const config = (await import("../../next.config")).default;
      expect(config.env?.NEXT_PUBLIC_BUILD_NETWORK_PROFILE).toBe("local-surfpool");
    } finally {
      process.env = previous;
      jest.resetModules();
    }
  });
});
