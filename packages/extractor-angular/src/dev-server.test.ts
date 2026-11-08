import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractContext } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { angularListens } from './dev-server.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const listening = (files: Record<string, unknown>): string[] => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-ng-serve-')));
  roots.push(root);
  for (const [file, value] of Object.entries(files)) writeFileSync(join(root, file), JSON.stringify(value, null, 2));
  return angularListens({ repoDir: root } as ExtractContext).map((port) => `${port.file}:${port.line} ${port.port}${port.devServer === true ? ' dev' : ''}`);
};

describe("where an Angular application's dev server listens (P254)", () => {
  it("reads each project's `serve` options and configurations, and `ng serve --port`", () => {
    expect(
      listening({
        'angular.json': {
          projects: {
            admin: {
              architect: {
                build: { options: { outputPath: 'dist' } },
                serve: { options: { port: 4300, proxyConfig: 'proxy.conf.json' }, configurations: { production: { buildTarget: 'admin:build:production' }, e2e: { port: 4310 } } },
              },
            },
          },
        },
        'package.json': { scripts: { start: 'ng serve --port 4320', build: 'ng build' } },
      }),
    ).toEqual(['angular.json:12 4300 dev', 'angular.json:20 4310 dev', 'package.json:3 4320 dev']);
  });

  it('assumes no default where nothing writes a port', () => {
    expect(listening({ 'angular.json': { projects: { admin: { architect: { serve: { options: {} } } } } }, 'package.json': { scripts: { start: 'ng serve' } } })).toEqual([]);
  });
});
