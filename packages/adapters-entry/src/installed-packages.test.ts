import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lockedPackageFinder } from './installed-packages.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const repoWith = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-locked-')));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

/** What a lockfile states of a package: its keywords and peers, and the lockfile's name. */
const stated = (root: string, name: string): string | undefined => {
  const found = lockedPackageFinder(root)(name);
  return found === undefined ? undefined : `${found.lockfile.slice(root.length + 1)} [${found.keywords.join(', ')}] [${found.peers.join(', ')}]`;
};

describe('what a lockfile states of a package not installed (P345)', () => {
  it("reads npm's entry, its keywords and peer dependencies", () => {
    const root = repoWith({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/tagger-kit': { version: '1.0.0', keywords: ['strapi', 'tags'], peerDependencies: { '@strapi/strapi': '^5.0.0' } },
          'node_modules/left-pad': { version: '1.3.0' },
        },
      }),
    });
    expect([stated(root, 'tagger-kit'), stated(root, 'left-pad'), stated(root, 'absent')]).toEqual([
      'package-lock.json [strapi, tags] [@strapi/strapi]',
      'package-lock.json [] []',
      undefined,
    ]);
  });

  it("reads pnpm's and yarn's entries, as each version of their lockfiles keys a package", () => {
    const pnpm = repoWith({
      'pnpm-lock.yaml': [
        "lockfileVersion: '9.0'",
        '',
        'importers:',
        '',
        '  .:',
        '    dependencies:',
        '      tagger-kit:',
        '        specifier: 1.0.0',
        '        version: 1.0.0',
        '',
        'packages:',
        '',
        "  '@shop/feeds@2.0.0':",
        '    resolution: {integrity: sha512-x}',
        '',
        '  tagger-kit@1.0.0:',
        '    resolution: {integrity: sha512-y}',
        '    peerDependencies:',
        "      '@strapi/strapi': ^5.0.0",
        '      react: ^18.0.0',
        '',
      ].join('\n'),
    });
    expect([stated(pnpm, 'tagger-kit'), stated(pnpm, '@shop/feeds')]).toEqual(['pnpm-lock.yaml [] [@strapi/strapi, react]', 'pnpm-lock.yaml [] []']);
    const yarn = repoWith({
      'yarn.lock': [
        '__metadata:',
        '  version: 8',
        '',
        '"tagger-kit@npm:^1.0.0, tagger-kit@npm:1.0.0":',
        '  version: 1.0.0',
        '  peerDependencies:',
        '    "@strapi/strapi": ^5.0.0',
        '  checksum: abc',
        '',
      ].join('\n'),
    });
    expect(stated(yarn, 'tagger-kit')).toBe('yarn.lock [] [@strapi/strapi]');
  });
});
