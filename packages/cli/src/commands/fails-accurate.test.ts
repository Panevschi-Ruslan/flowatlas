import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AdapterRegistry, failuresOf, type Failure, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * P87. The snapshot of fixtures/nest-fails-accurate is the reading with its
 * global filter; this is the same repository with the filter taken out of
 * `main.ts`, so the statuses the error classes state have nothing to read them.
 */
const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/nest-fails-accurate');

const BARE_MAIN = `import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  await app.listen(3000);
}
void bootstrap();
`;

describe('a domain error with no filter to read it (P87)', () => {
  let dir: string;
  let graph: RepoGraph;
  const throwsOf = (label: string) =>
    failuresOf(graph.nodes.find((node) => node.label === label))
      .filter((item: Failure) => item.source === 'throw')
      .map(({ status, exception, assumed, declared }) => [status, exception, assumed, declared]);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fails-no-filter-'));
    cpSync(FIXTURE, dir, { recursive: true, filter: (path) => !path.includes('.flowatlas') });
    writeFileSync(join(dir, 'src/main.ts'), BARE_MAIN);
    graph = await extractRepo({
      rootDir: dir,
      repo: 'loans',
      registry: registerEntryAdapters(new AdapterRegistry()),
      noTypes: true,
    });
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists the framework 500, assumed, with the status the class declares kept', () => {
    expect(throwsOf('GET /loans/:param')).toEqual([[500, 'LoanNotFound', true, 404]]);
    expect(throwsOf('GET /loans/:param/shelf')).toEqual([
      [500, 'LoanNotFound', true, 404],
      [500, 'ShelfLocked', true, 423],
    ]);
    expect(throwsOf('POST /loans')).toEqual([
      [401, 'UnauthorizedException', undefined, undefined],
      [500, 'LoanOverdue', true, 409],
      [500, 'LoanOverdue', true, 409],
      [500, 'PlainFailure', true, undefined],
      [500, 'PlainFailure', true, undefined],
    ]);
  });

  it('still lets a controller filter answer for its routes', () => {
    expect(throwsOf('POST /returns/:param')).toEqual([
      [400, 'LoanNotFound', undefined, undefined],
      [400, 'ShelfLocked', undefined, undefined],
    ]);
  });
});
