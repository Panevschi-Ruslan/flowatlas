import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { settingNamesOf } from './names.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repoOf = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-setting-names-'));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

/** The names a service's deployment files set (P388), never their values. */
describe('the settings a service’s deployment files name', () => {
  it('reads environment files, compose environments and the files they load, a Dockerfile, a worker and a manifest', () => {
    const dir = repoOf({
      '.env.example': 'PORT=3000\nPAYMENTS_API_KEY=\n# COMMENTED=1\n',
      '.env': 'SECRET_TOKEN=s3cr3t\n',
      'docker-compose.yml': 'services:\n  api:\n    environment:\n      SMTP_HOST: mail\n    env_file: ./compose.env\n',
      'compose.env': 'QUEUE_URL=amqp://q\n',
      Dockerfile: 'FROM node\nENV NODE_ENV=production TZ=UTC\n',
      'wrangler.toml': 'name = "api"\n[vars]\nAPI_HOST = "x"\n',
      'k8s/deployment.yaml': 'kind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - env:\n            - name: CACHE_URL\n          envFrom:\n            - configMapRef:\n                name: shared\n',
    });
    const names = settingNamesOf(dir);
    expect(Object.keys(names.names)).toEqual(['API_HOST', 'CACHE_URL', 'NODE_ENV', 'PAYMENTS_API_KEY', 'PORT', 'QUEUE_URL', 'SECRET_TOKEN', 'SMTP_HOST', 'TZ']);
    expect(names.names['SMTP_HOST']).toEqual(['docker-compose.yml']);
    expect(names.from).toEqual(['shared (k8s/deployment.yaml)']);
    expect(JSON.stringify(names)).not.toContain('s3cr3t');
  });

  it('says where a configuration module validates the settings with a schema, and reads nothing where there is nothing', () => {
    const dir = repoOf({ 'src/app.module.ts': 'ConfigModule.forRoot({ isGlobal: true, validationSchema: schema, ignoreEnvFile: true })' });
    expect(settingNamesOf(dir)).toEqual({ names: {}, files: [], schema: 'src/app.module.ts' });
  });

  /** P401: a source of the settings named and not read, said, so a key set nowhere is not said to be. */
  it('says which env files a compose file names or the code loads are not in the checkout', () => {
    const dir = repoOf({
      'docker-compose.yml': 'services:\n  api:\n    env_file:\n      - ./api.env\n      - ./present.env\n',
      'present.env': 'QUEUE_URL=amqp://q\n',
      'src/main.ts': "import 'dotenv/config';\n",
      'src/app.module.ts': "ConfigModule.forRoot({ envFilePath: '.env.local' })",
    });
    const names = settingNamesOf(dir);
    expect(names.names).toEqual({ QUEUE_URL: ['present.env'] });
    expect(names.missing).toEqual(['./api.env (env_file of api in docker-compose.yml)', '.env (loaded by src/main.ts)', '.env.local (loaded by src/app.module.ts)']);
  });

  it('takes an example of an env file the code loads for it, and an ignored env file for none', () => {
    const example = repoOf({ '.env.example': 'PORT=3000\n', 'src/app.module.ts': 'ConfigModule.forRoot({ isGlobal: true })' });
    expect(settingNamesOf(example).missing).toBeUndefined();
    const ignored = repoOf({ 'src/app.module.ts': 'ConfigModule.forRoot({ ignoreEnvFile: true })' });
    expect(settingNamesOf(ignored).missing).toBeUndefined();
  });

  it('says what hands settings in when the service runs: a secrets tool, a compose service’s secrets', () => {
    const dir = repoOf({
      Dockerfile: 'FROM node\nCMD ["doppler", "run", "--", "node", "main.js"]\n',
      'docker-compose.yml': 'services:\n  api:\n    secrets:\n      - db_password\n',
      'package.json': JSON.stringify({ scripts: { start: 'infisical run -- node dist/main.js', build: 'tsc' } }),
    });
    expect(settingNamesOf(dir).injected).toEqual(['doppler run in Dockerfile', 'the secrets of api in docker-compose.yml', 'infisical run in the start script of package.json']);
  });
});
