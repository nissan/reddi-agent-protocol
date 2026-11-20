import Link from "next/link";
import { notFound } from "next/navigation";
import FunnelBeacon from "../../../components/FunnelBeacon";
import { SIGNUP_COPY as C } from "../../../lib/newsletter/copy";

const STATES = {
  confirmed: { title: C.confirmedTitle, body: C.confirmedBody },
  unsubscribed: { title: "You're out.", body: "No more messages will be sent to this address. If this was a mistake, you can subscribe again from the home page." },
  expired: { title: "That link has expired.", body: "Confirmation links work for 48 hours. Enter your address again on the home page and we'll send a fresh one." },
  invalid: { title: "That link didn't work.", body: "The link is not valid for this address any more. If you want the newsletter, subscribe again from the home page; if you wanted to leave, you already have." },
  closed: { title: "Newsletter signup is not open.", body: C.closedStateBody },
} as const;

export const dynamicParams = false;
export function generateStaticParams() { return Object.keys(STATES).map((state) => ({ state })); }
export const metadata = { robots: { index: false, follow: false } };

export default async function NewsletterState({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  const copy = STATES[state as keyof typeof STATES];
  if (!copy) notFound();
  return <main id="main" className="wrap article"><p className="eyebrow">NEWSLETTER</p><h1>{copy.title}</h1><p className="lead">{copy.body}</p>{state === "confirmed" && <p><Link className="text-link" href="/status">{C.catchUpLabel} ↗</Link></p>}<Link className="text-link" href="/">Back to the home page ↗</Link>{state === "confirmed" && <FunnelBeacon event="signup_confirmed" />}</main>;
}
