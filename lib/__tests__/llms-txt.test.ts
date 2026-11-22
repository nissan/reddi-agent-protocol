/**
 * The llms.txt files (https://llmstxt.org) are what an agent reads first, so their structure, their links and the
 * figures they quote are held to the source of truth here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARKDOWN_PAGE_ALIASES } from '@/lib/llms/markdown-aliases';
import { LAUNCH_PROTOCOL_FEE_BPS, LAUNCH_RATE_ENDS_AT_MS, PROTOCOL_FEE_BPS, SOL_PROTOCOL_FEE_CAP_LAMPORTS } from '@redditech/x402-solana/payment';

const ROOT = join(__dirname, '..', '..');
const ORIGIN = 'https://app.agent-protocol.reddi.tech';
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('public/llms.txt', () => {
  const text = read('public/llms.txt');

  it('follows the llms.txt layout: one H1, a blockquote summary, then H2 sections of link lists', () => {
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Reddi Agent Protocol');
    expect(lines.filter((l) => l.startsWith('# '))).toHaveLength(1);
    expect(lines.find((l) => l.trim() !== '' && !l.startsWith('# '))).toMatch(/^> /);
    const sections = lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    expect(sections).toEqual(['Buying agents', 'Service providers', 'Pricing and fees', 'Optional']);
    // Every entry inside a section is "- [name](url)" with optional ": notes".
    const firstSection = lines.findIndex((l) => l.startsWith('## '));
    for (const line of lines.slice(firstSection)) {
      if (line.startsWith('## ') || line.trim() === '') continue;
      expect(line).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)\s]+\)(: .+)?$/);
    }
  });

  it('links only to files this app serves when it links into the app', () => {
    for (const [, url] of text.matchAll(/\]\((https:\/\/[^)]+)\)/g)) {
      if (!url.startsWith(`${ORIGIN}/`)) continue;
      const path = url.slice(ORIGIN.length);
      if (path.startsWith('/api/')) continue;
      const file = join(ROOT, 'public', path);
      const page = join(ROOT, 'app', path, 'page.tsx');
      expect([path, existsSync(file) || existsSync(page)]).toEqual([path, true]);
    }
  });

  it('names the provider kit and both SDK packages', () => {
    for (const pkg of ['provider-kit', 'x402-solana', 'agent-protocol']) {
      expect(text).toContain(`https://www.npmjs.com/package/@redditech/${pkg}`);
      expect(JSON.parse(read(`packages/${pkg}/package.json`)).name).toBe(`@redditech/${pkg}`);
    }
  });

  it('keeps the Solana RFS framing and the not-affiliated line', () => {
    expect(text).toContain('https://solana.com/request-for-startups#ai-inference-marketplace');
    expect(text).toContain('Not affiliated with or endorsed by the Solana Foundation');
  });
});

describe('fee figures in agent-facing files', () => {
  const launchEnds = new Date(LAUNCH_RATE_ENDS_AT_MS);
  it('match the fee schedule in @redditech/x402-solana', () => {
    expect(PROTOCOL_FEE_BPS).toBe(500);
    expect(LAUNCH_PROTOCOL_FEE_BPS).toBe(250);
    expect(launchEnds.toISOString()).toBe('2027-04-01T00:00:00.000Z');
    expect(SOL_PROTOCOL_FEE_CAP_LAMPORTS).toBe(BigInt(100_000_000));
  });

  it.each(['public/llms.txt', 'public/provider.md', 'public/pricing.md'])('%s quotes 5%%, the 2.5%% launch rate to 1 April 2027 and the 0.1 SOL cap', (rel) => {
    const text = read(rel);
    expect(text).toMatch(/\b5%/);
    expect(text).toMatch(/2\.5% launch rate/);
    expect(text).toContain('1 April 2027');
    expect(text).toContain('0.1 SOL');
    expect(text).not.toMatch(/0\.05%|5 bps/);
  });

  it('pricing.md worked example adds up at both rates', () => {
    const units = (usdc: string) => Math.round(Number(usdc) * 1_000_000);
    const cost = units('0.003') + units('0.0075');
    const fee = (bps: number) => Math.floor((cost * bps) / 10_000);
    const text = read('public/pricing.md');
    expect(text).toContain(`| ${(cost / 1e6).toFixed(6)} |`);
    expect(text).toContain(`| ${(fee(LAUNCH_PROTOCOL_FEE_BPS) / 1e6).toFixed(6)} |`);
    expect(text).toContain(`| ${((cost - fee(LAUNCH_PROTOCOL_FEE_BPS)) / 1e6).toFixed(6)} |`);
    expect(text).toContain(`fee on the same call is ${(fee(PROTOCOL_FEE_BPS) / 1e6).toFixed(6)} USDC`);
    expect(text).toContain(`provider receives ${((cost - fee(PROTOCOL_FEE_BPS)) / 1e6).toFixed(6)} USDC`);
  });
});

describe('public/llms-full.txt', () => {
  it('is current with the files it bundles', () => {
    expect(() => execFileSync('node', [join(ROOT, 'scripts', 'build-llms-full.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('starts with the index and contains every bundled file', () => {
    const full = read('public/llms-full.txt');
    expect(full.startsWith(read('public/llms.txt').trim())).toBe(true);
    for (const rel of ['skill.md', 'provider.md', 'pricing.md']) expect(full).toContain(read(`public/${rel}`).trim());
  });
});

describe('markdown versions of key pages', () => {
  it.each(Object.entries(MARKDOWN_PAGE_ALIASES))('%s is the page plus .md and serves %s from public/', (source, destination) => {
    expect(existsSync(join(ROOT, 'app', source.replace(/\.md$/, ''), 'page.tsx'))).toBe(true);
    expect(existsSync(join(ROOT, 'public', destination))).toBe(true);
  });
});
