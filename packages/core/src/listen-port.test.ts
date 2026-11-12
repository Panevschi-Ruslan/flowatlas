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
