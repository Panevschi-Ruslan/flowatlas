import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkoutLine, checkoutsMoved, citedFiles, contentHash, FRESHNESS_FORMAT_VERSION, headOf, staleOf, type Freshness } from './freshness.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-freshness-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/** A file in a service directory, and its stamp as a build would record it. */
const written = (dir: string, file: string, text: string): [number, number, string] => {
  const path = join(dir, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  const stat = statSync(path);
  return [stat.size, stat.mtimeMs, contentHash(text)];
};

describe('the files an answer cites (P230)', () => {
  it('reads a row that says its service and loc, and an id that names a file, once each', () => {
    const answer = {
      root: {
        node: { id: 'entry:orders:http:POST:/orders', loc: 'src/orders.controller.ts:31', service: 'orders' },
        children: [
          { node: { id: 'orders#src/orders.service.ts:OrdersService.create', service: 'orders' }, children: [] },
          { node: { id: 'db_query:orders#src/orders.service.ts:41:23' }, children: [] },
          { node: { id: 'channel:order.created', service: 'orders' }, children: [] },
        ],
      },
      next: ['impact({symbol: "x"})'],
    };
    expect(citedFiles(answer)).toEqual([
      { service: 'orders', file: 'src/orders.controller.ts' },
      { service: 'orders', file: 'src/orders.service.ts' },
    ]);
  });

  it('stops at the limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ service: 's', loc: `f${i}.ts:1` }));
    expect(citedFiles(rows, 3)).toHaveLength(3);
  });
});

describe('whether they changed since the build', () => {
  const dir = join(scratch, 'svc');
  const stamps = {
    'a.ts': written(dir, 'a.ts', 'export const a = 1;\n'),
    'b.ts': written(dir, 'b.ts', 'export const b = 1;\n'),
    'gone.ts': written(dir, 'gone.ts', 'x'),
  };
  const freshness: Freshness = {
    freshnessFormatVersion: FRESHNESS_FORMAT_VERSION,
    builtAt: '2026-11-05T10:00:00.000Z',
    services: { svc: { dir, commit: null, branch: null, dirty: false, files: stamps } },
  };
  const cite = (...files: string[]) => files.map((file) => ({ service: 'svc', file }));

  it('says nothing when nothing moved', () => {
    expect(staleOf(freshness, cite('a.ts', 'b.ts'))).toBeUndefined();
  });

  it('is not fooled by a touch: the time moved and the text did not', () => {
    utimesSync(join(dir, 'a.ts'), new Date(), new Date(Date.now() + 5000));
    expect(staleOf(freshness, cite('a.ts'))).toBeUndefined();
  });

  it('counts an edit, and a file that is gone, against the files it knows', () => {
    writeFileSync(join(dir, 'b.ts'), 'export const b = 2;\n');
    rmSync(join(dir, 'gone.ts'));
    expect(staleOf(freshness, cite('a.ts', 'b.ts', 'gone.ts', 'never-read.ts'))).toEqual({
      files: 2,
      of: 3,
      first: 'svc/b.ts',
      since: '2026-11-05T10:00:00.000Z',
    });
  });

  it('says nothing of a service not checked out here, as a pulled graph has them (P236)', () => {
    const away: Freshness = { ...freshness, services: { far: { dir: join(scratch, 'not-here'), commit: SHA_A, branch: 'main', dirty: false, files: { 'a.ts': [1, 1, 'sha1:x'] } } } };
    expect(staleOf(away, [{ service: 'far', file: 'a.ts' }])).toBeUndefined();
    expect(checkoutsMoved(away)).toEqual([]);
  });

  it('says nothing without a freshness file', () => {
    expect(staleOf(undefined, cite('b.ts'))).toBeUndefined();
  });
});

describe('the checkout a directory is on, read off its files', () => {
  const repo = join(scratch, 'repo');
  mkdirSync(join(repo, '.git', 'refs', 'heads'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });

  it('names the branch and its commit, from a loose ref or from packed refs', () => {
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(repo, '.git', 'refs', 'heads', 'main'), `${SHA_A}\n`);
    expect(headOf(join(repo, 'src'))).toEqual({ commit: SHA_A, branch: 'main' });
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
    writeFileSync(join(repo, '.git', 'packed-refs'), `# pack-refs with: peeled\n${SHA_B} refs/heads/feature/x\n`);
    expect(headOf(repo)).toEqual({ commit: SHA_B, branch: 'feature/x' });
  });

  it('names a detached HEAD by its commit alone', () => {
    writeFileSync(join(repo, '.git', 'HEAD'), `${SHA_A}\n`);
    expect(headOf(repo)).toEqual({ commit: SHA_A, branch: null });
  });

  it('follows a worktree to its own HEAD and the refs it shares', () => {
    const worktree = join(scratch, 'worktree');
    const gitDir = join(repo, '.git', 'worktrees', 'wt');
    mkdirSync(gitDir, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitDir}\n`);
    writeFileSync(join(gitDir, 'commondir'), '../..\n');
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    expect(headOf(worktree)).toEqual({ commit: SHA_A, branch: 'main' });
  });

  it('is nothing outside a checkout', () => {
    expect(headOf(tmpdir() === '/' ? scratch : join(scratch, 'svc'))).toEqual({ commit: null, branch: null });
  });

  it('says which services moved since the build, once per directory', () => {
    const freshness: Freshness = {
      freshnessFormatVersion: FRESHNESS_FORMAT_VERSION,
      builtAt: 'then',
      services: {
        web: { dir: '/w', commit: SHA_A, branch: 'main', dirty: false, files: {} },
        api: { dir: '/w', commit: SHA_A, branch: 'main', dirty: false, files: {} },
        none: { dir: '/n', commit: null, branch: null, dirty: false, files: {} },
      },
    };
    let asked = 0;
    const moved = checkoutsMoved(freshness, () => {
      asked += 1;
      return { commit: SHA_B, branch: 'feature-x' };
    });
    expect(asked).toBe(1);
    expect(moved.map(checkoutLine)).toEqual([
      'api: built on main@aaaaaaa, now feature-x@bbbbbbb',
      'web: built on main@aaaaaaa, now feature-x@bbbbbbb',
    ]);
  });
});
