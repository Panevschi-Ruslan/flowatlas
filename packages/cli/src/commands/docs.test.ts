import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type GraphEdge, type GraphNode, type ProjectGraph } from '@flowatlas/core';
import { parseDocs, readDocsIndex, writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT } from '../exit.js';
import { docFiles, runDocs, type DocsOptions } from './docs.js';

/**
 * `flowatlas docs` (P120) on a project of its own: a bookshop's way in that
 * asks the catalogue for a book, built five ways - as it is, with every line
 * moved, with a publish added, with the catalogue's route renamed, and with
 * the catalogue no longer asking its store - and a page of blocks about it.
 */
const FIXED = '2026-01-01T00:00:00.000Z';
const ROUTE = 'entry:shop:http:GET:/books/:param';
const HANDLER = 'shop#src/books.controller.ts:BooksController.get';
const CLIENT = 'shop#src/catalog.client.ts:CatalogClient.fetch';
const TARGET = 'entry:catalog:http:GET:/books/:param';
const FIND = 'catalog#src/books.service.ts:BooksService.find';

const report = (): LinkReport => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  configHash: 'test',
  services: [],
  httpOut: { total: 0, linked: 0, byMarker: 0, unknownEnv: 0, noRoute: 0, ambiguous: 0, external: 0, dynamic: 0 },
  ui: { total: 0, resolved: 0, unresolved: 0, byReason: {} },
  channels: { total: 0, linked: 0, noConsumers: [], noProducers: [] },
  routes: { total: 0, called: 0, uncalled: [], duplicated: [] },
  types: { total: 0, sharedPackage: 0 },
  unresolved: [],
  totals: { nodes: 0, edges: 0, types: 0, missed: 0, sites: 0, notes: 0, findings: 0, unresolved: 0 },
});

type Variant = 'as-is' | 'moved' | 'publishes' | 'renamed' | 'no-store';

/** The project in one of its five shapes. `moved` is `as-is` with every line three further down. */
const graphOf = (variant: Variant): ProjectGraph => {
  const shift = variant === 'moved' ? 3 : 0;
  const at = (line: number): number => line + shift;
  const request = `http_out:shop#src/catalog.client.ts:${at(20)}:4`;
  const targetPath = variant === 'renamed' ? '/books/:param/details' : '/books/:param';
  const target = variant === 'renamed' ? 'entry:catalog:http:GET:/books/:param/details' : TARGET;
  const query = `db_query:catalog#src/books.service.ts:${at(14)}:6`;
  const producer = `producer:catalog#src/books.service.ts:${at(16)}:6`;
  const nodes: GraphNode[] = [
    { id: ROUTE, type: 'entry', kind: 'http', label: 'GET /books/:param', repo: 'shop', file: 'src/books.controller.ts', line: at(8), meta: { method: 'GET', path: '/books/:param' } },
    { id: HANDLER, type: 'method', label: 'BooksController.get', repo: 'shop', file: 'src/books.controller.ts', line: at(8) },
    { id: CLIENT, type: 'method', label: 'CatalogClient.fetch', repo: 'shop', file: 'src/catalog.client.ts', line: at(19) },
    { id: request, type: 'http_out', label: 'GET /books/:param', repo: 'shop', file: 'src/catalog.client.ts', line: at(20) },
    { id: target, type: 'entry', kind: 'http', label: `GET ${targetPath}`, repo: 'catalog', file: 'src/books.controller.ts', line: at(10), meta: { method: 'GET', path: targetPath } },
    { id: 'catalog#src/books.controller.ts:BooksController.get', type: 'method', label: 'BooksController.get', repo: 'catalog', file: 'src/books.controller.ts', line: at(10) },
    { id: FIND, type: 'method', label: 'BooksService.find', repo: 'catalog', file: 'src/books.service.ts', line: at(13) },
    { id: query, type: 'db_query', label: 'read books', repo: 'catalog', file: 'src/books.service.ts', line: at(14) },
    { id: 'table:catalog#books', type: 'table', label: 'books', repo: 'catalog' },
    ...(variant === 'publishes'
      ? ([
          { id: producer, type: 'producer', label: 'event book.viewed', repo: 'catalog', file: 'src/books.service.ts', line: at(16) },
          { id: 'channel:book.viewed', type: 'channel', label: 'book.viewed', repo: '' },
        ] satisfies GraphNode[])
      : []),
  ];
  const edges: GraphEdge[] = [
    { from: ROUTE, to: HANDLER, type: 'handles', confidence: 'static', file: 'src/books.controller.ts', line: at(8) },
    { from: HANDLER, to: CLIENT, type: 'calls', confidence: 'static', file: 'src/books.controller.ts', line: at(9) },
    { from: CLIENT, to: request, type: 'calls', confidence: 'static', file: 'src/catalog.client.ts', line: at(20) },
    // The renamed route is still asked for by its old path: the request joins nothing.
    ...(variant === 'renamed' ? [] : [{ from: request, to: target, type: 'http_calls' as const, confidence: 'static' as const, returns: 'type:catalog#BookDto' }]),
    { from: target, to: 'catalog#src/books.controller.ts:BooksController.get', type: 'handles', confidence: 'static' },
    { from: 'catalog#src/books.controller.ts:BooksController.get', to: FIND, type: 'calls', confidence: 'static', file: 'src/books.controller.ts', line: at(11) },
    ...(variant === 'no-store'
      ? []
      : [
          { from: FIND, to: query, type: 'calls' as const, confidence: 'static' as const, file: 'src/books.service.ts', line: at(14) },
          { from: query, to: 'table:catalog#books', type: 'queries' as const, confidence: 'static' as const },
        ]),
    ...(variant === 'publishes'
      ? [
          { from: FIND, to: producer, type: 'calls' as const, confidence: 'static' as const, file: 'src/books.service.ts', line: at(16) },
          { from: producer, to: 'channel:book.viewed', type: 'emits' as const, confidence: 'static' as const },
        ]
      : []),
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    builtAt: FIXED,
    services: [
      { name: 'shop', repo: './shop', type: 'nestjs', extractor: null },
      { name: 'catalog', repo: './catalog', type: 'nestjs', extractor: null },
    ],
    nodes,
    edges,
    types: {
      'type:catalog#BookDto': { name: 'BookDto', kind: 'object', declaredIn: 'catalog#src/book.dto.ts', structuralHash: 'aaaa1111', fields: [{ name: 'id', type: 'string', optional: false }] },
    },
    unresolved: [],
  };
};

const root = mkdtempSync(join(tmpdir(), 'flowatlas-docs-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let made = 0;

/** A project directory: the database of one variant under `out/`, and the page under `docs/`. */
const project = (variant: Variant, page: string): { dir: string; db: string; page: string } => {
  made += 1;
  const dir = join(root, `p${made}`);
  mkdirSync(join(dir, 'out'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  const db = join(dir, 'out', 'graph.db');
  writeGraphDb(graphOf(variant), report(), db);
  writeFileSync(join(dir, 'docs', 'page.md'), page);
  return { dir, db, page: join(dir, 'docs', 'page.md') };
};

/** The same directory read against another variant of the graph. */
const rebuild = (where: { db: string }, variant: Variant): void => {
  rmSync(where.db, { force: true });
  writeGraphDb(graphOf(variant), report(), where.db);
};

const quiet = { out: () => undefined, err: () => undefined };

const run = (where: { dir: string; db: string; page: string }, options: DocsOptions = {}) => {
  let out = '';
  const result = runDocs([where.page], { db: where.db, cwd: where.dir, ...options }, { out: (text) => void (out += text), err: () => undefined });
  return { ...result, out };
};

const PAGE = [
  '# The bookshop',
  '',
  'Prose the tool never touches.',
  '',
  '<!-- flowatlas:flow id="GET /books/:param" service="shop" view="steps" -->',
  '<!-- /flowatlas:flow -->',
  '',
  'Between the blocks, more prose.',
  '',
  '<!-- flowatlas:flow id="entry:shop:http:GET:/books/:param" view="sequence" -->',
  '<!-- /flowatlas:flow -->',
  '',
  '<!-- flowatlas:flow id="GET /books/:param" service="shop" view="contract" -->',
  '<!-- /flowatlas:flow -->',
  '',
  '<!-- flowatlas:flow id="GET /books/:param" service="shop" view="mermaid" -->',
  '<!-- /flowatlas:flow -->',
  '',
  '<!-- flowatlas:flow id="GET /books/:param" service="shop" view="prompt" -->',
  '<!-- /flowatlas:flow -->',
  '',
  '<!-- flowatlas:symbol id="BooksService.find" view="steps" -->',
  '<!-- /flowatlas:symbol -->',
  '',
  'The service is <!-- flowatlas:ref id="BooksService.find" -->`BooksService.find`.',
  '',
].join('\n');

/** What lies outside every block region, so a test can say nothing there moved. */
const outside = (text: string): string => {
  let kept = '';
  let at = 0;
  for (const block of parseDocs(text).blocks) {
    kept += text.slice(at, block.openEnd);
    at = block.end;
  }
  return kept + text.slice(at);
};

describe('flowatlas docs --write (P120)', () => {
  it('fills every block, and a second write changes no byte', () => {
    const where = project('as-is', PAGE);
    const first = run(where, { write: true });
    expect(first.written).toEqual(['docs/page.md']);
    const written = readFileSync(where.page, 'utf8');
    expect(first.results.map((result) => result.check.state)).toEqual(Array(7).fill('ok'));
    for (const block of parseDocs(written).blocks.filter((item) => item.kind !== 'ref')) {
      expect(block.fingerprint, `${block.id} ${block.view}`).toMatch(/^[0-9a-f]{8}$/);
      expect(block.content.trim().length, `${block.id} ${block.view}`).toBeGreaterThan(0);
    }
    expect(written).toContain('```text\n@  GET /books/:param');
    expect(written).toContain('sequenceDiagram');
    expect(written).toContain('| 2 | shop → catalog `GET /books/:param` | — | `BookDto` | — |');
    expect(written).toContain('### Way in: GET /books/:param');
    expect(written).toContain('reached from: GET /books/:param');
    // Nothing outside the markers moved, byte for byte.
    expect(outside(written)).toBe(outside(PAGE));

    const second = run(where, { write: true });
    expect(second.written).toEqual([]);
    expect(readFileSync(where.page, 'utf8')).toBe(written);
    expect(second.results.some((result) => result.written === true)).toBe(false);
  });

  it('writes docs.json beside the database on every run', () => {
    const where = project('as-is', PAGE);
    run(where, { write: true });
    const { index } = readDocsIndex(join(where.dir, 'out', 'docs.json'));
    expect(index?.files).toEqual(['docs/page.md']);
    expect(index?.blocks.map((entry) => [entry.kind, entry.node, entry.state])).toEqual([
      ['flow', ROUTE, 'ok'],
      ['flow', ROUTE, 'ok'],
      ['flow', ROUTE, 'ok'],
      ['flow', ROUTE, 'ok'],
      ['flow', ROUTE, 'ok'],
      ['symbol', FIND, 'ok'],
      ['ref', FIND, 'ok'],
    ]);
  });
});

describe('flowatlas docs --check (P120)', () => {
  it('passes once written, and still passes when every line moved', () => {
    const where = project('as-is', PAGE);
    run(where, { write: true });
    expect(run(where, { check: true }).exitCode).toBe(EXIT.ok);
    rebuild(where, 'moved');
    const moved = run(where, { check: true });
    expect(moved.results.map((result) => result.check.state)).toEqual(Array(7).fill('ok'));
    expect(moved.exitCode).toBe(EXIT.ok);
  });

  it('fails naming the block and the step a flow gained', () => {
    const where = project('as-is', PAGE);
    run(where, { write: true });
    rebuild(where, 'publishes');
    const checked = run(where, { check: true });
    expect(checked.exitCode).toBe(EXIT.failed);
    const sequence = checked.results.find((result) => result.block.view === 'sequence');
    expect(sequence?.check.state).toBe('changed');
    expect(checked.out).toMatch(/docs\/page\.md:\d+ {2}flow entry:shop:http:GET:\/books\/:param \(sequence\) {2}changed/);
    expect(checked.out).toContain('+ catalog → book.viewed book.viewed');
    // Without --check it says the same and exits 0.
    expect(run(where).exitCode).toBe(EXIT.ok);
  });

  it('says a step went, and that a change inside a service is a change', () => {
    const where = project('as-is', PAGE);
    run(where, { write: true });
    rebuild(where, 'no-store');
    const checked = run(where, { check: true });
    expect(checked.exitCode).toBe(EXIT.failed);
    expect(checked.out).toContain('- catalog → books (table) read books');
  });

  it('says a block whose route is gone is gone, with the nearest names, and writes nothing into it', () => {
    const where = project('as-is', PAGE);
    run(where, { write: true });
    rebuild(where, 'renamed');
    const checked = run(where, { check: true });
    expect(checked.exitCode).toBe(EXIT.failed);
    // The shop's way in is still there and changed; the catalogue's request lost its target.
    expect(checked.results.find((result) => result.block.view === 'steps' && result.block.kind === 'flow')?.check.state).toBe('changed');
    const gone = project('renamed', '<!-- flowatlas:flow id="GET /books/:param" service="catalog" -->\n<!-- /flowatlas:flow -->\n');
    const said = run(gone, { check: true, write: true });
    expect(said.results[0]?.check.state).toBe('gone');
    expect(said.results[0]?.check.near).toContain('entry:catalog:http:GET:/books/:param/details');
    expect(said.out).toContain('nearest: ');
    expect(readFileSync(gone.page, 'utf8')).toBe('<!-- flowatlas:flow id="GET /books/:param" service="catalog" -->\n<!-- /flowatlas:flow -->\n');
    expect(said.exitCode).toBe(EXIT.failed);
  });

  it('never guesses between two ways in of one name', () => {
    const where = project('as-is', '<!-- flowatlas:flow id="GET /books/:param" -->\n<!-- /flowatlas:flow -->\n');
    const checked = run(where, { check: true, write: true });
    expect(checked.results[0]?.check.state).toBe('ambiguous');
    expect(checked.results[0]?.check.candidates).toEqual([TARGET, ROUTE]);
    expect(checked.written).toEqual([]);
    expect(checked.exitCode).toBe(EXIT.failed);
  });

  it('says a block written by hand is changed until it is written once', () => {
    const where = project('as-is', '<!-- flowatlas:flow id="GET /books/:param" service="shop" -->\nby hand\n<!-- /flowatlas:flow -->\n');
    const checked = run(where, { check: true });
    expect(checked.results[0]?.check.state).toBe('changed');
    expect(checked.out).toContain('never written');
  });

  it('exits 2 on a marker it cannot read, and names the file and line', () => {
    const where = project('as-is', 'text\n<!-- flowatlas:flow id="GET /books/:param" -->\nnever closed\n');
    const checked = run(where, { check: true });
    expect(checked.exitCode).toBe(EXIT.cannotRun);
    expect(checked.out).toContain('docs/page.md:2  not read: the flow block opened here is never closed');
  });

  it('writes workflow commands at the line of each stale block', () => {
    const where = project('as-is', '\n<!-- flowatlas:flow id="GET /books/:param" -->\n<!-- /flowatlas:flow -->\n');
    const checked = run(where, { check: true, format: 'github' });
    expect(checked.out.split('\n')[0]).toMatch(/^::warning file=docs\/page\.md,line=2,title=flowatlas docs::flow GET \/books\/:param is ambiguous: could mean: /);
  });
});

describe('a tour (P120 D4)', () => {
  const TOUR = '<!-- flowatlas:flow id="GET /books/:param" service="shop" view="tour" -->\n<!-- /flowatlas:flow -->\n';

  it('keeps the notes by step, keeps a note whose step went under orphaned notes, and gives it back', () => {
    const where = project('as-is', TOUR);
    run(where, { write: true });
    const blank = readFileSync(where.page, 'utf8');
    const step = (key: string): string => `<!-- step key="${key}" -->\n   <!-- note -->`;
    expect(blank).toContain(step(FIND));
    const noted = blank
      .replace(step(FIND), `<!-- step key="${FIND}" -->\n   Finds the book; the one place that reads the store.`)
      .replace(step(ROUTE), `<!-- step key="${ROUTE}" -->\n   Where the shop's page asks for a book.`);
    writeFileSync(where.page, noted);

    // The flow gained a step: both notes stay under their steps.
    rebuild(where, 'publishes');
    run(where, { write: true });
    const grown = readFileSync(where.page, 'utf8');
    expect(grown).toContain(`<!-- step key="${FIND}" -->\n   Finds the book; the one place that reads the store.`);
    expect(grown).toContain(`<!-- step key="${ROUTE}" -->\n   Where the shop's page asks for a book.`);
    expect(grown).toContain('**event book.viewed**');

    // The step the note is under left the flow: the note is kept, not deleted.
    rebuild(where, 'renamed');
    const lost = run(where, { write: true });
    expect(lost.results[0]?.orphaned).toEqual([FIND]);
    const orphaned = readFileSync(where.page, 'utf8');
    expect(orphaned).toContain('**Orphaned notes**');
    expect(orphaned).toContain(`- **BooksService.find** · catalog · \`src/books.service.ts:13\` <!-- step key="${FIND}" -->\n   Finds the book; the one place that reads the store.`);
    expect(lost.out).toContain(`orphaned notes kept at the end of the block: ${FIND}`);

    // It comes back with its step.
    rebuild(where, 'as-is');
    run(where, { write: true });
    const back = readFileSync(where.page, 'utf8');
    expect(back).not.toContain('**Orphaned notes**');
    expect(back).toContain(`<!-- step key="${FIND}" -->\n   Finds the book; the one place that reads the store.`);
    expect(run(where, { write: true }).written).toEqual([]);
  });
});

describe('which files a run reads', () => {
  it('reads every Markdown file under the configuration but the output and node_modules', () => {
    const dir = join(root, 'files');
    for (const path of ['docs/a.md', 'b.md', 'out/c.md', 'node_modules/x/d.md', 'docs/e.txt']) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), '');
    }
    const where = { cwd: dir, rootDir: dir, outputDir: join(dir, 'out') };
    expect(docFiles([], where).files.map((path) => path.slice(dir.length + 1))).toEqual(['b.md', 'docs/a.md']);
    expect(docFiles([], { ...where, configured: ['docs/*.md'] }).files.map((path) => path.slice(dir.length + 1))).toEqual(['docs/a.md']);
    expect(docFiles(['docs', 'missing.md', 'out/c.md'], where)).toEqual({ files: [join(dir, 'docs', 'a.md')], missing: ['missing.md'] });
  });

  it('refuses to list and write in one run', () => {
    const where = project('as-is', '');
    expect(() => runDocs([where.page], { db: where.db, cwd: where.dir, list: true, write: true }, quiet)).toThrow('ask for one');
  });
});
