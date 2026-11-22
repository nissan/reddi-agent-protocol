/**
 * Test fixtures describe a token payment by its `transferChecked` legs and the
 * owners of the token accounts. A real RPC response also carries each account's
 * balance before and after, which the verifier reads to check net credit. This
 * fills those in from the legs: every listed account starts at `startUnits` and
 * ends at that plus the units transferred into it.
 */
export function withTokenBalances<T extends { meta: Record<string, unknown>; transaction: { message: { accountKeys: unknown[]; instructions: unknown[] } } }>(tx: T, decimals = 6, startUnits = BigInt(0)): T {
  const keys = tx.transaction.message.accountKeys.map((key) => (typeof key === 'string' ? key : String((key as { pubkey: unknown }).pubkey)));
  const credited = new Map<string, bigint>();
  for (const item of tx.transaction.message.instructions) {
    const info = (item as { parsed?: { type?: string; info?: Record<string, unknown> } }).parsed;
    if (info?.type !== 'transferChecked' || !info.info) continue;
    const amount = info.info.tokenAmount as { amount?: string; uiAmountString?: string } | undefined;
    const destination = info.info.destination as string;
    const units = amount?.amount !== undefined ? BigInt(amount.amount) : uiToUnits(amount?.uiAmountString ?? '0', decimals);
    credited.set(destination, (credited.get(destination) ?? BigInt(0)) + units);
  }
  const post = (tx.meta.postTokenBalances as Record<string, unknown>[] | undefined) ?? [];
  const balance = (entry: Record<string, unknown>, units: bigint) => ({
    ...entry,
    uiTokenAmount: { ...(entry.uiTokenAmount as object | undefined), amount: units.toString(), decimals },
  });
  return {
    ...tx,
    meta: {
      ...tx.meta,
      preTokenBalances: post.map((entry) => balance(entry, startUnits)),
      postTokenBalances: post.map((entry) => balance(entry, startUnits + (credited.get(keys[entry.accountIndex as number]) ?? BigInt(0)))),
    },
  };
}

function uiToUnits(ui: string, decimals: number): bigint {
  const [whole, fraction = ''] = ui.split('.');
  return BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}
