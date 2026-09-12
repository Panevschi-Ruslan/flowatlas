import { describe, expect, it } from 'vitest';
import { bySeverity, checkContracts, errorsOf } from './check.js';
import type { TypeRegistry } from '@flowatlas/core';
import type { ContractReport } from './types.js';
import { edge, field, graphOf, node, object } from './test-graph.js';

/**
 * Which end of which boundary is which, and what happens when one of them is
 * missing.
 *
 * The roles are the flow of the data and not the direction of the arrow, so
 * every case here is really one claim about who is sending: on a response the
 * handler sends and the caller receives, though the edge points the other way.
 * Getting that backwards would report every answer as a missing request.
 */

const FIXED = '2026-01-01T00:00:00.000Z';

const registry = {
  'type:caller#Body': object('Body', [field('id', 'string')]),
  'type:api#Body': object('Body', [field('id', 'string'), field('channel', 'string')]),
  'type:api#Answer': object('Answer', [field('total', 'number')]),
  'type:caller#Answer': object('Answer', [field('total', 'string')]),
};

/** A caller in one service reaching a route in another, both ends typed. */
const request = (extra: { markers?: Array<{ name: string }> } = {}): ContractReport =>
  checkContracts(
    graphOf({
      nodes: [
        node('caller#Client.create', 'method', 'caller', {
          ...(extra.markers === undefined ? {} : { meta: { markers: extra.markers } }),
        }),
        node('http_out:caller#1', 'http_out', 'caller'),
        node('entry:api:http:POST:/orders', 'entry', 'api', { kind: 'http' }),
        node('api#Controller.create', 'method', 'api'),
      ],
      edges: [
        edge('caller#Client.create', 'calls', 'http_out:caller#1'),
        edge('http_out:caller#1', 'http_calls', 'entry:api:http:POST:/orders', {
          params: ['type:caller#Body'],
          returns: 'type:caller#Answer',
        }),
        edge('entry:api:http:POST:/orders', 'handles', 'api#Controller.create', {
          params: ['type:api#Body'],
          returns: 'type:api#Answer',
          meta: { body: 'type:api#Body' },
        }),
      ],
      types: registry,
    }),
    { generatedAt: FIXED },
  );

describe('who sends and who receives', () => {
  const report = request();

  it('checks both halves of a call separately', () => {
    expect(report.edges.map((row) => row.direction).sort()).toEqual(['request', 'response']);
  });

  it('has the caller sending on the request', () => {
    const found = report.edges.find((row) => row.direction === 'request');
    expect(found?.sender.service).toBe('caller');
    expect(found?.receiver.service).toBe('api');
    expect(found?.receiver.typeId).toBe('type:api#Body');
  });

  it('has the handler sending on the response', () => {
    const found = report.edges.find((row) => row.direction === 'response');
    expect(found?.sender.service).toBe('api');
    expect(found?.sender.typeId).toBe('type:api#Answer');
    expect(found?.receiver.service).toBe('caller');
  });

  it('names the method a reader would open, not the node standing for the call', () => {
    const found = report.edges.find((row) => row.direction === 'request');
    expect(found?.sender.symbol).toBe('caller#Client.create');
    expect(found?.receiver.symbol).toBe('api#Controller.create');
  });

  it('finds the field each half disagrees about', () => {
    expect(report.findings.map((finding) => `${finding.direction} ${finding.field}`)).toEqual([
      'request channel',
      'response total',
    ]);
  });
});

describe('an annotation that excuses a difference', () => {
  const report = request({ markers: [{ name: 'ContractIgnore' }] });

  it('keeps every finding and counts none of them', () => {
    expect(report.findings).toEqual([]);
    expect(report.ignored).toHaveLength(2);
    expect(errorsOf(report)).toEqual([]);
  });

  it('says which symbol excused them', () => {
    expect(report.ignored[0]?.ignoredBy).toBe('caller#Client.create');
    expect(report.ignored[0]?.ignored).toBe(true);
  });

  it('reports them as ordinary findings when asked to ignore the annotation', () => {
    const graph = graphOf({});
    expect(checkContracts(graph, { honourIgnore: false }).findings).toEqual([]);
  });
});

describe('a boundary the configuration excuses', () => {
  it('is excused by its key, for code nobody can annotate', () => {
    const report = checkContracts(
      graphOf({
        nodes: [
          node('http_out:caller#1', 'http_out', 'caller'),
          node('entry:api:http:POST:/orders', 'entry', 'api', { kind: 'http' }),
          node('api#Controller.create', 'method', 'api'),
        ],
        edges: [
          edge('http_out:caller#1', 'http_calls', 'entry:api:http:POST:/orders', {
            params: ['type:caller#Body'],
          }),
          edge('entry:api:http:POST:/orders', 'handles', 'api#Controller.create', {
            meta: { body: 'type:api#Body' },
          }),
        ],
        types: registry,
      }),
      {
        generatedAt: FIXED,
        ignoreEdges: ['http_out:caller#1|http_calls|entry:api:http:POST:/orders'],
      },
    );
    expect(report.findings).toEqual([]);
    expect(report.ignored[0]?.ignoredBy).toBe('config:contracts.ignoreEdges');
  });
});

describe('what stops the check before it starts', () => {
  const boundary = (params?: string[], body?: string) =>
    graphOf({
      nodes: [
        node('http_out:caller#1', 'http_out', 'caller'),
        node('entry:api:http:POST:/orders', 'entry', 'api', { kind: 'http' }),
        node('api#Controller.create', 'method', 'api'),
      ],
      edges: [
        edge('http_out:caller#1', 'http_calls', 'entry:api:http:POST:/orders', {
          ...(params === undefined ? {} : { params }),
        }),
        edge('entry:api:http:POST:/orders', 'handles', 'api#Controller.create', {
          ...(body === undefined ? {} : { meta: { body } }),
        }),
      ],
      types: registry,
    });

  const reasonOf = (graph: ReturnType<typeof boundary>): string[] =>
    checkContracts(graph, { generatedAt: FIXED })
      .unchecked.filter((row) => row.direction === 'request')
      .map((row) => row.reason);

  it('says so when the sender declares no shape', () => {
    expect(reasonOf(boundary(undefined, 'type:api#Body'))).toEqual(['no-type-on-sender']);
  });

  it('says so when the receiver declares no shape', () => {
    expect(reasonOf(boundary(['type:caller#Body']))).toEqual(['no-type-on-receiver']);
  });

  it('says so when the body was already turned into text', () => {
    expect(reasonOf(boundary(['string'], 'type:api#Body'))).toEqual(['body-already-serialised']);
  });

  it('says so when a referenced type is not in the registry', () => {
    expect(reasonOf(boundary(['type:caller#Gone'], 'type:api#Body'))).toEqual(['type-missing']);
  });

  it('says so when a type came from a package and was not read', () => {
    const graph = boundary(['type:pkg#Thing'], 'type:api#Body');
    graph.types['type:pkg#Thing'] = {
      name: 'Thing',
      kind: 'external',
      declaredIn: 'pkg',
      structuralHash: 'x',
    };
    expect(reasonOf(graph)).toEqual(['type-kind-unsupported']);
  });

  it('says so when two handlers declare the same route', () => {
    const graph = boundary(['type:caller#Body'], 'type:api#Body');
    graph.nodes.push(node('api#Other.create', 'method', 'api'));
    graph.edges.push(
      edge('entry:api:http:POST:/orders', 'handles', 'api#Other.create', {
        meta: { body: 'type:api#Body' },
      }),
    );
    expect(reasonOf(graph)).toEqual(['ambiguous-handler']);
  });

  it('gives every one of them a sentence and something to do about it', () => {
    for (const row of checkContracts(boundary(), { generatedAt: FIXED }).unchecked) {
      expect(row.message.length).toBeGreaterThan(0);
      expect(row.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('a message on a channel', () => {
  const channel = (): ReturnType<typeof graphOf> =>
    graphOf({
      nodes: [
        node('producer:api#1', 'producer', 'api'),
        node('channel:order.created', 'channel', 'api'),
        node('consumer:billing#1', 'consumer', 'billing', {
          meta: { entryId: 'entry:billing:event:order.created' },
        }),
        node('billing#Consumer.on', 'method', 'billing'),
        node('entry:billing:event:order.created', 'entry', 'billing', { kind: 'event' }),
      ],
      edges: [
        edge('producer:api#1', 'emits', 'channel:order.created', {
          params: ['type:caller#Body'],
        }),
        edge('channel:order.created', 'consumes', 'consumer:billing#1'),
        edge('consumer:billing#1', 'handles', 'billing#Consumer.on'),
        edge('entry:billing:event:order.created', 'handles', 'billing#Consumer.on', {
          params: ['type:api#Body'],
        }),
      ],
      types: registry,
    });

  it('is a contract between the publisher and the handler, with the channel in between', () => {
    const report = checkContracts(channel(), { generatedAt: FIXED });
    const [row] = report.edges;
    expect(row?.direction).toBe('payload');
    expect(row?.edgeKey).toBe('producer:api#1|emits|consumer:billing#1');
    expect(row?.sender.service).toBe('api');
    expect(row?.receiver.service).toBe('billing');
    expect(report.findings.map((finding) => finding.field)).toEqual(['channel']);
  });

  it('says so when nothing handles what is published', () => {
    const graph = channel();
    graph.edges = graph.edges.filter((row) => row.type !== 'consumes');
    expect(checkContracts(graph).unchecked[0]?.reason).toBe('channel-without-consumer');
  });

  it('says so when nothing publishes what is handled', () => {
    const graph = channel();
    graph.edges = graph.edges.filter((row) => row.type !== 'emits');
    expect(checkContracts(graph).unchecked[0]?.reason).toBe('channel-without-producer');
  });
});

describe('the two short-circuits', () => {
  const pair = (sent: string, expected: string, types: TypeRegistry = registry) =>
    checkContracts(
      graphOf({
        nodes: [
          node('http_out:caller#1', 'http_out', 'caller'),
          node('entry:api:http:POST:/orders', 'entry', 'api', { kind: 'http' }),
          node('api#Controller.create', 'method', 'api'),
        ],
        edges: [
          edge('http_out:caller#1', 'http_calls', 'entry:api:http:POST:/orders', { params: [sent] }),
          edge('entry:api:http:POST:/orders', 'handles', 'api#Controller.create', {
            meta: { body: expected },
          }),
        ],
        types,
      }),
      { generatedAt: FIXED },
    ).edges.find((row) => row.direction === 'request');

  it('calls one declaration imported by both ends shared', () => {
    const types = {
      'type:@fx/wire#Money': object('Money', [field('amount', 'number')], {}, {
        sharedPackage: '@fx/wire',
      }),
    };
    expect(pair('type:@fx/wire#Money', 'type:@fx/wire#Money', types)?.status).toBe('shared');
  });

  it('calls two declarations of one shape identical, and walks no field', () => {
    const types = {
      'type:caller#Same': object('Same', [field('id', 'string')]),
      'type:api#Same': object('Same', [field('id', 'string')]),
    };
    const found = pair('type:caller#Same', 'type:api#Same', types);
    expect(found?.status).toBe('identical');
    expect(found?.findings).toEqual([]);
  });

  it('reports a shared package the repositories do not hold the same copy of', () => {
    const types = {
      'type:@fx/wire#Money': {
        ...object('Money', [field('amount', 'number')]),
        meta: {
          sharedPackage: '@fx/wire',
          versions: [
            { repo: 'caller', structuralHash: 'aaa' },
            { repo: 'api', structuralHash: 'bbb' },
          ],
        },
      },
    };
    const found = pair('type:@fx/wire#Money', 'type:@fx/wire#Money', types);
    expect(found?.status).toBe('hash_differs');
    expect(found?.findings[0]?.message).toContain('do not hold the same copy');
  });
});

describe('the report itself', () => {
  it('says the same thing whichever order the edges arrive in', () => {
    const forward = request();
    const shuffled = checkContracts(
      graphOf({
        nodes: [
          node('api#Controller.create', 'method', 'api'),
          node('entry:api:http:POST:/orders', 'entry', 'api', { kind: 'http' }),
          node('http_out:caller#1', 'http_out', 'caller'),
          node('caller#Client.create', 'method', 'caller'),
        ],
        edges: [
          edge('entry:api:http:POST:/orders', 'handles', 'api#Controller.create', {
            params: ['type:api#Body'],
            returns: 'type:api#Answer',
            meta: { body: 'type:api#Body' },
          }),
          edge('http_out:caller#1', 'http_calls', 'entry:api:http:POST:/orders', {
            params: ['type:caller#Body'],
            returns: 'type:caller#Answer',
          }),
          edge('caller#Client.create', 'calls', 'http_out:caller#1'),
        ],
        types: registry,
      }),
      { generatedAt: FIXED },
    );
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(forward));
  });

  it('leaves no boundary in neither list', () => {
    const report = request();
    expect(report.edges.length + report.unchecked.length).toBe(2);
  });

  it('counts what it says', () => {
    const report = request();
    expect(report.summary.errors).toBe(2);
    expect(report.summary.edges).toBe(report.edges.length);
    expect(bySeverity(report, 'warning')).toHaveLength(2);
    expect(bySeverity(report, 'error')).toHaveLength(2);
  });
});
