# 05 Budget lifecycle

A Budget is one lock that pays several providers. A person locks a total (for example $5 in USDC) for an open period
(72 hours by default), and their agent gets a **key, not a wallet**. While the Budget is open the agent calls providers
through the RAP relay; each provider reserves its own **slice** on chain, serves calls against it, posts what it is
owed, and is paid after a 24-hour dispute window. What was never reserved, and what a slice did not use, goes back to
the payer. Budgets are the launch product on mainnet ([02](02-mainnet-target-layout.md)); everything below runs on
devnet today (devnet end-to-end runs passed on 25 and 26 November).

## The whole life on one page

```mermaid
flowchart LR
  A["1 Open<br/>payer locks the total,<br/>names providers and a judge"] --> B["2 Reserve<br/>each provider takes a slice,<br/>approved by the KMS spender"]
  B --> C["3 Call<br/>agent calls through the relay,<br/>provider meters each call"]
  C --> B
  C --> D["4 Close<br/>early by payer or agent,<br/>or anyone after 72 h;<br/>unreserved money back at once"]
  D --> E["5 Post<br/>each provider posts what it is owed,<br/>at most its slice"]
  E --> F{"6 Dispute window<br/>24 h from close"}
  F -->|"payer waives"| G["7 Payout"]
  F -->|"window ends undisputed"| G
  F -->|"payer disputes"| H["Judge rules within 72 h<br/>(no ruling: full refund)"]
  H --> G
  G --> I["Provider share,<br/>fee to treasury,<br/>rest of slice to payer"]
```

## Accounts and their states

```mermaid
stateDiagram-v2
  direction LR
  state "Budget" as Budget {
    [*] --> Open: open_budget / open_token_budget
    Open --> Closed: close (payer or spender any time,<br/>anyone after the open period)
    Closed --> [*]: last slice paid, account closed
  }
  state "Reservation (one per provider, at most 8)" as Res {
    [*] --> Reserved: reserve (spender + provider)
    Reserved --> Reserved: raise (same call, higher total)
    Reserved --> Posted: post_final (provider, at most the slice)
    Posted --> Posted: re-post (may only go down)
    Posted --> Paid: waive (payer) then payout
    Posted --> Paid: payout after dispute window
    Posted --> Disputed: dispute (payer)
    Disputed --> Paid: resolve (judge splits)
    Disputed --> Paid: judge window ends (full refund)
    Reserved --> Paid: never posted (pays nothing, refund)
    Paid --> [*]
  }
```

## 1 Open: the payer sets it up

```mermaid
sequenceDiagram
  autonumber
  actor Payer as Payer (wallet)
  participant Page as /budget page (app)
  participant DB as Custody store
  participant R as RAP program
  participant Signer as Budget signer

  Payer->>Page: Token, total ($5 default), up to 4 providers, alert email
  Page->>Page: Make the agent secret, keep only its SHA-256
  Page-->>Payer: Text to sign: network, payer, Budget address, providers,<br/>max reserve, contact, time, terms, agent key hash
  Payer->>Page: Ed25519 signature (relay authorization)
  Page->>DB: Record (pending, at most 1 hour to activate)
  Page-->>Payer: open_budget transaction, checked by the page before signing
  Payer->>R: open_budget: total, spender = SHA-256 of KMS P-256 key (flag 0x08),<br/>allowlist = the providers, per-provider cap = half,<br/>open 72 h, dispute 24 h, judge 72 h
  Page->>R: Read the Budget (own RPC, genesis hash checked)
  Note over Page: Payer, spender, flag, allowlist and terms<br/>must match what the payer signed
  Page->>DB: Record open
  Page-->>Payer: Agent key, shown once: agentSecret.recordId
  Note over Signer: From here the signer re-verifies the payer's<br/>signature on every approval it gives
```

## 2 and 3 Reserve and call: the agent spends

The agent never touches a wallet. It sends an OpenAI-style request to the relay with its Budget key. The relay asks
the signer to sign the call; on a provider's first call (or when a slice runs low) it asks the signer to approve a
reserve, and the provider co-signs and pays for the reserve transaction.

```mermaid
sequenceDiagram
  autonumber
  actor Agent as Buyer agent
  participant Relay as Relay (app)
  participant Signer as Budget signer
  participant KMS as Vercel KMS (P-256)
  participant Prov as Provider (provider kit)
  participant R as RAP program

  Agent->>Relay: POST /api/budget/v1/chat/completions<br/>Bearer agentSecret.recordId, model = a chosen provider
  Relay->>Relay: Key matches record? Record open?
  Relay->>Signer: sign-call (Budget, created_slot, provider, body hash)
  Signer->>Signer: Re-verify payer's signed authorization, holds,<br/>pause switch, limits, log the use, next call number
  Signer->>KMS: ES256 sign
  KMS-->>Signer: signature
  Signer-->>Relay: signed call n
  Relay->>Prov: request + x402-budget (Budget, created_slot, n) + x402-budget-signature
  alt no slice yet, or slice too low
    Prov-->>Relay: 402 Budget offer (program, payee, payout account, mint,<br/>reservation wanted, accepted judges)
    Relay->>Relay: Offer is this program, cluster, payee, token?
    Relay->>Signer: approve reserve (provider, amount up to the payer's maximum)
    Signer->>KMS: ES256 sign the 175-byte approval (expires in about 150 slots)
    Signer-->>Relay: secp256r1 instruction + reserve instruction
    Relay->>Prov: same call again + x402-budget-reserve
    Prov->>Prov: One reserve, for me, within my offer, valid spender approval?
    Prov->>R: Provider signs as fee payer and sends:<br/>secp256r1 approval, then reserve
    R->>R: Precompile key hashes to the Budget's spender,<br/>message is this exact call, provider on the allowlist,<br/>slice within cap and what is left
    R-->>Prov: Reservation created (provider paid the rent)
  end
  Prov->>Prov: Spender signed this call? Number above the last served?
  Prov->>Prov: Serve, meter tokens at its price, add to the slice
  Prov-->>Relay: answer + reddi.receipt.v2 (session and budget blocks)
  Relay-->>Agent: answer, cost, receipt
```

Limits on the relay's path (each over 10 minutes): 30 approvals per Budget, 60 per payer, 300 per network; 300 paid
calls per Budget, 600 per payer, 6,000 per network. Past the per-Budget limit the Budget is frozen and the operator is
told. A reserve is approved only for a provider the payer named and only up to the payer's signed maximum.

## 4 to 7 Close, post, dispute window, payout

```mermaid
sequenceDiagram
  autonumber
  actor Payer as Payer (wallet)
  participant W as Budget watcher
  participant Prov as Provider (kit sweep)
  participant R as RAP program
  participant J as Judge
  participant T as Treasury (Squads vault on mainnet)

  alt payer or agent closes early
    Payer->>R: close_budget
  else open period ends
    Prov->>R: close_budget (anyone may)
  end
  R-->>Payer: never-reserved money back at once
  Prov->>R: post_final (what it is owed, at most its slice)
  W->>R: Compare slices with last pass
  W-->>Payer: Email: amount posted, dispute deadline,<br/>Solana Pay link that builds a dispute
  alt payer approves early
    Payer->>R: waive
    Prov->>R: payout_token_budget (at once)
  else payer does nothing for 24 h
    Prov->>R: payout_token_budget (anyone may)
  else payer disputes
    Payer->>R: dispute
    alt judge rules within 72 h
      J->>R: resolve_token_budget (payout at most the posted amount)
    else no ruling in time
      Prov->>R: payout (full refund to payer)
    end
  end
  R-->>Prov: provider's part less the fee
  R-->>T: protocol fee
  R-->>Payer: rest of the slice
```

The dispute window runs from the close (from the end of the open period at the earliest when someone other than the
payer closed a Budget without an allowlist) and never ends sooner than about an hour after the provider's first post. A
re-post may only lower the amount.

## Fees on a payout

The fee comes out of the provider's part, never on top: planned 5%, with a 2.5% launch rate for payouts before
1 April 2027 UTC, rounded down, capped at 0.1 SOL on SOL Budgets only.

| Example (devnet run, 26 November) | Lamports |
|---|---|
| Slice posted by the provider | 700 |
| Fee at the 2.5% launch rate (17.5, rounded down) | 17 to the treasury |
| Provider receives | 683 |
| Rest of the slice and never-reserved money | back to the payer |

The planned launch bonus (#1115) adds to this on mainnet USDC Budgets for 30 days after launch: a Budget earns a bonus
of half its total with RAP's own providers. The bonus covers a third of each such call and the slice is charged the
rest (the fee is taken on the charged part only), up to $10 per wallet from a $1,000 pool. It is a discount recorded
by RAP's providers, so no extra money moves, and it stays off until its start date is set.

## Recording the work

A Budget call becomes a job in My jobs only when a landed `payout_budget` or `resolve_budget` (or its token form) for
this Budget, this opening and this provider's reservation is found, with the amounts from the program's own `BudgetPaid`
event, and the provider's signed receipt v2 names the same Budget and reservation (`lib/jobs/budget-call.ts`). Showing
calls and cost per provider beside each post is in flight (#1145).

## When something goes wrong

The operator's incident step runs in the signer, never through the app: pause every approval, close every open Budget
on chain with a KMS approval (never-reserved money goes back at once; posted slices keep their dispute window), then,
if needed, remove the KMS grant so nothing can approve again. A payer can always close their own Budget from their
wallet. Detail: [`BUDGET-RELAY-CUSTODY.md`](../BUDGET-RELAY-CUSTODY.md#incident-the-relay-or-its-kms-access-may-be-compromised).
