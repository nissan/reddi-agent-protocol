<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Solana toolchain baseline

Use `docs/SOLANA-TOOLCHAIN-BASELINE.md` and `scripts/solana-baseline-toolchain.sh` for the pinned user-scoped RAP Solana baseline. Keep Node repo-local through `.mise.toml`; do not replace the machine-wide Node used outside this repository. Prefer `npm run check:toolchain:surfpool-smoke` for a safe dynamic-port Surfpool smoke; inspect broader Surfpool/devnet scripts before running because some use fixed ports, keypair paths, live RPC, or generated artifacts.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
