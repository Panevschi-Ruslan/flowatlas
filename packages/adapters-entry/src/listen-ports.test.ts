import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GraphBuilder, listeningOf, noAdapters, parseConfig, silentLogger, type EntryAdapter, type ExtractContext, type ListenPort } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { afterEach, describe, expect, it } from 'vitest';
import { expressRoutesAdapter, fastifyRoutesAdapter, honoRoutesAdapter, koaRoutesAdapter } from './call-routes.js';
import { nestjsHttpAdapter } from './nestjs-http.js';
import { nextjsRoutesAdapter } from './nextjs-routes.js';
import { nitroRoutesAdapter } from './nuxt-routes.js';
import { strapiServerAdapter } from './strapi-server.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * The ports the detected adapters say the server listens on (P250): `code`
 * is the repository's TypeScript, read in memory; `files` are written to a
 * directory, for the configurations and the manifest read off the disk.
 */
const listening = (adapters: EntryAdapter[], code: Record<string, string>, files: Record<string, string> = {}, rows?: string[]): string[] => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-listen-')));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
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
    `${port.file}:${port.line} ${port.port}${port.setting === undefined ? '' : `[${port.setting}]`}${port.default === true ? ' default' : ''}` +
    `${port.valueFrom === undefined ? '' : ` from ${port.valueFrom}`}${port.merged === undefined ? '' : ` merged at ${port.merged}`}`;
  const ports = listeningOf(ctx).map(said);
  rows?.push(...ctx.builder.build().unresolved.map((row) => `${row.reason} ${row.message}`));
  return ports;
};

describe('where a framework server listens by the environment file it loads (P305)', () => {
  const scripts = (dev: string): string => JSON.stringify({ scripts: { dev } }, null, 2);

  it("moves Nuxt's default to the port its dev command's .env gives NUXT_PORT, NITRO_PORT or PORT", () => {
    expect(listening([nitroRoutesAdapter], {}, { 'package.json': scripts('nuxi dev'), '.env': 'API_URL=http://localhost:4000\nPORT=3010\n' })).toEqual([
      '.env:2 3010[PORT] from .env',
    ]);
    expect(listening([nitroRoutesAdapter], {}, { 'package.json': scripts('nuxt dev'), '.env': 'PORT=3010\nNUXT_PORT="3011"\n' })).toEqual([
      '.env:2 3011[NUXT_PORT] from .env',
    ]);
    // `--dotenv` names the file the command loads instead.
    expect(listening([nitroRoutesAdapter], {}, { 'package.json': scripts('nuxi dev --dotenv .env.dev'), '.env.dev': 'PORT=3012\n' })).toEqual([
      '.env.dev:1 3012[PORT] from .env.dev',
    ]);
  });

  it('takes an example file only as a candidate, as weak as the default, and only where no .env is committed', () => {
    expect(listening([nitroRoutesAdapter], {}, { 'package.json': scripts('nuxi dev'), '.env.example': '# the dev port\nPORT=3020\n' })).toEqual([
      '.env.example:2 3020[PORT] default from .env.example',
    ]);
    expect(listening([nitroRoutesAdapter], {}, { 'package.json': scripts('nuxi dev'), '.env': 'API_URL=x\n', '.env.example': 'PORT=3020\n' })).toEqual([
      'package.json:3 3000[PORT] default',
    ]);
  });

  it("keeps Next's default whatever its .env says, and a command that loads no file", () => {
    expect(listening([nextjsRoutesAdapter], {}, { 'package.json': scripts('next dev'), '.env': 'PORT=3030\n', '.env.example': 'PORT=3031\n' })).toEqual([
      'package.json:3 3000[PORT] default',
    ]);
    expect(
      listening([nitroRoutesAdapter], {}, { 'package.json': JSON.stringify({ scripts: { start: 'nuxi preview' } }, null, 2), '.env': 'PORT=3040\n' }),
    ).toEqual(['package.json:3 3000[PORT] default']);
    // A value nothing here can read is no port.
    expect(listening([nitroRoutesAdapter], {}, { 'package.json': scripts('nuxi dev'), '.env': 'PORT=${DEV_PORT}\n' })).toEqual(['package.json:3 3000[PORT] default']);
  });

  it('reads a NestJS bootstrap port through a merge of the given configuration over defaults another module keeps', () => {
    expect(
      listening([nestjsHttpAdapter], {
        'src/config/defaults.ts': "export const defaults = { apiOptions: { hostname: '', port: 3000 } };",
        'src/config/merge.ts': [
          "import { defaults } from './defaults';",
          'export function mergeConfig(given: any) {',
          '  const out: any = { ...defaults };',
          '  for (const [key, value] of Object.entries(given)) out[key] = { ...out[key], ...(value as object) };',
          '  return out;',
          '}',
        ].join('\n'),
        'src/main.ts': [
          "import { mergeConfig } from './config/merge';",
          'export async function bootstrap(given = {}) {',
          '  const { hostname, port } = mergeConfig(given).apiOptions;',
          '  const app = await NestFactory.create(AppModule);',
          '  await app.listen(port, hostname);',
          '}',
        ].join('\n'),
      }),
    ).toEqual(['src/main.ts:5 3000 merged at src/main.ts:3']);
  });
});

describe("a server of the code's own listens where the environment file its code or its script loads says (P315)", () => {
  const listen = 'const app = express();\napp.listen(process.env.PORT ?? 3000);';

  it('reads the setting from .env where the code loads it with dotenv, and keeps the fallback where nothing loads it', () => {
    expect(listening([expressRoutesAdapter], { 'src/main.ts': `import 'dotenv/config';\n${listen}` }, { '.env': 'DEBUG=1\nPORT=4010\n' })).toEqual([
      'src/main.ts:3 4010[PORT] from .env',
    ]);
    expect(listening([expressRoutesAdapter], { 'src/main.ts': listen }, { '.env': 'PORT=4010\n' })).toEqual(['src/main.ts:2 3000[PORT]']);
    // dotenv's `config` with a path, imported by name or as the module.
    expect(
      listening([expressRoutesAdapter], { 'src/main.ts': `import dotenv from 'dotenv';\ndotenv.config({ path: '.env.dev' });\n${listen}` }, { '.env.dev': 'PORT=4011\n', '.env': 'PORT=4999\n' }),
    ).toEqual(['src/main.ts:4 4011[PORT] from .env.dev']);
    expect(listening([expressRoutesAdapter], { 'src/main.ts': `import { config } from 'dotenv';\nconfig();\n${listen}` }, { '.env': 'PORT=4012\n' })).toEqual([
      'src/main.ts:4 4012[PORT] from .env',
    ]);
  });

  it("reads NestJS's ConfigModule, which loads .env or the files it names, and not where it ignores them", () => {
    const main = 'async function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(process.env.PORT || 3005);\n}';
    const module = (options: string): string => `import { ConfigModule } from '@nestjs/config';\n@Module({ imports: [ConfigModule.forRoot(${options})] })\nexport class AppModule {}`;
    expect(listening([nestjsHttpAdapter], { 'src/main.ts': main, 'src/app.module.ts': module('') }, { '.env': 'PORT=4013\n' })).toEqual([
      'src/main.ts:3 4013[PORT] from .env',
    ]);
    expect(
      listening([nestjsHttpAdapter], { 'src/main.ts': main, 'src/app.module.ts': module("{ envFilePath: ['.env.local', '.env'] }") }, { '.env.local': 'PORT=4014\n', '.env': 'PORT=4015\n' }),
    ).toEqual(['src/main.ts:3 4014[PORT] from .env.local']);
    expect(listening([nestjsHttpAdapter], { 'src/main.ts': main, 'src/app.module.ts': module('{ ignoreEnvFile: true }') }, { '.env': 'PORT=4016\n' })).toEqual([
      'src/main.ts:3 3005[PORT]',
    ]);
  });

  it("reads the file a script's command loads: Node's --env-file, dotenv-cli, env-cmd", () => {
    const pkg = (start: string): string => JSON.stringify({ scripts: { start, test: 'dotenv -e .env.test -- vitest' } }, null, 2);
    expect(listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('node --env-file=.env.local dist/main.js'), '.env.local': 'PORT=4017\n' })).toEqual([
      'src/main.ts:2 4017[PORT] from .env.local',
    ]);
    expect(listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('dotenv -e .env.dev -- node dist/main.js'), '.env.dev': 'PORT=4018\n', '.env.test': 'PORT=4998\n' })).toEqual([
      'src/main.ts:2 4018[PORT] from .env.dev',
    ]);
    expect(listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('env-cmd node dist/main.js'), '.env': 'PORT=4019\n' })).toEqual([
      'src/main.ts:2 4019[PORT] from .env',
    ]);
    // A test runner's file is the test's.
    expect(listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('node dist/main.js'), '.env.test': 'PORT=4998\n' })).toEqual(['src/main.ts:2 3000[PORT]']);
  });

  it("moves Bun's own default to the BUN_PORT, PORT or NODE_PORT the .env Bun loads gives it", () => {
    expect(listening([honoRoutesAdapter], { 'src/index.ts': 'Bun.serve({ fetch: app.fetch });' }, { '.env': 'PORT=4020\n' })).toEqual(['src/index.ts:1 4020[PORT] from .env']);
    expect(listening([honoRoutesAdapter], { 'src/index.ts': 'Bun.serve({ fetch: app.fetch });' }, { '.env': 'NAME=x\n' })).toEqual(['src/index.ts:1 3000 default']);
  });
});

describe('a port that comes from defaults loaded by a path decided at run time (P315)', () => {
  it('reads no port and leaves a row saying why', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-listen-')));
    roots.push(root);
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
    project.createSourceFile(
      join(root, 'src/config.ts'),
      "import path from 'path';\nlet active: any;\nexport async function load() { active = (await import(path.join(__dirname, 'defaults'))).defaults; }\nexport function getConfig() { return active; }",
    );
    project.createSourceFile(join(root, 'src/main.ts'), "import { getConfig, load } from './config';\nexport async function bootstrap() {\n  await load();\n  await app.listen(getConfig().api.port);\n}");
    const builder = new GraphBuilder({ repo: 'api' });
    const ctx: ExtractContext = {
      repo: 'api',
      repoDir: root,
      service: { name: 'api', repo: root, type: 'nestjs' },
      config: parseConfig({}),
      pkg: {},
      project,
      checker: project.getTypeChecker(),
      builder,
      adapters: { ...noAdapters, entry: [nestjsHttpAdapter] },
      logger: silentLogger,
    };
    expect(listeningOf(ctx)).toEqual([]);
    const rows = builder.build().unresolved.filter((row) => row.reason === 'listen-port-unread');
    expect(rows.map((row) => `${row.file}:${row.line}`)).toEqual(['src/main.ts:4']);
    expect(rows[0]?.message).toContain("import(path.join(__dirname, 'defaults'))");
  });
});

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

  it("reads Nuxt's `devServer.port` and a script's `--port`, with no default beside them", () => {
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

  // P296: a full-stack framework's own default where nothing says, and the
  // port a script's own environment gives.
  it("takes Next's and Nuxt's 3000 where nothing writes a port, as PORT's fallback", () => {
    expect(listening([nextjsRoutesAdapter], {}, { 'package.json': JSON.stringify({ scripts: { dev: 'next dev --turbopack', start: 'next start' } }, null, 2) })).toEqual([
      'package.json:3 3000[PORT] default',
    ]);
    expect(listening([nitroRoutesAdapter], {}, { 'package.json': JSON.stringify({ scripts: { dev: 'nuxi dev' } }, null, 2) })).toEqual(['package.json:3 3000[PORT] default']);
    expect(listening([nextjsRoutesAdapter], {}, { 'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }, null, 2) })).toEqual(['package.json:1 3000[PORT] default']);
  });

  it('reads the port a script gives PORT, and assumes no default where a script hands the port in unread', () => {
    expect(
      listening([nextjsRoutesAdapter], {}, { 'package.json': JSON.stringify({ scripts: { start: 'PORT=3030 next start', dev: 'next dev -p ${PORT:-3031}' } }, null, 2) }),
    ).toEqual(['package.json:3 3030', 'package.json:4 3031']);
    expect(listening([nextjsRoutesAdapter], {}, { 'package.json': JSON.stringify({ scripts: { dev: 'next dev -p $PORT' } }, null, 2) })).toEqual([]);
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

describe('the last ways a port is set (P257)', () => {
  const config = "import { registerAs } from '@nestjs/config';\nexport default registerAs('app', () => ({ port: Number(process.env.PORT) || 3012, http: { port: 3022 } }));";

  it("reads NestJS's `ConfigType` settings object taken from the application by its token", () => {
    expect(
      listening([nestjsHttpAdapter], {
        'src/app.config.ts': config,
        'src/main.ts': [
          "import appConfig from './app.config';",
          'async function bootstrap() {',
          '  const app = await NestFactory.create(AppModule);',
          '  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);',
          '  await app.listen(config.port);',
          '}',
        ].join('\n'),
        'src/admin.ts': "import appConfig from './app.config';\nconst admin = await NestFactory.create(AdminModule);\nawait admin.listen(admin.get(appConfig.KEY).http.port);",
      }),
    ).toEqual(['src/admin.ts:3 3022', 'src/main.ts:5 3012[PORT]']);
  });

  it('reads one injected by its token, or typed `ConfigType<typeof appConfig>`', () => {
    expect(
      listening([nestjsHttpAdapter], {
        'src/app.config.ts': config,
        'src/server.ts': [
          "import appConfig from './app.config';",
          'export class Server {',
          '  constructor(@Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>) {}',
          '  start(app: App) {',
          '    return app.listen(this.config.port);',
          '  }',
          '}',
        ].join('\n'),
        'src/typed.ts': "import appConfig from './app.config';\nexport const start = (app: App, settings: ConfigType<typeof appConfig>) => app.listen(settings.http.port);",
      }),
    ).toEqual(['src/server.ts:5 3012[PORT]', 'src/typed.ts:2 3022']);
  });

  it('reads nothing of a settings object no factory builds', () => {
    expect(
      listening([nestjsHttpAdapter], {
        'src/app.config.ts': "export default registerAs('app', () => ({ port: 3012 }));",
        'src/main.ts': 'const config = app.get(OtherConfig.KEY);\napp.listen(config.port);',
      }),
    ).toEqual([]);
  });

  it("reads a workspace tool's Next server target, and not a target that only takes a debugger's port", () => {
    const project = JSON.stringify(
      {
        name: 'shop',
        targets: {
          serve: { executor: '@nx/next:server', options: { buildTarget: 'shop:build', port: 4300 }, configurations: { production: { port: 4301 } } },
          debug: { executor: '@nx/js:node', options: { port: 9229 } },
        },
      },
      null,
      2,
    );
    expect(listening([nextjsRoutesAdapter], {}, { 'project.json': project })).toEqual(['project.json:8 4300', 'project.json:12 4301']);
  });
});

describe('which loaded file wins, as each loader orders them (P321)', () => {
  const listen = 'const app = express();\napp.listen(process.env.PORT ?? 3000);';
  const pkg = (start: string): string => JSON.stringify({ scripts: { start } }, null, 2);

  it("takes the last of Node's repeated --env-file, the first of dotenv's paths, and the last of them with override", () => {
    expect(
      listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('node --env-file=.env --env-file=.env.local dist/main.js'), '.env': 'PORT=4999\n', '.env.local': 'PORT=4030\n' }),
    ).toEqual(['src/main.ts:2 4030[PORT] from .env.local']);
    expect(
      listening(
        [expressRoutesAdapter],
        { 'src/main.ts': `import dotenv from 'dotenv';\ndotenv.config({ path: ['.env.local', '.env'] });\n${listen}` },
        { '.env': 'PORT=4999\n', '.env.local': 'PORT=4031\n' },
      ),
    ).toEqual(['src/main.ts:4 4031[PORT] from .env.local']);
    expect(
      listening(
        [expressRoutesAdapter],
        { 'src/main.ts': `import dotenv from 'dotenv';\ndotenv.config({ path: ['.env', '.env.local'], override: true });\n${listen}` },
        { '.env': 'PORT=4999\n', '.env.local': 'PORT=4032\n' },
      ),
    ).toEqual(['src/main.ts:4 4032[PORT] from .env.local']);
  });

  it("puts what a script loads before the code runs over what the code loads, and reads dotenv-cli's cascade", () => {
    expect(
      listening([expressRoutesAdapter], { 'src/main.ts': `import 'dotenv/config';\n${listen}` }, { 'package.json': pkg('node --env-file=.env.ci dist/main.js'), '.env': 'PORT=4999\n', '.env.ci': 'PORT=4033\n' }),
    ).toEqual(['src/main.ts:3 4033[PORT] from .env.ci']);
    expect(
      listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('dotenv -c development -- node dist/main.js'), '.env': 'PORT=4999\n', '.env.development': 'PORT=4034\n' }),
    ).toEqual(['src/main.ts:2 4034[PORT] from .env.development']);
  });

  it("reads Bun's files by the NODE_ENV its command sets, .env.local over both, and only the files its --env-file names", () => {
    const files = { '.env': 'PORT=4999\n', '.env.development': 'PORT=4035\n', '.env.production': 'PORT=4036\n' };
    expect(listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('bun src/main.ts'), ...files })).toEqual(['src/main.ts:2 4035[PORT] from .env.development']);
    expect(listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('NODE_ENV=production bun src/main.ts'), ...files })).toEqual([
      'src/main.ts:2 4036[PORT] from .env.production',
    ]);
    expect(listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('bun src/main.ts'), ...files, '.env.local': 'PORT=4037\n' })).toEqual([
      'src/main.ts:2 4037[PORT] from .env.local',
    ]);
    expect(listening([expressRoutesAdapter], { 'src/main.ts': listen }, { 'package.json': pkg('bun --env-file=.env.staging src/main.ts'), ...files, '.env.staging': 'PORT=4038\n' })).toEqual([
      'src/main.ts:2 4038[PORT] from .env.staging',
    ]);
  });
});

describe('where fastify-cli and Strapi start a server the code does not (P321)', () => {
  it("reads fastify start's -p, the FASTIFY_PORT or PORT its command or its .env gives, and its 3000", () => {
    const pkg = (start: string): string => JSON.stringify({ scripts: { start } }, null, 2);
    const app = { 'app.ts': "export default async function (fastify: any) { fastify.get('/', async () => 'ok'); }" };
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('fastify start -l info app.js'), '.env': 'PORT=4999\nFASTIFY_PORT=4040\n' })).toEqual([
      '.env:2 4040[FASTIFY_PORT] from .env',
    ]);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('fastify start -p 4041 app.js'), '.env': 'PORT=4999\n' })).toEqual(['package.json:3 4041']);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('FASTIFY_PORT=4042 fastify start app.js') })).toEqual(['package.json:3 4042']);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('fastify start app.js') })).toEqual(['package.json:3 3000[PORT] default']);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('node dist/app.js') })).toEqual([]);
  });

  it("reads Strapi's config/server port, moved by the .env Strapi loads, and its 1337 where none is written", () => {
    const server = "module.exports = ({ env }) => ({\n  host: env('HOST', '0.0.0.0'),\n  port: env.int('PORT', 1337),\n});\n";
    const pkg = (develop: string): string => JSON.stringify({ scripts: { develop }, dependencies: { '@strapi/strapi': '^5.0.0' } }, null, 2);
    expect(listening([strapiServerAdapter], {}, { 'package.json': pkg('strapi develop'), 'config/server.js': server, '.env': 'HOST=0.0.0.0\nPORT=4050\n' })).toEqual([
      'config/server.js:3 4050[PORT] from .env',
    ]);
    expect(listening([strapiServerAdapter], {}, { 'package.json': pkg('strapi develop'), 'config/server.js': server })).toEqual(['config/server.js:3 1337[PORT]']);
    expect(
      listening([strapiServerAdapter], {}, { 'package.json': pkg('ENV_PATH=./.env.dev strapi develop'), 'config/server.js': server, '.env': 'PORT=4999\n', '.env.dev': 'PORT=4051\n' }),
    ).toEqual(['config/server.js:3 4051[PORT] from .env.dev']);
    expect(listening([strapiServerAdapter], {}, { 'package.json': pkg('strapi develop') })).toEqual(['package.json:1 1337[PORT] default']);
    expect(listening([strapiServerAdapter], {}, { 'package.json': pkg('strapi develop'), 'config/server.ts': 'export default () => ({ port: 4052 });\n' })).toEqual([
      'config/server.ts:1 4052',
    ]);
  });
});

describe('the loader and framework items P321 left open (P327)', () => {
  const pkg = (start: string, dependencies: Record<string, string> = {}): string => JSON.stringify({ scripts: { start }, dependencies }, null, 2);

  it('keeps the first file of repeated process.loadEnvFile calls, imported from node:process or not, as Node sets only what is unset', () => {
    const listen = 'const app = express();\napp.listen(process.env.PORT ?? 3000);';
    const files = { '.env.local': 'PORT=4061\n', '.env': 'PORT=4999\n' };
    expect(
      listening([expressRoutesAdapter], { 'src/main.ts': `process.loadEnvFile('.env.local');\nprocess.loadEnvFile('.env');\n${listen}` }, { 'package.json': pkg('node dist/main.js'), ...files }),
    ).toEqual(['src/main.ts:4 4061[PORT] from .env.local']);
    expect(
      listening(
        [expressRoutesAdapter],
        { 'src/main.ts': `import { loadEnvFile as load } from 'node:process';\nload('.env.local');\nload();\n${listen}` },
        { 'package.json': pkg('node dist/main.js'), ...files },
      ),
    ).toEqual(['src/main.ts:5 4061[PORT] from .env.local']);
  });

  it('lets a FASTIFY_PORT the loaded .env gives win over a PORT the command gives, as fastify-cli reads FASTIFY_PORT first', () => {
    const app = { 'app.ts': "export default async function (fastify: any) { fastify.get('/', async () => 'ok'); }" };
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('PORT=4062 fastify start app.js'), '.env': 'FASTIFY_PORT=4063\n' })).toEqual([
      '.env:1 4063[FASTIFY_PORT] from .env',
    ]);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('PORT=4062 fastify start app.js'), '.env': 'PORT=4999\n' })).toEqual(['package.json:3 4062']);
  });

  it("reads Strapi's production override of the port, and says another environment's in a row", () => {
    const strapi = { '@strapi/strapi': '^5.0.0' };
    const server = "module.exports = ({ env }) => ({\n  host: env('HOST', '0.0.0.0'),\n  port: env.int('PORT', 1337),\n});\n";
    const rows: string[] = [];
    expect(
      listening(
        [strapiServerAdapter],
        {},
        {
          'package.json': pkg('strapi start', strapi),
          'config/server.js': server,
          'config/env/production/server.js': 'module.exports = () => ({\n  port: 4064,\n});\n',
          'config/env/staging/server.js': 'module.exports = () => ({\n  port: 4065,\n});\n',
          'config/env/development/server.js': 'module.exports = () => ({\n  port: 4064,\n});\n',
          'config/env/test/database.js': 'module.exports = () => ({});\n',
        },
        rows,
      ),
    ).toEqual(['config/env/production/server.js:2 4064']);
    expect(rows).toEqual([
      "framework-environment-differs Strapi's server is read listening on 4064, the production build's; for staging, config/env/staging/server.js moves it to 4065. Which one runs is NODE_ENV's, development where nothing sets it",
    ]);
    // An override that writes no port leaves the base file's; a base file writing none is Strapi's own, moved by .env.
    expect(
      listening([strapiServerAdapter], {}, { 'package.json': pkg('strapi start', strapi), 'config/server.js': server, 'config/env/production/server.js': "module.exports = () => ({ url: 'https://cms.example.com' });\n" }),
    ).toEqual(['config/server.js:3 1337[PORT]']);
    expect(listening([strapiServerAdapter], {}, { 'package.json': pkg('strapi start', strapi), 'config/server.js': 'module.exports = () => ({});\n', '.env': 'PORT=4066\n' })).toEqual([
      'package.json:1 4066[PORT] from .env',
    ]);
  });
});

describe('the configuration a command names and the environment a start script sets (P329)', () => {
  const pkg = (start: string, dependencies: Record<string, string> = {}): string => JSON.stringify({ scripts: { start }, dependencies }, null, 2);
  const app = { 'app.ts': "export default async function (fastify: any) { fastify.get('/', async () => 'ok'); }" };

  it("reads the port of fastify start's --config file after -p and FASTIFY_PORT and before PORT", () => {
    const json = { 'fastify.json': '{\n  "logLevel": "info",\n  "port": 4070\n}\n' };
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('PORT=4999 fastify start -c fastify.json app.js'), ...json })).toEqual(['fastify.json:3 4070']);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('fastify start --config=./fastify.json app.js'), '.env': 'PORT=4999\n', ...json })).toEqual([
      'fastify.json:3 4070',
    ]);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('FASTIFY_PORT=4071 fastify start -c fastify.json app.js'), ...json })).toEqual(['package.json:3 4071']);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('fastify start -c fastify.json app.js'), '.env': 'FASTIFY_PORT=4072\n', ...json })).toEqual([
      '.env:1 4072[FASTIFY_PORT] from .env',
    ]);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('fastify start -p 4073 -c fastify.json app.js'), ...json })).toEqual(['package.json:3 4073']);
    expect(
      listening([fastifyRoutesAdapter], app, { 'package.json': pkg('fastify start -c fastify.config.js app.js'), 'fastify.config.js': "module.exports = {\n  port: '4074',\n};\n" }),
    ).toEqual(['fastify.config.js:2 4074']);
  });

  it('goes on to PORT where the --config file writes no port, and says where it is not read', () => {
    const rows: string[] = [];
    expect(
      listening([fastifyRoutesAdapter], app, { 'package.json': pkg('PORT=4075 fastify start -c fastify.json app.js'), 'fastify.json': '{ "logLevel": "info" }\n' }),
    ).toEqual(['package.json:3 4075']);
    expect(listening([fastifyRoutesAdapter], app, { 'package.json': pkg('PORT=4076 fastify start -c missing.json app.js') }, rows)).toEqual(['package.json:3 4076']);
    expect(rows).toEqual([
      'listen-port-unread fastify start reads its port from missing.json, the --config file, before PORT; it is not a file of the repository, nor is missing.json a package installed in it or of its workspace, so the port is read from what comes after it.',
    ]);
  });

  it('reads a --config naming a package, an ES module or TypeScript file exporting its port by name, and says a port under export default (P335)', () => {
    const rows: string[] = [];
    const config = (start: string, files: Record<string, string>): string[] => listening([fastifyRoutesAdapter], app, { 'package.json': pkg(start), ...files }, rows);
    expect(
      config('fastify start -c @shop/server-config app.js', {
        'node_modules/@shop/server-config/package.json': JSON.stringify({ name: '@shop/server-config', exports: { '.': { require: './dist/index.cjs', import: './dist/index.mjs' } } }),
        'node_modules/@shop/server-config/dist/index.cjs': "'use strict';\nexports.logLevel = 'info';\nexports.port = 4090;\n",
      }),
    ).toEqual(['node_modules/@shop/server-config/dist/index.cjs:3 4090']);
    expect(
      config('fastify start -c @shop/server-config/fastify.json app.js', {
        'node_modules/@shop/server-config/package.json': JSON.stringify({ name: '@shop/server-config' }),
        'node_modules/@shop/server-config/fastify.json': '{\n  "port": 4091\n}\n',
      }),
    ).toEqual(['node_modules/@shop/server-config/fastify.json:2 4091']);
    expect(config('fastify start -c fastify.config.mjs app.js', { 'fastify.config.mjs': "export const logLevel = 'info';\nexport const port = 4092;\n" })).toEqual([
      'fastify.config.mjs:2 4092',
    ]);
    expect(config('fastify start -c fastify.config.ts app.js', { 'fastify.config.ts': 'const port: number = 4093;\nconst logLevel = "info";\nexport { port, logLevel };\n' })).toEqual([
      'fastify.config.ts:1 4093',
    ]);
    expect(rows).toEqual([]);
    expect(config('PORT=4094 fastify start -c fastify.config.mjs app.js', { 'fastify.config.mjs': 'export default {\n  port: 4999,\n};\n' })).toEqual(['package.json:3 4094']);
    expect(config('PORT=4095 fastify start -c @shop/absent app.js', {})).toEqual(['package.json:3 4095']);
    expect(rows).toEqual([
      "listen-port-unread fastify start reads its port from fastify.config.mjs, the --config file, before PORT; it writes its port under export default, which require hands fastify start as the module's default, not as its port, so the port is read from what comes after it.",
      'listen-port-unread fastify start reads its port from @shop/absent, the --config file, before PORT; it is not a file of the repository, nor is @shop/absent a package installed in it or of its workspace, so the port is read from what comes after it.',
    ]);
  });

  it('reads the Strapi environment the start script sets with NODE_ENV', () => {
    const strapi = { '@strapi/strapi': '^5.0.0' };
    const files = {
      'config/server.js': "module.exports = ({ env }) => ({ port: env.int('PORT', 1337) });\n",
      'config/env/production/server.js': 'module.exports = () => ({\n  port: 4080,\n});\n',
      'config/env/staging/server.js': 'module.exports = () => ({\n  port: 4081,\n});\n',
    };
    const rows: string[] = [];
    expect(listening([strapiServerAdapter], {}, { 'package.json': pkg('NODE_ENV=staging strapi start', strapi), ...files }, rows)).toEqual([
      'config/env/staging/server.js:2 4081',
    ]);
    expect(rows).toEqual([
      "framework-environment-differs Strapi's server is read listening on 4081, NODE_ENV=staging's, which the start script sets; for production, config/env/production/server.js moves it to 4080. Which one runs is NODE_ENV's, development where nothing sets it",
    ]);
    expect(listening([strapiServerAdapter], {}, { 'package.json': pkg('cross-env NODE_ENV=production strapi start', strapi), ...files })).toEqual([
      'config/env/production/server.js:2 4080',
    ]);
  });
});
