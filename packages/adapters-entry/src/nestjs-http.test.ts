import { GraphBuilder, noAdapters, parseConfig, silentLogger, type EntryNode, type ExtractContext } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { nestjsHttpAdapter } from './nestjs-http.js';

const extract = (source: string): EntryNode[] => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false, experimentalDecorators: true } });
  project.createSourceFile('/src/a.controller.ts', source);
  const ctx: ExtractContext = {
    repo: 'library',
    repoDir: '/',
    service: { name: 'library', repo: '/', type: 'nestjs' },
    config: parseConfig({}),
    pkg: { dependencies: { '@nestjs/common': '^11.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'library' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  return nestjsHttpAdapter.extractEntries(ctx);
};

const notes = (entries: EntryNode[]): Array<[string, unknown]> =>
  entries.map((entry) => [entry.label, entry.meta?.['publicNote']] as [string, unknown]).sort(([a], [b]) => (a < b ? -1 : 1));

describe('a route said to be public in so many words (P90)', () => {
  it('reads the marker on the handler, then on its controller, and keeps an empty reason empty', () => {
    const entries = extract(`
      import { Controller, Get } from '@nestjs/common';

      /** @flowatlas-public opening hours are shown to anyone */
      @Controller('hours')
      export class HoursController {
        @Get() list() { return []; }

        /** @flowatlas-public the holiday calendar is printed on the door */
        @Get('holidays') holidays() { return []; }
      }

      @Controller('desk')
      export class DeskController {
        /** @flowatlas-public */
        @Get('queue') queue() { return []; }

        @Get('stats') stats() { return []; }
      }`);
    expect(notes(entries)).toEqual([
      ['GET /desk/queue', ''],
      ['GET /desk/stats', undefined],
      ['GET /hours', 'opening hours are shown to anyone'],
      ['GET /hours/holidays', 'the holiday calendar is printed on the door'],
    ]);
  });

  it('reads nothing as public from a verb, a path or a name', () => {
    const entries = extract(`
      import { Controller, Get } from '@nestjs/common';

      /** Anyone may browse. @flowatlas-publicity is not the marker. */
      @Controller('public/catalogue')
      export class PublicCatalogueController {
        @Get('items') items() { return []; }
      }`);
    expect(entries.map((entry) => [entry.label, entry.meta?.['publicNote']])).toEqual([['GET /public/catalogue/items', undefined]]);
  });
});
