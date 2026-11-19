import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractContext } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { angularListens, angularProxies } from './dev-server.js';

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

describe("what an Angular application's dev server forwards, and a workspace tool's serve target (P257)", () => {
  const files = (written: Record<string, unknown>): string => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-ng-proxy-')));
    roots.push(root);
    for (const [file, value] of Object.entries(written)) writeFileSync(join(root, file), JSON.stringify(value, null, 2));
    return root;
  };
  const rules = (root: string): string[] => {
    const read = angularProxies({ repoDir: root } as ExtractContext);
    return [
      ...read.rules.map((rule) => `${rule.file}:${rule.line} ${rule.path} -> ${rule.target}${rule.to}`),
      ...read.rows.map((row) => `${row.file}:${row.line} ${row.reason}`),
    ];
  };

  it('reads the proxy configuration `serve` names, and the one `ng serve --proxy-config` names', () => {
    const root = files({
      'angular.json': { projects: { admin: { architect: { serve: { options: { port: 4300, proxyConfig: 'proxy.conf.json' } } } } } },
      'proxy.conf.json': { '/billing': { target: 'http://localhost:3004', pathRewrite: { '^/billing': '' } } },
      'package.json': { scripts: { 'start:local': 'ng serve --proxy-config proxy.local.json' } },
      'proxy.local.json': { '/stock': { target: 'http://localhost:3002' } },
    });
    expect(rules(root)).toEqual(['proxy.conf.json:2 /billing -> http://localhost:3004', 'proxy.local.json:2 /stock -> http://localhost:3002/stock']);
  });

  it("reads `project.json`'s `serve` target as a project of the workspace, and says where the file it names is missing", () => {
    const project = { name: 'admin', targets: { serve: { executor: '@nx/angular:dev-server', options: { port: 4400, proxyConfig: 'src/proxy.conf.json' } } } };
    expect(listening({ 'project.json': project })).toEqual(['project.json:7 4400 dev']);
    expect(rules(files({ 'project.json': project }))).toEqual(['project.json:8 proxy-rule-unread']);
  });
});
