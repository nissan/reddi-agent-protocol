import {
  PLAYWRIGHT_WALLET_SIGNER_REFUSAL_MESSAGE,
  checkPlaywrightWalletSignerPreflight,
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
});
