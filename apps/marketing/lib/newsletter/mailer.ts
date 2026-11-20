// Outbound email (WEB-07). `ResendMailer` calls the Resend HTTP API directly (no SDK); `FakeMailer`
// records messages for tests. Nothing here logs recipient addresses.
export type Message = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> };
export type SendResult = { id: string };

export interface Mailer {
  send(message: Message): Promise<SendResult>;
}

// WEB-59: a refusal by the provider (any non-2xx answer) is thrown as a ProviderRefusal carrying only the HTTP status.
// The message and the error name stay what they were ("resend responded <status>", "Error"), so outage classification
// in http.ts and the cron's interrupted line are unchanged; callers tell a refusal apart with instanceof.
export class ProviderRefusal extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`resend responded ${status}`);
    this.status = status;
  }
}

// The status class written to the log: 429 is named, everything else is reduced to its hundred.
export function refusalClass(status: number): "rate-limit" | "4xx" | "5xx" | "other" {
  if (status === 429) return "rate-limit";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}

// WEB-59: the one greppable line for a refused send: `newsletter-provider-refusal op=<confirmation|welcome|issue> class=<rate-limit|4xx|5xx|other>`.
// Built from two fixed labels only: never an address, subject, token, link, message id or response body. Anything that is
// not a ProviderRefusal (a network error, a bug) writes nothing here; the existing handlers deal with it as before.
export function logProviderRefusal(op: "confirmation" | "welcome" | "issue", error: unknown): void {
  if (!(error instanceof ProviderRefusal)) return;
  console.error(`newsletter-provider-refusal op=${op} class=${refusalClass(error.status)}`);
}

export class FakeMailer implements Mailer {
  sent: Message[] = [];
  failNext = false;
  refuseNext: number | null = null; // WEB-59: the next send is refused with this HTTP status
  async send(message: Message) {
    if (this.failNext) { this.failNext = false; throw new Error("mailer failure (test)"); }
    if (this.refuseNext !== null) { const status = this.refuseNext; this.refuseNext = null; throw new ProviderRefusal(status); }
    this.sent.push(message);
    return { id: `fake-${this.sent.length}` };
  }
}

export class ResendMailer implements Mailer {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly replyTo: string | undefined;
  private readonly fetchImpl: typeof fetch;
  constructor(apiKey: string, from: string, replyTo: string | undefined, fetchImpl: typeof fetch = fetch) { this.apiKey = apiKey; this.from = from; this.replyTo = replyTo; this.fetchImpl = fetchImpl; }
  async send(message: Message): Promise<SendResult> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [message.to], reply_to: this.replyTo, subject: message.subject, text: message.text, html: message.html, headers: message.headers }),
    });
    if (!res.ok) throw new ProviderRefusal(res.status); // no body echo: it could contain the address
    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error("resend response had no id");
    return { id: data.id };
  }
}
