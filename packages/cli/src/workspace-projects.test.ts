import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { FlowatlasError, forgetWorkspaces, workspaceApplicationOf } from '@flowatlas/core';
import { afterEach, describe, expect, it } from 'vitest';
import { scanCandidates } from './commands/init.js';
import { linkRepos } from './commands/link.js';
import { describedProject, describedProjects, workspaceApplicationsIn } from './workspace-projects.js';

/** Two applications and a library under one manifest, as a Nest CLI monorepo keeps them (R180). */
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/workspace-one-manifest');

const temporary: string[] = [];

afterEach(() => {
  forgetWorkspaces();
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

const scratch = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-one-manifest-')));
  temporary.push(dir);
  return dir;
};

const write = (path: string, content: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(content, null, 2));
};

const silent = (): void => undefined;

describe('link, on an application of a workspace that keeps one manifest (R180)', () => {
  it('takes each application, named as the workspace names it, typed by the root', () => {
    const config = join(scratch(), 'flowatlas.config.json');
    const linked = linkRepos([join(FIXTURE, 'apps/shop'), join(FIXTURE, 'apps/orders')], {
      config,
      mcp: false,
      dryRun: true,
      print: silent,
    });
    expect(linked.added.map((service) => [service.name, service.type])).toEqual([
      ['shop', 'nestjs'],
      ['orders', 'nestjs'],
    ]);
  });

  it('still refuses a library of the workspace, and a directory that is nothing', () => {
    const config = join(scratch(), 'flowatlas.config.json');
    expect(() => linkRepos([join(FIXTURE, 'libs/order-events')], { config, mcp: false, dryRun: true, print: silent })).toThrow(
      FlowatlasError,
    );
  });

  it('takes an application no description names when the root declares a framework', () => {
    const root = scratch();
    write(join(root, 'package.json'), { name: 'shop-workspace', dependencies: { '@nestjs/core': '^11.0.0' } });
    write(join(root, 'tsconfig.json'), { compilerOptions: {} });
    write(join(root, 'apps/billing/tsconfig.json'), { extends: '../../tsconfig.json' });
    const linked = linkRepos([join(root, 'apps/billing')], {
      config: join(root, 'flowatlas.config.json'),
      mcp: false,
      dryRun: true,
      print: silent,
    });
    expect(linked.added.map((service) => [service.name, service.type])).toEqual([['billing', 'nestjs']]);
  });
});

describe('what a workspace says its projects are (R180)', () => {
  it('reads nest-cli.json, with its libraries told apart from its applications', () => {
    expect(describedProjects(FIXTURE).map((project) => [project.name, project.application, project.from])).toEqual([
      ['shop', true, 'nest-cli.json'],
      ['orders', true, 'nest-cli.json'],
      ['order-events', false, 'nest-cli.json'],
    ]);
  });

  it('reads angular.json and a project.json in a project of its own', () => {
    const root = scratch();
    write(join(root, 'package.json'), { name: 'portal' });
    write(join(root, 'angular.json'), {
      projects: {
        admin: { projectType: 'application', root: 'projects/admin' },
        widgets: { projectType: 'library', root: 'projects/widgets' },
      },
    });
    write(join(root, 'apps/catalog/project.json'), { name: 'catalog-api', projectType: 'application' });
    expect(
      describedProjects(root)
        .map((project) => [project.name, project.application, project.from])
        .sort(),
    ).toEqual([
      ['admin', true, 'angular.json'],
      ['catalog-api', true, 'apps/catalog/project.json'],
      ['widgets', false, 'angular.json'],
    ]);
    write(join(root, 'tsconfig.base.json'), { compilerOptions: {} });
    write(join(root, 'apps/catalog/tsconfig.json'), { extends: '../../tsconfig.base.json' });
    const application = workspaceApplicationOf(join(root, 'apps/catalog'));
    expect(application === undefined ? undefined : describedProject(application)?.name).toBe('catalog-api');
  });

  it('offers only the applications build would read as applications', () => {
    expect(workspaceApplicationsIn(FIXTURE).map((application) => application.name)).toEqual(['shop', 'orders']);
  });
});

describe('init, on a workspace that keeps one manifest (R180)', () => {
  it('offers its applications rather than the root', () => {
    const scan = scratch();
    cpSync(FIXTURE, join(scan, 'shop-workspace'), { recursive: true });
    const found = scanCandidates(scan, join(scan, 'flowatlas'));
    expect(found.map((candidate) => [candidate.name, candidate.repo, candidate.type])).toEqual([
      ['orders', '../shop-workspace/apps/orders', 'nestjs'],
      ['shop', '../shop-workspace/apps/shop', 'nestjs'],
    ]);
  });

  it('offers an application found by scanning the directory applications are kept in', () => {
    const scan = scratch();
    cpSync(FIXTURE, join(scan, 'shop-workspace'), { recursive: true });
    const found = scanCandidates(join(scan, 'shop-workspace/apps'), join(scan, 'flowatlas'));
    expect(found.map((candidate) => [candidate.name, candidate.type])).toEqual([
      ['orders', 'nestjs'],
      ['shop', 'nestjs'],
    ]);
  });
});
