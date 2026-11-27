// The run's ledger: who was hired, what each call billed, and the on-chain payouts read back from the
// transactions themselves (token balance changes), as JSON and as one self-contained HTML page.
import { accountLink, explorer } from "./chain.mjs";
import { usdc } from "./plan.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * Sums a payout's token moves into what the provider got, the protocol fee and the payer's refund.
 * `moves` is { tokenAccount: { owner, delta } } from chain.tokenMoves.
 */
export function splitPayout(moves, { payoutAccount, treasuryTokens, payerTokens }) {
  const get = (a) => moves[a]?.delta ?? 0n;
  return { provider: get(payoutAccount), fee: get(treasuryTokens), refund: get(payerTokens) };
}

export function totals(ledger) {
  const t = { provider: 0n, fee: 0n, refund: BigInt(ledger.close?.refund ?? 0) };
  for (const p of ledger.payouts) {
    t.provider += BigInt(p.provider);
    t.fee += BigInt(p.fee);
    t.refund += BigInt(p.refund);
  }
  t.spent = t.provider + t.fee;
  return t;
}

export function renderLedger(ledger) {
  const t = totals(ledger);
  const rows = ledger.payouts
    .map(
      (p) => `<tr><td><strong>${esc(p.name)}</strong><br><a href="${accountLink(p.wallet)}">${esc(short(p.wallet))}</a></td>
<td class="n">${usdc(p.reserved)}</td><td class="n">${usdc(p.posted)}</td><td class="n paid">${usdc(p.provider)}</td><td class="n">${usdc(p.fee)}</td><td class="n">${usdc(p.refund)}</td>
<td><a href="${explorer(p.signature)}">payout</a></td></tr>`,
    )
    .join("\n");
  const calls = ledger.calls
    .map((c) => `<tr><td>${esc(c.role)}</td><td class="n">${c.sequence}</td><td>${esc(c.action)}</td><td><code>${esc(c.task ?? "")}</code></td><td class="n">${usdc(c.cost)}</td></tr>`)
    .join("\n");
  const files = ledger.files
    .map((f) => `<li><a href="${esc(f.url)}">${esc(f.name)}</a> · ${esc(f.role)} · ${(f.size / 1024).toFixed(0)} KB · sha256 <code>${esc(f.sha256.slice(0, 16))}…</code> ${f.verified ? "✓ checked" : ""}</li>`)
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grokbot run ledger</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--line:#e4e1d8;--accent:#0f766e;--card:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151514;--fg:#ecebe6;--muted:#a19f97;--line:#2e2d2a;--accent:#5eead4;--card:#1d1d1b}}
:root[data-theme="dark"]{--bg:#151514;--fg:#ecebe6;--muted:#a19f97;--line:#2e2d2a;--accent:#5eead4;--card:#1d1d1b}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}
.muted{color:var(--muted)}a{color:var(--accent)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.tile b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;background:var(--card)}
th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
.n{text-align:right;font-variant-numeric:tabular-nums}.paid{color:var(--accent);font-weight:600}
code{font-size:12px}blockquote{margin:0;padding:8px 12px;border-left:3px solid var(--accent);background:var(--card)}
</style></head><body><main>
<h1>Grokbot hired four providers from one Budget</h1>
<p class="muted">Devnet · test USDC · ${esc(ledger.finishedAt)} · Budget <a href="${accountLink(ledger.budget)}">${esc(short(ledger.budget))}</a></p>
<div class="tiles">
<div class="tile"><span class="muted">Budget</span><b>${usdc(ledger.total)}</b></div>
<div class="tile"><span class="muted">Paid to providers</span><b>${usdc(t.provider)}</b></div>
<div class="tile"><span class="muted">Protocol fee</span><b>${usdc(t.fee)}</b></div>
<div class="tile"><span class="muted">Back to Grokbot</span><b>${usdc(t.refund)}</b></div>
</div>
<h2>The brief</h2><blockquote>${esc(ledger.brief)}</blockquote>
<p class="muted">Team picked by ${esc(ledger.brain)}: ${esc(ledger.why)}</p>
<h2>Who got paid</h2>
<div class="scroll"><table><thead><tr><th>Provider</th><th class="n">Reserved</th><th class="n">Earned</th><th class="n">Paid</th><th class="n">Fee</th><th class="n">Returned</th><th></th></tr></thead><tbody>
${rows}
</tbody></table></div>
<p class="muted">Earned is the total each provider posted from its own metered calls. The slice was paid at once because Grokbot's spender waived the dispute window after checking each file on delivery. Budget <a href="${explorer(ledger.open.signature)}">opened</a> · <a href="${explorer(ledger.close.signature)}">closed</a> (${usdc(ledger.close.refund)} unreserved returned).</p>
<h2>What was made</h2>
<p><strong>${esc(ledger.script.title)}</strong></p><blockquote>${esc(ledger.script.voiceover)}</blockquote>
<ul>${files}</ul>
<h2>Every call</h2>
<div class="scroll"><table><thead><tr><th>Desk</th><th class="n">#</th><th>Action</th><th>Task</th><th class="n">Billed</th></tr></thead><tbody>
${calls}
</tbody></table></div>
<p class="muted">Each answer carried a provider-signed receipt naming this Budget; Grokbot checked every one.</p>
</main></body></html>
`;
}
