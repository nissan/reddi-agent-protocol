// The hero illustration: a sample receipt. Every value is made up and the card says so; it is a picture of the idea,
// not a record of a transaction.
const ROWS: [string, string][] = [
  ["request", "POST /v1/chat/completions"],
  ["provider", "sample-provider.example"],
  ["model declared", "open-model-7b-instruct"],
  ["request hash", "9f2c…a41e"],
  ["response hash", "5b07…d3c9"],
  ["paid", "0.002 USDC · x402 · Solana devnet"],
  ["payment tx", "4xQp…sample"],
  ["provider signature", "ed25519 · 7Hn3…sample"],
];
export default function Receipt() {
  return (
    <figure className="receipt" aria-label="Illustration of an inference receipt with sample values">
      <div className="receipt-paper">
        <p className="receipt-head"><b>INFERENCE RECEIPT</b><span>SAMPLE</span></p>
        <dl>{ROWS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="receipt-check"><span aria-hidden="true">✓</span> signature matches provider key</p>
        <p className="receipt-foot">Illustration with made-up values. Not a live transaction.</p>
      </div>
    </figure>
  );
}
