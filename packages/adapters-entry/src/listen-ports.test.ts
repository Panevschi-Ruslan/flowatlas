import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphBuilder, listeningOf, noAdapters, parseConfig, silentLogger, type EntryAdapter, type ExtractContext, type ListenPort } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { afterEach, describe, expect, it } from 'vitest';
import { expressRoutesAdapter, fastifyRoutesAdapter, honoRoutesAdapter, koaRoutesAdapter } from './call-routes.js';
import { nestjsHttpAdapter } from './nestjs-http.js';
import { nextjsRoutesAdapter } from './nextjs-routes.js';
import { nitroRoutesAdapter } from './nuxt-routes.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * The ports the detected adapters say the server listens on (P250): `code`
 * is the repository's TypeScript, read in memory; `files` are written to a
 * directory, for the configurations and the manifest read off the disk.
 */
const listening = (adapters: EntryAdapter[], code: Record<string, string>, files: Record<string, string> = {}): string[] => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-listen-')));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  for (const [path, text] of Object.entries(code)) project.createSourceFile(join(root, path), text);
  const ctx: ExtractContext = {
    repo: 'api',
    repoDir: root,
    service: { name: 'api', repo: root, type: 'nestjs' },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'api' }),
    adapters: { ...noAdapters, entry: adapters },
    logger: silentLogger,
  };
  const said = (port: ListenPort): string =>
    `${port.file}:${port.line} ${port.port}${port.setting === undefined ? '' : `[${port.setting}]`}${port.default === true ? ' default' : ''}`;
  return listeningOf(ctx).map(said);
};

describe('where each framework server listens (P250)', () => {
  it('reads `app.listen` for express, koa, fastify and NestJS, each once', () => {
    expect(
      listening([expressRoutesAdapter, koaRoutesAdapter], {
        'src/app.ts': "import express from 'express';\nconst app = express();\napp.listen(3001);",
      }),
    ).toEqual(['src/app.ts:3 3001']);
    expect(
      listening([fastifyRoutesAdapter], {
        'src/server.ts': "const app = Fastify();\nawait app.listen({ port: Number(process.env.PORT) || 3002, host: '0.0.0.0' });",
      }),
    ).toEqual(['src/server.ts:2 3002[PORT]']);
    expect(
      listening([nestjsHttpAdapter], {
        'src/main.ts': 'async function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(process.env.PORT ?? 3005);\n}',
      }),
    ).toEqual(['src/main.ts:3 3005[PORT]']);
  });

  it("reads Hono's `serve`, with its default where no port is written, and the runtimes' own", () => {
    expect(
      listening([honoRoutesAdapter], {
        'src/a.ts': "import { serve } from '@hono/node-server';\nserve({ fetch: app.fetch, port: 3003 });",
        'src/b.ts': "import { serve as start } from '@hono/node-server';\nstart({ fetch: app.fetch });",
        'src/c.ts': 'Bun.serve({ port: 3006, fetch: app.fetch });',
        'src/d.ts': 'Deno.serve(app.fetch);',
        'src/e.ts': 'export default { port: 3007, fetch: app.fetch };',
        'src/f.ts': 'export default { fetch: app.fetch };',
        'src/g.ts': 'serve({ port: 3999 });',
      }),
    ).toEqual(['src/a.ts:2 3003', 'src/b.ts:2 3000 default', 'src/c.ts:1 3006', 'src/d.ts:1 8000 default', 'src/e.ts:1 3007']);
  });

  it("reads Nuxt's `devServer.port` and a script's `--port`, and assumes no default", () => {
    expect(
      listening([nitroRoutesAdapter], {}, {
        'nuxt.config.ts': "export default defineNuxtConfig({\n  ssr: true,\n  devServer: {\n    host: '0.0.0.0',\n    port: 3010,\n  },\n});\n",
        'package.json': JSON.stringify({ scripts: { dev: 'nuxi dev', preview: 'nuxi preview --port 3011' } }, null, 2),
      }),
    ).toEqual(['nuxt.config.ts:5 3010', 'package.json:4 3011']);
    expect(listening([nitroRoutesAdapter], {}, { 'nuxt.config.ts': 'export default defineNuxtConfig({});\n' })).toEqual([]);
  });

  it('reads `next dev -p` and `next start --port=`, and nothing from a script reading the environment', () => {
    expect(
      listening([nextjsRoutesAdapter], {}, {
        'package.json': JSON.stringify({ scripts: { dev: 'next dev -p 3020', start: 'next build && next start --port=3021', env: 'next dev -p $PORT', lint: 'eslint -p 3999' } }, null, 2),
      }),
    ).toEqual(['package.json:3 3020', 'package.json:4 3021']);
  });
});

describe('a port read through the settings a repository builds (P254)', () => {
  it("reads NestJS's `registerAs` and `load` factories by the key the getter asks", () => {
    expect(
      listening([nestjsHttpAdapter], {
        'src/app.config.ts': "export default registerAs('app', () => ({ port: parseInt(process.env.PORT, 10) || 3004, name: 'billing' }));",
        'src/http.config.ts': 'export const httpConfig = () => ({ http: { port: 3014 } });',
        'src/app.module.ts': "import { httpConfig } from './http.config';\n@Module({ imports: [ConfigModule.forRoot({ load: [httpConfig] })] })\nexport class AppModule {}",
        'src/main.ts':
          'async function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  const config = app.get(ConfigService);\n  await app.listen(config.get<number>(\'app.port\'));\n}',
        'src/admin.ts': "const admin = await NestFactory.create(AdminModule);\nawait admin.listen(admin.get(ConfigService).get('http.port'));",
      }),
    ).toEqual(['src/admin.ts:2 3014', 'src/main.ts:4 3004[PORT]']);
  });

  it("reads a convict schema's default, with the setting it names", () => {
    expect(
      listening([koaRoutesAdapter], {
        'src/config.ts': "import convict from 'convict';\nexport const config = convict({ server: { port: { doc: 'port', format: 'port', default: 3005, env: 'LEDGER_PORT' } } });",
        'src/server.ts': "import { config } from './config';\napp.listen(config.get('server.port'));",
      }),
    ).toEqual(['src/server.ts:2 3005[LEDGER_PORT]']);
  });

  it("reads a port handed to the function that starts Hono's server", () => {
    expect(
      listening([honoRoutesAdapter], {
        'src/serve.ts': "import { serve } from '@hono/node-server';\nexport const start = (port: number) => serve({ fetch: app.fetch, port });",
        'src/main.ts': "import { start } from './serve';\nstart(3013);",
      }),
    ).toEqual(['src/serve.ts:2 3013']);
  });
});
