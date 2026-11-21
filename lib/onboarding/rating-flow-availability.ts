/**
 * Why the onboarding and planner surfaces do not submit ratings or attestations on chain.
 *
 * The V1 program (programs/pinocchio-escrow) ties a rating and a judge attestation to an escrow:
 * the buyer opts the job in with `open_rating` in the slot of the lock, the seller agrees, the job
 * is paid, and only then can the two parties commit and the named judge attest. The flows here
 * predate that: they sign with a server-held operator key against a job id that no escrow backs,
 * so the program would refuse every instruction they could build. They fail closed with this
 * reason. The app rating flow (#842) replaced them in the UI: the buyer opts in at the lock and each
 * party signs its own steps from its wallet (`components/rating`, `lib/rating`). The instruction
 * builders are in `@redditech/x402-solana/rating`.
 */
export const RATING_FLOW_UNAVAILABLE_REASON =
  "On-chain ratings and attestations are not made by this server (app rating flow, #842): the program ties each one to an escrow the buyer opted in to rating when it was locked, and the buyer, the seller and the judge each sign their own steps from their own wallets.";
