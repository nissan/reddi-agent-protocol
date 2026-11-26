import type { Metadata } from "next";
import Link from "next/link";

import { Prose, ProseSection } from "@/components/legal/Prose";
import { APP_POLICY } from "@/lib/legal";
import { ANALYTICS_REGION } from "@/lib/analytics/enabled";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What the Reddi Agent Protocol app collects when you sign in, open a Budget, pay a provider or run one, who handles it, and your choices.",
};

export default function PrivacyPage() {
  const mail = `mailto:${APP_POLICY.contact}`;
  return (
    <Prose
      eyebrow={`Privacy notice · Version ${APP_POLICY.version} · ${APP_POLICY.date}`}
      title="Privacy notice"
      lead="This notice covers the Reddi Agent Protocol app. You can browse it, read the docs and use the sandbox preview without an account or a wallet. We collect only what paying, getting paid, keeping you informed and counting visits need."
    >
      <ProseSection id="public" title="What is public by design">
        <p>Solana is a public ledger. Your wallet address, every lock, payout, refund, rating and attestation, and the amounts involved, are visible to anyone and cannot be deleted by us or by you. Do not use a wallet you want kept private.</p>
      </ProseSection>

      <ProseSection id="collect" title="What we collect, and why">
        <ul>
          <li><strong>Wallet sign-in.</strong> When you sign in, your wallet signs a message. We keep your wallet address and a session so the app can show your jobs and listings. Signing in does not move funds.</li>
          <li><strong>Budget alerts.</strong> If you give an email address when you open a Budget, we use it only to tell you when a provider takes a share, posts what it is owed, or when something needs your attention. We keep it with that Budget&apos;s record.</li>
          <li><strong>Budget records.</strong> For each Budget opened in the app we keep its on-chain address, your wallet address, the providers and limits you chose, the message you signed, and a log of approvals. We keep a hash of your agent&apos;s key, never the key itself. The key that signs for your agent is held in a managed key service and cannot be exported.</li>
          <li><strong>Calls your agent makes.</strong> A call made with a Budget key or an agent pass goes through our relay to the provider you chose. We pass the request and the answer on and do not store their content. We keep what payment needs: the time, the provider, the call number, hashes of the request and answer, token counts, the cost and the receipt.</li>
          <li><strong>Jobs and receipts.</strong> After a payment is checked on chain, we keep the job record: buyer and provider wallet addresses, token counts, amounts, transaction signatures and the signed receipt.</li>
          <li><strong>Provider listings.</strong> If you list a provider, we keep and publish what you entered: name, endpoint address, models, prices and your service description. Do not put personal information in a listing.</li>
          <li><strong>Request logs.</strong> Our hosting provider keeps ordinary request logs, including IP addresses, for security, rate limiting and reliability.</li>
        </ul>
      </ProseSection>

      <ProseSection id="analytics" title="Visit counts and analytics">
        <p><strong>Visit counts.</strong> Our hosting provider, Vercel, counts visits to the app for us with its Web Analytics. It sets no cookies and stores nothing in your browser, and it has no ID that follows you from one day to the next. It records the page you opened, with any wallet address, key or other ID in the link removed, the site that linked you here, our own campaign labels if the link had them, and your country, browser and type of device.</p>
        <p><strong>Optional analytics.</strong> Anything more is off until you choose. The first time you visit, the app asks. If you allow it, we use {ANALYTICS_REGION ? `PostHog (${ANALYTICS_REGION})` : "PostHog"} to count which pages are opened and clicks on links to other sites, and to see which of our own campaign links brought you here. It uses a random anonymous ID kept in this browser. Like any website you connect to, PostHog receives your IP address with each request and may use it to estimate a rough location. It never receives your wallet address, your email address or any key, it does not record your screen, and it sets no advertising trackers.</p>
        <p>You can change your mind at any time with Privacy settings at the foot of every page. Withdrawing stops collection at once and removes PostHog&apos;s identifiers from this browser. The app runs no advertising trackers.</p>
      </ProseSection>

      <ProseSection id="providers-see" title="What a provider sees">
        <p>The provider you pay receives your request so it can answer it, along with the payment details that prove it will be paid. Each provider handles that content under its own terms. Do not send a provider anything you would not want it to have.</p>
      </ProseSection>

      <ProseSection id="who" title="Who handles data for us">
        <ul>
          <li><strong>Vercel</strong> hosts the app and the key service, keeps request logs and counts visits.</li>
          <li><strong>PostHog</strong> receives the optional analytics, only if you allow it.</li>
          <li><strong>Supabase</strong> stores sign-in sessions, listings, jobs and Budget records.</li>
          <li><strong>Resend</strong> sends Budget alert emails.</li>
          <li><strong>A Solana RPC provider</strong> receives the transactions and read requests the app makes for you, with your IP address.</li>
        </ul>
        <p>These services may process data outside Australia, including in the United States. We do not sell personal information or share it for advertising.</p>
      </ProseSection>

      <ProseSection id="keep" title="How long we keep it">
        <p>Job records and receipts are kept while the app runs, because they are the record of what was paid for. Budget records and their alert address are kept for 12 months after the Budget ends, then the email address is removed. Sign-in sessions expire on their own. Hosting logs follow the hosting provider&apos;s retention period.</p>
      </ProseSection>

      <ProseSection id="choices" title="Your choices">
        <p>You can ask what we hold about your wallet or email address, ask us to correct it, or ask us to delete what we hold off chain. Write to <a href={mail}>{APP_POLICY.contact}</a>. We may ask you to sign a message with the wallet to show it is yours. We cannot change or delete anything recorded on Solana. If you are not satisfied with our answer, you can complain to the Office of the Australian Information Commissioner.</p>
        <p>The marketing website has its own notice for the newsletter and its analytics. See also the <Link href="/terms">Terms of use</Link>.</p>
      </ProseSection>
    </Prose>
  );
}
