import { describe, expect, it } from 'vitest';
import { forwardedBy, proxyPatternRule, proxyPrefixOf, proxyRule, proxySettingOf, proxySettingRule, proxyTargetOf, type ProxyRule } from './proxy-rule.js';

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

describe('the rest of the ways a rule is written (P260)', () => {
  it('matches a regular expression, before a prefix no longer than what it starts with', () => {
    const rules: ProxyRule[] = [
      { path: '/', target: 'web', to: '', file: 'a', line: 1 },
      {
        path: '^/catalog(/|$)(.*)',
        target: 'catalog',
        to: '',
        file: 'a',
        line: 2,
        match: { source: '^/catalog(/|$)(.*)', flags: 'i' },
        rewrite: { source: '^/catalog(/|$)(.*)', flags: 'i', with: '/$2', whole: true },
      },
      { path: '/catalog/admin', target: 'admin', to: '/admin', file: 'a', line: 3 },
      { path: '/health', target: 'stock', to: '/health', file: 'a', line: 4, exact: true },
    ];
    expect(forwardedBy(rules, '/Catalog/products/1')).toMatchObject({ rule: { line: 2 }, path: '/products/1' });
    expect(forwardedBy(rules, '/catalog/admin/x')).toMatchObject({ rule: { line: 3 }, path: '/admin/x' });
    expect(forwardedBy(rules, '/health')).toMatchObject({ rule: { line: 4 }, path: '/health' });
    expect(forwardedBy(rules, '/health/deep')).toMatchObject({ rule: { line: 1 }, path: '/health/deep' });
    expect(forwardedBy([{ path: '/', target: 'stock', to: '', file: 'a', line: 5, rewrite: { source: '^/v\\d+', with: '' } }], '/v2/stock')).toMatchObject({ path: '/stock' });
  });

  it('reads a rewrite of the whole path, a key written as a pattern, and a target read from a setting', () => {
    expect(proxyRule('/api', 'http://localhost:3001/base', { kind: 'pattern', source: '^/api/v\\d+', with: '' }, at)).toEqual({
      path: '/api',
      target: 'http://localhost:3001',
      to: '/base',
      ...at,
      rewrite: { source: '^/api/v\\d+', with: '' },
    });
    expect(proxyPatternRule('^/legacy/.*', { target: 'http://localhost:3009', to: '' }, { kind: 'keep' }, at)).toMatchObject({ path: '^/legacy/.*', match: { source: '^/legacy/.*' } });
    expect(proxyPatternRule('^/[', { target: 'http://localhost:3009', to: '' }, { kind: 'keep' }, at)).toBeUndefined();
    expect(proxySettingOf('process.env.API_URL')).toEqual({ name: 'API_URL' });
    expect(proxySettingOf("env.VITE_API ?? 'http://localhost:3001'")).toEqual({ name: 'VITE_API', fallback: 'http://localhost:3001' });
    expect(proxySettingOf('`${process.env.ORDERS_URL}/orders/:path*`')).toEqual({ name: 'ORDERS_URL', path: '/orders/:path*' });
    expect(proxySettingOf('config.target')).toBeUndefined();
    expect(proxySettingRule('/api', { name: 'API_URL', path: '/v1' }, { kind: 'strip' }, at)).toEqual({ path: '/api', target: '', to: '/v1', ...at, setting: { name: 'API_URL', to: '/v1' } });
    expect(proxySettingRule('/api', { name: 'API_URL', fallback: 'http://localhost:3001' }, { kind: 'keep' }, at)).toMatchObject({
      target: 'http://localhost:3001',
      to: '/api',
      setting: { name: 'API_URL', to: '/api' },
    });
  });
});
