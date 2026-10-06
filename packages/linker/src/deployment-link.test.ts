import { SCHEMA_VERSION, UNREAD_SPAN, parseConfig, type GraphEdge, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const config = parseConfig({
  services: [
    { name: 'platform', repo: './platform', type: 'functions' },
    { name: 'loans', repo: './loans', type: 'functions' },
  ],
});

const graph = (repo: string, nodes: GraphNode[], edges: GraphEdge[] = []): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes,
  edges,
  types: {},
  unresolved: [],
});

const STATE = 'state:s3:bucket=b,key=platform.tfstate#v1_resource_id';

const platformRepo = (roots: unknown[]): GraphNode => ({
  id: 'repo:platform',
  type: 'repo',
  label: 'platform',
  repo: 'platform',
  meta: { apiRoots: roots },
});

const rooted: GraphNode = {
  id: `entry:loans:http:POST:/${UNREAD_SPAN}/loans`,
  type: 'entry',
  kind: 'http',
  label: `POST /${UNREAD_SPAN}/loans`,
  repo: 'loans',
  file: 'infra/api.tf',
  line: 8,
  meta: { method: 'POST', path: `/${UNREAD_SPAN}/loans`, root: STATE, below: '/loans' },
};

const handler: GraphNode = { id: 'loans#index.ts:createLoan', type: 'function', label: 'createLoan', repo: 'loans' };
const handles: GraphEdge = { from: rooted.id, to: handler.id, type: 'handles', confidence: 'static' };

describe('a route hanging from another repository', () => {
  it('takes the full path of the point it hangs from, with its edges', () => {
    const { project } = linkGraphs(
      [graph('platform', [platformRepo([{ key: STATE, path: '/v1', api: 'library' }])]), graph('loans', [rooted, handler], [handles])],
      config,
      { builtAt: FIXED },
    );
    const route = project.nodes.find((node) => node.type === 'entry');
    expect(route).toMatchObject({
      id: 'entry:loans:http:POST:/v1/loans',
      label: 'POST /v1/loans',
      meta: { path: '/v1/loans', rootedIn: 'platform', rootPath: '/v1', api: 'library' },
    });
    expect(project.edges).toEqual([{ ...handles, from: 'entry:loans:http:POST:/v1/loans' }]);
    expect(project.unresolved).toEqual([]);
  });

  it('keeps the route unread and says which repository is missing when nothing publishes the point', () => {
    const { project } = linkGraphs([graph('loans', [rooted, handler], [handles])], config, { builtAt: FIXED });
    expect(project.nodes.find((node) => node.type === 'entry')?.id).toBe(rooted.id);
    expect(project.unresolved).toEqual([
      expect.objectContaining({ reason: 'route-root-not-found', service: 'loans', file: 'infra/api.tf', line: 8, symbol: rooted.id }),
    ]);
  });

  it('chooses neither of two places for one point', () => {
    const { project } = linkGraphs(
      [
        graph('platform', [platformRepo([{ key: STATE, path: '/v1' }, { key: STATE, path: '/v2' }])]),
        graph('loans', [rooted, handler], [handles]),
      ],
      config,
      { builtAt: FIXED },
    );
    expect(project.nodes.find((node) => node.type === 'entry')?.id).toBe(rooted.id);
    expect(project.unresolved.map((row) => row.reason)).toEqual(['route-root-ambiguous']);
  });
});

describe('a route answered by a function deployed elsewhere', () => {
  const route: GraphNode = {
    id: 'entry:platform:http:GET:/v1/borrowers/:param/loans',
    type: 'entry',
    kind: 'http',
    label: 'GET /v1/borrowers/:param/loans',
    repo: 'platform',
    meta: { method: 'GET', path: '/v1/borrowers/:param/loans', invokes: 'library-dev-list-loans' },
  };
  const fn: GraphNode = {
    id: 'entry:loans:invoke:library-dev-list-loans',
    type: 'entry',
    kind: 'invoke',
    label: 'library-dev-list-loans',
    repo: 'loans',
    meta: { key: 'library-dev-list-loans', name: 'library-dev-list-loans' },
  };
  const body: GraphNode = { id: 'loans#list.ts:handler', type: 'function', label: 'handler', repo: 'loans' };
  const middleware: GraphNode = { id: 'loans#list.ts:logged()', type: 'middleware', label: 'logged()', repo: 'loans' };
  const fnEdges: GraphEdge[] = [
    { from: fn.id, to: body.id, type: 'handles', confidence: 'static' },
    { from: fn.id, to: middleware.id, type: 'guarded_by', confidence: 'static', meta: { order: 0 } },
  ];

  it('takes the handler, and what stands in front of it, of the function of that name', () => {
    const { project } = linkGraphs([graph('platform', [route]), graph('loans', [fn, body, middleware], fnEdges)], config, {
      builtAt: FIXED,
    });
    const joined = project.edges.filter((edge) => edge.from === route.id);
    expect(joined).toEqual([
      expect.objectContaining({ to: body.id, type: 'handles', confidence: 'static' }),
      expect.objectContaining({ to: middleware.id, type: 'guarded_by', meta: expect.objectContaining({ via: 'function-name', function: fn.id }) }),
    ]);
    expect(project.nodes.find((node) => node.id === route.id)?.meta).toMatchObject({ functionService: 'loans' });
  });

  it('draws nothing to a name nobody deploys', () => {
    const { project } = linkGraphs([graph('platform', [route])], config, { builtAt: FIXED });
    expect(project.edges).toEqual([]);
    expect(project.unresolved.map((row) => row.reason)).toEqual(['invoke-target-not-found']);
  });
});
