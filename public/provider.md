---
name: reddi-agent-protocol-provider
description: Set up and run a paid AI inference provider on Reddi Agent Protocol with the @redditech/provider-kit CLI. Put a per-token priced, receipted endpoint in front of any OpenAI-compatible model, describe it in ADL v0.3 and list it. Use when your person wants to sell a model, a specialist or a prompt as a paid service on Solana.
---

# Run a provider on Reddi Agent Protocol

Reddi Agent Protocol (RAP) is an open marketplace for paid AI inference on Solana, built for the Solana Foundation's Request for Startups item "An open marketplace for AI inference". As a provider you bring a model and a Solana wallet. The provider kit puts a paid endpoint in front of the model: buyers pay per token through a metered escrow, and every paid answer carries a `reddi.receipt.v2` receipt signed by your wallet.

The whole provider is one config file (`provider.json`) and one command (`rap-provider`).

## Rules you always follow

1. **Devnet until told otherwise.** Set `"network": "solana-devnet"` unless your person says to use mainnet. Mainnet is coming soon.
2. **Keys stay out of chat and out of files you write.** The wallet keypair lives in the file `keypairPath` names, readable only by its owner (`chmod 600`). Never print, copy or commit it. The upstream model's API key goes in an environment variable (`UPSTREAM_API_KEY` by default), never in `provider.json`.
3. **Dry-run before anything that signs.** Run `rap-provider doctor` and `rap-provider register --dry-run` and show your person the output before `rap-provider register`, which sends a transaction and pays a 0.01 SOL registration fee.
4. **Your person sets the price.** Propose a price per million input and output tokens, with the reasoning, and wait for a yes before you list it.
5. **Do not serve mock answers to paying buyers.** `upstream.mock` is for trying the payment flow; it is refused on mainnet.

## Set up

You need Node 20 or newer and the Solana CLI.

```bash
npm install -g @redditech/provider-kit
rap-provider --help
```

1. **A wallet.** `solana-keygen new --outfile ~/.config/solana/provider.json`. Ask your person to fund its address with 0.5 devnet SOL at https://faucet.solana.com, then create its USDC token account:
   `spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --owner "$(solana address -k ~/.config/solana/provider.json)" --url devnet`
2. **A config.** `rap-provider init --wallet "$(solana address -k ~/.config/solana/provider.json)"`, then set `"keypairPath": "~/.config/solana/provider.json"` in `provider.json`. It starts with mock answers so you can try the payment flow first.
3. **Check it.** `rap-provider doctor` reads only; it sends and spends nothing. It checks the key matches the wallet, the token accounts can receive, and the ADL document passes Level 3.
4. **Serve.** `rap-provider start` (port 8787 by default).
5. **Make a paid call to yourself** with a second devnet wallet: `BUYER_KEYPAIR_PATH=~/.config/solana/buyer.json node packages/provider-kit/examples/paid-call.mjs http://localhost:8787 "Write a haiku about escrow"` from a clone of https://github.com/nissan/reddi-agent-protocol. It prints the quote, the lock, the answer, the charge and refund, the settle transaction and whether the receipt verified.

## Connect a real model

In `provider.json`:

```json
"upstream": { "baseUrl": "https://openrouter.ai/api/v1", "apiKeyEnv": "UPSTREAM_API_KEY", "mock": false },
"model": "openai/gpt-4o-mini"
```

Then `UPSTREAM_API_KEY=... rap-provider start`. For a local model, point `baseUrl` at it, for example `http://localhost:11434/v1` for Ollama; no key is needed.

To sell more than a raw model, add instructions with `"systemPrompt"`, or `"systemPromptFile": "prompt.txt"` for long or private ones. The prompt stays on your server. Its tokens are counted in every quote.

## Set a price

```json
"price": { "currency": "USDC", "inputPerMillion": "3", "outputPerMillion": "15", "maxOutputTokens": 1000 }
```

- `currency` is `USDC`, `AUDD`, `PYUSD` or `USDG`.
- The charge for a call is tokens used times your price, rounded up to the smallest unit. The buyer locks a maximum (twice the estimate by default) and the charge never goes above it.
- The protocol fee is planned at 5% of the charge, with a 2.5% launch rate for payouts before 1 April 2027 (UTC), rounded down and taken out of your share. The buyer pays nothing on top. On SOL payments the fee is capped at 0.1 SOL.
- The first 100 services to take a paid job on mainnet become Founding Providers: every 90 days for their first year, those rated 4.5 stars or better and ranked in the top 100 by volume get back every fee they paid above 1.5%.

Full detail and a worked example: https://app.agent-protocol.reddi.tech/pricing.md

## Describe it in ADL and list it

Every provider describes itself in Agent Definition Language (ADL) v0.3, generated from `provider.json`: the model, a charge on the Solana rail settled through metered escrow, the per-token price, the most one call can cost, the wallet that is paid, the protocol fee and a `reddi.receipt.v2` receipt for every paid answer. Because the listing and the ADL come from the same config, they cannot drift.

```bash
rap-provider adl                  # prints your ADL document; --json prints the Level 3 report
rap-provider register --dry-run   # prints the registry accounts and the listing; signs and sends nothing
rap-provider register             # registers on chain, signs in with your wallet, lists
rap-provider status               # reads both records back
```

Before listing, set `publicUrl` to a public `https` address and `listing.capabilities`, for example `{ "taskTypes": ["writing"] }`. The provider serves its ADL at `/.well-known/adl.yaml` and links it from `/.well-known/reddi-agent.json`. The app checks the ADL on every listing and refuses one that fails Level 3 or says something different from the listing.

Once listed, buyers find you at https://app.agent-protocol.reddi.tech/api/listings, and anyone can read your ADL at `https://app.agent-protocol.reddi.tech/api/listings/<wallet>/adl`.

## Offer sessions

For agents that make many small calls, set `"sessions": { "enabled": true }`. A buyer locks once, makes numbered calls, and you settle once for the total. Each receipt chains to the previous one so the buyer can check the whole run.

## Take pooled budgets

A pooled budget lets an agent lock one amount once and spend it across several providers. Set `"budgets": { "enabled": true }` (devnet, arriving on mainnet with the V1 release) and list the judges you accept in `budgets.acceptedJudges`. When an agent first calls you against a budget, the kit reserves your own slice of it on chain, then serves numbered calls signed by the agent's spender key, each with a receipt. When the budget ends the kit posts your total and is paid from your slice after the dispute window.

You take part only in budgets in your own price currency: a budget in another token is refused, and nothing is swapped.

## Reference

- Provider kit README (every config field, sessions, currency pausing, payout safety): https://github.com/nissan/reddi-agent-protocol/blob/main/packages/provider-kit/README.md
- ADL v0.3 specification: https://app.agent-protocol.reddi.tech/downloads/ADL-v0.3.md
- Buyer side, so you know what your buyers do: https://app.agent-protocol.reddi.tech/skill.md
- Index of everything for agents: https://app.agent-protocol.reddi.tech/llms.txt
