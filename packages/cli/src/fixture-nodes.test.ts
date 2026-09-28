import { describe, expect, it } from 'vitest';
import {
  RELATION_NAMES,
  resolveNode,
  resolveNodeId,
  type FixtureGraph,
} from '../../../scripts/fixture-nodes.mjs';

/**
 * The resolver the fixture assertions ask for their coordinates through.
 *
 * It exists so that no test spells a line number out, and it is only worth
 * having if it refuses to guess. A helper that quietly answered with the first
 * of two matches would leave an assertion passing about whichever node came
 * back first, which is worse than the coordinate it replaced: the coordinate at
 * least said which one it meant. So the two failures are the point of this
 * file, and they are asserted on the message, because the message is what the
 * next person has to act on.
 *
 * A graph written out here rather than built from a fixture, so that these
 * cases stay reachable — an ambiguous match is exactly the shape the fixtures
 * are curated not to have.
 */
const graph: FixtureGraph = {
  nodes: [
    { id: 'repo#src/client.ts:Client.fetchOne', type: 'method' },
    { id: 'repo#src/client.ts:Client.twice', type: 'method' },
    { id: 'repo#src/client.ts:Client.quiet', type: 'method' },
    { id: 'web#src/page.ts:Page.submit', type: 'method' },
    { id: 'http_out:repo#src/client.ts:12:4', type: 'http_out' },
    { id: 'http_out:repo#src/client.ts:20:4', type: 'http_out' },
    { id: 'http_out:repo#src/client.ts:21:4', type: 'http_out' },
    { id: 'db_query:repo#src/client.ts:13:4', type: 'db_query' },
    { id: 'ui_action:web#src/page.ts:3:8', type: 'ui_action' },
  ],
  edges: [
    { from: 'repo#src/client.ts:Client.fetchOne', to: 'http_out:repo#src/client.ts:12:4', type: 'calls' },
    { from: 'repo#src/client.ts:Client.fetchOne', to: 'db_query:repo#src/client.ts:13:4', type: 'calls' },
    { from: 'repo#src/client.ts:Client.twice', to: 'http_out:repo#src/client.ts:20:4', type: 'calls' },
    { from: 'repo#src/client.ts:Client.twice', to: 'http_out:repo#src/client.ts:21:4', type: 'calls' },
    { from: 'ui_action:web#src/page.ts:3:8', to: 'web#src/page.ts:Page.submit', type: 'handles' },
  ],
};

describe('asking a graph for one node by what it is', () => {
  it('answers with the request a method makes', () => {
    expect(
      resolveNodeId(graph, { type: 'http_out', calledBy: 'repo#src/client.ts:Client.fetchOne' }),
    ).toBe('http_out:repo#src/client.ts:12:4');
  });

  it('tells two leaves of the same method apart by what they are', () => {
    expect(
      resolveNodeId(graph, { type: 'db_query', calledBy: 'repo#src/client.ts:Client.fetchOne' }),
    ).toBe('db_query:repo#src/client.ts:13:4');
  });

  it('follows an edge that points at the method rather than away from it', () => {
    expect(resolveNodeId(graph, { type: 'ui_action', handling: 'web#src/page.ts:Page.submit' })).toBe(
      'ui_action:web#src/page.ts:3:8',
    );
  });

  it('answers with the whole node, so a row can be found where the node is', () => {
    const found = resolveNode(graph, {
      type: 'http_out',
      calledBy: 'repo#src/client.ts:Client.fetchOne',
    });
    expect(found).toMatchObject({ id: 'http_out:repo#src/client.ts:12:4', type: 'http_out' });
  });
});

describe('what the resolver does rather than guess', () => {
  it('refuses when the symbol it was told to start from is not there', () => {
    expect(() =>
      resolveNodeId(graph, { type: 'http_out', calledBy: 'repo#src/client.ts:Client.gone' }),
    ).toThrow(/has no node repo#src\/client\.ts:Client\.gone to start from/);
  });

  it('refuses when the method reaches nothing of that kind, and says what it does reach', () => {
    expect(() =>
      resolveNodeId(graph, { type: 'producer', calledBy: 'repo#src/client.ts:Client.fetchOne' }),
    ).toThrow(/it reaches http_out \(http_out:repo#src\/client\.ts:12:4\), db_query/);
  });

  it('refuses when the method reaches nothing at all', () => {
    expect(() =>
      resolveNodeId(graph, { type: 'http_out', calledBy: 'repo#src/client.ts:Client.quiet' }),
    ).toThrow(/it reaches nothing of any type/);
  });

  it('refuses when two nodes answer to the same description, and names both', () => {
    expect(() =>
      resolveNodeId(graph, { type: 'http_out', calledBy: 'repo#src/client.ts:Client.twice' }),
    ).toThrow(
      /2 nodes http_out calledBy repo#src\/client\.ts:Client\.twice: http_out:repo#src\/client\.ts:20:4, http_out:repo#src\/client\.ts:21:4/,
    );
  });

  it('refuses a relation it does not know, and lists the ones it does', () => {
    expect(() =>
      // @ts-expect-error a selector key the resolver has no strategy for
      resolveNodeId(graph, { type: 'http_out', writtenBy: 'repo#src/client.ts:Client.fetchOne' }),
    ).toThrow(/knows no relation named writtenBy/);
  });

  it('refuses a selector that names two relations, or none', () => {
    expect(() =>
      resolveNodeId(graph, {
        type: 'http_out',
        calledBy: 'repo#src/client.ts:Client.fetchOne',
        handling: 'web#src/page.ts:Page.submit',
      }),
    ).toThrow(new RegExp(`exactly one of ${RELATION_NAMES.join(', ')}, and this one carries 2`));
    // @ts-expect-error a selector with no relation at all
    expect(() => resolveNodeId(graph, { type: 'http_out' })).toThrow(/carries 0/);
  });
});
