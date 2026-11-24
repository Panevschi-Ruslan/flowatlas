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
    const dir = repoOf({ 'src/app.module.ts': 'ConfigModule.forRoot({ isGlobal: true, validationSchema: schema })' });
    expect(settingNamesOf(dir)).toEqual({ names: {}, files: [], schema: 'src/app.module.ts' });
  });
});
