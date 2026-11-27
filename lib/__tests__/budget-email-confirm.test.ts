/** @jest-environment node */
import { Keypair, PublicKey } from "@solana/web3.js";
import { createEmailCooldown, emailConfirmLink, emailConfirmRequired, emailProof, emailProofProblem, EMAIL_PROOF_TTL_SECONDS } from "@/lib/budget/email-confirm";
import { prepareBudget } from "@/lib/budget/page";
import { budgetProviders } from "@/lib/budget/page";

const SECRET = "s".repeat(40);
const payer = Keypair.generate().publicKey.toBase58();
const NOW = 1_800_000_000_000;
const on = { BUDGET_REQUIRE_CONFIRMED_EMAIL: "true", BUDGET_EMAIL_CONFIRM_SECRET: SECRET };

describe("confirmed alert email (#1208, RAP-MB6-S4)", () => {
  it("is required on mainnet always and elsewhere only when switched on", () => {
    expect(emailConfirmRequired("solana-mainnet-beta", {})).toBe(true);
    expect(emailConfirmRequired("solana-devnet", {})).toBe(false);
    expect(emailConfirmRequired("solana-devnet", { BUDGET_REQUIRE_CONFIRMED_EMAIL: "true" })).toBe(true);
    expect(emailConfirmRequired("solana-devnet", { BUDGET_REQUIRE_CONFIRMED_EMAIL: "1" })).toBe(false);
  });

  it("passes when confirmation is not required, whatever the proof", () => {
    expect(emailProofProblem({ network: "solana-devnet", payer, email: "a@example.com", proof: undefined, env: {} })).toBeUndefined();
  });

  it("refuses, never passes, when required without a usable secret", () => {
    expect(emailProofProblem({ network: "solana-mainnet-beta", payer, email: "a@example.com", proof: "v1.1.x", env: {} })).toBe("not_configured");
    expect(emailProofProblem({ network: "solana-mainnet-beta", payer, email: "a@example.com", proof: undefined, env: { BUDGET_EMAIL_CONFIRM_SECRET: "short" } })).toBe("not_configured");
    expect(emailProof({ network: "solana-mainnet-beta", payer, email: "a@example.com", env: {} })).toBeUndefined();
  });

  it("accepts the proof for the same wallet, address and network, ignoring case of the address", () => {
    const proof = emailProof({ network: "solana-mainnet-beta", payer, email: "Ada@Example.com", nowMs: NOW, env: on })!;
    expect(proof).toMatch(/^v1\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(emailProofProblem({ network: "solana-mainnet-beta", payer, email: "ada@example.com ", proof, nowMs: NOW + 1000, env: on })).toBeUndefined();
  });

  it("refuses a missing, malformed, forged, borrowed or expired proof", () => {
    const proof = emailProof({ network: "solana-mainnet-beta", payer, email: "ada@example.com", nowMs: NOW, env: on })!;
    const check = (over: Partial<Parameters<typeof emailProofProblem>[0]>) => emailProofProblem({ network: "solana-mainnet-beta", payer, email: "ada@example.com", proof, nowMs: NOW, env: on, ...over });
    expect(check({})).toBeUndefined();
    expect(check({ proof: undefined })).toBe("unconfirmed");
    expect(check({ proof: 7 })).toBe("unconfirmed");
    expect(check({ proof: "v1.nope" })).toBe("unconfirmed");
    // Change the MAC's first character: the last one carries padding bits, so changing it can decode to the same bytes.
    const [v, exp, sig] = proof.split(".");
    expect(check({ proof: `${v}.${exp}.${sig.startsWith("A") ? "B" : "A"}${sig.slice(1)}` })).toBe("unconfirmed");
    // Another spelling of the same MAC bytes (spare bits set in the last character) is refused too.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const respelt = `${sig.slice(0, -1)}${alphabet[alphabet.indexOf(sig.slice(-1)) + 1]}`;
    expect(Buffer.from(respelt, "base64url").equals(Buffer.from(sig, "base64url"))).toBe(true);
    expect(check({ proof: `${v}.${exp}.${respelt}` })).toBe("unconfirmed");
    expect(check({ email: "eve@example.com" })).toBe("unconfirmed");
    expect(check({ payer: Keypair.generate().publicKey.toBase58() })).toBe("unconfirmed");
    expect(check({ network: "solana-devnet" })).toBe("unconfirmed");
    expect(check({ env: { ...on, BUDGET_EMAIL_CONFIRM_SECRET: "t".repeat(40) } })).toBe("unconfirmed");
    expect(check({ nowMs: NOW + EMAIL_PROOF_TTL_SECONDS * 1000 })).toBe("unconfirmed");
    // A later expiry with the old MAC does not extend it.
    expect(check({ proof: `v1.${Number(exp) + 1000}.${sig}` })).toBe("unconfirmed");
  });

  it("puts the proof in the link's fragment, not its query", () => {
    const link = new URL(emailConfirmLink("https://app.example", payer, "a+b@example.com", "v1.1.x"));
    expect(link.search).toBe("");
    expect(link.pathname).toBe("/budget");
    expect(new URLSearchParams(link.hash.slice(1)).get("email")).toBe("a+b@example.com");
  });

  it("holds one address to one email a minute", () => {
    const cooldown = createEmailCooldown();
    expect(cooldown.take("A@example.com", 0)).toBe(true);
    expect(cooldown.take("a@example.com", 59_000)).toBe(false);
    expect(cooldown.take("b@example.com", 59_000)).toBe(true);
    expect(cooldown.take("a@example.com", 61_000)).toBe(true);
  });

  describe("at prepare", () => {
    const programId = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
    const judge = Keypair.generate().publicKey.toBase58();
    const base = { BUDGET_DEFAULT_JUDGE: judge };
    const provider = budgetProviders(base).find((p) => p.token === "SOL")!;
    const input = { payer, token: "SOL", total: "100000000", providerIds: [provider.id], email: "ada@example.com" };

    it("opens without a proof where confirmation is off", () => {
      const prepared = prepareBudget(input, programId, NOW, base);
      expect(prepared.ok).toBe(true);
      if (prepared.ok) expect(prepared.terms).not.toHaveProperty("emailProof");
    });

    it("refuses an unconfirmed address and says what to do", () => {
      const prepared = prepareBudget(input, programId, NOW, { ...base, ...on });
      expect(prepared).toMatchObject({ ok: false, status: 409, code: "email_unconfirmed" });
    });

    it("pauses rather than opens when the secret is missing", () => {
      const prepared = prepareBudget(input, programId, NOW, { ...base, BUDGET_REQUIRE_CONFIRMED_EMAIL: "true" });
      expect(prepared).toMatchObject({ ok: false, status: 503, code: "email_confirm_not_configured" });
    });

    it("opens with the proof and hands it back for start", () => {
      const proof = emailProof({ network: "solana-devnet", payer, email: input.email, env: on })!;
      const prepared = prepareBudget({ ...input, emailProof: proof }, programId, Date.now(), { ...base, ...on });
      expect(prepared.ok).toBe(true);
      if (prepared.ok) expect(prepared.terms.emailProof).toBe(proof);
    });
  });
});
