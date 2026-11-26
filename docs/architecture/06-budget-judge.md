# 06 Budget judge (being built)

A payer who disputes a posted slice needs someone to rule. The program already supports it: `resolve_budget` and
`resolve_token_budget` accept a signature from the judge the Budget named at open, on a disputed slice, before the
judge window ends (72 hours by default), paying the provider at most what it posted. A slice nobody rules on in time is
refunded to the payer in full. What is being built is the RAP-run judge that sits behind that key (#1157 task 10). The
decisions below are the recommended design, waiting on the owner; nothing here is deployed.

```mermaid
sequenceDiagram
  autonumber
  actor Payer as Payer (wallet)
  participant R as RAP program
  participant Relay as Relay (app)
  participant J as RAP judge (rap-budget-judge)
  participant KMS as Vercel KMS (EdDSA judge key)
  participant Prov as Provider

  Note over Relay: During the Budget the relay keeps each provider's<br/>signed receipt, and the signer logs every call it signed
  Payer->>R: dispute (slice is held)
  loop every 15 min (plus an hourly backup)
    J->>R: Find disputed slices where this judge is named
  end
  J->>J: Read the evidence: provider receipts for this Budget<br/>and reservation, calls the spender signed for this provider
  alt receipts verify and match signed calls
    J->>J: Ruling = min(posted, latest valid receipt's cumulative cost)
  else evidence missing or does not match
    J->>J: Ruling = 0 (full refund)
  end
  J->>KMS: Sign resolve_token_budget(payout = ruling)
  KMS-->>J: Ed25519 signature
  J->>R: resolve_token_budget
  R->>R: Signer is Budget.judge? Slice disputed? Inside judge window?<br/>Payout at most the posted amount?
  R-->>Prov: ruling less the fee
  R-->>Payer: the rest of the slice
  Note over R: If no ruling lands inside the judge window,<br/>anyone's payout refunds the payer in full
```

## What the judge decides, and what it does not

```mermaid
flowchart TD
  D["Disputed slice"] --> E{"Receipt v2 for this Budget,<br/>this reservation, this payer?"}
  E -->|no| Z["Rule 0: payer refunded"]
  E -->|yes| S{"Call numbers within what the<br/>spender signed for this provider,<br/>request hashes among signed bodies?"}
  S -->|no| Z
  S -->|yes| P["Rule min(posted, cumulative cost<br/>on the latest valid receipt)"]
  P --> Q["Quality of the answers is not judged in V1"]
```

| Decision (recommended, awaiting the owner) | |
|---|---|
| Evidence rule | Pay what signed receipts and signed calls prove was served, never more than posted |
| Key custody | A Vercel KMS EdDSA key granted only to its own project, `rap-budget-judge`, one per network; the judge pays its own fees |
| Missing evidence | Full refund to the payer |
| Timing | Evidence window 24 hours; automatic ruling well inside the 72-hour judge window |

Providers must list the judge in `budgets.acceptedJudges`: a provider kit with an empty list refuses any Budget that
names a judge. So the default judge, the sandbox desk, `rap-providers` and featured providers change in the same step.
