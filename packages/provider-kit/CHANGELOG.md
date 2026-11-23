# Changelog — @redditech/provider-kit

All notable changes to this package are documented here. Dates are AEST.

## 0.3.0 — 2026-11-23

### Added

- Serverless hosts: `createServerlessProvider` runs a provider on a host with many short-lived instances (Vercel and similar). It reads the wallet keypair, the private system prompt and the model key from environment variables, mounts the provider under a path, and gives `handle(request)` and `sweep()` for a cron job. It refuses to start without any of them, and refuses sessions and the refund-account subsidy, which still keep their state in one process.
- Postgres stores (`postgresProviderStores`) for everything a provider remembers: accepted locks, a lease per lock, answers waiting for their settle, settles not yet known to land, and the model's limits. Every instance of one provider shares them. The tables and a least-privilege role are in this repository's `provider_kit` migration. The kit has no database driver dependency: pass a `pg` Pool.
- `loadProviderKeyFromEnv`, the provider key from an environment variable; `redactLogEvent`, which takes URLs out of log events.
- Claude models through the Anthropic API (`upstream.provider: "anthropic"`, with `effort` and `thinking`), and a `capacity` setting: when the model is at its per-minute or per-day limit, a call is refused with `503 provider_busy` before any lock is read.
- When the payer's token account cannot receive the unused part of a lock, the settle returns it to a fresh account the provider creates for the payer, so a payer cannot block the settle.

### Changed

- The minimum lock counts one token a UTF-8 byte of input, and the request body limit is enforced while the body streams in. Sessions are offered on devnet only.
- A held answer is given only to the payer of its lock, checked by the escrow address the payer's wallet and nonce derive, and only for the lock instance the payer signed for. Another wallet that names the escrow is refused before any lock is read.
- A pending settle records its payer and lock slot. The sweep declines only the lock it recorded; a record without them is dropped with an alert instead of declining a later lock at the same address.

### Upgrading

- The replay key now names the lock instance, so keys stored by 0.2.x do not match. Deploy 0.3.0 when the sweep shows no pending settles.

## 0.2.1 and earlier

First public releases were 0.2.0 and 0.2.1 (2026-11-22).
