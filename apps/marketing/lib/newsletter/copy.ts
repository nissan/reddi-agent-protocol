// Wording of the one signup. The newsletter signup is also the guarded-beta signup: a person asks to be told when the
// guarded beta opens and to receive the build updates until then. Every sentence is a promise to notify and never says
// something can be used on mainnet today. The page, the form, the confirmation page and the emails import their text
// from here, and tests/claims.test.ts checks all of it against the repository's public-claim boundary.
type Frequency = "weekly" | "daily";
type Prefs = { frequency: Frequency; switchLabel: string; switchUrl: string };

// How often a subscriber hears from us. Weekly is the default: one digest on Monday morning (Sydney) with the week's
// updates. Daily sends each update on the day it is published. Either can be switched from a link in every email.
const SIGNUP_COPY_FREQUENCY = {
  legend: "How often",
  weekly: "Weekly digest",
  daily: "Each update as it's published",
  cadence: (f: Frequency) => (f === "daily" ? "as each one is published" : "in one digest each Monday"),
  switchLabel: (to: Frequency) => (to === "daily" ? "Get each update as it's published instead" : "Get one weekly digest instead"),
  pageTitle: (to: Frequency) => (to === "daily" ? "Switch to every update?" : "Switch to the weekly digest?"),
  pageBody: (to: Frequency) => (to === "daily" ? "Press the button and we'll email you each build update on the day it's published." : "Press the button and we'll send one digest each Monday with that week's build updates."),
  pageButton: (to: Frequency) => (to === "daily" ? "Send me every update" : "Send me the weekly digest"),
  doneTitle: (f: Frequency) => (f === "daily" ? "You'll get every update." : "You'll get the weekly digest."),
  doneBody: (f: Frequency) => (f === "daily" ? "We'll email you each build update on the day it's published. You can switch back from any email." : "We'll send one digest each Monday with that week's build updates. You can switch back from any email."),
  digestTitle: "This week at Reddi Agent Protocol",
} as const;

export const SIGNUP_COPY = {
  eyebrow: "TELL ME WHEN THE BETA OPENS",
  headline: "Be first to hear when there is something to try.",
  lede: "One short email when the devnet sandbox opens, one when the guarded beta opens, and honest build updates in between.",
  formTitle: "Tell me when it opens",
  formBody: "One list: a message when the sandbox and the guarded beta open, plus the build updates. Confirmed opt-in; one-click unsubscribe in every message.",
  statusIdle: "We use your address only to confirm this request and to send those messages.",
  closedNotice: "Signup opens soon, and this page does not collect email addresses yet. Until then, follow the build on X or GitHub.",
  closedHomeNote: "Signup is not open yet. Until then, follow @reddiagent on X or watch the repository on GitHub.",
  closedPlaceholder: "Signup opens soon",
  closedButton: "Signup opens soon",
  button: "Send me a confirmation",
  replyMessage: "If that address can be signed up, a confirmation email is on its way. Nothing is stored for good until you confirm.",
  confirmTitle: "One more click.",
  confirmBody: "Press the button to confirm that Reddi Agent Protocol may email you when the sandbox and the guarded beta open, and send you the build updates. Nothing is kept until you do.",
  confirmButton: "Confirm my signup",
  confirmedTitle: "You're on the list.",
  catchUpLabel: "See what exists today",
  confirmedBody: "We'll email you when the guarded beta opens on Solana mainnet, and send the build updates until then. Mainnet is coming soon; the devnet sandbox is there to try in the meantime. A short welcome email is on its way with a one-click unsubscribe link; every message carries one, and nothing else is sent to this address.",
  closedStateBody: "This site does not collect email addresses yet.",
  email: {
    subject: "Confirm your Reddi Agent Protocol signup",
    text: (link: string, catchUp?: string) => `You asked to be told when the Reddi Agent Protocol guarded beta opens on Solana mainnet, and to get the build updates. Mainnet is coming soon. Open this link and press the button to confirm (the link expires in 48 hours):\n\n${link}\n\nIf you did not ask for this, ignore this email and nothing more will be sent.${catchUp ? `\n\nSee what exists today: ${catchUp}` : ""}`,
    html: (link: string, catchUp?: string) => `<p>You asked to be told when the Reddi Agent Protocol guarded beta opens on Solana mainnet, and to get the build updates. Mainnet is coming soon.</p><p><a href="${link}">Confirm your signup</a> (opens a page with one button; the link expires in 48 hours).</p><p>If you did not ask for this, ignore this email and nothing more will be sent.</p>${catchUp ? `<p><a href="${catchUp}">See what exists today</a></p>` : ""}`,
  },
  // Sent once, right after the confirm button is pressed. It is the first message with the unsubscribe link.
  welcome: {
    subject: "You're on the Reddi Agent Protocol list",
    text: (unsubscribe: string, catchUp?: string, prefs?: Prefs) => `You're on the list. We'll email you when the guarded beta opens on Solana mainnet, and send the build updates until then${prefs ? ` ${SIGNUP_COPY_FREQUENCY.cadence(prefs.frequency)}` : ""}. Mainnet is coming soon; the devnet sandbox is there to try in the meantime.${catchUp ? `\n\nSee what exists today: ${catchUp}` : ""}${prefs ? `\n\n${prefs.switchLabel}: ${prefs.switchUrl}` : ""}\n\nUnsubscribe: ${unsubscribe}`,
    html: (unsubscribe: string, catchUp?: string, prefs?: Prefs) => `<p>You're on the list. We'll email you when the guarded beta opens on Solana mainnet, and send the build updates until then${prefs ? ` ${SIGNUP_COPY_FREQUENCY.cadence(prefs.frequency)}` : ""}. Mainnet is coming soon; the devnet sandbox is there to try in the meantime.</p>${catchUp ? `<p><a href="${catchUp}">See what exists today</a></p>` : ""}${prefs ? `<p><a href="${prefs.switchUrl}">${prefs.switchLabel}</a></p>` : ""}<p><a href="${unsubscribe}">Unsubscribe</a> with one click. You're receiving this because you confirmed your Reddi Agent Protocol signup.</p>`,
  },
  frequency: SIGNUP_COPY_FREQUENCY,
} as const;
