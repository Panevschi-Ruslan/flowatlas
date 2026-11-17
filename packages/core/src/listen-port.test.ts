import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import type { ExtractContext } from './adapters/context.js';
import type { EntryAdapter } from './adapters/entry.js';
import { listenCallsIn, listeningOf, literalPort, placedPort, type ListenPort, type PortReading } from './listen-port.js';

/** The ports read in some files, as `port[setting]` at their line. */
const portsIn = (files: Record<string, string>): string[] => {
  const project = new Project({ useInMemoryFileSystem: true });
  const sources = Object.entries(files).map(([path, text]) => project.createSourceFile(path, text));
  return listenCallsIn(sources).map((read) => {
    const placed = placedPort(read, '/');
    return `${placed.file}:${placed.line} ${placed.port}${placed.setting === undefined ? '' : `[${placed.setting}]`}`;
  });
};

describe('the port a server listens on (P250)', () => {
  it('reads a number, a constant, an options object and a server made around an application', () => {
    expect(
      portsIn({
        '/src/a.ts': 'app.listen(3001);',
        '/src/b.ts': 'const PORT = 3002;\napp.listen(PORT, () => {});',
        '/src/c.ts': "await app.listen({ port: 3003, host: '0.0.0.0' });",
        '/src/d.ts': "import http from 'node:http';\nhttp.createServer(app).listen('3004');",
      }),
    ).toEqual(['src/a.ts:1 3001', 'src/b.ts:2 3002', 'src/c.ts:1 3003', 'src/d.ts:2 3004']);
  });

  it('reads the number a setting falls back to, with the setting', () => {
    expect(
      portsIn({
        '/src/a.ts': 'app.listen(process.env.PORT ?? 3001);',
        '/src/b.ts': 'const port = Number(process.env.APP_PORT) || 3002;\napp.listen(port);',
        '/src/c.ts': "app.listen(parseInt(process.env['PORT'] ?? '3003', 10));",
        '/src/d.ts': "await app.listen(config.get('PORT', 3004));",
        '/src/e.ts': 'const given = process.env.PORT;\nawait app.listen({ port: +given || 3005 });',
        '/src/f.ts': 'export {};\nconst port = Number(process.env.PORT) || 3006;\nvoid app.listen({ port, host: "0.0.0.0" });',
      }),
    ).toEqual(['src/a.ts:1 3001[PORT]', 'src/b.ts:2 3002[APP_PORT]', 'src/c.ts:1 3003[PORT]', 'src/d.ts:1 3004[PORT]', 'src/e.ts:2 3005[PORT]', 'src/f.ts:3 3006[PORT]']);
  });

  it('reads nothing where the port is handed in by nobody, asked of the system, a key nothing fills, or in a test', () => {
    expect(
      portsIn({
        '/src/b.ts': 'export const start = (port: number) => app.listen(port);',
        '/src/c.ts': 'server.listen();',
        '/src/d.ts': "emitter.listen('ready', () => {});",
        '/src/e.test.ts': 'app.listen(3009);',
        '/src/f.ts': "app.listen(configService.get('app.port'));",
      }),
    ).toEqual([]);
  });

  it('keeps a port read from a setting alone, with no number, for the setting files to fill (P254)', () => {
    expect(
      portsIn({
        '/src/a.ts': 'app.listen(process.env.PORT);',
        '/src/b.ts': "app.listen(Number(process.env['ORDERS_PORT']));",
      }),
    ).toEqual(['src/a.ts:1 undefined[PORT]', 'src/b.ts:1 undefined[ORDERS_PORT]']);
  });

  it('tells a literal port from a fallback and a default', () => {
    expect(literalPort({})).toBe(true);
    expect(literalPort({ setting: 'PORT' })).toBe(false);
    expect(literalPort({ default: true })).toBe(false);
  });

  it('keeps each port once per line, whichever adapters read it', () => {
    const at = (port: number, line: number, file = 'src/main.ts'): ListenPort => ({ port, file, line });
    const adapter = (name: string, ports: ListenPort[]): EntryAdapter => ({ name, detect: () => true, extractEntries: () => [], listens: () => ports });
    const ctx = {
      adapters: { entry: [adapter('a', [at(3001, 4), at(3002, 9, 'src/admin.ts')]), adapter('b', [at(3001, 4)]), adapter('c', [])] },
    } as unknown as ExtractContext;
    expect(listeningOf(ctx)).toEqual([at(3002, 9, 'src/admin.ts'), at(3001, 4)]);
  });

  it("asks a front end's adapters where its dev server listens too (P254)", () => {
    const port: ListenPort = { port: 5174, file: 'bundler.config.ts', line: 4, devServer: true };
    const ctx = {
      adapters: { entry: [], frontend: [{ name: 'front', detect: () => true, extract: () => {}, listens: () => [port] }] },
    } as unknown as ExtractContext;
    expect(listeningOf(ctx)).toEqual([port]);
  });
});

/** The ports read in some files, with the call that hands each in and the setting it falls back from. */
const handedIn = (files: Record<string, string>, reading?: PortReading): string[] => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  const sources = Object.entries(files).map(([path, text]) => project.createSourceFile(path, text));
  return listenCallsIn(sources, reading).map((read) => {
    const placed = placedPort(read, '/');
    return `${placed.file}:${placed.line} ${placed.port ?? '-'}${placed.setting === undefined ? '' : `[${placed.setting}]`}${placed.handed === undefined ? '' : ` < ${placed.handed}`}`;
  });
};

describe('a port decided away from the line that starts the server (P254)', () => {
  it('reads a port handed to the function that starts the server, at each call, through two functions', () => {
    expect(
      handedIn({
        '/src/server.ts': 'export const start = (port: number) => app.listen(port);',
        '/src/main.ts': "import { start } from './server';\nstart(3001);",
        '/src/worker.ts': "import { start } from './server';\n\nstart(Number(process.env.PORT) || 3101);",
        '/src/server.test.ts': "import { start } from './server';\nstart(9999);",
      }),
    ).toEqual(['src/server.ts:1 3001 < src/main.ts:2', 'src/server.ts:1 3101[PORT] < src/worker.ts:3']);
    expect(
      handedIn({
        '/src/serve.ts': 'export function serve(options: { port: number }) {\n  return app.listen(options.port);\n}',
        '/src/boot.ts': "import { serve } from './serve';\nexport const boot = (port: number) => serve({ port });",
        '/src/main.ts': "import { boot } from './boot';\nboot(3002);",
      }),
    ).toEqual(['src/serve.ts:2 3002 < src/main.ts:2']);
  });

  it('reads a port destructured from an options object handed in, and one handed as the options', () => {
    expect(
      handedIn({
        '/src/a.ts': 'export async function bootstrap({ port }: { port: number }) {\n  await app.listen(port);\n}\nbootstrap({ port: 3003 });',
        '/src/b.ts': 'const run = (options) => server.listen(options);\nrun({ port: 3004, host: "0.0.0.0" });',
      }),
    ).toEqual(['src/a.ts:2 3003 < src/a.ts:4', 'src/b.ts:1 3004 < src/b.ts:2']);
  });

  it('reads a property of a literal settings object, in this file or another, nested or destructured', () => {
    expect(
      handedIn({
        '/src/config.ts': 'export const config = { port: 3005, server: { port: Number(process.env.PORT) || 3006 } };\nexport default { port: 3007 };',
        '/src/a.ts': "import { config } from './config';\napp.listen(config.port);",
        '/src/b.ts': "import { config } from './config';\napp.listen(config.server.port);",
        '/src/c.ts': "import settings from './config';\napp.listen(settings.port);",
        '/src/d.ts': "import { config } from './config';\nconst { port } = config;\napp.listen(port);",
      }),
    ).toEqual(['src/a.ts:2 3005', 'src/b.ts:2 3006[PORT]', 'src/c.ts:2 3007', 'src/d.ts:3 3005']);
  });

  it("asks the adapter's reading what a settings getter answers, the getter's own fallback first", () => {
    const reading: PortReading = { settingOf: (_call, key) => (key === 'app.port' ? { setting: 'PORT', port: 3008 } : undefined) };
    expect(
      handedIn(
        {
          '/src/a.ts': "app.listen(configService.get('app.port'));",
          '/src/b.ts': "app.listen(configService.get<number>('app.port', 3009));",
          '/src/c.ts': "app.listen(settings.get('other'));",
        },
        reading,
      ),
    ).toEqual(['src/a.ts:1 3008[PORT]', 'src/b.ts:1 3009[PORT]']);
  });
});

describe('a port read through a merge helper of the repository (P305)', () => {
  /** The ports read in some files, with the merge each is read through. */
  const merged = (files: Record<string, string>): string[] => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sources = Object.entries(files).map(([path, text]) => project.createSourceFile(path, text));
    return listenCallsIn(sources).map((read) => {
      const placed = placedPort(read, '/');
      return `${placed.file}:${placed.line} ${placed.port}${placed.merged === undefined ? '' : ` merged at ${placed.merged}`}`;
    });
  };
  const defaults = "export const defaults = { api: { host: '', port: 3000, path: 'shop' } };";
  const helper = [
    "import { defaults } from './defaults';",
    'export function mergeConfig(given: Record<string, any>) {',
    '  const out: Record<string, any> = { ...defaults };',
    '  for (const [key, value] of Object.entries(given)) out[key] = { ...out[key], ...value };',
    '  return out;',
    '}',
  ].join('\n');

  it("reads the defaults' value where what is handed in leaves the key out, and marks it", () => {
    expect(
      merged({
        '/src/defaults.ts': defaults,
        '/src/merge.ts': helper,
        '/src/main.ts': [
          "import { mergeConfig } from './merge';",
          'export async function bootstrap(given = {}) {',
          '  const config = mergeConfig(given);',
          '  const { host, port } = config.api;',
          '  await app.listen(port, host);',
          '}',
        ].join('\n'),
      }),
    ).toEqual(['src/main.ts:5 3000 merged at src/main.ts:3']);
    expect(literalPort({ merged: 'src/main.ts:3' })).toBe(false);
  });

  it("reads the given object's value where it writes the key, at the whole path, and a helper handed both", () => {
    expect(
      merged({
        '/src/defaults.ts': defaults,
        '/src/merge.ts': helper,
        '/src/a.ts': "import { mergeConfig } from './merge';\nconst { port } = mergeConfig({ api: { host: 'x', port: 4100 } }).api;\napp.listen(port);",
        '/src/b.ts': "import { mergeConfig } from './merge';\napp.listen(mergeConfig({ api: { host: 'x' } }).api.port);",
        '/src/c.ts': [
          "import { defaults } from './defaults';",
          'const deep = (target: any, source: any): any => { for (const key in source) target[key] = source[key]; return target; };',
          'app.listen(deep(defaults, { other: 1 }).api.port);',
        ].join('\n'),
      }),
    ).toEqual(['src/a.ts:3 4100 merged at src/a.ts:2', 'src/b.ts:2 3000 merged at src/b.ts:2', 'src/c.ts:3 3000 merged at src/c.ts:3']);
  });

  it('reads through a function of the repository that returns what it is handed, unmarked, and nothing through one of a library (P315)', () => {
    expect(
      merged({
        '/src/defaults.ts': defaults,
        '/src/a.ts': "import { defaults } from './defaults';\nconst pick = (given: any) => given;\napp.listen(pick(defaults).api.port);",
        '/src/b.ts': "import merge from 'lodash/merge';\nimport { defaults } from './defaults';\napp.listen(merge({}, defaults).api.port);",
      }),
    ).toEqual(['src/a.ts:3 3000']);
  });

  it("reads each caller's object where the merged object is a parameter, and the parameter's default where a caller hands none (P315)", () => {
    expect(
      merged({
        '/src/defaults.ts': defaults,
        '/src/merge.ts': helper,
        '/src/main.ts': [
          "import { mergeConfig } from './merge';",
          'export async function bootstrap(given = {}) {',
          '  const { port } = mergeConfig(given).api;',
          '  await app.listen(port);',
          '}',
        ].join('\n'),
        '/src/index.ts': "import { bootstrap } from './main';\nvoid bootstrap({ api: { port: 4100 } });\nvoid bootstrap();",
      }),
    ).toEqual(['src/main.ts:4 4100 merged at src/main.ts:3', 'src/main.ts:4 3000 merged at src/main.ts:3']);
  });
});

describe('a port read through a module variable a setter merges into and a getter returns (P315)', () => {
  /** The ports read in some files, with the merge each is read through and the call that hands it. */
  const held = (files: Record<string, string>, unread: string[] = []): string[] => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sources = Object.entries(files).map(([path, text]) => project.createSourceFile(path, text));
    return listenCallsIn(sources, undefined, (each) => unread.push(`${each.at.getSourceFile().getBaseName()}:${each.at.getStartLineNumber()} from ${each.from.getText()}`))
      .map((read) => placedPort(read, '/'))
      .map((placed) => `${placed.file}:${placed.line} ${placed.port}${placed.merged === undefined ? '' : ` merged at ${placed.merged}`}${placed.handed === undefined ? '' : ` handed at ${placed.handed}`}`)
      .sort();
  };
  const defaults = "export const defaults = { api: { host: '', port: 3000 } };";
  const merge = 'export function mergeConfig(target: any, source: any): any {\n  for (const key in source) target[key] = source[key];\n  return target;\n}';
  const config = [
    "import { defaults } from './defaults';",
    "import { mergeConfig } from './merge';",
    'let active: any = defaults;',
    'export function setConfig(given: any) { active = mergeConfig(active, given); }',
    'export function getConfig() { return active; }',
  ].join('\n');

  it("reads what each call of the setter made before the read hands, over the variable's first value", () => {
    expect(
      held({
        '/src/defaults.ts': defaults,
        '/src/merge.ts': merge,
        '/src/config.ts': config,
        '/src/main.ts': [
          "import { getConfig, setConfig } from './config';",
          'export async function bootstrap(given: any) {',
          '  setConfig(given);',
          '  await app.listen(getConfig().api.port);',
          '}',
        ].join('\n'),
        '/src/index.ts': "import { bootstrap } from './main';\nvoid bootstrap({ api: { port: 4100 } });",
        '/src/worker.ts': "import { bootstrap } from './main';\nvoid bootstrap({ api: { host: 'x' } });",
      }),
    ).toEqual(['src/main.ts:4 3000 merged at src/config.ts:4', 'src/main.ts:4 4100 merged at src/config.ts:4 handed at src/index.ts:2']);
  });

  it('reads a setter called before the function that reads, and not one called after', () => {
    expect(
      held({
        '/src/defaults.ts': defaults,
        '/src/merge.ts': merge,
        '/src/config.ts': config,
        '/src/server.ts': "import { getConfig } from './config';\nexport function start() {\n  const { port } = getConfig().api;\n  app.listen(port);\n}",
        '/src/main.ts': "import { setConfig } from './config';\nimport { start } from './server';\nsetConfig({ api: { port: 4200 } });\nstart();\nsetConfig({ api: { port: 4300 } });",
      }),
    ).toEqual(['src/server.ts:4 4200 merged at src/config.ts:4 handed at src/main.ts:3']);
  });

  it('reads a plain write of what a setter is handed, and the first value where no setter is called first', () => {
    expect(
      held({
        '/src/a.ts': 'let port = 3001;\nexport function usePort(given: number) { port = given; }\nexport function start() { app.listen(port); }',
        '/src/b.ts': "import { start, usePort } from './a';\nusePort(4001);\nstart();",
        '/src/c.ts': 'let port = 3002;\nexport function usePort(given: number) { port = given; }\nexport function start() { app.listen(port); }\nstart();\nusePort(4002);',
      }),
    ).toEqual(['src/a.ts:3 4001 handed at src/b.ts:2', 'src/c.ts:3 3002']);
  });

  it('reads no port and says so where the first value is loaded by a path decided at run time', () => {
    const unread: string[] = [];
    expect(
      held(
        {
          '/src/merge.ts': merge,
          '/src/config.ts': [
            "import path from 'path';",
            "import { mergeConfig } from './merge';",
            'let active: any;',
            "const defaultsPath = path.join(__dirname, 'defaults');",
            'async function loadDefaults() { return (await import(defaultsPath)).defaults; }',
            'export async function setConfig(given: any) {',
            '  if (!active) active = await loadDefaults();',
            '  active = mergeConfig(active, given);',
            '}',
            'export function getConfig() { return active; }',
          ].join('\n'),
          '/src/main.ts': "import { getConfig, setConfig } from './config';\nexport async function bootstrap(given: any) {\n  await setConfig(given);\n  await app.listen(getConfig().api.port);\n}",
        },
        unread,
      ),
    ).toEqual([]);
    expect(unread).toEqual(['main.ts:4 from import(defaultsPath)']);
  });
});

describe("a port a parameter is given: each caller's, and the default (P315)", () => {
  it("reads each caller's argument and the parameter's default where a caller hands none", () => {
    expect(
      portsIn({
        '/src/a.ts': 'export function start(port = 3001) { app.listen(port); }\nstart(4000);\nstart();',
        '/src/b.ts': 'function serve({ port = 3002 }: { port?: number } = {}) { app.listen({ port }); }\nserve({ port: 4001 });\nserve({});',
        '/src/c.ts': 'export const run = (options = { port: 3003 }) => app.listen(options.port);',
      }),
    ).toEqual(['src/a.ts:1 4000', 'src/a.ts:1 3001', 'src/b.ts:1 4001', 'src/b.ts:1 3002', 'src/c.ts:1 3003']);
  });
});

describe('a port held where P315 left it unread: callbacks, properties, locals and computed paths (P321)', () => {
  /** The ports read in some files, with how each was reached, and what was said of the ones not read. */
  const read = (files: Record<string, string>, said: string[] = []): string[] => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sources = Object.entries(files).map(([path, text]) => project.createSourceFile(path, text));
    return listenCallsIn(sources, undefined, (each) =>
      said.push(`${each.at.getSourceFile().getBaseName()}:${each.at.getStartLineNumber()} ${each.how ?? ''}${each.guessed === true ? ' guessed' : ''} ${each.from.getText()}`),
    )
      .map((port) => placedPort(port, '/'))
      .map(
        (placed) =>
          `${placed.file}:${placed.line} ${placed.port}` +
          `${placed.merged === undefined ? '' : ` merged at ${placed.merged}`}` +
          `${placed.handed === undefined ? '' : ` handed at ${placed.handed}`}` +
          `${placed.rewritten === undefined ? '' : ` rewritten at ${placed.rewritten}`}`,
      )
      .sort();
  };
  const merge = 'export function mergeConfig(target: any, source: any): any {\n  for (const key in source) target[key] = source[key];\n  return target;\n}';
  const defaults = "export const defaults = { api: { host: '', port: 3000 } };";

  it('reads defaults a module loads by a path built from its own directory, through the constant that holds it', () => {
    const said: string[] = [];
    expect(
      read(
        {
          '/src/merge.ts': merge,
          '/src/config/defaults.ts': defaults,
          '/src/config/index.ts': [
            "import path from 'path';",
            "import { mergeConfig } from '../merge';",
            'let active: any;',
            "const defaultsPath = path.join(__dirname, 'defaults');",
            'async function loadDefaults() { return (await import(defaultsPath)).defaults; }',
            'export async function setConfig(given: any) {',
            '  if (!active) active = await loadDefaults();',
            '  active = mergeConfig(active, given);',
            '}',
            'export function getConfig() { return active; }',
          ].join('\n'),
          '/src/main.ts': "import { getConfig, setConfig } from './config';\nexport async function bootstrap(given: any) {\n  await setConfig(given);\n  await app.listen(getConfig().api.port);\n}",
          '/src/index.ts': "import { bootstrap } from './main';\nvoid bootstrap({ api: { host: 'x' } });",
        },
        said,
      ),
    ).toEqual(['src/main.ts:4 3000 merged at src/config/index.ts:8']);
    expect(said).toEqual([]);
  });

  it("reads a module's exports through require and a resolved path, and says so where the path names no file", () => {
    const said: string[] = [];
    expect(
      read(
        {
          '/config/server.js': 'module.exports = { port: 3400 };',
          '/src/a.ts': "import { resolve } from 'path';\nconst settings = require(resolve(__dirname, '../config/server'));\napp.listen(settings.port);",
          '/src/b.ts': "const settings = require(`${__dirname}/missing`);\napp.listen(settings.port);",
        },
        said,
      ),
    ).toEqual(['src/a.ts:3 3400']);
    expect(said).toEqual(['b.ts:2 loaded require(`${__dirname}/missing`)']);
  });

  it('reads a setter whose write is inside a callback as the named function it is written in', () => {
    expect(
      read({
        '/src/defaults.ts': defaults,
        '/src/merge.ts': merge,
        '/src/config.ts': [
          "import { defaults } from './defaults';",
          "import { mergeConfig } from './merge';",
          'let active: any = defaults;',
          'export function setConfig(given: any) {',
          '  return ready().then(() => {',
          '    active = mergeConfig(active, given);',
          '  });',
          '}',
          'export function getConfig() { return active; }',
        ].join('\n'),
        '/src/main.ts': "import { getConfig, setConfig } from './config';\nexport async function bootstrap() {\n  await setConfig({ api: { port: 4100 } });\n  app.listen(getConfig().api.port);\n}",
      }),
    ).toEqual(['src/main.ts:4 4100 merged at src/config.ts:6 handed at src/main.ts:3']);
  });

  it("reads a property an object's key or a class's field holds, written by a setter or a constructor", () => {
    expect(
      read({
        '/src/defaults.ts': defaults,
        '/src/merge.ts': merge,
        '/src/state.ts': [
          "import { defaults } from './defaults';",
          "import { mergeConfig } from './merge';",
          'export const state = { config: defaults };',
          'export function setConfig(given: any) { state.config = mergeConfig(state.config, given); }',
        ].join('\n'),
        '/src/a.ts': "import { setConfig, state } from './state';\nsetConfig({ api: { port: 4200 } });\napp.listen(state.config.api.port);",
        '/src/settings.ts': [
          "import { defaults } from './defaults';",
          "import { mergeConfig } from './merge';",
          'export class Settings {',
          '  private config: any = defaults;',
          '  load(given: any) { this.config = mergeConfig(this.config, given); }',
          '  get() { return this.config; }',
          '}',
        ].join('\n'),
        '/src/b.ts': "import { Settings } from './settings';\nconst settings = new Settings();\nsettings.load({ api: { port: 4300 } });\napp.listen(settings.get().api.port);",
        '/src/server.ts': [
          'export class Server {',
          '  private options: any;',
          '  constructor(options: any) { this.options = options; }',
          '  start() { app.listen(this.options.port); }',
          '}',
        ].join('\n'),
        '/src/c.ts': "import { Server } from './server';\nnew Server({ port: 4400 }).start();",
      }),
    ).toEqual([
      'src/a.ts:3 4200 merged at src/state.ts:4 handed at src/a.ts:2',
      'src/b.ts:4 4300 merged at src/settings.ts:5 handed at src/b.ts:3',
      'src/server.ts:4 4400 handed at src/c.ts:2',
    ]);
  });

  it('reads a merge written in place over the holder itself as a setter, the spread answered by what lies beneath', () => {
    expect(
      read({
        '/src/settings.ts': [
          'const defaults = { port: 3200, index: "products" };',
          'export class Settings {',
          '  private values: any = defaults;',
          '  load(given: any) { this.values = { ...this.values, ...given }; }',
          '  get() { return this.values; }',
          '}',
        ].join('\n'),
        '/src/a.ts': "import { Settings } from './settings';\nconst settings = new Settings();\nsettings.load({ port: 4200 });\napp.listen(settings.get().port);",
        '/src/b.ts': "import { Settings } from './settings';\nconst settings = new Settings();\nsettings.load({ index: 'other' });\napp.listen(settings.get().port);",
      }),
    ).toEqual(['src/a.ts:4 4200 merged at src/settings.ts:4 handed at src/a.ts:3', 'src/b.ts:4 3200 merged at src/settings.ts:4']);
  });

  it('reads a variable of a function at the write before the read, each write that may be made, and a parameter written again', () => {
    expect(
      read({
        '/src/a.ts': [
          'function applyPlugins(config: any) { return config; }',
          'export async function boot() {',
          '  let config: any = { port: 3100 };',
          '  config = await applyPlugins({ ...config, port: 4100 });',
          '  app.listen(config.port);',
          '}',
        ].join('\n'),
        '/src/b.ts': 'export function start(flag: boolean) {\n  let port = 3200;\n  if (flag) port = 4200;\n  app.listen(port);\n}',
        '/src/c.ts': 'export function serve(port = 3300) {\n  port = Number(port);\n  app.listen(port);\n}\nserve(4300);',
      }),
    ).toEqual(['src/a.ts:5 4100 handed at src/a.ts:4', 'src/b.ts:4 3200', 'src/b.ts:4 4200', 'src/c.ts:3 4300 handed at src/c.ts:5']);
  });

  it('reads the value from before a write whose own value is not read, as a guess, and says so', () => {
    const said: string[] = [];
    expect(
      read(
        {
          '/src/a.ts': "import getPort from 'get-port';\nexport async function start() {\n  let port = 3500;\n  port = await getPort({ port });\n  app.listen(port);\n}",
          '/src/b.ts': [
            "import { applyAll } from 'plugin-kit';",
            'export async function boot() {',
            '  let config: any = { port: 3600 };',
            '  config = await applyAll(config);',
            '  app.listen(config.port);',
            '}',
          ].join('\n'),
        },
        said,
      ),
    ).toEqual(['src/a.ts:5 3500 rewritten at src/a.ts:4', 'src/b.ts:5 3600 rewritten at src/b.ts:4']);
    expect(said).toEqual(['a.ts:5 rewritten guessed port = await getPort({ port })', 'b.ts:5 rewritten guessed config = await applyAll(config)']);
    expect(literalPort({ rewritten: 'src/a.ts:4' })).toBe(false);
  });

  it('reads a held configuration mutated in place: Object.assign over it or a key of it, and a nested key written (P327)', () => {
    const said: string[] = [];
    expect(
      read(
        {
          '/src/a.ts': 'export {};\nconst config = { port: 3100 };\nObject.assign(config, { port: 4100 });\napp.listen(config.port);',
          '/src/b.ts': 'export {};\nconst config = { server: { port: 3200 } };\nconfig.server.port = 4200;\napp.listen(config.server.port);',
          '/src/c.ts': 'export {};\nconst config = { port: 3300 };\nconfig.port = 4300;\napp.listen(config.port);',
          '/src/d.ts': 'export function boot() {\n  const config = { port: 3400, host: "" };\n  Object.assign(config, { host: "x" });\n  app.listen(config);\n}',
          '/src/e.ts': 'export {};\nconst config = { server: { port: 3500 } };\nObject.assign(config.server, { port: 4500 });\napp.listen(config.server.port);',
          '/src/f.ts': 'export {};\nconst config = { port: 3600 };\nObject.assign(config, loadOverrides());\napp.listen(config.port);',
          '/src/g.ts': 'export function boot() {\n  const options = { port: 3700 };\n  Object.assign(options, { port: 4700 });\n  app.listen(options);\n}',
          '/src/h.ts': 'export {};\nconst config = { port: 3800 };\nexport function configure() { config.port = 4800; }\napp.listen(config.port);',
        },
        said,
      ),
    ).toEqual([
      'src/a.ts:4 4100',
      'src/b.ts:4 4200',
      'src/c.ts:4 4300',
      'src/d.ts:4 3400',
      'src/e.ts:4 4500',
      'src/f.ts:4 3600 rewritten at src/f.ts:3',
      'src/g.ts:4 4700',
      'src/h.ts:4 3800',
      'src/h.ts:4 4800',
    ]);
    expect(said).toEqual(['f.ts:4 rewritten guessed Object.assign(config, loadOverrides())']);
  });

  it("reads a class's field per instance: each instance's setter calls, its own new, each call of the method that reads it (P327)", () => {
    expect(
      read({
        '/src/settings.ts': [
          'export class Settings {',
          '  private values: any = { port: 3700 };',
          '  load(given: any) { this.values = { ...this.values, ...given }; }',
          '  get() { return this.values; }',
          '}',
        ].join('\n'),
        '/src/a.ts': "import { Settings } from './settings';\nconst one = new Settings();\nconst two = new Settings();\none.load({ port: 4701 });\ntwo.load({ port: 4702 });\napp.listen(one.get().port);",
        '/src/server.ts': ['export class Server {', '  private port: number;', '  constructor(port: number) { this.port = port; }', '  start() { app.listen(this.port); }', '}'].join('\n'),
        '/src/b.ts': "import { Server } from './server';\nconst first = new Server(4801);\nconst second = new Server(4802);\nfirst.start();",
        '/src/worker.ts': ['export class Worker {', '  port = 3900;', '  constructor(options: any) { Object.assign(this, options); }', '  run() { app.listen(this.port); }', '}'].join('\n'),
        '/src/c.ts': "import { Worker } from './worker';\nconst worker = new Worker({ port: 4900 });\nworker.run();",
      }),
    ).toEqual([
      'src/a.ts:6 4701 merged at src/settings.ts:3 handed at src/a.ts:4',
      'src/server.ts:4 4801 handed at src/b.ts:2',
      'src/worker.ts:4 4900 handed at src/c.ts:2',
    ]);
  });

  it('reads Object.assign into a held configuration reached through a getter or a parameter, and a key the literal does not declare (P329)', () => {
    expect(
      read({
        '/src/a.ts': 'export {};\nconst config = { port: 3100 };\nfunction current() { return config; }\nObject.assign(current(), { port: 4100 });\napp.listen(config.port);',
        '/src/b.ts': [
          'export {};',
          'const config = { port: 3200 };',
          'function apply(target: any, overrides: any) { Object.assign(target, overrides); }',
          'apply(config, { port: 4200 });',
          'app.listen(config.port);',
        ].join('\n'),
        '/src/c.ts': 'export interface Config { port?: number }\nconst config: Config = {};\nconfig.port = 4300;\napp.listen(config.port);',
        '/src/d.ts': 'export interface Options { port: number }\nconst options: Options = { port: 3400 };\noptions.port = 4400;\napp.listen(options);',
        '/src/e.ts': 'const settings: Record<string, number> = {};\nexport function configure() { settings.port = 4500; }\napp.listen(settings.port);',
        '/src/f.ts': 'export interface Config { port?: number }\nconst config: Config = {};\nObject.assign(config, { port: 4600 });\napp.listen(config);',
      }),
    ).toEqual(['src/a.ts:5 4100', 'src/b.ts:5 4200 handed at src/b.ts:4', 'src/c.ts:4 4300', 'src/d.ts:4 4400', 'src/e.ts:3 4500', 'src/f.ts:4 4600']);
  });

  it('reads a field for the instance a parameter or a field holds, resolved to its own new (P329)', () => {
    const server = ['export class Server {', '  private port: number;', '  constructor(port: number) { this.port = port; }', '  start() { app.listen(this.port); }', '}'].join('\n');
    expect(
      read({
        '/src/server.ts': server,
        '/src/a.ts': "import { Server } from './server';\nconst first = new Server(4801);\nconst second = new Server(4802);\nfunction boot(server: Server) { server.start(); }\nboot(first);",
      }),
    ).toEqual(['src/server.ts:4 4801 handed at src/a.ts:2']);
    expect(
      read({
        '/src/server.ts': server,
        '/src/a.ts': [
          "import { Server } from './server';",
          'class App {',
          '  private server = new Server(4901);',
          '  run() { this.server.start(); }',
          '}',
          'new Server(4902);',
          'new App().run();',
        ].join('\n'),
      }),
    ).toEqual(['src/server.ts:4 4901 handed at src/a.ts:3']);
    expect(
      read({
        '/src/server.ts': server,
        '/src/a.ts': [
          "import { Server } from './server';",
          'class App {',
          '  constructor(private readonly server: Server) {}',
          '  run() { this.server.start(); }',
          '}',
          'const kept = new Server(5001);',
          'new Server(5002);',
          'new App(kept).run();',
        ].join('\n'),
        '/src/b.ts': "import { Server } from './server';\nfunction boot(server: Server) { server.start(); }\nboot(new Server(5101));\nboot(new Server(5102));",
      }),
    ).toEqual(['src/server.ts:4 5001 handed at src/a.ts:6', 'src/server.ts:4 5101 handed at src/b.ts:3', 'src/server.ts:4 5102 handed at src/b.ts:4']);
  });
});
