import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BLOCK_END, BLOCK_START, hookBlock, hookStatus, installHooks, removeHooks, withBlock, withoutBlock } from './hook.js';

// Real, as git names it: a temporary directory is often behind a link (macOS's /var), or on
// Windows under a short name (RUNNER~1) only the native call spells out long.
const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'flowatlas-hook-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A project of two services, `api` and `web`, each its own checkout. */
const project = (name: string): { config: string; hooks: (service: string) => string; dir: (service: string) => string } => {
  const root = join(scratch, name);
  for (const service of ['api', 'web']) {
    mkdirSync(join(root, service), { recursive: true });
    git(join(root, service), 'init', '-q');
  }
  const config = join(root, 'flowatlas.config.json');
  writeFileSync(
    config,
    JSON.stringify({
      services: [
        { name: 'api', repo: './api', type: 'nestjs' },
        { name: 'web', repo: './web', type: 'angular' },
      ],
    }),
  );
  return { config, dir: (service) => join(root, service), hooks: (service) => join(root, service, '.git', 'hooks') };
};

describe('the block a hook holds (P230)', () => {
  const block = hookBlock('merge', 'flowatlas', '/p/flowatlas.config.json');

  it('starts a background build and never fails the git command', () => {
    expect(block).toBe(
      [BLOCK_START, '# Rebuilds the flowatlas graph in the background; `flowatlas hook remove` takes this out.', "flowatlas build --background --config '/p/flowatlas.config.json' >/dev/null 2>&1 || true", BLOCK_END].join('\n'),
    );
  });

  it('acts on a branch checkout only, not on checking out files', () => {
    expect(hookBlock('checkout', 'flowatlas', '/c')).toContain('if [ "$3" = "1" ]; then flowatlas build --background');
  });

  it('is added to a hook a team already has, and taken out leaving it as it was, byte for byte', () => {
    const theirs = '#!/bin/sh\nnpm run lint-staged\n';
    const ours = withBlock(theirs, block);
    expect(ours.startsWith(theirs)).toBe(true);
    expect(withBlock(ours, block)).toBe(ours);
    expect(withoutBlock(ours)).toBe(theirs);
    expect(withoutBlock(withBlock(undefined, block))).toBeUndefined();
  });
});

describe('installing, checking and removing the hooks', () => {
  it('writes three hooks per repository, executable, a second time nothing, and removes them again', () => {
    const { config, hooks } = project('plain');
    writeFileSync(join(hooks('api'), 'post-merge'), '#!/bin/sh\necho theirs\n');
    const first = installHooks({ config });
    expect(first.changes.map((change) => change.state)).toEqual(['installed', 'installed', 'installed', 'installed', 'installed', 'installed']);
    // Windows has no executable bit; Git for Windows runs a hook by its `#!` line.
    if (process.platform !== 'win32') expect(statSync(join(hooks('web'), 'post-checkout')).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(hooks('web'), 'post-checkout'), 'utf8')).toMatch(/^#!\/bin\/sh\n/);
    expect(readFileSync(join(hooks('api'), 'post-merge'), 'utf8')).toMatch(/^#!\/bin\/sh\necho theirs\n# flowatlas:hook\n/);
    expect(installHooks({ config }).changes.every((change) => change.state === 'unchanged')).toBe(true);
    expect(hookStatus({ config }).changes.every((change) => change.state === 'installed')).toBe(true);

    expect(removeHooks({ config }).changes).toHaveLength(6);
    expect(readFileSync(join(hooks('api'), 'post-merge'), 'utf8')).toBe('#!/bin/sh\necho theirs\n');
    expect(existsSync(join(hooks('web'), 'post-checkout'))).toBe(false);
    expect(hookStatus({ config }).changes.every((change) => change.state === 'missing')).toBe(true);
  });

  it('writes nothing with --dry-run, and only the hooks asked for with --on', () => {
    const { config, hooks } = project('dry');
    expect(installHooks({ config, dryRun: true }).changes).toHaveLength(6);
    expect(existsSync(join(hooks('api'), 'post-checkout'))).toBe(false);
    expect(installHooks({ config, on: 'commit', repo: 'api' }).changes.map((change) => change.file)).toEqual([join(hooks('api'), 'post-commit')]);
  });

  it('names each hook as git does, whatever name the configuration reaches the repository by', () => {
    // A link stands in for a second name of one directory: a Windows short name, a link in a temporary path.
    const { hooks } = project('linked');
    const alias = join(scratch, 'linked-alias');
    symlinkSync(join(scratch, 'linked'), alias, 'junction');
    const files = installHooks({ config: join(alias, 'flowatlas.config.json'), dryRun: true }).changes.map((change) => change.file);
    expect(files).toHaveLength(6);
    expect(files.every((file) => file.startsWith(join(hooks('api'), '')) || file.startsWith(join(hooks('web'), '')))).toBe(true);
  });

  it('writes nothing where another tool keeps the hooks, and says the line to add', () => {
    const { config, dir } = project('managed');
    git(dir('api'), 'config', 'core.hooksPath', '.husky');
    const run = installHooks({ config });
    expect(run.managed).toHaveLength(1);
    expect(run.managed[0]).toMatchObject({ services: ['api'], hooksPath: '.husky' });
    expect(run.managed[0]!.lines[0]).toMatch(/^post-checkout: if \[ "\$3" = "1" \]; then .*build --background/);
    expect(existsSync(join(dir('api'), '.husky'))).toBe(false);
    expect(run.changes.every((change) => change.services[0] === 'web')).toBe(true);
  });

  it('leaves a hook that is not a shell script alone', () => {
    const { config, hooks } = project('node-hook');
    writeFileSync(join(hooks('api'), 'post-merge'), '#!/usr/bin/env node\nconsole.log(1);\n');
    const run = installHooks({ config, repo: 'api' });
    expect(run.changes.find((change) => change.file.endsWith('post-merge'))?.state).toBe('not a shell script');
    expect(readFileSync(join(hooks('api'), 'post-merge'), 'utf8')).toBe('#!/usr/bin/env node\nconsole.log(1);\n');
  });
});
