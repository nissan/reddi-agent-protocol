import { assertNoProviderSecretsOnMainnet } from "./lib/config/mainnet-provider-guard";

/**
 * Runs once when a server instance starts. A mainnet app that carries a provider payee key
 * refuses to start and says why (#1203); next.config.ts refuses the build the same way.
 */
export function register() {
  assertNoProviderSecretsOnMainnet(process.env);
}
