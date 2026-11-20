"use client";

// Fires one event when the page it sits on is shown (the confirm page, the confirmed-state page, a build update).
// It is evaluated once, when the page is shown: if the visitor has not accepted measurement by then it is not
// recorded, and accepting later on the same page sends nothing for it.
import { useEffect } from "react";
import { signupConfirmedOnce, signupConfirmOpenedOnce, updateOpenedOnce, whenPageShown } from "../lib/analytics/funnel";

type Props = { event: "signup_confirm_opened" | "signup_confirmed" } | { event: "update_opened"; slug: string };

export default function FunnelBeacon(props: Props) {
  const slug = props.event === "update_opened" ? props.slug : "";
  const { event } = props;
  useEffect(() => {
    const once = event === "signup_confirmed" ? signupConfirmedOnce() : event === "update_opened" ? updateOpenedOnce(slug) : signupConfirmOpenedOnce();
    return whenPageShown(once);
  }, [event, slug]);
  return null;
}
