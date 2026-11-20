import { Suspense } from "react";
import NewsletterAction from "../../../components/NewsletterAction";

export const metadata = { robots: { index: false, follow: false } };

export default function Page() {
  return <Suspense fallback={<main id="main" className="wrap article"><p className="eyebrow">NEWSLETTER</p><p className="lead">Loading…</p></main>}><NewsletterAction action="unsubscribe" /></Suspense>;
}
