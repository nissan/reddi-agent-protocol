# 01 System architecture (as built, devnet)

Everything that moves money ends in one on-chain program. Around it sit four Vercel projects, one Supabase project,
two timers and three npm packages. This page is the layout running on devnet today (main at the end of 26 November
2026). [02](02-mainnet-target-layout.md) is the layout mainnet Budgets need.

```mermaid
flowchart LR
  subgraph people["People and agents"]
    payer["Payer<br/>person with a wallet"]
    agent["Buyer agent<br/>holds a Budget key, no wallet"]
    seller["Provider operator<br/>runs the provider kit"]
  end

  subgraph appProj["Vercel: app (app.agent-protocol.reddi.tech)"]
    budgetPage["/budget page and /api/budget/v1<br/>prepare, start, activate, status, action, dispute"]:::live
    relay["Relay<br/>POST /api/budget/v1/chat/completions"]:::live
    watcher["Budget watcher<br/>/api/cron/budget-watch"]:::live
    desk["Sandbox SOL providers<br/>payee wallets, slice ledger, payout sweep"]:::live
    perCall["/try, /planner, /pass<br/>per-call and metered escrow"]:::live
    pages["Directory, My jobs, ratings,<br/>sandbox simulations, docs"]:::live
  end

  subgraph signerProj["Vercel: rap-budget-signer"]
    signer["Budget signer<br/>approve, sign-call, incident, health"]:::live
    kms[("Vercel KMS<br/>ES256 spender key")]:::live
  end

  subgraph provProj["Vercel: rap-providers"]
    rapProv["RAP providers<br/>humaniser, writing style, script writer"]:::live
  end

  marketing["Vercel: rap-marketing<br/>agent-protocol.reddi.tech"]:::live

  subgraph store["Supabase"]
    custody[("Budget custody<br/>records, use log, holds")]:::live
    kitState[("provider_kit schema<br/>replay, sessions, slices")]:::live
    appData[("Jobs, directory, ratings cache")]:::live
  end

  subgraph timers["Timers"]
    gha["GitHub Actions<br/>every 5 min, best effort"]:::live
    cfw["Cloudflare Worker cron<br/>PR #1192"]:::inflight
  end

  subgraph solana["Solana"]
    program[["RAP program (Pinocchio), 42 instructions<br/>registry, escrow, rating, attestation,<br/>delivery check, pooled Budget"]]:::live
    secp[["secp256r1 precompile"]]:::live
    treasury[("Protocol treasury<br/>devnet test wallet")]:::live
  end

  subgraph npmPkgs["npm (@redditech)"]
    x402["x402-solana"]:::live
    kit["provider-kit"]:::live
    ap["agent-protocol<br/>receipt v2, ADL"]:::inflight
  end

  outside["Outside providers<br/>Splice, TOLCA (featured in sandbox)"]:::later

  payer -->|"signs authorization and open_budget"| budgetPage
  agent -->|"Bearer Budget key"| relay
  relay -->|"sign this call / approve this reserve"| signer
  signer -->|"ES256 sign"| kms
  signer --> custody
  budgetPage --> custody
  relay -->|"x402-budget headers"| rapProv
  relay -->|"x402-budget headers"| desk
  rapProv --> kitState
  desk --> appData
  watcher -->|"reads slices, alerts payer"| custody
  gha --> watcher
  cfw -.-> watcher
  gha --> desk
  perCall -->|"x402 challenge"| rapProv
  seller -->|"installs"| kit
  kit --> x402
  kit --> ap
  rapProv -. built on .-> kit

  budgetPage -->|"open_budget"| program
  rapProv -->|"reserve, post_final, payout"| program
  desk -->|"reserve, post_final, payout"| program
  rapProv -->|"approval + reserve in one transaction"| secp
  secp --> program
  program -->|"fee"| treasury

  classDef live fill:#e3f3ea,stroke:#0b7a4b,stroke-width:2px,color:#14161a
  classDef launch fill:#ece4ff,stroke:#6a35d9,stroke-width:2px,color:#14161a
  classDef inflight fill:#fff4dc,stroke:#b07a10,stroke-width:2px,stroke-dasharray:6 4,color:#14161a
  classDef later fill:#f4f0e6,stroke:#9a978c,stroke-width:1px,stroke-dasharray:3 3,color:#5a5d57
```

## The pieces

| Piece | Where | Job |
|---|---|---|
| RAP program | `programs/pinocchio-escrow/` | One Pinocchio program, one build, 42 instructions. Holds every lock; pays providers, the treasury and refunds. Devnet program `DcfW3Cxt…5Ucu`. |
| App | repo root, Vercel project `reddi-agent-protocol` | The Budget page and its routes, the relay agents call, the Budget watcher, the devnet sandbox providers, the per-call pages, directory, My jobs. Holds no KMS grant. |
| Budget signer | `apps/budget-signer/`, Vercel `rap-budget-signer` | The only project granted the KMS issuer. Re-checks the payer's signed authorization, holds, limits and the use log before every signature. |
| RAP providers | `apps/providers/`, Vercel `rap-providers` | RAP's own providers on the provider kit (serverless), state in the `provider_kit` schema. |
| Marketing | `apps/marketing/`, Vercel `rap-marketing` | The public site. |
| Supabase | `supabase/migrations/` | Custody records (`budget_spenders`, `budget_spender_uses`, `budget_signer_holds`), the provider kit's state, app data. |
| Timers | `.github/workflows/budget-watch.yml`, `ops/budget-watch-worker/` (PR #1192) | Call the watcher and the sandbox payout sweep every 5 minutes. GitHub's schedule is best effort, so a Cloudflare Worker is being added. |
| npm packages | `packages/x402-solana`, `packages/provider-kit`, `packages/agent-protocol` | x402 challenge, escrow and Budget builders; the runnable provider server; receipt v2, ADL and the offline checks. |

## Who holds which key

```mermaid
flowchart LR
  payerKey["Payer wallet<br/>Ed25519, in the person's wallet"] -->|"opens, disputes, closes,<br/>signs the relay authorization"| program[["RAP program"]]
  spender["Spender key<br/>P-256 in Vercel KMS"] -->|"approves reserve, waive, close<br/>signs each paid call"| program
  agentKey["Agent Budget key<br/>rap_budget_ secret, only its hash stored"] -->|"asks the relay"| spender
  provKey["Provider wallet<br/>Ed25519, provider's own"] -->|"co-signs reserve, posts, signs receipts"| program
  squads["Squads vault, 2 of 3<br/>treasury and upgrade authority"] -->|"receives fees,<br/>approves upgrades"| program
  judgeKey["Judge key<br/>being built"]:::inflight -->|"resolves disputed slices"| program
  classDef inflight fill:#fff4dc,stroke:#b07a10,stroke-width:2px,stroke-dasharray:6 4,color:#14161a
```

The relay holds no spender key material: the private key never leaves KMS, and the signer project alone may ask for a
signature. The agent never holds a wallet, only a key that lets it ask the relay to spend within what the payer
signed. On devnet the treasury is a plain test wallet; on mainnet it is the Squads vault.
