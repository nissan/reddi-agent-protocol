import type { Metadata } from "next";
import Link from "next/link";

import { Prose, ProseSection } from "@/components/legal/Prose";
import { APP_POLICY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for paying and getting paid through the Reddi Agent Protocol app: what it does, what it costs, how refunds and disputes work, and the risks.",
};

export default function TermsPage() {
  const mail = `mailto:${APP_POLICY.contact}`;
  return (
    <Prose
      eyebrow={`Terms of use · Version ${APP_POLICY.version} · ${APP_POLICY.date}`}
      title="Terms of use"
      lead="These terms cover the Reddi Agent Protocol app: opening a Budget, paying a provider, running a provider, and the API your agent calls. By signing a transaction or a message the app asks for, or by using a Budget key, you agree to them."
    >
      <ProseSection id="what" title="What the app does">
        <p>Reddi Agent Protocol (RAP) is open-source software that lets buyers and their agents pay independent AI providers on Solana and get a signed receipt for each paid call. Payments are held and released by a program on Solana, under rules anyone can read.</p>
        <p><strong>We never hold your funds.</strong> Your wallet signs every lock. Funds sit in the on-chain program until they are paid to a provider or returned to you. We cannot move them anywhere else.</p>
        <p>Providers are independent. We do not run their models, and we do not promise the quality, accuracy or availability of any answer. A receipt records what a provider declared and what was paid. It does not prove which model ran.</p>
      </ProseSection>

      <ProseSection id="networks" title="Networks">
        <p>Each page says which Solana network it uses. On devnet, tokens are test tokens with no value. On mainnet, tokens are real. Check the network in your wallet before you sign.</p>
        <p>The mainnet release is a guarded beta. The program has been reviewed in several internal security rounds. It has not had an independent third-party audit. Use only amounts you can afford to lose.</p>
      </ProseSection>

      <ProseSection id="paying" title="Paying">
        <ul>
          <li><strong>You set the most that can be spent.</strong> A single call locks a maximum you approve. A Budget locks one amount for a set period, 72 hours by default.</li>
          <li><strong>You pay for what was used.</strong> Providers price per token, or per second for media. After the work, the provider is paid the actual cost and the rest of the lock returns to your wallet.</li>
          <li><strong>Budgets have limits you can see.</strong> Only the providers you picked can take a share, and no provider can take more than its cap, half the Budget by default.</li>
          <li><strong>Your agent&apos;s key spends your Budget.</strong> Anyone holding a Budget key can spend that Budget within its limits. Keep it secret. If it leaks, close the Budget.</li>
          <li><strong>Network fees.</strong> Solana charges a small fee for each transaction you sign. That fee goes to the network, not to us.</li>
        </ul>
      </ProseSection>

      <ProseSection id="fees" title="Our fee">
        <p>The protocol fee is 5% of what a provider is actually paid, with a launch rate of 2.5% for payouts before 1 April 2027 (UTC). It is taken out of the provider&apos;s share by the program at payout, so it adds nothing to the price a buyer approved. On payments in SOL the fee is capped at 0.1 SOL. No fee is charged on devnet test payments that have no value.</p>
        <p>Full detail is in <a href="/pricing.md">Pricing and fees</a>.</p>
      </ProseSection>

      <ProseSection id="refunds" title="Refunds, checks and disputes">
        <ul>
          <li><strong>Unused funds come back.</strong> Whatever is not paid to a provider returns to the wallet that locked it, when the call settles or the Budget closes.</li>
          <li><strong>If a provider never delivers,</strong> you can take a single-call lock back after its refund time. The app shows a refund link.</li>
          <li><strong>Budgets have a check period.</strong> After a Budget closes, each provider waits 24 hours before it is paid, unless you approve sooner. In that time you can dispute a provider&apos;s share.</li>
          <li><strong>A disputed share goes to the judge named when the Budget was opened.</strong> The judge decides how that share is split, and the program pays out on that decision. If the judge does not decide in time, the program applies its fallback rule. By default the judge is an agent run by RAP; a provider may refuse to work under a judge it does not accept.</li>
          <li><strong>Payments on Solana are final.</strong> Once the program has paid a provider, we cannot reverse it.</li>
        </ul>
      </ProseSection>

      <ProseSection id="providers" title="If you run a provider">
        <ul>
          <li>You are responsible for your service, your model licences, the content you return, your taxes and the laws that apply to you.</li>
          <li>Describe your service truthfully. The model you declare and the price you list are recorded in every receipt.</li>
          <li>Keep your payout wallet and token accounts open. A payout to a closed account can fail.</li>
          <li>If you accept rated jobs, you agree to rate the buyer in the time the program allows. Ratings and attestations are public and permanent.</li>
          <li>We may remove a listing from the app&apos;s directory if it is misleading, abusive or unlawful. We cannot remove an on-chain registration.</li>
        </ul>
      </ProseSection>

      <ProseSection id="rules" title="Rules for everyone">
        <ul>
          <li>Do not use the app for anything unlawful, or to send content you have no right to send.</li>
          <li>Do not try to break, overload or get around the app&apos;s limits, or another person&apos;s Budget.</li>
          <li>You must be allowed to use digital assets where you live, and you must not be subject to sanctions.</li>
          <li>You are responsible for your wallet, your keys and your Budget keys.</li>
        </ul>
      </ProseSection>

      <ProseSection id="risk" title="Risks you accept">
        <p>Software can have faults. Blockchains can be congested or change. Tokens can lose value, and the issuers of some stablecoins can freeze them. A provider can go offline. We may pause new payments in the app if we see a problem; funds already locked stay under the program&apos;s rules.</p>
        <p>The app and the software are provided as they are, without warranties, to the extent the law allows. To that same extent, we are not liable for lost funds, lost profits or indirect loss arising from your use of them. Nothing here removes rights you have under consumer law that cannot be excluded, including the Australian Consumer Law.</p>
        <p>Nothing in the app is financial, investment or legal advice, and nothing here offers a token or an investment.</p>
      </ProseSection>

      <ProseSection id="other" title="Other things to know">
        <p>The software is open source under the licence in its public repository. Reddi Agent Protocol is an independent project.</p>
        <p>We may update these terms. The version and date at the top change when we do, and the new terms apply to what you sign after that date. These terms are governed by the laws of New South Wales, Australia.</p>
        <p>How we handle data is in the <Link href="/privacy">Privacy notice</Link>. Questions: <a href={mail}>{APP_POLICY.contact}</a>.</p>
      </ProseSection>
    </Prose>
  );
}
