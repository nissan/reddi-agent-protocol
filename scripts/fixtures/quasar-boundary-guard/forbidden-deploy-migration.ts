export const releaseRunbook = {
  command: "solana program deploy target/deploy/quasar_registry.so",
  rollback: "anchor migrate --provider.cluster devnet",
};
