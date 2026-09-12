import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RepoGraph } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dependentsOf,
  extractRepoFull,
  extractRepoIncremental,
  globalFiles,
  importsOf,
  openRepo,
  repoFiles,
  type WarmRepo,
} from './incremental.js';

const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/nest-incremental');
const SERVICE = 'src/orders/orders.service.ts';
const REPOSITORY = 'src/orders/orders.repository.ts';
const CLIENT = 'src/billing/billing.client.ts';

// The copies live under `fixtures/` rather than in the system temporary
// directory because the fixture repositories resolve `@nestjs/common` from the
// `node_modules` hoisted beside them, and a copy anywhere else has no checker.
const scratch = mkdtempSync(join(resolve(FIXTURE, '..'), '.scratch-warm-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A copy of the fixture, since every test here edits the sources. */
const copyFixture = (name: string): string => {
  const rootDir = join(scratch, name);
  mkdirSync(rootDir, { recursive: true });
  cpSync(FIXTURE, rootDir, { recursive: true });
  rmSync(join(rootDir, '.flowatlas'), { recursive: true, force: true });
  return rootDir;
};

const open = (name: string): WarmRepo =>
  openRepo({ rootDir: copyFixture(name), repo: 'nest-incremental' });

const edit = (repo: WarmRepo, file: string, change: (text: string) => string): void => {
  const path = join(repo.options.rootDir, file);
  writeFileSync(path, change(readFileSync(path, 'utf8')));
};

const methodIds = (graph: RepoGraph): string[] =>
  graph.nodes.filter((node) => node.type === 'method').map((node) => node.id);

describe('what a repository says about itself once it is open', () => {
  let repo: WarmRepo;
  beforeAll(() => {
    repo = open('survey');
  });

  it('lists its own sources and none of its installed packages', () => {
    const files = repoFiles(repo);
    expect(files).toContain(SERVICE);
    expect(files.some((file) => file.includes('node_modules'))).toBe(false);
  });

  it('records what each file imports, type-only imports included', () => {
    const imports = importsOf(repo);
    expect(imports[SERVICE]).toEqual([
      CLIENT,
      'src/orders/dto/create-order.dto.ts',
      'src/orders/orders.repository.ts',
      'src/shared/tokens.ts',
    ]);
  });

  it('calls the entry file and every file declaring a module global', () => {
    expect(globalFiles(repo)).toEqual([
      'src/app.module.ts',
      'src/main.ts',
      'src/orders/orders.module.ts',
    ]);
  });

  it('follows imports backwards to the files a change is felt in', () => {
    expect(dependentsOf(repo, [SERVICE])).toEqual([
      'src/orders/orders.controller.ts',
      'src/orders/orders.module.ts',
    ]);
  });

  it('counts a file imported only for the token it declares as a dependent', () => {
    expect(dependentsOf(repo, ['src/shared/tokens.ts'])).toEqual([
      'src/orders/orders.module.ts',
      SERVICE,
    ]);
  });

  it('counts a file imported only for its types as a dependent', () => {
    expect(dependentsOf(repo, ['src/orders/dto/create-order.dto.ts'])).toEqual([
      'src/orders/orders.controller.ts',
      REPOSITORY,
      SERVICE,
    ]);
  });
});

describe('re-reading a repository that is already open', () => {
  it('sees a method that was added', async () => {
    const repo = open('added');
    const before = await extractRepoIncremental(repo, { files: [] });
    edit(repo, SERVICE, (text) =>
      text.replace(
        '  findOne(id: string): OrderDto {',
        '  cancel(id: string): OrderDto {\n    return this.orders.find(id);\n  }\n\n  findOne(id: string): OrderDto {',
      ),
    );
    const after = await extractRepoIncremental(repo, { files: [SERVICE] });

    expect(methodIds(before.graph)).not.toContain(
      'nest-incremental#src/orders/orders.service.ts:OrdersService.cancel',
    );
    expect(methodIds(after.graph)).toContain(
      'nest-incremental#src/orders/orders.service.ts:OrdersService.cancel',
    );
  });

  it('leaves the caller of a method that was renamed with a row saying so', async () => {
    const repo = open('renamed');
    const before = await extractRepoIncremental(repo, { files: [] });
    expect(before.graph.unresolved).toEqual([]);

    edit(repo, REPOSITORY, (text) => text.replace('find(id: string)', 'findById(id: string)'));
    const after = await extractRepoIncremental(repo, { files: [REPOSITORY, SERVICE] });

    expect(after.graph.unresolved.map((row) => row.reason)).toContain('call-dynamic-receiver');
    expect(after.graph.unresolved[0]?.file).toBe(SERVICE);
  });

  it('forgets a file that was deleted', async () => {
    const repo = open('deleted');
    rmSync(join(repo.options.rootDir, CLIENT));
    const after = await extractRepoIncremental(repo, { files: [CLIENT] });

    expect(after.graph.nodes.some((node) => node.file === CLIENT)).toBe(false);
    expect(repoFiles(repo)).not.toContain(CLIENT);
  });

  it('picks up a file that did not exist when the repository was opened', async () => {
    const repo = open('created');
    const added = 'src/orders/orders.audit.ts';
    writeFileSync(
      join(repo.options.rootDir, added),
      `import { Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class OrdersAudit {\n  record(id: string): string {\n    return id;\n  }\n}\n`,
    );
    const after = await extractRepoIncremental(repo, { files: [added] });

    expect(after.graph.nodes.some((node) => node.file === added)).toBe(true);
    expect(repoFiles(repo)).toContain(added);
  });

  it('says it re-derived the whole repository, so nothing has to be spliced', async () => {
    const repo = open('covers');
    expect((await extractRepoIncremental(repo, { files: [] })).covers).toBe('repository');
  });

  it('produces exactly what parsing the repository again produces', async () => {
    const repo = open('equivalent');
    edit(repo, SERVICE, (text) => `${text}\n// a change\n`);
    const warm = await extractRepoIncremental(repo, { files: [SERVICE] });
    const cold = await extractRepoFull(repo);

    expect(JSON.stringify({ ...warm.graph, generatedAt: '' })).toBe(
      JSON.stringify({ ...cold, generatedAt: '' }),
    );
  });
});
