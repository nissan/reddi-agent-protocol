# Reddi Agent Protocol pricing and fees

> Providers set a price per million tokens. Buyers lock the most a call can cost, pay only for the tokens actually used, and get the rest back. A planned protocol fee of 5% (2.5% at the launch rate) comes out of the provider's share; buyers pay nothing on top.

Reddi Agent Protocol (RAP) is an open marketplace for paid AI inference on Solana, answering the Solana Foundation's Request for Startups item "An open marketplace for AI inference" (https://solana.com/request-for-startups#ai-inference-marketplace). Not affiliated with or endorsed by the Solana Foundation. Payments prove transfer; RAP Assurance proves paid work.

## Why Solana

An agent might buy hundreds of small answers a day. Each payment needs a public record anyone can check, and it has to land fast so the agent isn't left waiting. Solana does both at a cost low enough to use on every call:

- **A public record anyone can check.** Every lock and settle is a Solana transaction.
- **Confirms in under a second**, so payment never bottlenecks a real-time answer.
- **Network fee of about 0.000005 SOL per transaction**, a tiny fraction of a cent, and still tiny with a priority fee added.

So a ten-cent answer is still worth selling and still worth buying, and both the agent and the provider stay ahead on every call. Payments this small only work on a network that is fast and nearly free to use.

## How a call is priced

1. **The provider's price.** Each listing names a price per million input tokens and per million output tokens, in one currency.
2. **The quote.** An unpaid request comes back as HTTP 402 with that price, an estimated cost for this request, and a suggested maximum: twice the estimate by default, never below it.
3. **The buyer's maximum.** The buyer authorises a maximum and locks it in a metered escrow payable to the provider. The charge can never exceed it.
4. **The actual cost.** After the model answers, the provider counts the tokens used and settles tokens used times the price, rounded up to the smallest unit of the currency.
5. **The split.** In the same transaction the escrow program pays the provider, sends the protocol fee to the RAP treasury and returns the unused part of the maximum to the buyer.

## The protocol fee

| | |
|---|---|
| Standard rate | 5% (500 basis points) of the actual cost. |
| Launch rate | 2.5% (250 basis points) for payouts before 1 April 2027, 00:00 UTC. The rate is read when the payout happens. |
| Who pays it | It comes out of the provider's share. The buyer pays the actual cost and nothing on top. |
| Rounding | Rounded down to the smallest unit of the currency. |
| SOL cap | At most 0.1 SOL per payment on SOL payments. Stablecoin payments have no cap. |
| Status | Planned: set in the V1 escrow program and paid on every settle, release and claim once it is on mainnet. Mainnet is coming soon. |

## Founding Providers

The first 100 services to take a paid job on mainnet become Founding Providers. Every 90 days for their first year, Founding Providers rated 4.5 stars or better, from at least 10 rated jobs by 5 different buyers, and ranked in the top 100 by volume get back every fee they paid above 1.5%. The rebate never exceeds the fees paid, and one owner wallet can hold up to 3 seats. Ratings are on chain, so anyone can check who qualified.

## Currencies

- SOL, USDC, AUDD, PYUSD and USDG for per-call payments and escrow.
- PYUSD and USDG are Token-2022 mints. A provider can pause a currency without delisting.
- The provider kit prices in USDC, AUDD, PYUSD or USDG.

## Worked example

A provider lists a model at 3 USDC per million input tokens and 15 USDC per million output tokens. A request is quoted with an estimate of 0.012 USDC, so the suggested maximum is 0.024 USDC, which the buyer locks.

The model reads 1,000 input tokens and writes 500 output tokens:

| | USDC |
|---|---|
| Input: 1,000 × 3 / 1,000,000 | 0.003000 |
| Output: 500 × 15 / 1,000,000 | 0.007500 |
| Actual cost, paid by the buyer | 0.010500 |
| Protocol fee at the 2.5% launch rate | 0.000262 |
| Provider receives | 0.010238 |
| Returned to the buyer (0.024 − 0.0105) | 0.013500 |

At the standard 5% rate the fee on the same call is 0.000525 USDC and the provider receives 0.009975 USDC.

## Sessions

An agent that makes many small calls can lock once and make numbered calls against that lock. The provider settles once, for the total, and the fee applies to that total. Every receipt in the session chains to the one before, so the buyer can check the whole run.

## Pooled budgets

An agent can lock one budget and spend it across several providers. Each provider reserves a slice, meters its calls at its own per-token price and is paid its total when the budget ends. The fee applies to each provider's total, and whatever no provider used goes back to the agent. A budget is in one token, and only providers priced in that token take part.

## More

- Buyer skill: https://app.agent-protocol.reddi.tech/skill.md
- Provider skill: https://app.agent-protocol.reddi.tech/provider.md
- Market case and revenue model: https://agent-protocol.reddi.tech/market
- Index for agents: https://app.agent-protocol.reddi.tech/llms.txt
