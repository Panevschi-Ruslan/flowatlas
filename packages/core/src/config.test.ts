import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONFIG_FILENAME,
  DEFAULT_OUTPUT,
  DEFAULT_TYPE_MAX_DEPTH,
  findConfig,
  loadConfig,
  parseConfig,
} from './config.js';
import { ConfigInvalidError, ConfigNotFoundError } from './errors.js';

const temporary: string[] = [];

const makeRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-config-'));
  temporary.push(dir);
  return dir;
};

const writeConfig = (root: string, config: unknown): string => {
  const path = join(root, CONFIG_FILENAME);
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
};

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseConfig', () => {
  it('applies every default to an empty configuration', () => {
    expect(parseConfig({})).toEqual({
      services: [],
      sharedPackages: [],
      adapters: {
        auto: true,
        force: {},
        entry: { registries: [], http: [] },
        broker: { custom: [] },
        db: { localBaseClasses: [] },
      },
      output: DEFAULT_OUTPUT,
      types: { maxDepth: DEFAULT_TYPE_MAX_DEPTH },
      contracts: {
        depth: DEFAULT_TYPE_MAX_DEPTH,
        rules: { disable: [] },
        ignoreEdges: [],
      },
      doctor: {
        ignoreReasons: [],
        publicDecorators: ['Public', 'IsPublic', 'AllowAnonymous', 'SkipAuth'],
        publicRoutes: [],
        nonGateWrappers: ['ThrottlerGuard'],
        skipGuardDecorators: {},
        markers: { warnAsError: false },
      },
    });
  });

  it('fills the inner defaults when a section is given partially', () => {
    expect(parseConfig({ adapters: { auto: false } }).adapters).toEqual({
      auto: false,
      force: {},
      entry: { registries: [], http: [] },
      broker: { custom: [] },
      db: { localBaseClasses: [] },
    });
    expect(parseConfig({ types: {} }).types).toEqual({ maxDepth: DEFAULT_TYPE_MAX_DEPTH });
  });

  it('keeps the values it was given', () => {
    const config = parseConfig({
      services: [
        { name: 'gateway', repo: '../gateway', type: 'backend', baseUrlEnv: ['GATEWAY_URL'] },
        { name: 'web', repo: '../web-app', type: 'frontend', apiBaseEnv: ['apiUrl'] },
      ],
      sharedPackages: ['@project/contracts'],
      adapters: { auto: true, force: { entry: ['some-entry-adapter'] } },
      output: '.out',
      types: { maxDepth: 5 },
    });
    expect(config.services.map((s) => s.name)).toEqual(['gateway', 'web']);
    expect(config.services[0]?.baseUrlEnv).toEqual(['GATEWAY_URL']);
    expect(config.services[1]?.apiBaseEnv).toEqual(['apiUrl']);
    expect(config.adapters.force.entry).toEqual(['some-entry-adapter']);
    expect(config.output).toBe('.out');
    expect(config.types.maxDepth).toBe(5);
  });

  it('accepts the optional per-service paths', () => {
    const config = parseConfig({
      services: [
        {
          name: 'bot',
          repo: '../bot',
          type: 'backend',
          tsconfig: 'tsconfig.build.json',
          bootstrap: 'src/worker.ts',
        },
      ],
    });
    expect(config.services[0]).toMatchObject({
      tsconfig: 'tsconfig.build.json',
      bootstrap: 'src/worker.ts',
    });
  });

  it('rejects a duplicate service name', () => {
    expect(() =>
      parseConfig({
        services: [
          { name: 'orders', repo: '../a', type: 'backend' },
          { name: 'orders', repo: '../b', type: 'backend' },
        ],
      }),
    ).toThrow(ConfigInvalidError);
  });

  it('rejects an unknown key', () => {
    expect(() => parseConfig({ servces: [] })).toThrow(ConfigInvalidError);
    expect(() => parseConfig({ services: [{ name: 'a', repo: '../a', type: 'backend', extra: 1 }] })).toThrow(
      ConfigInvalidError,
    );
  });

  it('rejects a service that is missing a required field', () => {
    expect(() => parseConfig({ services: [{ name: 'a', type: 'backend' }] })).toThrow(
      ConfigInvalidError,
    );
  });

  it('accepts a frontend that names which service answers its settings key', () => {
    const config = parseConfig({
      services: [
        { name: 'gateway', repo: '../gateway', type: 'backend' },
        {
          name: 'web',
          repo: '../web',
          type: 'frontend',
          apiBaseEnv: ['apiUrl'],
          apiTarget: { apiUrl: 'gateway' },
        },
      ],
    });
    expect(config.services[1]?.apiTarget).toEqual({ apiUrl: 'gateway' });
  });

  it('rejects a target naming a service that does not exist, and says which key', () => {
    try {
      parseConfig({
        services: [
          { name: 'web', repo: '../web', type: 'frontend', apiTarget: { apiUrl: 'nope' } },
        ],
      });
      expect.unreachable('parseConfig should have thrown');
    } catch (error) {
      const issues = (error as ConfigInvalidError).issues.join();
      expect(issues).toContain('services.0.apiTarget.apiUrl');
      expect(issues).toContain('nope');
    }
  });

  it('names the offending path in the error', () => {
    try {
      parseConfig({ services: [{ name: '', repo: '../a', type: 'backend' }] });
      expect.unreachable('parseConfig should have thrown');
    } catch (error) {
      expect((error as ConfigInvalidError).issues.join()).toContain('services.0.name');
    }
  });
});

describe('findConfig', () => {
  it('finds the file in the directory itself', () => {
    const root = makeRoot();
    const path = writeConfig(root, {});
    expect(findConfig(root)).toBe(path);
  });

  it('walks up from a nested directory', () => {
    const root = makeRoot();
    const path = writeConfig(root, {});
    const nested = join(root, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect(findConfig(nested)).toBe(path);
  });

  it('returns undefined when there is nothing to find', () => {
    expect(findConfig(makeRoot())).toBeUndefined();
  });
});

describe('loadConfig', () => {
  it('reads a configuration and resolves its directories', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'orders'));
    writeConfig(root, { services: [{ name: 'orders', repo: './orders', type: 'backend' }] });
    const loaded = loadConfig(root);
    expect(loaded.rootDir).toBe(resolve(root));
    expect(loaded.outputDir).toBe(resolve(root, DEFAULT_OUTPUT));
    expect(loaded.repoDir('orders')).toBe(resolve(root, 'orders'));
  });

  it('accepts the configuration file itself as the argument', () => {
    const root = makeRoot();
    const path = writeConfig(root, {});
    expect(loadConfig(path).configPath).toBe(path);
  });

  it('resolves a repository directory by service object as well as by name', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'orders'));
    writeConfig(root, { services: [{ name: 'orders', repo: './orders', type: 'backend' }] });
    const loaded = loadConfig(root);
    const service = loaded.config.services[0];
    expect(service).toBeDefined();
    if (service !== undefined) expect(loaded.repoDir(service)).toBe(resolve(root, 'orders'));
  });

  it('honours an absolute repository path and an absolute output path', () => {
    const root = makeRoot();
    const elsewhere = makeRoot();
    writeConfig(root, {
      services: [{ name: 'orders', repo: elsewhere, type: 'backend' }],
      output: elsewhere,
    });
    const loaded = loadConfig(root);
    expect(loaded.repoDir('orders')).toBe(elsewhere);
    expect(loaded.outputDir).toBe(elsewhere);
  });

  it('reports a repository directory that does not exist', () => {
    const root = makeRoot();
    writeConfig(root, { services: [{ name: 'orders', repo: './missing', type: 'backend' }] });
    try {
      loadConfig(root);
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigInvalidError);
      expect((error as ConfigInvalidError).issues.join()).toContain('./missing');
    }
  });

  it('skips the directory check when asked to', () => {
    const root = makeRoot();
    writeConfig(root, { services: [{ name: 'orders', repo: './missing', type: 'backend' }] });
    expect(loadConfig(root, { checkRepos: false }).config.services).toHaveLength(1);
  });

  it('throws when no configuration exists anywhere above', () => {
    expect(() => loadConfig(makeRoot())).toThrow(ConfigNotFoundError);
  });

  it('reports a file that is not valid JSON', () => {
    const root = makeRoot();
    writeFileSync(join(root, CONFIG_FILENAME), '{ "services": [ }');
    expect(() => loadConfig(root)).toThrow(ConfigInvalidError);
  });

  it('throws for a service name that is not configured', () => {
    const root = makeRoot();
    writeConfig(root, {});
    expect(() => loadConfig(root).repoDir('nope')).toThrow(ConfigInvalidError);
  });
});
