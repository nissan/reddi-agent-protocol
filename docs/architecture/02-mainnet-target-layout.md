# 02 Mainnet target layout (Budgets, 5 December launch)

The launch puts Budgets on mainnet; per-call payments stay on devnet. The final security round (26 November, at
1079ce8) found the devnet layout fine for test funds but not for relay-held Budgets with real money: the app project
holds the sandbox providers' payee wallets, their ledger, the payout cron and the watcher next to the relay. The target
below takes each of those out. Numbers in brackets are the tasks on issue #1157; colours follow the
[status key](README.md#status-key).

```mermaid
flowchart TB
  subgraph people["People and agents"]
    payer["Payer wallet"]
    agent["Buyer agent<br/>Budget key"]
  end

  subgraph relayProj["Vercel: app, mainnet entry point [2]"]
    page["/budget page<br/>checks every action transaction [14]"]:::launch
    relay["Relay<br/>cluster pinned in code, genesis checked at start [2]<br/>failures do not strike providers, served calls report charged [5, 7]"]:::launch
    jobs["My jobs: Budget calls and cost per provider<br/>beside each post [9]"]:::inflight
    perCall["/try, /planner, /pass<br/>labelled devnet"]:::live
  end

  subgraph signerMain["Vercel: mainnet signer deployment [3]"]
    signerM["Budget signer, mainnet<br/>own RPC, secrets, durable limits and ceilings [13]"]:::launch
    kmsM[("Mainnet KMS issuer<br/>ES256 spender key")]:::launch
    dbM[("Mainnet custody tables<br/>devnet deployments cannot write them")]:::launch
  end

  subgraph signerDev["Vercel: devnet signer (today's)"]
    signerD["Budget signer, devnet"]:::live
  end

  subgraph watchProj["Outside the relay's project [8]"]
    watch["Budget watcher and payer alerts<br/>scheduler with a delivery promise,<br/>outside monitor, named owner"]:::inflight
    worker["Cloudflare Worker timer<br/>PR #1192"]:::inflight
  end

  subgraph provMain["Providers apart from the relay [1]"]
    rapProvM["rap-providers, mainnet<br/>own payout wallets, ledger and sweep"]:::launch
    kitM["provider kit 0.4.x<br/>reserve and raise limits, rent limits [6]"]:::inflight
  end

  subgraph judgeProj["Vercel: rap-budget-judge [10]"]
    judge["RAP judge service<br/>evidence rule, rulings"]:::inflight
    kmsJ[("Ed25519 judge key (sealed env var)")]:::inflight
  end

  subgraph chain["Solana mainnet"]
    program[["RAP program<br/>container (verifiable) build"]]:::launch
    secp[["secp256r1 precompile<br/>live since epoch 800 [17]"]]:::launch
    vault[("Squads vault, 2 of 3<br/>treasury and upgrade authority<br/>token accounts before launch [17]")]:::launch
    helius["Helius RPC"]:::launch
  end

  payer --> page
  agent --> relay
  relay -->|"sign-call, approve"| signerM
  signerM --> kmsM
  signerM --> dbM
  relay -->|"x402-budget"| rapProvM
  rapProvM -. built on .-> kitM
  worker --> watch
  watch -->|"reads slices, emails payer"| program
  judge --> kmsJ
  judge -->|"resolve_budget"| program
  page -->|"open_budget"| program
  rapProvM -->|"reserve, post_final, payout"| secp
  secp --> program
  program -->|"fee"| vault
  relay --- helius
  signerD -. "devnet only, kept apart" .- signerM
  page --> jobs

  classDef live fill:#e3f3ea,stroke:#0b7a4b,stroke-width:2px,color:#14161a
  classDef launch fill:#ece4ff,stroke:#6a35d9,stroke-width:2px,color:#14161a
  classDef inflight fill:#fff4dc,stroke:#b07a10,stroke-width:2px,stroke-dasharray:6 4,color:#14161a
  classDef later fill:#f4f0e6,stroke:#9a978c,stroke-width:1px,stroke-dasharray:3 3,color:#5a5d57
```

## What moves, and why

| Today (devnet) | Target (mainnet) | Why | #1157 |
|---|---|---|---|
| Sandbox SOL providers' payee wallets, slice ledger and payout sweep live in the app project | No provider wallet, ledger or payout job in the relay's project; no scripted sandbox provider in the mainnet directory | A compromised relay must not also be a provider that can post and collect | 1 |
| One codebase reads devnet constants | A mainnet entry point with the cluster pinned in code; each deployment checks its RPC's genesis hash at start | No path can serve one cluster with the other's settings | 2 |
| One signer deployment, devnet | A second signer deployment with its own KMS issuer, key, RPC, secrets and tables | A devnet leak cannot sign or write for mainnet | 3 |
| Watcher runs in the app project on a best-effort GitHub schedule | Watcher and payer alerts outside the relay's project, on a scheduler with a delivery promise and an outside monitor (PR #1192 starts this with a Cloudflare Worker timer) | The payer's dispute window only helps if the alert arrives | 8 |
| No judge set by default | RAP judge in its own project with a KMS key, or a stated no-judge launch | A dispute needs someone who can rule within 72 hours | 10 |
| Treasury is a devnet test wallet | Squads vault `5CsBuTBF…3Hxe` (2 of 3) receives fees and holds upgrade authority | No single key can take fees or change the program | 17 |

The rest of the list keeps the launch caps (0.5 SOL or 100 USDC per Budget, provider share at most half), rehearses
the incident step on a mainnet build (pause, close all, resume, unfreeze, KMS grant removal), gives payers a way to
freeze a leaked agent key and close or pay out without the app, and ends with a review of the mainnet entry point at
its own commit. The code on main still refuses Budgets on mainnet (`lib/budget/runtime.ts`) until those are done.

## Per-call stays on devnet

```mermaid
flowchart LR
  subgraph mainnetBuild["Mainnet build"]
    b["/budget<br/>mainnet Budgets"]:::launch
    t["/try, /planner, /pass<br/>devnet, labelled"]:::live
  end
  b --> m[["RAP program, mainnet"]]:::launch
  t --> d[["RAP program, devnet"]]:::live
  classDef live fill:#e3f3ea,stroke:#0b7a4b,stroke-width:2px,color:#14161a
  classDef launch fill:#ece4ff,stroke:#6a35d9,stroke-width:2px,color:#14161a
```

Owner decision, 26 November 2026: pre-spend Budgets lead because people set a budget first and the agent spends inside
it. Direct per-call and per-escrow payments ([03](03-per-call-x402.md), [04](04-metered-escrow.md)) keep working on
devnet while their pricing and demand are worked out; the `/updates` page says so and why.
