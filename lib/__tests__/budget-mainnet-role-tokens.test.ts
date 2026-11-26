/**
 * @jest-environment node
 *
 * The owner's script that makes the mainnet Budget role tokens (#1205).
 */
import { execFileSync } from "child_process";
import { createPublicKey, createVerify } from "crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { custodyStoreConfig, tokenRole } from "@/lib/budget/store";

const SCRIPT = join(process.cwd(), "scripts/budget-mainnet-role-tokens.mjs");
const run = (...args: string[]) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("scripts/budget-mainnet-role-tokens.mjs", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "rap-role-tokens-")), "out");
  const out = run("make", dir, "--days", "30");
  const token = (role: string) => readFileSync(join(dir, `${role}.token`), "utf8").trim();

  it("writes one private key and one token per role, readable by the owner alone, and prints none of them", () => {
    expect(readdirSync(dir).sort()).toEqual(["budget_mainnet_app.token", "budget_mainnet_judge.token", "budget_mainnet_signer.token", "signing-key.jwk.json"]);
    for (const file of readdirSync(dir)) expect(statSync(join(dir, file)).mode & 0o077).toBe(0);
    const jwk = JSON.parse(readFileSync(join(dir, "signing-key.jwk.json"), "utf8"));
    expect(out).toContain(jwk.kid);
    expect(out).not.toContain(jwk.d);
    for (const role of ["budget_mainnet_app", "budget_mainnet_judge", "budget_mainnet_signer"]) expect(out).not.toContain(token(role));
  });

  it("signs each token with that key, ES256, naming the role, the key id and an expiry", () => {
    const jwk = JSON.parse(readFileSync(join(dir, "signing-key.jwk.json"), "utf8"));
    const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
    for (const role of ["budget_mainnet_signer", "budget_mainnet_app", "budget_mainnet_judge"]) {
      const [header, claims, signature] = token(role).split(".");
      expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", typ: "JWT", kid: jwk.kid });
      const body = JSON.parse(Buffer.from(claims, "base64url").toString());
      expect(body.role).toBe(role);
      expect(body.exp - body.iat).toBe(30 * 86400);
      expect(createVerify("SHA256").update(`${header}.${claims}`).verify({ key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
      expect(tokenRole(token(role))).toBe(role);
    }
  });

  it("makes tokens the mainnet store accepts for its two roles and refuses for the judge's", () => {
    const env = (role: string) => ({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", BUDGET_CUSTODY_SCHEMA: "budget_mainnet", BUDGET_CUSTODY_ROLE_TOKEN: token(role) });
    expect(custodyStoreConfig(env("budget_mainnet_signer"), "solana-mainnet-beta").ok).toBe(true);
    expect(custodyStoreConfig(env("budget_mainnet_app"), "solana-mainnet-beta").ok).toBe(true);
    expect(custodyStoreConfig(env("budget_mainnet_judge"), "solana-mainnet-beta").ok).toBe(false);
  });

  it("refuses a directory that exists, a role outside the schema, and a probe without the public settings", () => {
    expect(() => run("make", dir)).toThrow(/exists already/);
    expect(() => run("make", `${dir}-2`, "--roles", "service_role")).toThrow(/not a budget_mainnet role/);
    expect(() => run("probe", join(dir, "budget_mainnet_app.token"))).toThrow(/SUPABASE_URL/);
  });

  it("reads a token back without printing it", () => {
    const text = run("check", join(dir, "budget_mainnet_signer.token"));
    expect(text).toContain("role: budget_mainnet_signer");
    expect(text).not.toContain(token("budget_mainnet_signer"));
  });
});
