# Custody policy (V1 mainnet)

Status: **draft for owner approval** (audit condition C14). Lines marked
**Owner decision** take effect only once the owner records the choice on #736.
Addresses here are public; no key, seed, password or recovery phrase is ever
written in this repository, an issue, or an agent's notes.

## 1. What is held, and by whom

| Asset or power | Holder | Notes |
|---|---|---|
| Escrow program `DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu` upgrade authority | Squads vault `5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe` | Never the multisig account (`FSwX9…`), never the deployer. Checked by `scripts/check-escrow-deployment.mjs`. |
| Protocol fee treasury (`PROTOCOL_TREASURY`) | Same vault | SOL plus four token accounts (USDC, AUDD, PYUSD, USDG). The vault never goes to zero lamports and those accounts are never closed (`docs/MAINNET-LAUNCH-RUNBOOK.md` §6). |
| Squads multisig "Reddi Agent Protocol" | 3 members, threshold 2 of 3 | Separate from the company investments squad, which never takes part in protocol flows. |
| Deployer key | Owner, for the deploy only | Retired after the authority handover: buffers closed, SOL returned, key archived offline (runbook §3.4). |
| First-party provider wallets | One hot key per provider, in the host's sensitive environment variables | Hold only working float. Revenue is swept to a separate single-signer operating vault, never to the protocol vault. |
| Operating vault (provider revenue) | Owner, single signer | Separate from the protocol vault. |
| Service credentials (Helius, Supabase, npm, model keys, Vercel, GitHub) | Owner's password manager | Listed in §5. |

Agents (Claude, Codex and others) never create, read, hold or sign with any
key in this table. They may prepare unsigned transactions and read-only checks.

## 2. Members and key types

- Each of the three members is a different key, kept on a different device,
  and no two are recoverable from the same backup or account.
- **Owner decision:** at least two of the three members are hardware wallets
  (Ledger or equivalent). A browser-extension hot wallet may be the third.
- **Owner decision:** name who controls each member (by role, not in this
  file; record names privately). If one person controls all three, the 2-of-3
  threshold protects against a lost key, not against that person being
  compromised or coerced; record that this is accepted for V1.
- Recovery material for each member is stored offline, separately from the
  others, and never photographed or typed into a computer that is online.

## 3. What needs the multisig, and how it is checked

| Action | Approval | Check before signing |
|---|---|---|
| Program upgrade | 2 of 3 | The buffer's executable hash equals a release record committed in `config/releases/`, built by `escrow-verifiable-build.yml` on a reviewed `main` commit, with the test job against that binary green. Read it from the Squads transaction, not from a message. |
| Change upgrade authority, or make the program immutable | 2 of 3 | Only to an address in this policy, pasted from it. |
| Move funds out of the treasury | 2 of 3 | Destination is the operating vault or another address recorded on #736. The vault keeps at least 0.01 SOL and its four token accounts. |
| Change members or threshold | 2 of 3 | Recorded on #736 the same day. |

**Owner decision (recommended):** turn on a Squads time lock for the protocol
multisig, at least 24 hours, so a malicious upgrade or authority change can be
seen (on-chain watch, §6 of the incident runbook) and cancelled by the other
signers before it executes. The cost is that an emergency fix also waits; the
program has no pause, so the response to an exploit during the wait is to stop
new locks off-chain (incident runbook, stop switches).

## 4. Lost or compromised member key

1. A member suspected lost or compromised is treated as compromised.
2. The two remaining members propose and approve a config transaction that
   removes it and adds a fresh key, **before** anything else is signed.
3. Until that lands, no other proposal is approved, and any pending proposal
   the compromised key created or approved is rejected.
4. If two members are lost or compromised, the attacker can act. Follow the
   incident runbook (key compromise): stop new locks, tell users to refund open
   escrows once their windows open, and redeploy under a new program id if
   the program itself was changed.
5. Record the change and the new member address on #736.

## 5. Service credentials

Kept only in the owner's password manager; never in the repository, an issue,
a chat, or an agent's memory. Rotation triggers: an agent or person who saw it
leaves, it appeared in a log or a commit, or 12 months pass.

| Credential | Where it is used | Blast radius if leaked |
|---|---|---|
| Helius API key | Vercel `SOLANA_RPC_URL` (sensitive), provider hosts | RPC spend; no funds |
| Supabase owner password and service-role key | Server only | Read and write of all app data |
| `provider_kit_app` database login | Providers host | The `provider_kit` schema only |
| npm publish token (until trusted publishing replaces it) | `npm-release` environment | Publishing a malicious package version |
| Model provider keys (OpenAI, Anthropic, OpenRouter) | Providers host | Model spend |
| Jupiter API key | Swap quotes; an old key is in git history, so rotation is owed | Quote API spend |
| Provider wallet keypairs | Providers host (sensitive) | That provider's float and its settle authority |

## 6. Immutability

**Owner decision (recommended):** keep the program upgradeable through V1, held
by the vault, so a bug can be fixed. Revisit when an external audit is done and
the program has run 90 days without a change; making it immutable needs a
2-of-3 approval and a public note.

## 7. Review

Reviewed at every program release and at least every 6 months. Changes go
through a pull request and are recorded on #736.
