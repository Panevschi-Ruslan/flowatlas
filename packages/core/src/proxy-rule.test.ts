import { describe, expect, it } from 'vitest';
import { forwardedBy, proxyPrefixOf, proxyRule, proxyTargetOf, type ProxyRule } from './proxy-rule.js';

const at = { file: 'vite.config.ts', line: 4 };

describe('a rule a server forwards a path by (P257)', () => {
  it('keeps the prefix, takes it off, or puts another in its place, behind the target own path', () => {
    expect(proxyRule('/api', 'http://localhost:3001', { kind: 'keep' }, at)).toEqual({ path: '/api', target: 'http://localhost:3001', to: '/api', ...at });
    expect(proxyRule('/api/', 'http://localhost:3001', { kind: 'strip' }, at)?.to).toBe('');
    expect(proxyRule('/api', 'http://localhost:3001/v2', { kind: 'replace', with: '/v1' }, at)?.to).toBe('/v2/v1');
    expect(proxyRule('/api', 'http://LOCALHOST:3001/v2/', { kind: 'keep' }, at)).toMatchObject({ target: 'http://localhost:3001', to: '/v2/api' });
  });

  it('reads a trailing catch-all off a prefix, and every path as `/`', () => {
    expect(proxyPrefixOf('/api/**')).toBe('/api');
    expect(proxyPrefixOf('/api/:path*')).toBe('/api');
    expect(proxyPrefixOf('')).toBe('/');
    expect(proxyRule('/', 'http://localhost:4000', { kind: 'keep' }, { ...at, after: 'own-routes' })).toMatchObject({ path: '/', to: '', after: 'own-routes' });
  });

  it('keeps nothing that is not an address', () => {
    expect(proxyTargetOf('${API_URL}')).toBeUndefined();
    expect(proxyTargetOf('localhost:3001')).toBeUndefined();
    expect(proxyTargetOf('ftp://files.example.test')).toBeUndefined();
    expect(proxyRule('/api', 'process.env.API', { kind: 'keep' }, at)).toBeUndefined();
  });
});

describe('the rule a request is forwarded by (P257)', () => {
  const rules: ProxyRule[] = [
    { path: '/api', target: 'http://localhost:3001', to: '', file: 'a', line: 1 },
    { path: '/api/stock', target: 'http://localhost:3002', to: '/stock', file: 'a', line: 2 },
    { path: '/', target: 'http://localhost:3009', to: '', file: 'b', line: 1, after: 'own-routes' },
  ];

  it('is the one with the longest prefix of whole segments, the path rewritten', () => {
    expect(forwardedBy(rules, '/api/orders/:param')).toMatchObject({ rule: { line: 1 }, path: '/orders/:param' });
    expect(forwardedBy(rules, '/api/stock/ABC-1')).toMatchObject({ rule: { line: 2 }, path: '/stock/ABC-1' });
    expect(forwardedBy(rules, '/api')).toMatchObject({ rule: { line: 1 }, path: '/' });
  });

  it('never matches part of a segment, and reaches the catch-all rule otherwise', () => {
    expect(forwardedBy(rules, '/apis/x')).toMatchObject({ rule: { file: 'b' }, path: '/apis/x' });
    expect(forwardedBy(rules.slice(0, 2), '/apis/x')).toBeUndefined();
  });
});
