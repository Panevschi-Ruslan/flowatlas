import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import type { ExtractContext } from './adapters/context.js';
import type { EntryAdapter } from './adapters/entry.js';
import { listenCallsIn, listeningOf, literalPort, placedPort, type ListenPort } from './listen-port.js';

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

  it('reads nothing where the port is the setting alone, handed in, asked of the system, or in a test', () => {
    expect(
      portsIn({
        '/src/a.ts': 'app.listen(process.env.PORT);',
        '/src/b.ts': 'export const start = (port: number) => app.listen(port);',
        '/src/c.ts': 'server.listen();',
        '/src/d.ts': "emitter.listen('ready', () => {});",
        '/src/e.test.ts': 'app.listen(3009);',
      }),
    ).toEqual([]);
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
});
