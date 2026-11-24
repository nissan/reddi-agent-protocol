/**
 * Emails the operator when a provider logs an event marked `alert: true` (a sweep that failed, a settle whose outcome
 * is unknown, a paid answer that was lost, a provider that is not set up). Off unless all three settings are present:
 *
 *   PROVIDER_ALERT_RESEND_API_KEY  a Resend API key (kept in the host's secret settings, never in a NEXT_PUBLIC_ name)
 *   PROVIDER_ALERT_EMAIL_TO        where alerts go
 *   PROVIDER_ALERT_EMAIL_FROM      a sender on a domain verified in Resend
 *
 * Per instance, one email per event name per window (15 minutes by default); alerts held back in the window are
 * counted and named in the next email for that event. The email carries the event as logged, which has already had
 * every URL redacted (an RPC URL carries its key). A failed send is logged without the address or the response body,
 * and never throws into the caller.
 */
export type AlertEvent = Record<string, unknown> & { event?: unknown; alert?: unknown };

export type AlertSettings = { apiKey: string; to: string; from: string };

export type AlerterOptions = {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  windowMs?: number;
  /** Runs the send after the response where the host allows it (Next's `after`); defaults to fire-and-forget. */
  schedule?: (task: () => Promise<void>) => void;
  /** Where the alerter writes its own lines (one JSON object each). */
  write?: (line: Record<string, unknown>) => void;
};

export type Alerter = { enabled: boolean; notify(event: AlertEvent): void };

export const ALERT_WINDOW_MS = 15 * 60 * 1000;

export function alertSettings(env: Record<string, string | undefined>): AlertSettings | { missing: string[] } | null {
  const apiKey = env.PROVIDER_ALERT_RESEND_API_KEY?.trim();
  const to = env.PROVIDER_ALERT_EMAIL_TO?.trim();
  const from = env.PROVIDER_ALERT_EMAIL_FROM?.trim();
  if (!apiKey && !to && !from) return null;
  const missing = [
    !apiKey && "PROVIDER_ALERT_RESEND_API_KEY",
    !to && "PROVIDER_ALERT_EMAIL_TO",
    !from && "PROVIDER_ALERT_EMAIL_FROM",
  ].filter((name): name is string => Boolean(name));
  if (missing.length) return { missing };
  return { apiKey: apiKey!, to: to!, from: from! };
}

export function alertEmail(event: AlertEvent, held: number): { subject: string; text: string } {
  const name = typeof event.event === "string" ? event.event : "alert";
  const provider = typeof event.provider === "string" ? ` (${event.provider})` : "";
  const lines = [
    `A RAP provider logged an alert: ${name}${provider}.`,
    "",
    JSON.stringify(event, null, 2),
    "",
  ];
  if (held > 0) lines.push(`${held} more "${name}" alert(s) on this instance were held back since the last email.`, "");
  lines.push("What to do: docs/security/INCIDENT-RUNBOOK.md, and the provider's logs in Vercel for the full sequence.");
  return { subject: `[RAP provider alert] ${name}${provider}`, text: lines.join("\n") };
}

export function createAlerter(options: AlerterOptions): Alerter {
  const write = options.write ?? ((line) => console.log(JSON.stringify(line)));
  const settings = alertSettings(options.env);
  if (settings === null) return { enabled: false, notify: () => undefined };
  if ("missing" in settings) {
    write({ source: "rap-provider", event: "alert_email_not_configured", missing: settings.missing });
    return { enabled: false, notify: () => undefined };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? ALERT_WINDOW_MS;
  const schedule = options.schedule ?? ((task) => void task());
  const lastSent = new Map<string, number>();
  const held = new Map<string, number>();

  const send = async (event: AlertEvent, heldCount: number) => {
    const { subject, text } = alertEmail(event, heldCount);
    try {
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: settings.from, to: [settings.to], subject, text }),
      });
      // No body echo: it could carry the address.
      if (!response.ok) write({ source: "rap-provider", event: "alert_email_failed", status: response.status });
    } catch {
      write({ source: "rap-provider", event: "alert_email_failed", status: "network" });
    }
  };

  return {
    enabled: true,
    notify(event) {
      if (event.alert !== true) return;
      const name = typeof event.event === "string" ? event.event : "alert";
      const at = now();
      const last = lastSent.get(name);
      if (last !== undefined && at - last < windowMs) {
        held.set(name, (held.get(name) ?? 0) + 1);
        return;
      }
      lastSent.set(name, at);
      const heldCount = held.get(name) ?? 0;
      held.delete(name);
      try {
        schedule(() => send(event, heldCount));
      } catch {
        // Outside a request (no `after` scope): send without waiting.
        void send(event, heldCount);
      }
    },
  };
}
