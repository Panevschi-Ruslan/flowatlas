import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dependencyChange, surveyDependencies, NO_DEPENDENCIES } from './dependencies.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-deps-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const write = (path: string, text: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
};

/**
 * A workspace: a root that declares `packages/*`, an application and a library
 * the application depends on.
 */
const workspace = (name: string): string => {
  const root = join(scratch, name);
  write(
    join(root, 'package.json'),
    JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*', 'packages/*'] }),
  );
  write(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  write(
    join(root, 'apps/api/package.json'),
    JSON.stringify({ name: 'api', dependencies: { lib: 'workspace:*' } }),
  );
  write(join(root, 'packages/lib/package.json'), JSON.stringify({ name: 'lib' }));
  return root;
};

describe('what a service has installed', () => {
  it('finds the lockfile of the workspace above a member, and nothing above that', () => {
    const root = workspace('member');
    const state = surveyDependencies(join(root, 'apps/api'));
    // The lockfile is the workspace root's, two levels up, named relative to the
    // service so that moving the whole checkout is not a change.
    expect(state.lockfiles).toEqual({ '../../pnpm-lock.yaml': expect.stringMatching(/^sha1:/) });
    expect(state.installed).toEqual([]);
  });

  it('names every directory of the extent an install landed in, nearest first', () => {
    const root = workspace('installed');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    mkdirSync(join(root, 'apps/api/node_modules'), { recursive: true });
    expect(surveyDependencies(join(root, 'apps/api')).installed).toEqual(['.', '../..']);
  });

  it('says nothing at all about a bare directory that is nobody else\'s member', () => {
    const bare = join(scratch, 'bare');
    write(join(bare, 'package.json'), JSON.stringify({ name: 'bare' }));
    expect(surveyDependencies(bare)).toEqual(NO_DEPENDENCIES);
  });
});

describe('what changed about the dependencies', () => {
  const lock = { 'pnpm-lock.yaml': 'sha1:one' };

  it('is silent when nothing moved', () => {
    expect(dependencyChange({ installed: ['.'], lockfiles: lock }, { installed: ['.'], lockfiles: lock })).toBeUndefined();
  });

  it('names an install arriving, which is the sequence the cache used to miss', () => {
    expect(
      dependencyChange({ installed: [], lockfiles: lock }, { installed: ['.'], lockfiles: lock }),
    ).toBe('dependencies installed in .');
  });

  it('names an install going away, because that answer is smaller too', () => {
    expect(
      dependencyChange({ installed: ['.'], lockfiles: lock }, { installed: [], lockfiles: lock }),
    ).toBe('dependencies removed from .');
  });

  it('names the lockfile that moved under an install that stayed', () => {
    expect(
      dependencyChange(
        { installed: ['.'], lockfiles: lock },
        { installed: ['.'], lockfiles: { 'pnpm-lock.yaml': 'sha1:two' } },
      ),
    ).toBe('pnpm-lock.yaml changed');
    expect(
      dependencyChange({ installed: ['.'], lockfiles: {} }, { installed: ['.'], lockfiles: lock }),
    ).toBe('pnpm-lock.yaml appeared');
  });

  it('refuses to guess for a reading that recorded nothing', () => {
    expect(dependencyChange(undefined, NO_DEPENDENCIES)).toBe(
      'dependencies not recorded by the last build',
    );
  });
});
