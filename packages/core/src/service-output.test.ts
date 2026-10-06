import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SERVICES_DIRECTORY, serviceDirectoryName, serviceOutputDir } from './service-output.js';

/** The inverse of the short form, so the test can say "one-to-one" and check it. */
const decode = (written: string): string => decodeURIComponent(written);

/** Names a configuration accepts and a file system does not, or not as given. */
const AWKWARD = [
  'orders',
  'Orders',
  'ORDERS',
  'admin-api',
  'admin_api',
  'admin.api',
  '@scope/orders',
  '@scope%2Forders',
  '%40scope%2Forders',
  'scope/orders',
  'scope\\orders',
  '../orders',
  '..',
  '.',
  '...',
  '.hidden',
  'trailing.',
  'with space',
  'tab\there',
  'line\nbreak',
  'colon:name',
  'star*name',
  'q?',
  'pipe|name',
  '<angle>',
  '"quoted"',
  'tilde~name',
  '%',
  '%25',
  'con',
  'CON',
  'nul.txt',
  'com1',
  'lpt9.log',
  'conx',
  'заказы',
  'Заказы',
  'café',
  'café',
  '注文',
  '🙂',
  'a'.repeat(119),
  'a'.repeat(120),
  'a'.repeat(121),
  'a'.repeat(400),
  `${'a'.repeat(400)}b`,
  'Я'.repeat(60),
  `${'Я'.repeat(60)}я`,
];

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-service-output-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('the directory a service is written into', () => {
  it('keeps an ordinary service name as it is', () => {
    for (const name of ['orders', 'admin-api', 'waiter_bot', 'v2.api', 'mini-app']) {
      expect(serviceDirectoryName(name)).toBe(name);
    }
  });

  it('is one segment, under services/, whatever the name', () => {
    for (const name of AWKWARD) {
      const written = serviceDirectoryName(name);
      expect(written, name).not.toContain('/');
      expect(written, name).not.toContain('\\');
      expect(written, name).not.toMatch(/^\.|\.$/);
      expect(written.length, name).toBeLessThanOrEqual(120);
      expect(written, name).toMatch(/^[a-z0-9._%~A-F-]+$/);
      const dir = serviceOutputDir('/out', name);
      expect(dirname(dir)).toBe(join('/out', SERVICES_DIRECTORY));
      expect(basename(dir)).toBe(written);
    }
  });

  it('turns a scoped package name into one directory, not two', () => {
    expect(serviceDirectoryName('@scope/orders')).toBe('%40scope%2Forders');
  });

  it('never names `.`, `..` or a hidden directory', () => {
    expect(serviceDirectoryName('.')).toBe('%2E');
    expect(serviceDirectoryName('..')).toBe('%2E%2E');
    expect(serviceDirectoryName('.hidden')).toBe('%2Ehidden');
    expect(serviceDirectoryName('trailing.')).toBe('trailing%2E');
  });

  it('keeps a name Windows reserves for a device off the disk as that name', () => {
    expect(serviceDirectoryName('con')).toBe('%63on');
    expect(serviceDirectoryName('nul.txt')).toBe('%6Eul.txt');
    expect(serviceDirectoryName('conx')).toBe('conx');
  });

  it('gives two different names two different directories, even on a disk that ignores case', () => {
    const written = AWKWARD.map(serviceDirectoryName);
    expect(new Set(written).size).toBe(AWKWARD.length);
    expect(new Set(written.map((name) => name.toLowerCase())).size).toBe(AWKWARD.length);
  });

  it('can be read back to the name it came from, unless it had to be shortened', () => {
    for (const name of AWKWARD) {
      const written = serviceDirectoryName(name);
      if (written.includes('~')) continue;
      expect(decode(written), name).toBe(name);
    }
  });

  it('shortens a long name with a hash of all of it, so names sharing a start stay apart', () => {
    const one = serviceDirectoryName('a'.repeat(400));
    const two = serviceDirectoryName(`${'a'.repeat(400)}b`);
    expect(one).toContain('~');
    expect(one).not.toBe(two);
    // Never cut inside a `%XX`.
    expect(serviceDirectoryName('Я'.repeat(60))).toMatch(/^(%[0-9A-F]{2})+~[0-9a-f]{16}$/);
  });

  it('holds up against random names', () => {
    const alphabet = ['a', 'A', 'z', '0', '.', '-', '_', '/', '\\', '%', '~', ' ', '@', 'é', 'Я', ':'];
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    const seen = new Map<string, string>();
    for (let round = 0; round < 5000; round += 1) {
      const length = 1 + (next() % 12);
      const name = Array.from({ length }, () => alphabet[next() % alphabet.length]).join('');
      const written = serviceDirectoryName(name).toLowerCase();
      const before = seen.get(written);
      if (before !== undefined) expect(before).toBe(name);
      seen.set(written, name);
      expect(decode(serviceDirectoryName(name))).toBe(name);
    }
  });

  it('is a directory the file system accepts, one per name', () => {
    for (const name of AWKWARD) mkdirSync(serviceOutputDir(scratch, name), { recursive: true });
    const made = readdirSync(join(scratch, SERVICES_DIRECTORY));
    expect(made).toHaveLength(AWKWARD.length);
    expect(made.every((entry) => !entry.includes(sep))).toBe(true);
  });
});
