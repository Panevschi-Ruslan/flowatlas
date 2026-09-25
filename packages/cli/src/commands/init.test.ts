import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CONFIG_FILENAME, FlowatlasError, loadConfig } from '@flowatlas/core';
import { afterEach, describe, expect, it } from 'vitest';
import { UNKNOWN_TYPE } from '../stacks.js';
import { runInit, scanCandidates, suggestName } from './init.js';

const temporary: string[] = [];

const makeRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-init-'));
  temporary.push(dir);
  return dir;
};

const makeRepo = (root: string, dir: string, pkg: Record<string, unknown>): string => {
  const path = join(root, dir);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), JSON.stringify(pkg, null, 2));
  return path;
};

/** A workspace with the tool in `flowatlas/` and repositories beside it. */
const makeWorkspace = (): { root: string; configDir: string; out: string } => {
  const root = makeRoot();
  const configDir = join(root, 'flowatlas');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'package.json'), JSON.stringify({ name: 'flowatlas' }));
  return { root, configDir, out: join(configDir, CONFIG_FILENAME) };
};

const silent = (): ((message: string) => void) => () => undefined;

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('suggestName', () => {
  it('drops the scope from a package name', () => {
    expect(suggestName({ name: '@project/orders' }, '/repos/orders-service')).toBe('orders');
  });

  it('uses an unscoped package name as is', () => {
    expect(suggestName({ name: 'orders' }, '/repos/x')).toBe('orders');
  });

  it('falls back to the directory name', () => {
    expect(suggestName({}, '/repos/orders-service')).toBe('orders-service');
  });
});

describe('scanCandidates', () => {
  it('finds sibling repositories and skips the tool itself', () => {
    const { root, configDir } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api', dependencies: { '@nestjs/core': '10.0.0' } });
    makeRepo(root, 'web', { name: 'web', dependencies: { '@angular/core': '17.0.0' } });
    const found = scanCandidates(root, configDir);
    expect(found.map((c) => c.name)).toEqual(['api', 'web']);
    expect(found.map((c) => c.repo)).toEqual(['../api', '../web']);
  });

  it('ignores directories without a manifest and the usual noise', () => {
    const { root, configDir } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api' });
    mkdirSync(join(root, 'notes'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'package.json'), '{"name":"nm"}');
    mkdirSync(join(root, '.hidden'));
    writeFileSync(join(root, '.hidden', 'package.json'), '{"name":"h"}');
    expect(scanCandidates(root, configDir).map((c) => c.name)).toEqual(['api']);
  });

  it('reports a directory that cannot be read', () => {
    const { configDir } = makeWorkspace();
    expect(() => scanCandidates(join(configDir, 'nope'), configDir)).toThrow(FlowatlasError);
  });
});

describe('runInit', () => {
  /**
   * The first build of a fresh project failed on every service, and the error
   * told the reader to re-run the command that had just written the file.
   *
   * `init` computed each repository path relative to the directory it was
   * handed; `build` resolved them against the directory that file turned out to
   * be in. Where the two are separated by a symbolic link they differ by
   * however many levels the link skips, and on macOS `/tmp` is such a link, so
   * anyone who pointed `--out` there got a configuration that could not load.
   */
  it('writes paths that load, even reached through a link', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api', dependencies: { '@nestjs/core': '10.0.0' } });

    const linked = join(makeRoot(), 'by-another-name');
    symlinkSync(join(out, '..'), linked, 'dir');

    const result = await runInit({
      dir: root,
      out: join(linked, CONFIG_FILENAME),
      yes: true,
      print: silent(),
    });

    expect(result.config.services[0]?.repo).toBe('../api');
    expect(() => loadConfig(result.configPath)).not.toThrow();
  });

  it('writes a configuration that the loader accepts', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api', dependencies: { '@nestjs/core': '10.0.0' } });
    makeRepo(root, 'web', { name: 'web', dependencies: { '@angular/core': '17.0.0' } });

    const result = await runInit({ dir: root, out, yes: true, print: silent() });

    // `realpath`, not `resolve`: the path the caller typed may go through a
    // link, and every repo path in the file is written relative to where the
    // file really is so that `build` resolves them to the same place.
    expect(result.configPath).toBe(realpathSync(resolve(out)));
    expect(result.config.services).toEqual([
      { name: 'api', repo: '../api', type: 'nestjs' },
      { name: 'web', repo: '../web', type: 'angular' },
    ]);
    expect(result.config.output).toBe('.flowatlas');
    expect(result.config.adapters).toEqual({
      auto: true,
      force: {},
      entry: { registries: [], http: [] },
      broker: { custom: [] },
      db: { localBaseClasses: [] },
    });

    const loaded = loadConfig(out);
    expect(loaded.config.services).toHaveLength(2);
    expect(loaded.repoDir('api')).toBe(join(root, 'api'));
  });

  it('writes valid JSON ending in a newline', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api' });
    await runInit({ dir: root, out, yes: true, print: silent() });
    const text = readFileSync(out, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('keeps a repository whose type it could not guess, marked as unknown', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'tooling', { name: 'tooling', dependencies: { lodash: '4.0.0' } });
    const result = await runInit({ dir: root, out, yes: true, print: silent() });
    expect(result.config.services[0]).toEqual({
      name: 'tooling',
      repo: '../tooling',
      type: UNKNOWN_TYPE,
    });
  });

  it('names a framework it has no reader for, and says the repository is left out', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api', dependencies: { nuxt: '3.14.0' } });
    const messages: string[] = [];
    const result = await runInit({ dir: root, out, yes: true, print: (m) => messages.push(m) });
    // The configuration still holds it: a repository nobody can read is still a
    // repository of this project, and `type` is an open string.
    expect(result.config.services[0]).toEqual({ name: 'api', repo: '../api', type: UNKNOWN_TYPE });
    const said = messages.join('\n');
    expect(said).toContain('No reader yet for: api (Nuxt)');
    expect(said).toContain('contribute nothing to the graph');
    expect(said).not.toContain('Could not tell the type of');
  });

  it('still says it could not tell, when the manifest gave nothing away', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'tooling', { name: 'tooling', dependencies: { lodash: '4.0.0' } });
    const messages: string[] = [];
    await runInit({ dir: root, out, yes: true, print: (m) => messages.push(m) });
    const said = messages.join('\n');
    expect(said).toContain('Could not tell the type of: tooling');
    expect(said).not.toContain('No reader yet');
  });

  it('says so and writes an empty configuration when there is nothing to find', async () => {
    const { root, out } = makeWorkspace();
    const messages: string[] = [];
    const result = await runInit({ dir: root, out, yes: true, print: (m) => messages.push(m) });
    expect(result.config.services).toEqual([]);
    expect(messages.join(' ')).toContain('No repositories found');
    expect(loadConfig(out).config.services).toEqual([]);
  });

  it('refuses to overwrite an existing configuration', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api' });
    await runInit({ dir: root, out, yes: true, print: silent() });
    await expect(runInit({ dir: root, out, yes: true, print: silent() })).rejects.toThrow(
      FlowatlasError,
    );
  });

  it('overwrites when told to', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api' });
    await runInit({ dir: root, out, yes: true, print: silent() });
    makeRepo(root, 'web', { name: 'web' });
    const again = await runInit({ dir: root, out, yes: true, force: true, print: silent() });
    expect(again.config.services.map((s) => s.name)).toEqual(['api', 'web']);
  });

  it('lists what it wrote', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api', dependencies: { '@nestjs/core': '10.0.0' } });
    const messages: string[] = [];
    await runInit({ dir: root, out, yes: true, print: (m) => messages.push(m) });
    const printed = messages.join('\n');
    expect(printed).toContain('1 service(s)');
    expect(printed).toContain('api');
    expect(printed).toContain('../api');
  });
});

describe('runInit without a terminal', () => {
  it('says so instead of hanging on a prompt nobody can answer', async () => {
    const { root, out } = makeWorkspace();
    makeRepo(root, 'api', { name: 'api', dependencies: { '@nestjs/core': '10.0.0' } });
    expect(process.stdin.isTTY).not.toBe(true);
    await expect(runInit({ dir: root, out, print: silent() })).rejects.toThrow(
      /not interactive/i,
    );
  });

  it('still writes an empty configuration when there is nothing to ask about', async () => {
    const { root, out } = makeWorkspace();
    const result = await runInit({ dir: root, out, print: silent() });
    expect(result.config.services).toEqual([]);
  });
});
