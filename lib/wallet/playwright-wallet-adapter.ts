import {
  BaseMessageSignerWalletAdapter,
  WalletName,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import {
  Connection,
  Keypair,
  PublicKey,
  SendOptions,
  Transaction,
  TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";
import { checkPlaywrightWalletSignerPreflight } from "@/lib/wallet/playwright-wallet-safety";

export const PLAYWRIGHT_WALLET_NAME = "Playwright Wallet" as WalletName<"Playwright Wallet">;

const DEFAULT_PLAYWRIGHT_PUBLIC_KEY = "11111111111111111111111111111111";

export type PlaywrightWalletAdapterOptions = {
  networkProfileName?: string;
  rpcHttp?: string;
  rpcWs?: string;
  publicKey?: string;
  signerSecretJson?: string;
};

function parsePlaywrightSigner(raw: string): Keypair {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      throw new Error("invalid_byte_array");
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch {
    throw new Error("Playwright wallet signer secret could not be parsed as disposable local-only key material");
  }
}

export class PlaywrightWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = PLAYWRIGHT_WALLET_NAME;
  url = "https://agent-protocol.reddi.tech";
  icon =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' rx='12' fill='%23111827'/%3E%3Cpath d='M18 46V18h14c8 0 14 6 14 14s-6 14-14 14H18zm8-8h6c3.3 0 6-2.7 6-6s-2.7-6-6-6h-6v12z' fill='%239945FF'/%3E%3C/svg%3E";

  readonly supportedTransactionVersions = new Set(["legacy", 0] as const);
  private _publicKey: PublicKey | null = null;
  private _connected = false;
  private _connecting = false;
  private _signer: Keypair | undefined;
  private readonly options: PlaywrightWalletAdapterOptions;

  constructor(options: PlaywrightWalletAdapterOptions = {}) {
    super();
    this.options = {
      ...options,
      signerSecretJson: options.signerSecretJson ?? process.env.NEXT_PUBLIC_PLAYWRIGHT_WALLET_SECRET_KEY,
      publicKey: options.publicKey ?? process.env.NEXT_PUBLIC_PLAYWRIGHT_WALLET_PUBLIC_KEY,
    };
  }

  get publicKey() {
    return this._publicKey;
  }

  get connected() {
    return this._connected;
  }

  get connecting() {
    return this._connecting;
  }

  get readyState() {
    return WalletReadyState.Installed;
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._connecting = true;
    try {
      const signer = this.loadSignerIfConfigured();
      this._publicKey = signer?.publicKey ?? new PublicKey(this.options.publicKey ?? DEFAULT_PLAYWRIGHT_PUBLIC_KEY);
      this._connected = true;
      this.emit("connect", this._publicKey);
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._connected = false;
    this._publicKey = null;
    this.emit("disconnect");
  }

  async sendTransaction(
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendOptions
  ): Promise<TransactionSignature> {
    const signer = this.loadSignerIfConfigured();
    if (signer) {
      if (transaction instanceof VersionedTransaction) {
        transaction.sign([signer]);
      } else {
        transaction.partialSign(signer);
      }

      const raw = transaction.serialize();
      return connection.sendRawTransaction(raw, options);
    }

    return "playwright-mock-signature";
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    this.assertSignerBoundaryIfConfigured();
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    this.assertSignerBoundaryIfConfigured();
    return transactions;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    this.assertSignerBoundaryIfConfigured();
    return message;
  }

  private assertSignerBoundaryIfConfigured(): void {
    const raw = this.options.signerSecretJson;
    const preflight = checkPlaywrightWalletSignerPreflight({
      secretPresent: typeof raw === "string" && raw.length > 0,
      networkProfileName: this.options.networkProfileName,
      rpcHttp: this.options.rpcHttp,
      rpcWs: this.options.rpcWs,
    });
    if (!preflight.ok) throw new Error(preflight.message);
  }

  private loadSignerIfConfigured(): Keypair | null {
    const raw = this.options.signerSecretJson;
    if (!raw) return null;
    const preflight = checkPlaywrightWalletSignerPreflight({
      secretPresent: true,
      networkProfileName: this.options.networkProfileName,
      rpcHttp: this.options.rpcHttp,
      rpcWs: this.options.rpcWs,
    });
    if (!preflight.ok) throw new Error(preflight.message);
    if (this._signer === undefined) this._signer = parsePlaywrightSigner(raw);
    return this._signer;
  }
}
