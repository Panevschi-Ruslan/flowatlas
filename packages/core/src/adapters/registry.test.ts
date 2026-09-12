import { describe, expect, it } from 'vitest';
import { AdapterNotFoundError, FlowatlasError } from '../errors.js';
import type { BrokerAdapter } from './broker.js';
import type { PackageJson } from './context.js';
import type { DbAdapter } from './db.js';
import type { EntryAdapter } from './entry.js';
import type { FrontendAdapter } from './frontend.js';
import { AdapterRegistry, noAdapters } from './registry.js';

const entryAdapter = (name: string, dependency: string): EntryAdapter => ({
  name,
  detect: (pkg) => Object.hasOwn({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }, dependency),
  extractEntries: () => [],
});

const dbAdapter = (name: string, dependency: string): DbAdapter => ({
  name,
  detect: (pkg) => Object.hasOwn(pkg.dependencies ?? {}, dependency),
  descriptor: { package: dependency, operations: { find: 'read', save: 'write' } },
});

const brokerAdapter = (name: string, dependency: string): BrokerAdapter => ({
  name,
  detect: (pkg) => Object.hasOwn(pkg.dependencies ?? {}, dependency),
  producerPatterns: [{ method: 'emit', channelArg: 0, payloadArg: 1 }],
  consumerDecorators: ['OnMessage'],
  channelKind: 'topic',
});

const frontendAdapter = (name: string, dependency: string): FrontendAdapter => ({
  name,
  detect: (pkg) => Object.hasOwn(pkg.dependencies ?? {}, dependency),
  extract: () => undefined,
});

describe('AdapterRegistry', () => {
  it('starts empty in every slot', () => {
    const registry = new AdapterRegistry();
    expect(registry.detect({})).toEqual(noAdapters);
  });

  it('detects from dependencies, devDependencies and peerDependencies', () => {
    const registry = new AdapterRegistry()
      .register('entry', entryAdapter('runtime-dep', 'pkg-a'))
      .register('entry', entryAdapter('dev-dep', 'pkg-b'))
      .register('entry', entryAdapter('peer-dep', 'pkg-c'))
      .register('entry', entryAdapter('absent', 'pkg-d'));
    const pkg: PackageJson = {
      dependencies: { 'pkg-a': '1.0.0' },
      devDependencies: { 'pkg-b': '1.0.0' },
      peerDependencies: { 'pkg-c': '1.0.0' },
    };
    expect(registry.detect(pkg).entry.map((a) => a.name)).toEqual([
      'runtime-dep',
      'dev-dep',
      'peer-dep',
    ]);
  });

  it('fills every slot independently', () => {
    const registry = new AdapterRegistry()
      .register('entry', entryAdapter('e', 'pkg-a'))
      .register('db', dbAdapter('d', 'pkg-a'))
      .register('broker', brokerAdapter('b', 'pkg-a'))
      .register('frontend', frontendAdapter('f', 'pkg-a'));
    const detected = registry.detect({ dependencies: { 'pkg-a': '1.0.0' } });
    expect({
      entry: detected.entry.map((a) => a.name),
      db: detected.db.map((a) => a.name),
      broker: detected.broker.map((a) => a.name),
      frontend: detected.frontend.map((a) => a.name),
    }).toEqual({ entry: ['e'], db: ['d'], broker: ['b'], frontend: ['f'] });
  });

  it('returns nothing for a manifest with no dependency sections', () => {
    const registry = new AdapterRegistry().register('entry', entryAdapter('e', 'pkg-a'));
    expect(registry.detect({})).toEqual(noAdapters);
    expect(registry.detect({ name: 'x', version: '1.0.0' })).toEqual(noAdapters);
  });

  it('keeps registration order in the detected list', () => {
    const registry = new AdapterRegistry()
      .register('entry', entryAdapter('second', 'pkg-a'))
      .register('entry', entryAdapter('first', 'pkg-a'));
    expect(registry.detect({ dependencies: { 'pkg-a': '1.0.0' } }).entry.map((a) => a.name)).toEqual(
      ['second', 'first'],
    );
  });

  it('lets force replace the detected list rather than add to it', () => {
    const registry = new AdapterRegistry()
      .register('entry', entryAdapter('detected', 'pkg-a'))
      .register('entry', entryAdapter('forced', 'pkg-absent'));
    const pkg: PackageJson = { dependencies: { 'pkg-a': '1.0.0' } };
    expect(registry.detect(pkg).entry.map((a) => a.name)).toEqual(['detected']);
    expect(registry.detect(pkg, { entry: ['forced'] }).entry.map((a) => a.name)).toEqual(['forced']);
  });

  it('lets force empty a slot completely', () => {
    const registry = new AdapterRegistry().register('entry', entryAdapter('detected', 'pkg-a'));
    expect(registry.detect({ dependencies: { 'pkg-a': '1.0.0' } }, { entry: [] }).entry).toEqual([]);
  });

  it('leaves the other slots detecting when one is forced', () => {
    const registry = new AdapterRegistry()
      .register('entry', entryAdapter('e', 'pkg-a'))
      .register('db', dbAdapter('d', 'pkg-a'));
    const detected = registry.detect({ dependencies: { 'pkg-a': '1.0.0' } }, { entry: [] });
    expect(detected.entry).toEqual([]);
    expect(detected.db.map((a) => a.name)).toEqual(['d']);
  });

  it('throws when a forced name is not registered', () => {
    const registry = new AdapterRegistry().register('entry', entryAdapter('known', 'pkg-a'));
    expect(() => registry.detect({}, { entry: ['unknown'] })).toThrow(AdapterNotFoundError);
  });

  it('names the registered adapters in the error', () => {
    const registry = new AdapterRegistry().register('entry', entryAdapter('known', 'pkg-a'));
    try {
      registry.detect({}, { entry: ['unknown'] });
      expect.unreachable('detect should have thrown');
    } catch (error) {
      expect((error as AdapterNotFoundError).message).toContain('known');
      expect((error as AdapterNotFoundError).code).toBe('adapter-not-found');
    }
  });

  it('refuses two adapters with the same name in one slot', () => {
    const registry = new AdapterRegistry().register('entry', entryAdapter('same', 'pkg-a'));
    expect(() => registry.register('entry', entryAdapter('same', 'pkg-b'))).toThrow(FlowatlasError);
  });

  it('allows the same name in different slots', () => {
    const registry = new AdapterRegistry().register('entry', entryAdapter('shared', 'pkg-a'));
    expect(() => registry.register('db', dbAdapter('shared', 'pkg-a'))).not.toThrow();
  });

  it('exposes what is registered', () => {
    const registry = new AdapterRegistry()
      .register('entry', entryAdapter('a', 'pkg-a'))
      .registerAll('db', [dbAdapter('x', 'pkg-a'), dbAdapter('y', 'pkg-b')]);
    expect(registry.names('entry')).toEqual(['a']);
    expect(registry.names('db')).toEqual(['x', 'y']);
    expect(registry.list('db')).toHaveLength(2);
    expect(registry.get('entry', 'a')?.name).toBe('a');
    expect(registry.get('entry', 'missing')).toBeUndefined();
  });
});
