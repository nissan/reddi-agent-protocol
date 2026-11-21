# Devnet escrow end-to-end run

`scripts/devnet-escrow-e2e.cjs` exercises the V1 escrow program deployed on devnet
(`DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu`, see `DEPLOY.md`) in SOL and devnet USDC, with real
transactions. It complements the local-validator lane (`archive/anchor-escrow/tests/local_token_escrow.cjs`),
which covers the same paths with slot warps but never touches a public cluster.

Before it signs anything the script checks that the RPC is devnet (genesis hash) and that the deployed
program bytes hash to the recorded `5055df46…e142a`. It refuses otherwise.

## Modes

| Mode | Signs | What it does |
| --- | --- | --- |
| `plan` | no | Reads balances of the two wallets and the treasury, simulates the SOL and USDC locks unsigned, lists shortfalls. Needs only `RAP_E2E_PAYER` and `RAP_E2E_PAYEE` (public addresses). |
| `run` | yes | Per currency: lock → payer release; metered lock → payee settle at a lower actual cost; lock → payee decline. Early claim, early payer refund, settle above the maximum, settle of zero, payee settle of an unmetered escrow, a release to the wrong account and replays are simulated with real signatures and must be refused. Then it leaves one "refund" and one "claim" escrow open per currency. |
| `finish-refund` | yes | After the cancel window (648,000 slots, about 3 days): payer refunds the open "refund" escrows. Before that it only shows the refusal. |
| `finish-claim` | yes | After the claim window (1,512,000 slots, about 7 days): payee claims the open "claim" escrows, fee included. Before that it only shows the refusal. |

Every fee is checked from the transaction's own balance changes, so other traffic to the treasury (the
sandbox settles there too) cannot disturb the checks.

## Inputs

- `RAP_E2E_PAYER_KEYPAIR`, `RAP_E2E_PAYEE_KEYPAIR`: absolute paths to two different devnet wallets'
  keypair files (signing modes only). The script reads them and never prints or writes key material.
  The payer pays rent and the fees of its own actions. The payee signs its own actions alone and pays their
  fees, because the SOL release and settle instructions treat any payer signature as a payer action and a fee
  payer always signs. `run` sends the payee 0.01 SOL first when it holds under 0.005 SOL.
- `RAP_E2E_RUN_ID`: 3-40 letters, digits or dashes. Escrow nonces derive from it, so the finish modes
  must use the same value as `run`. A run id can be used once: `run` refuses one whose escrows already exist.
- `RAP_E2E_LEFTOVER_RUN_ID` (optional, `run` only): an earlier interrupted run. The payer closes its open
  escrows first by settling each at one base unit, so the rest returns to the payer.
- `RAP_E2E_OUT_DIR` (optional, absolute): one JSON result file per mode.
- `RAP_E2E_RPC` (optional): defaults to `https://api.devnet.solana.com`.

The payer needs about 0.1 devnet SOL and 3.7 devnet USDC (mint `4zMMC9…cDU`); `plan` reports any
shortfall. Devnet RPC airdrops are closed, so fund from faucet.solana.com and faucet.circle.com.

## Example

```bash
export RAP_E2E_PAYER=<payer address> RAP_E2E_PAYEE=<payee address>
npm run e2e:devnet:escrow -- plan

export RAP_E2E_PAYER_KEYPAIR=/abs/payer.json RAP_E2E_PAYEE_KEYPAIR=/abs/payee.json
export RAP_E2E_RUN_ID=v1-2026-11-21 RAP_E2E_OUT_DIR=/abs/out
npm run e2e:devnet:escrow -- run
# about 3 days later, then about 7 days later
npm run e2e:devnet:escrow -- finish-refund
npm run e2e:devnet:escrow -- finish-claim
```
