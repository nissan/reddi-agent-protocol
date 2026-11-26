# 08 Receipts v2

Every paid call in V1 ends with a `reddi.receipt.v2`: a statement the provider signs with its own wallet key (Ed25519
over a fixed-order canonical form) saying what it was asked, what it answered, which model it declared and how it was
paid. Payments prove transfer; the receipt binds that transfer to the work. Verification is offline, against what the
buyer knows itself.

```mermaid
classDiagram
  direction LR
  class SignedReddiReceiptV2 {
    receipt
    proof.type = ed25519
    proof.signature
  }
  class ReddiReceiptV2 {
    schemaVersion = reddi.receipt.v2
    providerId
    declaredModel
    requestHash
    responseHash
    issuedAt
    jobId?
  }
  class Payment {
    network
    txSignature
    currency SOL USDC AUDD PYUSD USDG
    mint?
    amount
    fee amount, treasury
    settlement direct, escrow, metered-escrow
    payer?
    metered? tokens, maxAmount, refunded
  }
  class Session {
    escrow or reservation
    payer
    sequence
    inputTokens, outputTokens
    cumulativeCost
    previousReceiptHash?
    closed
  }
  class Budget {
    address
    createdSlot
    reservation
  }
  class Delivery {
    name, mediaType
    bytes, sha256
    expiresAt
  }
  class Bonus {
    offer
    amount
  }
  SignedReddiReceiptV2 *-- ReddiReceiptV2
  ReddiReceiptV2 o-- Payment : per call or settle
  ReddiReceiptV2 o-- Session : numbered calls
  ReddiReceiptV2 o-- Budget : Budget calls
  ReddiReceiptV2 o-- Delivery : media jobs
  ReddiReceiptV2 o-- Bonus : launch bonus
```

## Who checks it, and against what

```mermaid
flowchart LR
  subgraph buyer["Buyer or agent (offline)"]
    v["verifyReddiReceiptV2<br/>expected: provider wallet paid,<br/>hash of request sent, hash of answer received,<br/>network and tx signature"]
    c["verifyReddiReceiptV2Session<br/>each receipt names the hash of the one before"]
  end
  subgraph chain["Solana"]
    tx["The named transaction<br/>(transfer, settle or BudgetPaid event)"]
  end
  subgraph app["App"]
    jobs["My jobs<br/>records a Budget job only when a landed payout<br/>and a matching receipt agree"]
  end
  subgraph judge["Judge (being built)"]
    j["Uses receipts as dispute evidence"]
  end
  r["Signed receipt<br/>header x-reddi-provider-receipt"] --> v
  r --> c
  v -->|"payment fields are the provider's statement:<br/>check them on chain"| tx
  r --> jobs
  r --> j
```

A valid signature shows what the provider declared. It does not show which model ran, and the payment fields are only
the provider's word until the named transaction is read on chain. `reddi.receipt.v2` is the only version accepted; v1
was removed before V1 (#776). Code: `packages/agent-protocol/src/receipt-v2.ts`.
