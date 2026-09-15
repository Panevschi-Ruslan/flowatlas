import {
  GraphBuilder,
  isFunctionHandler,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
  type Unresolved,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { entryRegistriesAdapter } from './entry-registries.js';

const REGISTRY = `
export interface BotDeps { orders: { cancel(id: string): void } }
type Handler = (data: string, deps: BotDeps) => void;
const handlers = new Map<string, Handler>();
const register = (prefix: string, handler: Handler): void => { handlers.set(prefix, handler); };
export const callbackRegistry = { register };
`;

const CALLBACKS = {
  name: 'callbacks',
  receiver: 'callbackRegistry',
  method: 'register',
  keyArg: 0,
  handlerArg: 1,
  kind: 'bot_callback',
};

const contextOf = (source: string, registries: unknown[]): ExtractContext => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false },
  });
  project.createSourceFile('/src/registry.ts', REGISTRY);
  project.createSourceFile('/src/actions.ts', source);
  return {
    repo: 'bot',
    repoDir: '/',
    service: { name: 'bot', repo: '/', type: 'nestjs' },
    config: parseConfig({ adapters: { entry: { registries } } }),
    pkg: { dependencies: { telegraf: '^4.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'bot' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
};

const extract = (
  source: string,
  registries: unknown[] = [CALLBACKS],
): { entries: EntryNode[]; unresolved: Unresolved[] } => {
  const ctx = contextOf(source, registries);
  const entries = entryRegistriesAdapter.extractEntries(ctx);
  return { entries, unresolved: ctx.builder.build().unresolved };
};

describe('handlers kept in a table the project wrote itself', () => {
  it('runs where handlers are installed by call, not by decorator', () => {
    expect(entryRegistriesAdapter.detect({ dependencies: { telegraf: '^4.0.0' } })).toBe(true);
    expect(entryRegistriesAdapter.detect({ dependencies: { express: '^4.0.0' } })).toBe(false);
  });

  it('turns each registration into a way in, handled by the function named', () => {
    const { entries } = extract(`
      import { callbackRegistry, type BotDeps } from './registry.js';
      function confirmCancel(data: string, { orders }: BotDeps) { orders.cancel(data); }
      callbackRegistry.register('confirm_cancel', confirmCancel);
    `);
    expect(entries.map((entry) => entry.id)).toEqual(['entry:bot:bot_callback:confirm_cancel']);
    const handler = entries[0]?.handler;
    expect(handler !== undefined && isFunctionHandler(handler) && handler.functionName).toBe(
      'confirmCancel',
    );
    expect(entries[0]?.meta?.['registry']).toBe('callbacks');
  });

  it('points at the function written in place, found again by where it starts', () => {
    const { entries, unresolved } = extract(`
      import { callbackRegistry } from './registry.js';
      callbackRegistry.register('keep_order', (data, { orders }) => { orders.cancel(data); });
    `);
    expect(entries.map((entry) => entry.id)).toEqual(['entry:bot:bot_callback:keep_order']);
    expect(entries[0]?.handler).toMatchObject({ inline: true, label: 'callbacks:keep_order', line: 3 });
    expect(entries[0]?.meta?.['handlerVia']).toBe('inline');
    expect(unresolved).toEqual([]);
  });

  it('reports a key built at run time instead of inventing one', () => {
    const { entries, unresolved } = extract(`
      import { callbackRegistry } from './registry.js';
      function rate(data: string) {}
      callbackRegistry.register(\`rate_\${String(Date.now())}\`, rate);
    `);
    expect(entries).toEqual([]);
    expect(unresolved.map((row) => row.reason)).toEqual(['registry-key-dynamic']);
  });

  it('reads the arguments the configuration names, in the order it names them', () => {
    const { entries } = extract(
      `
      import { callbackRegistry } from './registry.js';
      function show() {}
      callbackRegistry.register(show, 'orders');
    `,
      [{ ...CALLBACKS, keyArg: 1, handlerArg: 0, kind: 'bot_command' }],
    );
    expect(entries.map((entry) => entry.id)).toEqual(['entry:bot:bot_command:orders']);
  });

  it('says nothing about an object of the same name from a package', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
    project.createSourceFile('/node_modules/other/package.json', '{"types":"index.d.ts"}');
    project.createSourceFile(
      '/node_modules/other/index.d.ts',
      'export declare const callbackRegistry: { register(k: string, f: () => void): void };',
    );
    project.createSourceFile(
      '/src/actions.ts',
      `import { callbackRegistry } from 'other';
       function show() {}
       callbackRegistry.register('orders', show);`,
    );
    const ctx: ExtractContext = {
      repo: 'bot',
      repoDir: '/',
      service: { name: 'bot', repo: '/', type: 'nestjs' },
      config: parseConfig({ adapters: { entry: { registries: [CALLBACKS] } } }),
      pkg: { dependencies: { telegraf: '^4.0.0' } },
      project,
      checker: project.getTypeChecker(),
      builder: new GraphBuilder({ repo: 'bot' }),
      adapters: noAdapters,
      logger: silentLogger,
    };
    expect(entryRegistriesAdapter.extractEntries(ctx)).toEqual([]);
  });
});

describe('a table of handlers nobody configured', () => {
  it('is named once, with how much of it there is', () => {
    // The worst thing about a registry the tool does not know is not the missing
    // handlers; it is that nothing says they are missing (R12).
    const { entries, unresolved } = extract(
      `
      import { callbackRegistry, type BotDeps } from './registry.js';
      function a(data: string, deps: BotDeps) {}
      function b(data: string, deps: BotDeps) {}
      callbackRegistry.register('one', a);
      callbackRegistry.register('two', b);
    `,
      [],
    );
    expect(entries).toEqual([]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.reason).toBe('entry-registry-unconfigured');
    expect(unresolved[0]?.symbol).toBe('callbackRegistry.register');
    expect(unresolved[0]?.meta?.['registrations']).toBe(2);
    expect(unresolved[0]?.hint).toContain('adapters.entry.registries');
  });

  it('stays quiet about a client of an installed library, which is the same shape', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
    project.createSourceFile('/node_modules/hono/package.json', '{"types":"index.d.ts"}');
    project.createSourceFile(
      '/node_modules/hono/index.d.ts',
      'export declare class Hono { post(path: string, handler: () => void): void }',
    );
    project.createSourceFile(
      '/src/worker.ts',
      `import { Hono } from 'hono';
       const app = new Hono();
       function receive() {}
       app.post('/messenger', receive);`,
    );
    const ctx: ExtractContext = {
      repo: 'bot',
      repoDir: '/',
      service: { name: 'bot', repo: '/', type: 'nestjs' },
      config: parseConfig({}),
      pkg: { dependencies: { telegraf: '^4.0.0' } },
      project,
      checker: project.getTypeChecker(),
      builder: new GraphBuilder({ repo: 'bot' }),
      adapters: noAdapters,
      logger: silentLogger,
    };
    entryRegistriesAdapter.extractEntries(ctx);
    expect(ctx.builder.build().unresolved).toEqual([]);
  });
});
