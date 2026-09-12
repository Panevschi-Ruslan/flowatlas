import { describe, expect, it } from 'vitest';
import { SchemaVersionMismatchError } from '../errors.js';
import type { ProjectGraph, RepoGraph } from '../model/graph.js';
import {
  graphEdgeSchema,
  graphNodeSchema,
  parseRepoGraph,
  projectGraphSchema,
  repoGraphSchema,
  typeRegistrySchema,
} from './zod.js';
import { SCHEMA_VERSION } from './version.js';

const emptyGraph = (over: Record<string, unknown> = {}): unknown => ({
  schemaVersion: SCHEMA_VERSION,
  repo: 'orders',
  generatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [],
  edges: [],
  types: {},
  unresolved: [],
  ...over,
});

describe('type registry', () => {
  it('accepts the registry example from the plan', () => {
    const types = {
      'type:orders#CreateOrderDto': {
        name: 'CreateOrderDto',
        kind: 'object',
        declaredIn: 'orders#src/dto/create-order.dto.ts',
        structuralHash: 'a3f9...',
        fields: [
          { name: 'customerId', type: 'string', optional: false },
          { name: 'items', type: 'type:orders#OrderItem[]', optional: false },
          { name: 'note', type: 'string', optional: true },
        ],
      },
    };
    expect(typeRegistrySchema.parse(types)).toEqual(types);
  });

  it('accepts enum members and generic parameters', () => {
    const types = {
      'type:orders#Status': {
        name: 'Status',
        kind: 'enum',
        declaredIn: 'orders#src/status.ts',
        structuralHash: 'h',
        members: ['NEW', 'PAID'],
      },
      'type:orders#Paginated': {
        name: 'Paginated',
        kind: 'generic',
        declaredIn: 'orders#src/paginated.ts',
        structuralHash: 'g',
        typeParams: ['T'],
      },
    };
    expect(typeRegistrySchema.parse(types)).toEqual(types);
  });
});

describe('edges', () => {
  it('accepts the edge example from the plan once confidence is present', () => {
    const edge = {
      from: 'orders#src/a.ts:A.b',
      to: 'orders#src/c.ts:C.d',
      type: 'calls',
      confidence: 'static',
      params: ['type:orders#CreateOrderDto'],
      returns: 'type:orders#Order',
    };
    expect(graphEdgeSchema.parse(edge)).toEqual(edge);
  });

  it('treats params and returns as optional', () => {
    expect(
      graphEdgeSchema.parse({ from: 'a', to: 'b', type: 'calls', confidence: 'heuristic' }),
    ).toEqual({ from: 'a', to: 'b', type: 'calls', confidence: 'heuristic' });
  });

  it('rejects an edge without confidence', () => {
    expect(() => graphEdgeSchema.parse({ from: 'a', to: 'b', type: 'calls' })).toThrow();
  });

  it('rejects an unknown edge type', () => {
    expect(() =>
      graphEdgeSchema.parse({ from: 'a', to: 'b', type: 'invokes', confidence: 'static' }),
    ).toThrow();
  });

  it('rejects an unknown confidence', () => {
    expect(() =>
      graphEdgeSchema.parse({ from: 'a', to: 'b', type: 'calls', confidence: 'probably' }),
    ).toThrow();
  });
});

describe('nodes', () => {
  it('accepts an entry node with a known kind', () => {
    const node = {
      id: 'entry:orders:http:POST:/orders',
      type: 'entry',
      label: 'POST /orders',
      repo: 'orders',
      kind: 'http',
    };
    expect(graphNodeSchema.parse(node)).toEqual(node);
  });

  it('accepts every entry kind the model declares', () => {
    for (const kind of ['http', 'bot_command', 'bot_callback', 'bot_event', 'scene_step', 'event', 'rpc', 'cron']) {
      expect(() =>
        graphNodeSchema.parse({ id: 'e', type: 'entry', label: 'e', repo: 'r', kind }),
      ).not.toThrow();
    }
  });

  it('rejects an entry node without a kind', () => {
    expect(() =>
      graphNodeSchema.parse({ id: 'e', type: 'entry', label: 'e', repo: 'orders' }),
    ).toThrow();
  });

  it('rejects an entry node with an unknown kind', () => {
    expect(() =>
      graphNodeSchema.parse({ id: 'e', type: 'entry', label: 'e', repo: 'orders', kind: 'websocket' }),
    ).toThrow();
  });

  it('leaves the kind of a non-entry node open', () => {
    expect(() =>
      graphNodeSchema.parse({
        id: 'p',
        type: 'provider',
        label: 'p',
        repo: 'orders',
        kind: 'controller',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown node type', () => {
    expect(() => graphNodeSchema.parse({ id: 'x', type: 'widget', label: 'x', repo: 'r' })).toThrow();
  });

  it('does not accept a bare type node, since types live in the registry', () => {
    expect(() => graphNodeSchema.parse({ id: 't', type: 'type', label: 't', repo: 'r' })).toThrow();
  });
});

describe('graphs', () => {
  it('accepts an empty graph', () => {
    expect(repoGraphSchema.parse(emptyGraph())).toMatchObject({ repo: 'orders' });
  });

  it('requires a repo on a repo graph, and services on a project graph', () => {
    const { repo: _repo, generatedAt: _at, ...rest } = emptyGraph() as Record<string, unknown>;
    expect(() => repoGraphSchema.parse(rest)).toThrow();
    expect(() =>
      projectGraphSchema.parse({ ...rest, builtAt: '2026-01-01T00:00:00.000Z', services: [] }),
    ).not.toThrow();
    // A project graph without the services it was built from is incomplete.
    expect(() => projectGraphSchema.parse({ ...rest, builtAt: 'x' })).toThrow();
  });

  it('rejects an unresolved row without a reason', () => {
    expect(() =>
      repoGraphSchema.parse(emptyGraph({ unresolved: [{ file: 'a.ts', line: 1 }] })),
    ).toThrow();
  });

  it('parses a graph at the current version', () => {
    expect(parseRepoGraph(emptyGraph()).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('reports the found and expected versions when they differ', () => {
    try {
      parseRepoGraph(emptyGraph({ schemaVersion: SCHEMA_VERSION + 1 }));
      expect.unreachable('parseRepoGraph should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaVersionMismatchError);
      expect((error as SchemaVersionMismatchError).found).toBe(SCHEMA_VERSION + 1);
      expect((error as SchemaVersionMismatchError).expected).toBe(SCHEMA_VERSION);
    }
  });

  it('rejects a graph with no version at all', () => {
    const { schemaVersion: _v, ...withoutVersion } = emptyGraph() as Record<string, unknown>;
    expect(() => parseRepoGraph(withoutVersion)).toThrow(SchemaVersionMismatchError);
  });
});

describe('inferred types match the hand-written model', () => {
  it('stays assignable in both directions', () => {
    const fromSchema = repoGraphSchema.parse(emptyGraph());
    const asModel: RepoGraph = fromSchema;
    const backToSchema: typeof fromSchema = asModel;
    const { generatedAt: _at, ...body } = emptyGraph() as Record<string, unknown>;
    const projectFromSchema = projectGraphSchema.parse({
      ...body,
      builtAt: '2026-01-01T00:00:00.000Z',
      services: [],
    });
    const asProject: ProjectGraph = projectFromSchema;
    expect(backToSchema.repo).toBe('orders');
    expect(asProject.nodes).toEqual([]);
  });
});
