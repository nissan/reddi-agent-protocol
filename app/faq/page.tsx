import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Plain answers about paying AI providers through Reddi Agent Protocol: Budgets, refunds, disputes, fees, receipts, tokens and running a provider.",
};

type Faq = { question: string; answer: string[] };

const GROUPS: { id: string; title: string; faqs: Faq[] }[] = [
  {
    id: "paying",
    title: "Paying",
    faqs: [
      { question: "What is a Budget?", answer: [
        "One amount you lock from your own wallet, in one token, for a set time: $5 for 72 hours is the default. Your agent gets a key that spends from it, only with the providers you picked.",
        "Think of it as a prepaid card with a short list of shops. No provider can take more than its cap, half the Budget by default.",
      ] },
      { question: "Does my agent hold my wallet?", answer: [
        "No. Your wallet signs the lock once. Your agent holds a Budget key, which can only spend that Budget inside its limits. If the key leaks, close the Budget and what is left comes back to you.",
      ] },
      { question: "What happens to money my agent does not spend?", answer: [
        "It comes back to the wallet that locked it. For a single call, the unused part of the maximum returns when the provider settles. For a Budget, whatever no provider took returns when the Budget closes.",
      ] },
      { question: "A provider took my lock and never answered. What now?", answer: [
        "Nothing is paid until the provider settles. If it never does, you can take a single-call lock back once its refund time passes, and the app shows a refund link. In a Budget, a provider that posts nothing is paid nothing.",
      ] },
      { question: "How do I dispute what a provider charged?", answer: [
        "After a Budget closes, each provider waits 24 hours before it is paid. In that time, open your Budget page and press Dispute on that provider's share. The email we send for each share has the same link.",
        "A disputed share goes to the judge named when the Budget was opened. The judge decides the split and the program pays out on it. If you are happy sooner, press Approve and the provider is paid without waiting.",
      ] },
      { question: "Do I need a judge?", answer: [
        "No. When you open a Budget you choose. With the RAP judge, it works like insurance: each provider waits 24 hours after the Budget closes, so you can check what it posted and dispute it, and Approve pays a provider at once when you are happy.",
        "Without a judge nobody can dispute a share, so there is nothing to wait for: each provider is paid as soon as it posts what it is owed, never more than its share, and the rest of its share comes back to you.",
        "Pick no judge only for providers you trust. The RAP judge is the default because it protects you.",
      ] },
      { question: "Who is the judge?", answer: [
        "By default it is a judge agent run by Reddi Agent Protocol. The judge can only split a disputed share between you and that provider. It cannot send funds anywhere else.",
        "It follows one published rule. It checks the provider's own signed receipts against the calls your agent actually made through the Budget. The provider is paid what those receipts show, up to what it posted, and the rest comes back to you. With no receipts that match, you get the whole share back.",
        "It checks whether the calls were served, not how good the answers were. It rules within a day, sooner when the receipts already cover the post. A person at RAP can step in on any dispute. If no one rules within 72 hours, the whole share comes back to you.",
        "RAP also runs some of the providers you can pick, so every ruling is on chain with a note naming the rule and the evidence it used.",
      ] },
      { question: "Which tokens can I pay with?", answer: [
        "SOL, USDC, PYUSD, USDG and AUDD on mainnet. On devnet, test SOL and test USDC. A Budget is in one token, and only providers priced in that token can take part.",
      ] },
    ],
  },
  {
    id: "costs",
    title: "Costs",
    faqs: [
      { question: "What does a call cost?", answer: [
        "Providers set a price per million input and output tokens, or per second for media. Before a call you see an estimate and approve a maximum, twice the estimate by default. You pay for the tokens actually used.",
      ] },
      { question: "What is the protocol fee?", answer: [
        "5% of what a provider is paid, with a launch rate of 2.5% for payouts before 1 April 2027 (UTC). It comes out of the provider's share, so it adds nothing to the price you approved. On SOL payments it is capped at 0.1 SOL.",
      ] },
      { question: "What is the judge-free payback?", answer: [
        "Until 1 April 2027 (UTC), a provider paid through a Budget with no judge keeps the whole payment. The fee still comes out at payout, and on 1 April 2027 RAP pays it all back to the provider's wallet in the same token, with a soulbound receipt NFT that records the amount.",
        "The cut-off is when the payout lands: from 1 April 2027, 00:00 UTC, payouts pay the standard 5% and nothing comes back. RAP's own providers and the RAP treasury are left out. Judge-free payouts already get their whole fee back, so the Founding Provider rebate counts only fees on judged Budgets. No fee is paid back twice. The list comes from the program's on-chain records and is published before the payback, so anyone can check it.",
      ] },
      { question: "What about network fees?", answer: [
        "Solana charges a tiny fee for each transaction, a fraction of a cent. A single metered call is two transactions: the lock you sign and the provider's settle.",
      ] },
    ],
  },
  {
    id: "trust",
    title: "Receipts and trust",
    faqs: [
      { question: "What does a receipt prove?", answer: [
        "That this provider signed for this answer, with hashes of what you asked and what you got, the tokens it counted, and the payment that covered it. Anyone can check the signature and the transaction.",
        "It records the model the provider declares. It does not prove which model actually ran. Payments prove transfer; RAP Assurance proves paid work.",
      ] },
      { question: "What do the scores on a provider mean?", answer: [
        "They come from ratings on jobs paid through escrow that both sides agreed to have rated. They are not a review of every job, and one owner can run several wallets, so read a score as a signal, not a guarantee.",
      ] },
      { question: "Does Reddi Agent Protocol hold my funds?", answer: [
        "No. Funds sit in the on-chain program until they are paid to a provider or returned to you. We cannot move them anywhere else.",
      ] },
      { question: "Has the program been audited?", answer: [
        "It has been through several internal security review rounds. It has not had an independent third-party audit yet. The mainnet release is a guarded beta, so use amounts you can afford to lose.",
      ] },
    ],
  },
  {
    id: "networks",
    title: "Devnet and mainnet",
    faqs: [
      { question: "Is this real money?", answer: [
        "Each page says which network it uses. Devnet uses test tokens with no value, so it is the safe place to try everything. Mainnet uses real tokens. Check the network in your wallet before you sign.",
      ] },
      { question: "Can I try it without a wallet?", answer: [
        "Yes. The sandbox walks through paying, shopping around, a Budget and attempts to cheat with simulated payments.",
      ] },
    ],
  },
  {
    id: "providers",
    title: "Running a provider",
    faqs: [
      { question: "How do I sell my model or agent?", answer: [
        "Install the provider kit, point it at any OpenAI-compatible model, set your price per million tokens and start it. The kit answers unpaid requests with a price, checks the lock, meters the call, settles and signs the receipt.",
      ] },
      { question: "When am I paid?", answer: [
        "For a single call, when your provider settles, usually seconds after the answer. For a Budget, after it closes and the 24-hour check period ends, or sooner if the payer approves.",
      ] },
      { question: "What is a Founding Provider?", answer: [
        "One of the first 100 services to take a paid job on mainnet. For their first year, Founding Providers rated 4.5 stars or better and ranked in the top 100 by volume get back every fee they paid above 1.5%, every 90 days. It counts only fees on judged Budgets, because judge-free payouts get their whole fee back on 1 April 2027.",
      ] },
      { question: "My registration failed with \"account already in use\".", answer: [
        "That wallet is already registered. One wallet maps to one registration. Update the existing registration, or use another wallet for a second provider.",
      ] },
    ],
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-4xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <header>
          <p className="section-label">FAQ</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">Questions people ask before they pay</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
            Short answers about Budgets, refunds, disputes, fees and receipts. The rules behind them are in the{" "}
            <Link className="underline hover:text-white" href="/terms">Terms of use</Link>, and the steps are in the{" "}
            <Link className="underline hover:text-white" href="/docs">Docs</Link>.
          </p>
        </header>
        {GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`faq-${group.id}`} className="mt-12" data-testid={`faq-${group.id}`}>
            <h2 id={`faq-${group.id}`} className="font-display text-2xl font-bold text-white">{group.title}</h2>
            <div className="mt-4 space-y-4">
              {group.faqs.map((faq) => (
                <article key={faq.question} className="rounded-xl border border-white/10 bg-paper-raised p-6">
                  <h3 className="font-display text-lg font-semibold text-white">{faq.question}</h3>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-gray-300">
                    {faq.answer.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
        <p className="mt-12 text-sm text-gray-400">
          Something missing? Write to <a className="underline hover:text-white" href="mailto:hello@reddi.tech">hello@reddi.tech</a>.
        </p>
      </div>
    </div>
  );
}
