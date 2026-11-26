import { importedName, SCHEMA_VERSION, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { joinImports } from './import-link.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({ schemaVersion: SCHEMA_VERSION, repo, generatedAt: FIXED, nodes, edges: [], types: {}, unresolved: [] });
const repoNode = (repo: string, meta: Record<string, unknown>): GraphNode => ({ id: `repo:${repo}`, type: 'repo', label: repo, repo, meta });
const channel = (repo: string, name: string): GraphNode => ({ id: `channel:${name}`, type: 'channel', label: name, repo });

const PREFIX = 'export:shop-prefix';
const STAGE = 'parameter:/shop/stage';
/** A queue's name built of two values another repository publishes, and text: `${prefix}-${stage}-audit`. */
const BUILT = `${importedName(PREFIX)}-${importedName(STAGE)}-audit`;

/** `platform` publishes the prefix as text, and the stage where `stage` says so. */
const platform = (stage = true): RepoGraph =>
  graph('platform', [
    repoNode('platform', {
      exports: [
        { keys: [PREFIX], address: 'Outputs.Prefix', file: 'stack.yaml', line: 3, text: 'shop' },
        ...(stage ? [{ keys: [STAGE], address: 'Resources.Stage', file: 'stack.yaml', line: 9, text: 'prod' }] : []),
      ],
    }),
    channel('platform', 'sqs/shop-prod-audit'),
  ]);

/** `orders` sends to the queue whose name it builds of both. */
const orders = (): RepoGraph =>
  graph('orders', [
    repoNode('orders', {
      imports: [PREFIX, STAGE].map((key) => ({ key, file: 'stack.yaml', line: 20, what: 'the value of AUDIT', kinds: ['queue'], as: 'name', within: BUILT })),
    }),
    channel('orders', `sqs/${BUILT}`),
  ]);

describe('a name built of several values other repositories publish (P259)', () => {
  it('is written where every part of it is joined', () => {
    const { graphs, rows } = joinImports([platform(), orders()]);
    expect(rows).toEqual([]);
    expect((graphs[1] as RepoGraph).nodes.map((node) => node.id)).toEqual(['repo:orders', 'channel:sqs/shop-prod-audit']);
  });

  it('is kept whole, and a part that is not joined is a row, where any part is not', () => {
    const { graphs, rows } = joinImports([platform(false), orders()]);
    expect(rows.map((row) => [row.reason, row.meta?.['key']])).toEqual([['export-not-found', STAGE]]);
    expect((graphs[1] as RepoGraph).nodes.map((node) => node.id)).toEqual(['repo:orders', `channel:sqs/${BUILT}`]);
  });
});
