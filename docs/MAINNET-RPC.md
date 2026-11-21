# Mainnet RPC (Helius)

Owner decision, 21 November 2026: the mainnet RPC provider is Helius. The API key lives in
1Password and is never committed, logged or built into a browser bundle.

| Variable | Where | Value |
|---|---|---|
| `SOLANA_RPC_URL` | Vercel, Production, **Sensitive** | `https://mainnet.helius-rpc.com/?api-key=<key>` |
| `NEXT_PUBLIC_RPC_ENDPOINT` | Vercel, Production | `https://app.agent-protocol.reddi.tech/api/rpc` |
| `RPC_PROXY_ALLOWED_ORIGINS` | optional | extra page origins, comma separated |

- Server code reads the keyed URL through `serverRpcEndpoint()` (`lib/rpc/server-rpc.ts`). It refuses a
  non-https URL, and `describeRpcEndpoint()` gives the host only for messages and logs.
- Browsers call `POST /api/rpc` (`app/api/rpc/route.ts`). The proxy takes calls only from the app's own
  origin, forwards only the methods in `ALLOWED_RPC_METHODS` (`lib/rpc/proxy.ts`), limits
  `getProgramAccounts` to the app's programs, caps body (64 KiB) and batch (20) size, and returns
  plain errors that never name the upstream.
- Websocket subscriptions are not proxied. `WalletProvider` passes the profile's public `rpcWs`
  explicitly, so web3.js does not derive a websocket URL from the proxy path.
- Without `SOLANA_RPC_URL` the server falls back to the profile RPC, so devnet keeps working unchanged.

Rate limiting for `/api/rpc` belongs in the Vercel firewall (a rate-limit rule on the path) before launch.
