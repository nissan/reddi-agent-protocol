import { createHash } from 'node:crypto';
import { TOKEN_ESCROW_DISCRIMINATORS } from '../src/token-escrow';

describe('token escrow discriminators', () => {
  it.each(Object.entries(TOKEN_ESCROW_DISCRIMINATORS))('%s is the first 8 bytes of its sha256', (name, bytes) => {
    expect([...createHash('sha256').update(name).digest().subarray(0, 8)]).toEqual(bytes);
  });
});
