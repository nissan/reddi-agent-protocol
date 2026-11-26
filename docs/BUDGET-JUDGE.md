# The RAP judge for Budget disputes

Owner decisions, 26 November 2026: the default judge every Budget names is a RAP-run
judge that rules by a published evidence rule, and Nissan can hold any dispute and rule
it by hand ("Evidence rule, you can override"). Its key lives in its own Vercel
project. Vercel KMS has no Ed25519 keys, which the program needs for a judge, so the
key is a sensitive environment variable on that project only ("Sealed env var in its
own project", same day). Design: thread "Build the RAP judge for Budget
disputes"; audit 1079ce8 S7-claude-05 and S2-claude-16; #1157 item 10.

## What the judge decides

When a payer disputes a provider's post, the slice waits for the judge named on the
Budget (`resolve_budget` / `resolve_token_budget`). The judge sends the provider an
amount up to its post; the rest goes back to the payer. If nobody rules within the
Budget's judge window (72 hours on the Budget page), the program refunds the payer in
full.

The RAP judge answers one question: **did the provider serve the calls it charged
for?** It does not judge answer quality in V1.

## Rule `rap-judge-rule/1` (`lib/budget/judge/rule.ts`)

1. Take every receipt the judge holds for the slice: the copy of each call's
   `x-reddi-provider-receipt` the relay saved, and any receipt the provider sent to the
   evidence route.
2. A receipt counts only if it verifies for this slice: `reddi.receipt.v2` signed by the
   provider's wallet (the slice's payee), naming this Budget, its opening
   (`createdSlot`), the reservation and the payer, on this network. On devnet the
   sandbox providers' `rap.sandbox.budget-receipt.v1` counts too.
3. Its calls served (`session.sequence`) must be no more than the calls the Budget's
   spender signed for this provider, and the request it answered (`requestHash`) must
   be one of the bodies the spender signed (`budget_spender_uses`, purpose `call`).
4. Of the receipts that count, the latest (most calls served) decides: the provider gets
   the smaller of its post and the receipt's `cumulativeCost`.
5. With no receipt that counts, the provider gets 0, as when nobody rules.

The ruling is the same whoever disputes and however often. Each ruling transaction
carries a memo `rap-judge rap-judge-rule/1 <evidence hash>`, and the judge's log
(`budget_judge_log`) keeps the evidence hash, the receipt it rested on and why other
receipts were set aside.

RAP runs both the judge and some of the providers it judges (the dogfood and sandbox
providers). The rule is mechanical and every ruling is on chain with its evidence, so
anyone can check a ruling against it.

## Timing

Counted from the dispute, against the Budget's judge window (72 hours):

| When | What happens |
| --- | --- |
| Next pass (every 10 minutes) | The judge sees the dispute, logs it and emails the operator. |
| At once | A slice whose receipts cover the whole post is ruled. |
| Up to a third of the window (24 h) | A ruling short of the post waits for more evidence. |
| A third of the window | The judge rules on what it has. |
| Two thirds of the window (48 h) | Nothing is ruled automatically after this; the operator is reminded every 6 hours. |
| The window's end | The program refunds the payer in full without a ruling. |

## Nissan's override

`POST /api/v1/ops` with `Authorization: Bearer <BUDGET_JUDGE_OPS_SECRET>`:

- `{ "action": "hold", "budget", "payee", "reason" }`: the judge rules nothing on that
  slice automatically.
- `{ "action": "release", "budget", "payee", "reason" }`: lifts the hold.
- `{ "action": "rule", "budget", "payee", "payout", "reason" }`: rules by hand, `payout`
  in base units (at most the post), signed by the same key. Allowed until the
  judge's window ends, held or not.

A hold or release counts only with the judge's MAC over its place in the slice's log
(keyed from `BUDGET_JUDGE_OPS_SECRET`), so a row the app writes can neither hold nor
release a dispute.

## For providers

- List the RAP judge in `budgets.acceptedJudges`. A provider-kit desk with an empty list
  takes only Budgets with no judge, and every Budget opened on the Budget page names
  the RAP judge.
- Return the signed receipt on every Budget call (the provider kit does). If the relay
  did not pass it on, send your latest receipt for a disputed slice within 24 hours:
  `POST <judge>/api/v1/evidence` with `{ "budget", "payee", "receipt" }`, the receipt as
  its header value.

## Key and project

| Setting (rap-budget-judge) | Value |
| --- | --- |
| `BUDGET_JUDGE_NETWORK` | `solana-devnet` (default) or `solana-mainnet-beta`, one project and one key per network |
| `BUDGET_JUDGE_SECRET_KEY` | The judge's keypair as `solana-keygen` writes it (a JSON array of 64 bytes). Sensitive, Production only, set by Nissan; never stored anywhere else but 1Password |
| `BUDGET_JUDGE_ADDRESS` | The key's public address; the key must derive it, and every signature is checked against it |
| `BUDGET_JUDGE_PROGRAM_ID`, `BUDGET_JUDGE_RPC_URL` | Required on mainnet; devnet defaults to `config/networks/devnet.json` and the public RPC |
| `BUDGET_JUDGE_CRON_SECRET` | The pass; also the repository secret of the same name, with variable `BUDGET_JUDGE_ORIGIN` (`.github/workflows/budget-judge-pass.yml`) |
| `BUDGET_JUDGE_OPS_SECRET` | The override, at least 32 characters; saved in 1Password |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Devnet: the call log, receipts and the judge's log (tables in `public`) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `BUDGET_JUDGE_ROLE_TOKEN` | Mainnet: the same, in schema `budget_mainnet`, as role `budget_mainnet_judge`. Sensitive token; no service role key on the mainnet judge |
| `RESEND_API_KEY`, `BUDGET_ALERT_FROM`, `BUDGET_OPS_EMAIL` | Operator email |

- Mainnet evidence lives with the mainnet records (`supabase/migrations/20261127100000_budget_mainnet_judge.sql`,
  #1210). The mainnet app holds no service role key, so its relay saves each call's receipt
  with the role token it already has (`BUDGET_CUSTODY_ROLE_TOKEN`, role `budget_mainnet_app`):
  it may add relay receipts and can read neither them nor the judge's log. The mainnet judge
  project has its own token (`BUDGET_JUDGE_ROLE_TOKEN`, role `budget_mainnet_judge`, made the
  same way as the signer's and the app's tokens in `docs/BUDGET-RELAY-CUSTODY.md`): it reads
  the receipts and which calls the spender signed, adds providers' receipts and writes its
  log, and cannot write the relay's records. A mainnet relay route passes its network to
  `judgeStore(env, network)` and refuses to serve calls when that returns nothing, so
  receipts are never dropped without a sign.
- Making the key (Nissan, on his Mac): `solana-keygen new --no-bip39-passphrase -o
  /tmp/judge.json`, then `solana-keygen pubkey /tmp/judge.json` is `BUDGET_JUDGE_ADDRESS`.
  Save the file's contents to 1Password, paste them as the sensitive
  `BUDGET_JUDGE_SECRET_KEY` on this project only, and delete the file. No other project,
  workflow or repository holds it.
- Register the judge before any Budget names it. `open_budget` reads the judge's agent
  record (`["agent", judge]`) and refuses a judge that is not an active attestation
  agent, so with `BUDGET_DEFAULT_JUDGE` set to an unregistered address every new Budget
  fails to open (`AccountNotInitialized`). Order: fund the judge, send `register_agent`
  signed by its key (agent type 1, fee 0.01 SOL), check the record exists, and only then
  set `BUDGET_DEFAULT_JUDGE` on the app and the signer. Devnet record:
  `J5zeR6m9ZSdyjqPeS7QNFkqvpLQRPMqKfwCWX43W5kdt` for judge
  `9Zv4HWNRt5WzSjBkbmJnGPtAT7vrcG8NxTzcd2iGF576` (26 November 2026).
- The app checks this too (`lib/budget/judge-registry.ts`, #1210): before a payer signs
  anything, the open routes read the judge's record. While it is missing, not an
  attestation agent or not active they answer 503 `judge_not_ready`, and the operator
  gets a `judge_not_registered` alert (at most once an hour). A record that could not be
  read refuses that one request without an alert. A good answer is cached for a minute
  and a bad one for ten seconds, so registering the judge reopens Budgets without a
  redeploy.
- The judge pays its own fees: keep at least 0.01 SOL on its address (health shows the
  balance; the pass warns below that). A token ruling may also pay rent for the payer's
  token account.
- Never rotate the key while any Budget naming the judge is unsettled: a Budget's judge
  is fixed when it opens. A new key is a new judge for new Budgets.
- If the key is lost, disputed slices refund their payers in full when the window ends.
- `GET /api/v1/health` names the judge, network, program, rule and balance. Point the
  uptime monitor at it.
