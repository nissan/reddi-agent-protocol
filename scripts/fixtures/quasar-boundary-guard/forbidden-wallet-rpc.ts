import { Connection, Keypair } from "@solana/web3.js";

export async function unsafeProbe(secret: Uint8Array): Promise<number> {
  const signer = Keypair.fromSecretKey(secret);
  const connection = new Connection("https://api.devnet.solana.com");
  return connection.getBalance(signer.publicKey);
}
