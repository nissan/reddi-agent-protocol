#!/usr/bin/env node
/**
 * Role tokens for the mainnet Budget tables (#1205), made on the owner's
 * machine. Nothing here reaches the network except `probe`.
 *
 *   node scripts/budget-mainnet-role-tokens.mjs make <dir> [--days 365] [--roles a,b,c]
 *     Makes a new P-256 signing key and one ES256 token per role. Writes
 *     `signing-key.jwk.json` (private: import it in Supabase, then keep it in
 *     1Password only) and `<role>.token` files into <dir>, which must not
 *     exist yet, all readable by the owner alone. Prints file names, the
 *     key id and each token's expiry. Never prints a key or a token.
 *
 *   node scripts/budget-mainnet-role-tokens.mjs check <token-file>
 *     Prints the token's role, key id and expiry, read without checking the
 *     signature.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/budget-mainnet-role-tokens.mjs probe <token-file>
 *     Asks the Data API for `budget_controls` in schema `budget_mainnet` as
 *     that role and prints the HTTP status and row count only. 200 with one
 *     row means the signing key is accepted and the role can read. 401 means
 *     the key is not accepted yet; 406 means the schema is not exposed.
 */

import { createPrivateKey, createPublicKey, createSign, createVerify, generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SCHEMA = "budget_mainnet";
export const DEFAULT_ROLES = ["budget_mainnet_signer", "budget_mainnet_app", "budget_mainnet_judge"];
const ROLE = /^budget_mainnet_[a-z_]{1,40}$/;

const b64url = (value) => Buffer.from(value).toString("base64url");

/** A new P-256 key as a private JWK with a key id, the form Supabase imports. */
export function newSigningKey() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { ...privateKey.export({ format: "jwk" }), kid: randomUUID(), alg: "ES256", use: "sig", key_ops: ["sign", "verify"] };
}

/** One ES256 token naming a database role. */
export function roleToken(jwk, role, nowSeconds, days) {
  if (!ROLE.test(role)) throw new Error(`not a ${SCHEMA} role: ${role}`);
  if (!Number.isInteger(days) || days < 1 || days > 800) throw new Error("days must be a whole number from 1 to 800");
  const header = { alg: "ES256", typ: "JWT", kid: jwk.kid };
  const claims = { role, iss: "rap-budget-mainnet", iat: nowSeconds, exp: nowSeconds + days * 86400 };
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = createPrivateKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, format: "jwk" });
  const signature = createSign("SHA256").update(signed).sign({ key, dsaEncoding: "ieee-p1363" });
  return `${signed}.${b64url(signature)}`;
}

/** Whether the token's signature is this key's. */
export function tokenVerifies(jwk, token) {
  const [header, claims, signature] = token.split(".");
  const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" });
  return createVerify("SHA256").update(`${header}.${claims}`).verify({ key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
}

/** A token's header and claims, read without checking the signature. */
export function readToken(token) {
  const parts = token.trim().split(".");
  if (parts.length !== 3) throw new Error("not a token");
  return { header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")), claims: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) };
}

function option(argv, name, fallback) {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
}

function make(argv, log) {
  const dir = argv[0];
  if (!dir || dir.startsWith("--")) throw new Error("name a directory that does not exist yet");
  if (existsSync(dir)) throw new Error(`${dir} exists already: name a new directory, so no earlier key is overwritten`);
  const days = Number(option(argv, "--days", "365"));
  const roles = option(argv, "--roles", DEFAULT_ROLES.join(",")).split(",").map((r) => r.trim()).filter(Boolean);
  const jwk = newSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const tokens = roles.map((role) => [role, roleToken(jwk, role, now, days)]);
  for (const [, token] of tokens) if (!tokenVerifies(jwk, token)) throw new Error("a token did not verify against its own key; nothing written");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "signing-key.jwk.json"), `${JSON.stringify(jwk, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  for (const [role, token] of tokens) writeFileSync(join(dir, `${role}.token`), `${token}\n`, { mode: 0o600, flag: "wx" });
  log(`key id: ${jwk.kid}`);
  log(`wrote ${join(dir, "signing-key.jwk.json")} (private; import in Supabase, then 1Password only)`);
  for (const [role] of tokens) log(`wrote ${join(dir, `${role}.token`)} (expires ${new Date((now + days * 86400) * 1000).toISOString().slice(0, 10)})`);
  log("Delete the directory once the values are in 1Password and Vercel.");
}

function check(argv, log) {
  const { header, claims } = readToken(readFileSync(argv[0], "utf8"));
  log(`role: ${claims.role}`);
  log(`key id: ${header.kid}`);
  log(`expires: ${new Date(claims.exp * 1000).toISOString()}`);
}

async function probe(argv, log, env) {
  const token = readFileSync(argv[0], "utf8").trim();
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const apikey = env.SUPABASE_ANON_KEY?.trim();
  if (!url || !apikey) throw new Error("set SUPABASE_URL and SUPABASE_ANON_KEY (the public anon key, never the service role key)");
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) throw new Error("SUPABASE_URL must be https://<project>.supabase.co");
  const response = await fetch(`${url}/rest/v1/budget_controls?select=id`, { headers: { apikey, authorization: `Bearer ${token}`, "accept-profile": SCHEMA } });
  let rows = "-";
  if (response.ok) {
    const body = await response.json();
    rows = Array.isArray(body) ? String(body.length) : "-";
  }
  log(`role: ${readToken(token).claims.role}`);
  log(`status: ${response.status}`);
  log(`rows: ${rows}`);
  if (response.status === 401) log("401: the Data API does not accept this signing key (not imported, or revoked).");
  if (response.status === 406) log(`406: schema ${SCHEMA} is not in the exposed schemas.`);
  return response.ok ? 0 : 1;
}

export async function run(argv, log = console.log, env = process.env) {
  const [command, ...rest] = argv;
  if (command === "make") return make(rest, log) ?? 0;
  if (command === "check" && rest[0]) return check(rest, log) ?? 0;
  if (command === "probe" && rest[0]) return probe(rest, log, env);
  log("usage: budget-mainnet-role-tokens.mjs make <new-dir> [--days 365] [--roles a,b] | check <token-file> | probe <token-file>");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
