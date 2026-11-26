import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLockLease } from "../src/state.js";

test("a lease is released only by the token that claimed it", async () => {
  const lease = new MemoryLockLease();
  const now = 1_000_000;
  const first = await lease.claim("budget-rent:P", 30_000, now);
  assert.equal(typeof first, "string");
  assert.equal(await lease.claim("budget-rent:P", 30_000, now + 1), false);
  // A token that claimed nothing ends nothing.
  await lease.release("budget-rent:P", "not-the-token");
  assert.equal(await lease.held("budget-rent:P", now + 1), true);
  // The first holder runs past its 30 s; a second claim takes the lease.
  const second = await lease.claim("budget-rent:P", 30_000, now + 30_001);
  assert.equal(typeof second, "string");
  assert.notEqual(first, second);
  // The slow first holder's release does not end the second holder's lease.
  await lease.release("budget-rent:P", first as string);
  assert.equal(await lease.held("budget-rent:P", now + 30_002), true);
  assert.equal(await lease.claim("budget-rent:P", 30_000, now + 30_002), false);
  await lease.release("budget-rent:P", second as string);
  assert.equal(await lease.held("budget-rent:P", now + 30_002), false);
  assert.equal(typeof (await lease.claim("budget-rent:P", 30_000, now + 30_003)), "string");
});
