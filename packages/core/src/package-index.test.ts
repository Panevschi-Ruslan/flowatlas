import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageIndexOf, rangeIncludes } from './package-index.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const treeOf = (files: Record<string, unknown>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-index-')));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return root;
};

describe('packageIndexOf', () => {
  it('names each configured repository and every member of a workspace inside one', () => {
    const root = treeOf({
      'money/package.json': { name: '@acme/money', version: '1.4.0' },
      'kit/package.json': { name: 'kit', private: true, workspaces: ['packages/*'] },
      'kit/packages/queue/package.json': { name: '@acme/queue', version: '2.0.1' },
      'loans/package.json': { name: 'loans' },
    });
    const index = packageIndexOf({
      services: [
        { name: 'money-lib', dir: join(root, 'money') },
        { name: 'kit', dir: join(root, 'kit') },
        { name: 'loans', dir: join(root, 'loans') },
      ],
    });
    expect(index.sources.get('@acme/money')).toMatchObject({ dir: join(root, 'money'), version: '1.4.0', service: 'money-lib', origin: 'service' });
    expect(index.sources.get('@acme/queue')).toMatchObject({ dir: join(root, 'kit/packages/queue'), service: 'kit', origin: 'member' });
    expect(index.sources.has('loans')).toBe(true);
    expect(index.ambiguous.size).toBe(0);
  });

  it('keeps a name two repositories claim apart, and reads neither', () => {
    const root = treeOf({
      'a/package.json': { name: '@acme/money', version: '1.0.0' },
      'b/package.json': { name: '@acme/money', version: '1.1.0' },
    });
    const index = packageIndexOf({
      services: [
        { name: 'a', dir: join(root, 'a') },
        { name: 'b', dir: join(root, 'b') },
      ],
    });
    expect(index.sources.has('@acme/money')).toBe(false);
    expect(index.ambiguous.get('@acme/money')?.map((source) => source.service)).toEqual(['a', 'b']);
  });

  it('looks under the configuration only for what no repository names, and lets a repository win', () => {
    const root = treeOf({
      'money/package.json': { name: '@acme/money' },
      'money-copy/package.json': { name: '@acme/money' },
      'flags/package.json': { name: '@acme/flags', version: '0.3.0' },
      'node_modules/x/package.json': { name: 'x' },
      '.hidden/package.json': { name: 'hidden' },
    });
    const index = packageIndexOf({ services: [{ name: 'money', dir: join(root, 'money') }], folders: root });
    expect(index.sources.get('@acme/money')?.dir).toBe(join(root, 'money'));
    expect(index.sources.get('@acme/flags')).toMatchObject({ origin: 'folder', version: '0.3.0' });
    expect(index.sources.has('x')).toBe(false);
    expect(index.sources.has('hidden')).toBe(false);
    expect(index.ambiguous.size).toBe(0);
  });
});

describe('rangeIncludes', () => {
  it.each([
    ['^1.2.0', '1.4.0', true],
    ['^2.0.0', '1.4.0', false],
    ['^0.2.1', '0.2.9', true],
    ['^0.2.1', '0.3.0', false],
    ['~1.2.0', '1.2.7', true],
    ['~1.2.0', '1.3.0', false],
    ['>=1.0.0 <2.0.0', '1.9.9', true],
    ['1.x', '1.7.0', true],
    ['1.2.3', '1.2.3', true],
    ['1.0.0 - 1.5.0', '1.6.0', false],
    ['^1.0.0 || ^3.0.0', '3.1.0', true],
    ['*', '9.0.0', true],
    ['workspace:*', '0.0.1', true],
    ['workspace:^1.0.0', '2.0.0', false],
  ])('%s includes %s: %s', (range, version, expected) => {
    expect(rangeIncludes(range, version)).toBe(expected);
  });

  it('says nothing about a range it does not read', () => {
    expect(rangeIncludes('file:../money', '1.0.0')).toBeUndefined();
    expect(rangeIncludes('github:acme/money', '1.0.0')).toBeUndefined();
    expect(rangeIncludes('^1.0.0', 'not-a-version')).toBeUndefined();
  });
});
