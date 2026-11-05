import { describeAnswer, DbHandle, isResolved, resolveSymbol as resolveSymbolRef } from '@flowatlas/mcp';
import { openGraphDb } from '@flowatlas/linker';
import { beforeAll, describe, expect, it } from 'vitest';
import { CliError, EXIT } from '../exit.js';
import type { QueryIo } from '../query/answer.js';
import { resolveSymbol } from '../query/refs.js';
import { buildTestProject } from '../test-graph.js';
import { runExplain } from './explain.js';
import { runPath } from './path.js';

let dbPath: string;

beforeAll(() => {
  dbPath = buildTestProject('path-explain').dbPath;
});

interface Capture extends QueryIo {
  stdout: string;
  stderr: string;
}

const capture = (): Capture => {
  const held = {
    stdout: '',
    stderr: '',
    tty: false,
    out(text: string) {
      held.stdout += text;
    },
    err(text: string) {
      held.stderr += text;
    },
  };
  return held;
};

const stop = (run: () => unknown): CliError => {
  try {
    run();
  } catch (error) {
    return error as CliError;
  }
  throw new Error('expected a stop');
};

const ENTRY = 'entry:gateway:http:POST:/orders';
const TABLE = 'table:billing#Invoice';

describe('flowatlas path (P229)', () => {
  it('follows a click across three services to the table it writes, and exits 0', () => {
    const io = capture();
    const run = runPath(ENTRY, TABLE, { db: dbPath, format: 'json' }, io);
    expect(run).toEqual({ state: 'found', exitCode: EXIT.ok });
    const answer = JSON.parse(io.stdout);
    // The test project records a gap on the way, and the path counts it as `flow` would.
    expect(answer).toMatchObject({ state: 'found', from: ENTRY, to: TABLE, directed: true, paths: 1, unresolvedOnPath: 1 });
    const services = new Set<string>();
    const visit = (row: { node: { service?: string }; children: unknown[] }): void => {
      if (row.node.service !== undefined) services.add(row.node.service);
      for (const child of row.children) visit(child as typeof row);
    };
    visit(answer.root);
    expect([...services].sort()).toEqual(['billing', 'gateway', 'orders']);
  });

  it('says the other way round holds when asked the wrong way, and exits 1', () => {
    const io = capture();
    const run = runPath(TABLE, ENTRY, { db: dbPath, format: 'tree', ascii: true, color: false }, io);
    expect(run).toEqual({ state: 'none', exitCode: EXIT.failed });
    expect(io.stdout).toContain(`no path from ${TABLE} to ${ENTRY} within 24 steps; searched 1 nodes`);
    expect(io.stdout).toContain(`${ENTRY} reaches ${TABLE} instead, in `);
    expect(io.stdout).toContain(`flowatlas path ${ENTRY} ${TABLE}`);
  });

  it('draws the path as the sequence a pull request would show', () => {
    const io = capture();
    runPath(ENTRY, TABLE, { db: dbPath, format: 'sequence' }, io);
    expect(io.stdout.startsWith('sequenceDiagram')).toBe(true);
    expect(io.stdout).toContain('order.created');
  });

  it('stops on a name that means two nodes, naming both (exit 1)', () => {
    const error = stop(() => runPath('POST /orders', TABLE, { db: dbPath }, capture()));
    expect(error.code).toBe(EXIT.failed);
    expect(error.details).toEqual(expect.arrayContaining([`  ${ENTRY}`, '  entry:orders:http:POST:/orders']));
  });
});

describe('flowatlas explain (P229)', () => {
  const handleOf = () => new DbHandle({ dbPath });
  const input = { maxSteps: 40, maxChars: 8000 };

  it('prints the Markdown describe_for_prompt answers with, character for character', () => {
    const io = capture();
    runExplain(ENTRY, { db: dbPath }, io);
    const handle = handleOf();
    const opened = handle.open();
    if ('error' in opened) throw new Error(opened.error);
    try {
      const answer = describeAnswer(opened.db, { handle }, { id: ENTRY, ...input }) as { markdown: string };
      expect(io.stdout).toBe(`${answer.markdown.trimEnd()}\n`);
      expect(io.stdout.startsWith('# Way in: POST /orders')).toBe(true);
    } finally {
      opened.db.close();
    }
  });

  it('hands the whole answer over as JSON, next included', () => {
    const io = capture();
    runExplain(ENTRY, { db: dbPath, format: 'json' }, io);
    const answer = JSON.parse(io.stdout);
    expect(answer.id).toBe(ENTRY);
    expect(typeof answer.markdown).toBe('string');
    expect(Array.isArray(answer.next)).toBe(true);
  });

  it('describes a service with --scope', () => {
    const io = capture();
    runExplain('billing', { db: dbPath, scope: 'service' }, io);
    expect(io.stdout.startsWith('# Service: billing')).toBe(true);
  });

  it('stops on a name that means several things (1), and on a flag that makes no sense (2)', () => {
    const several = stop(() => runExplain('POST /orders', { db: dbPath }, capture()));
    expect(several.code).toBe(EXIT.failed);
    expect(several.details.some((line) => line.startsWith(`  ${ENTRY}`))).toBe(true);
    expect(stop(() => runExplain('nothing.like.this', { db: dbPath }, capture())).code).toBe(EXIT.failed);
    expect(stop(() => runExplain(ENTRY, { db: dbPath, scope: 'everything' }, capture())).code).toBe(EXIT.cannotRun);
    expect(stop(() => runExplain(ENTRY, { db: dbPath, maxChars: '10' }, capture())).code).toBe(EXIT.cannotRun);
  });
});

describe('one name, one node, in the terminal and in an assistant (P229)', () => {
  /** Names said every way a person or a tool says them, and two that mean several things or nothing. */
  const NAMES = [
    ENTRY,
    'POST /orders',
    'post /orders',
    'bot:order_confirm',
    'event:order.created',
    'OrdersService.create',
    'InvoicesService.create',
    'InvoicesSer',
    'order.created',
    'Loop.a',
    'nothing.like.this',
  ];

  it('resolves every name to the same node, or to no single one, through the command and the tool', () => {
    const db = openGraphDb(dbPath);
    try {
      for (const name of NAMES) {
        const tool = resolveSymbolRef(db, name);
        const command = ((): string | undefined => {
          try {
            return resolveSymbol(db, name).id;
          } catch (error) {
            if (error instanceof CliError && error.code === EXIT.failed) return undefined;
            throw error;
          }
        })();
        expect(command, name).toBe(isResolved(tool) ? tool.id : undefined);
      }
      // And a service narrows a name the same way for both.
      const narrowed = resolveSymbolRef(db, 'OrdersService.create', 'orders');
      expect(isResolved(narrowed) && narrowed.id).toBe(resolveSymbol(db, 'OrdersService.create', 'orders').id);
    } finally {
      db.close();
    }
  });
});
