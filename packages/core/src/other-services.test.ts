import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';
import type { RepoGraph } from './model/graph.js';
import type { GraphNode } from './model/nodes.js';
import { otherServiceDirs, withoutOtherServicesWaysIn } from './other-services.js';
import { forgetWorkspaces } from './workspace.js';

const temporary: string[] = [];

afterEach(() => {
  forgetWorkspaces();
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

const writePackage = (dir: string, pkg: Record<string, unknown>): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
};

/**
 * A workspace of an API, two front ends and three libraries: the back office
 * declares the API's package for its types and a formatting library of its
 * own; the API declares a catalog library; the storefront declares nothing.
 */
const workspace = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-other-services-')));
  temporary.push(root);
  writePackage(root, { name: 'root', private: true, workspaces: ['apps/*', 'packages/*'] });
  writePackage(join(root, 'apps/api'), { name: '@shop/api', dependencies: { '@shop/catalog': 'workspace:^' } });
  writePackage(join(root, 'apps/backoffice'), {
    name: '@shop/backoffice',
    dependencies: { '@shop/api': 'workspace:^', '@shop/formatting': 'workspace:^' },
  });
  writePackage(join(root, 'apps/storefront'), { name: '@shop/storefront' });
  writePackage(join(root, 'packages/catalog'), { name: '@shop/catalog' });
  writePackage(join(root, 'packages/formatting'), { name: '@shop/formatting' });
  const config = parseConfig({
    services: [
      { name: 'api', repo: './apps/api', type: 'nestjs' },
      { name: 'backoffice', repo: './apps/backoffice', type: 'react' },
      { name: 'storefront', repo: './apps/storefront', type: 'react' },
      { name: 'billing', document: { kind: 'openapi', path: './apps/billing/openapi.yaml' } },
    ],
  });
  const of = (name: string) => ({
    rootDir: join(root, 'apps', name),
    config,
    configDir: root,
    service: config.services.find((service) => service.name === name),
  });
  return { root, of };
};

const node = (id: string, type: GraphNode['type'], file: string): GraphNode =>
  ({ id, type, label: id, repo: 'backoffice', file }) as GraphNode;

const graphOf = (nodes: GraphNode[], edges: RepoGraph['edges']): RepoGraph => ({
  schemaVersion: 1,
  repo: 'backoffice',
  generatedAt: '',
  nodes,
  edges,
  types: {},
  unresolved: [],
});

describe('otherServiceDirs', () => {
  it('names the other services and the libraries reached only through one of them', () => {
    const { root, of } = workspace();
    expect(otherServiceDirs(of('backoffice')).sort()).toEqual(
      [join(root, 'apps/api'), join(root, 'apps/storefront'), join(root, 'packages/catalog')].sort(),
    );
  });

  it('keeps a library a service declares itself, and ignores a service declared by a document', () => {
    const { root, of } = workspace();
    const dirs = otherServiceDirs(of('backoffice'));
    expect(dirs).not.toContain(join(root, 'packages/formatting'));
    expect(dirs).not.toContain(join(root, 'apps/billing'));
    // The API's own library is the API's: nothing names it as somebody else's.
    expect(otherServiceDirs(of('api'))).not.toContain(join(root, 'packages/catalog'));
  });

  it('is nothing without a configuration to say which services there are', () => {
    const { root } = workspace();
    expect(otherServiceDirs({ rootDir: join(root, 'apps/backoffice') })).toEqual([]);
  });

  it('never names a directory the service is inside of', () => {
    const { root } = workspace();
    const config = parseConfig({
      services: [
        { name: 'whole', repo: '.', type: 'nestjs' },
        { name: 'api', repo: './apps/api', type: 'nestjs' },
      ],
    });
    const dirs = otherServiceDirs({ rootDir: join(root, 'apps/api'), config, configDir: root, service: config.services[1] });
    expect(dirs).toEqual([]);
  });
});

describe('withoutOtherServicesWaysIn', () => {
  it('leaves the ways in written in another service to it, with their edges, and keeps its code', () => {
    const { of } = workspace();
    const graph = graphOf(
      [
        node('entry:backoffice:graphql:Query.orders', 'entry', '../api/src/orders.resolver.ts'),
        node('entry:backoffice:http:GET:/catalog/:param', 'entry', '../../packages/catalog/src/index.ts'),
        node('consumer:backoffice:orders', 'consumer', '../api/src/orders.consumer.ts'),
        node('backoffice#../api/src/orders.resolver.ts:OrdersResolver.orders', 'method', '../api/src/orders.resolver.ts'),
        node('backoffice#../api/src/order-number.ts:orderNumber', 'function', '../api/src/order-number.ts'),
        node('backoffice#../../packages/formatting/src/index.ts:statusLabel', 'function', '../../packages/formatting/src/index.ts'),
        node('entry:backoffice:http:GET:/preview', 'entry', 'src/preview.ts'),
      ],
      [
        { from: 'entry:backoffice:graphql:Query.orders', to: 'backoffice#../api/src/orders.resolver.ts:OrdersResolver.orders', type: 'handles', confidence: 'static' },
        { from: 'entry:backoffice:http:GET:/preview', to: 'backoffice#../api/src/order-number.ts:orderNumber', type: 'handles', confidence: 'static' },
      ],
    );
    const kept = withoutOtherServicesWaysIn(graph, of('backoffice'));
    expect(kept.nodes.map((each) => each.id)).toEqual([
      'backoffice#../api/src/orders.resolver.ts:OrdersResolver.orders',
      'backoffice#../api/src/order-number.ts:orderNumber',
      'backoffice#../../packages/formatting/src/index.ts:statusLabel',
      'entry:backoffice:http:GET:/preview',
    ]);
    expect(kept.edges).toEqual([graph.edges[1]]);
  });

  it('hands the graph back untouched when nothing in it is another service’s', () => {
    const { of } = workspace();
    const graph = graphOf([node('entry:api:http:GET:/health', 'entry', 'src/health.controller.ts')], []);
    expect(withoutOtherServicesWaysIn(graph, of('api'))).toBe(graph);
  });
});
