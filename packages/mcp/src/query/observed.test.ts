import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { joinIdOf, OBSERVED_FILE, observedOf } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { loadObservedCounts, markObserved, nodeAmbiguous } from './observed.js';
import type { FlowNode } from './types.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-observed-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ROUTE = 'entry:catalog:http:GET:/items/:id';
const OTHER = 'entry:catalog:http:GET:/items/:slug';
const HANDLER = 'catalog#src/items.controller.ts:ItemsController.one';
const CALL = 'http_out:shop#src/a.ts:1:1';

const dbIn = (name: string, file: unknown): string => {
  const dir = mkdtempSync(join(scratch, `${name}-`));
  writeFileSync(join(dir, OBSERVED_FILE), JSON.stringify(file));
  return join(dir, 'graph.db');
};

const row = (id: string, type: string, children: FlowNode[] = []): FlowNode =>
  ({ node: { id }, edge: { type }, children }) as unknown as FlowNode;

describe('observed counts for the MCP server', () => {
  it('reads a version-2 file and notes where a node was one of several places a request fit', () => {
    const dbPath = dbIn(
      'v2',
      observedOf({
        spans: 4,
        joins: { [joinIdOf(ROUTE, 'handles', HANDLER)]: { count: 2, lastSeen: null } },
        entries: { [ROUTE]: { hits: 2, lastSeen: null } },
        symbols: {},
        channels: {},
        unmatched: [],
        ambiguous: [
          { service: 'catalog', kind: 'entry', name: 'GET /items/:value', candidates: [OTHER, ROUTE], count: 3 },
          { kind: 'join', name: 'GET /items/:value', candidates: [joinIdOf(CALL, 'http_calls', ROUTE)], count: 1 },
        ],
      }),
    );
    const counts = loadObservedCounts(dbPath)!;
    expect(counts.ambiguous).toHaveLength(2);
    expect(nodeAmbiguous(counts, ROUTE)).toBe(3);
    expect(nodeAmbiguous(counts, ROUTE, joinIdOf(CALL, 'http_calls', ROUTE))).toBe(4);
    expect(nodeAmbiguous(counts, HANDLER)).toBeUndefined();

    const tree = [row(HANDLER, 'handles')];
    markObserved(counts, ROUTE, tree, 'forward');
    expect(tree[0]).toMatchObject({ observed: 2 });
    expect(tree[0]).not.toHaveProperty('seenAmbiguous');

    const callers = [row(CALL, 'http_calls')];
    markObserved(counts, ROUTE, callers, 'backward');
    expect(callers[0]).toMatchObject({ seenAmbiguous: 1 });
  });

  it('reads a version-1 file as it is, and nothing from a file of another version', () => {
    const v1 = dbIn('v1', { observedFormatVersion: 1, spans: 1, joins: {}, entries: { [ROUTE]: { hits: 1, lastSeen: null } }, symbols: {}, channels: {}, unmatched: [] });
    expect(loadObservedCounts(v1)).toMatchObject({ entries: { [ROUTE]: { hits: 1 } }, ambiguous: [] });
    const v9 = dbIn('v9', { observedFormatVersion: 9 });
    expect(loadObservedCounts(v9)).toBeUndefined();
    expect(loadObservedCounts(join(scratch, 'nowhere', 'graph.db'))).toBeUndefined();
  });
});
