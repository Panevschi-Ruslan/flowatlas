import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appServerListens } from './dev-server.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const listens = (files: Record<string, string>): string[] => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-app-server-')));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  return appServerListens(root).map(
    (port) => `${port.file}:${port.line} ${port.port}[${port.setting}]${port.default === true ? ' default' : ''}${port.valueFrom === undefined ? '' : ` from ${port.valueFrom}`}`,
  );
};

const scripts = (all: Record<string, string>): string => JSON.stringify({ scripts: all }, null, 2);

describe("where Remix's own server listens by the .env `remix dev` loads (P305)", () => {
  it('takes the PORT its .env gives, and an example of it as a candidate', () => {
    expect(listens({ 'package.json': scripts({ dev: 'remix dev', start: 'remix-serve build' }), '.env': 'PORT=8002\n' })).toEqual(['.env:1 8002[PORT] from .env']);
    expect(listens({ 'package.json': scripts({ dev: 'remix dev' }), '.env.template': 'API_URL=http://localhost:3000\nPORT=8002\n' })).toEqual([
      '.env.template:2 8002[PORT] default from .env.template',
    ]);
  });

  it("keeps 3000 where only remix-serve starts it: the application's server loads no file", () => {
    expect(listens({ 'package.json': scripts({ start: 'remix-serve build' }), '.env': 'PORT=8002\n' })).toEqual(['package.json:3 3000[PORT] default']);
  });
});
