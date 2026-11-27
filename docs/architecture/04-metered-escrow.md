# 04 Metered escrow (per-token calls)

For a call priced per token, the buyer cannot know the cost up front. So it locks a maximum in the RAP program, the
provider serves, and the provider settles the **actual** cost: the program pays the provider, sends the fee to the
treasury and returns the rest to the buyer, all in one transaction. At launch this runs on devnet
([02](02-mainnet-target-layout.md#per-call-stays-on-devnet)).

```mermaid
sequenceDiagram
  autonumber
  actor Buyer as Buyer agent
  participant P as Provider (provider kit)
  participant M as Model
  participant R as RAP program
  participant T as Treasury

  Buyer->>P: POST /v1/chat/completions (no payment)
  P-->>Buyer: 402 offer: price per million input and output tokens,<br/>estimate, maximum to lock (2x estimate by default)
  Buyer->>R: lock_metered_token_escrow(maximum,<br/>claim window, cancel window)
  R-->>Buyer: escrow locked (created_slot)
  Buyer->>P: Same request + x402-payment naming the lock
  P->>R: Read the escrow at confirmed
  Note over P: Right program, cluster, payee and mint?<br/>Covers the estimate? At least 10 min of<br/>refund window left? Lock not used before?
  P->>M: Forward the request
  alt model answers
    M-->>P: answer + token usage
    P->>R: settle_token_escrow(actual cost, created_slot)
    R-->>P: provider share
    R-->>T: protocol fee
    R-->>Buyer: unused maximum back
    P-->>Buyer: answer (only after the settle confirms)<br/>+ reddi.receipt.v2, settlement: metered-escrow
  else model fails
    P->>R: cancel_token_escrow (decline)
    R-->>Buyer: everything back, no fee
    P-->>Buyer: error, nothing charged
  end
```

The buyer is charged only after the model answered, and gets the answer only after the settle confirmed. The charge is
tokens used times the price, rounded up to the smallest unit, and never more than the lock.

## Who can end an escrow

```mermaid
stateDiagram-v2
  [*] --> Locked: lock (payer)
  Locked --> Paid: release (payer, any time)
  Locked --> Paid: settle actual cost (payee only, metered)
  Locked --> Paid: claim (payee, after claim window)
  Locked --> Refunded: decline (payee, any time)
  Locked --> Refunded: refund (payer, after cancel window)
  Paid --> [*]: provider share + fee to treasury,<br/>unused part back to payer
  Refunded --> [*]: everything back, no fee
```

Every exit names its escrow by `created_slot` and cannot land in the lock slot, so an exit signed for one job can never
end a later job at the same address. Caps: 0.5 SOL or 100 token units per escrow.

## Sessions: many calls, one settle

An agent that makes many small calls to one provider locks once and numbers its calls (`x402-session-sequence: 1, 2,
3…`), each signed by a session key its wallet delegated once. Every answer carries a receipt whose `session` block
holds the running totals and the hash of the previous receipt, so the buyer can check the chain. The provider settles
once, for the total, on close, when the lock is used up, after an idle time, or before the refund window opens.

```mermaid
sequenceDiagram
  actor Buyer as Buyer agent
  participant P as Provider
  participant R as RAP program
  Buyer->>R: lock_metered_token_escrow (one lock)
  loop each call n
    Buyer->>P: call n, x402-session-signature
    P-->>Buyer: answer + receipt (sequence n, cumulative cost, previous receipt hash)
  end
  Buyer->>P: x402-session: close
  P->>R: settle once, for the total
  P-->>Buyer: closing receipt (closed: true, payment block)
```

## Delivery check (fixed-price media jobs)

A media job (a video, an image) can opt in to a delivery check at lock (escrow bit `0x04`). The provider records the
delivery, the buyer gets a verify window to accept or dispute, and a judge named at lock splits a disputed job. The
payee collects only after the buyer accepts or the window ends undisputed; the buyer can always release in full. The
chain cannot fetch the file: it records what the payee says it delivered (units, bytes, SHA-256), and the buyer's agent
or the judge checks the file against the receipt's `delivery` block.

```mermaid
stateDiagram-v2
  [*] --> Locked: lock + open_delivery
  Locked --> Delivered: record_delivery (provider, file hash)
  Delivered --> Accepted: accept_delivery (buyer)
  Delivered --> Accepted: verify window ends undisputed
  Delivered --> Disputed: dispute_delivery (buyer)
  Disputed --> Resolved: resolve_delivery (judge splits)
  Accepted --> [*]: payee settles or claims,<br/>fee to treasury
  Resolved --> [*]: split as the judge names
  Locked --> [*]: payer release (always) or payee decline
```

Code: `@redditech/x402-solana/provider` (`verifyMeteredLock`, `meteredSettlement`), `packages/provider-kit`; program
README "Delivery check".
