// Wording of the one signup. The newsletter signup is also the guarded-beta signup: a person asks to be told when the
// guarded beta opens and to receive the build updates until then. Every sentence is a promise to notify and never says
// something can be used on mainnet today. The page, the form, the confirmation page and the emails import their text
// from here, and tests/claims.test.ts checks all of it against the repository's public-claim boundary.
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
  confirmedBody: "We'll email you when the devnet sandbox opens and when the guarded beta opens, and send the build updates until then. Nothing is on mainnet yet. Every message carries a one-click unsubscribe link, and nothing else is sent to this address.",
  closedStateBody: "This site does not collect email addresses yet.",
  email: {
    subject: "Confirm your Reddi Agent Protocol signup",
    text: (link: string, catchUp?: string) => `You asked to be told when the Reddi Agent Protocol sandbox and guarded beta open, and to get the build updates. Nothing is on mainnet yet. Open this link and press the button to confirm (the link expires in 48 hours):\n\n${link}\n\nIf you did not ask for this, ignore this email and nothing more will be sent.${catchUp ? `\n\nSee what exists today: ${catchUp}` : ""}`,
    html: (link: string, catchUp?: string) => `<p>You asked to be told when the Reddi Agent Protocol sandbox and guarded beta open, and to get the build updates. Nothing is on mainnet yet.</p><p><a href="${link}">Confirm your signup</a> (opens a page with one button; the link expires in 48 hours).</p><p>If you did not ask for this, ignore this email and nothing more will be sent.</p>${catchUp ? `<p><a href="${catchUp}">See what exists today</a></p>` : ""}`,
  },
} as const;
