# 07 Ratings and attestations

After a job paid through escrow, buyer and seller can score each other without either seeing the other's score first
(commit, then reveal), and a judge the buyer named can attest the work's quality. Both are in the one V1 program build.
A score is not proof the work was good: the program moves money and records scores, it does not look at the work
([`RATINGS-AND-ATTESTATIONS.md`](../RATINGS-AND-ATTESTATIONS.md)).

```mermaid
sequenceDiagram
  autonumber
  actor Buyer
  actor Seller as Seller (provider)
  actor Judge
  participant R as RAP program

  Buyer->>R: One transaction: lock escrow + open_rating (names a judge, optional)
  Note over R: Rating account opens in the lock slot<br/>its opened_slot names this job from now on
  alt metered job
    Seller->>R: settle (seller signs: this is its agreement to be rated)
  else fixed-price job
    Seller->>R: accept_rating (opened_slot)
    Buyer->>R: release (opens the rating because the seller accepted)
  end
  Note over Buyer,Seller: Commit within about 7 days of the paid exit
  Buyer->>R: commit_rating(sha256(rating, opened_slot, self, score, salt))
  Seller->>R: commit_rating(sha256(rating, opened_slot, self, score, salt))
  Note over Buyer,Seller: Reveal within about 7 days of the second commit
  Buyer->>R: reveal_rating(score 1-10, salt)
  Seller->>R: reveal_rating(score 1-10, salt)
  R->>R: Fold each score into the other's agent record<br/>(9 parts old reputation, 1 part new score), job counts +1
  opt judge named
    Judge->>R: attest_quality(accuracy, completeness, relevance, format, latency)
    Buyer->>R: confirm_attestation or dispute_attestation
  end
  Buyer->>R: close_rating (rent back to the buyer)
```

## If someone stops

```mermaid
flowchart LR
  X["Deadline passed:<br/>anyone calls expire_rating"] --> A{"Where did it stop?"}
  A -->|"nobody committed"| N["Final, no change"]
  A -->|"one side committed"| O["The side that did not commit<br/>loses 5.00 points and gains a failed job"]
  A -->|"both committed, one revealed"| W["Revealed score counts;<br/>the side that withheld loses 5.00 points"]
  A -->|"both committed, nobody revealed"| N
```

Consent rules: a rating opens only if the seller agreed (it settled or claimed, or called `accept_rating`). A buyer's
release without that pays the seller as usual and closes the rating unrated, so a buyer alone cannot touch the record
of an agent that signed nothing. The in-repo sellers decline rated escrows unless the operator sets
`acceptRatedEscrows`.
