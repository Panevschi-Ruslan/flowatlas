import { describe, expect, it } from 'vitest';
import { bookshop, SERVICES } from './__fixtures__/bookshop.js';
import { exportBackstage, type BackstageEntity } from './backstage.js';
import { catalogProblems } from './checks.js';
import { exportModelOf } from './joins.js';
import { yamlScalar } from './yaml.js';

const entity = (entities: readonly BackstageEntity[], kind: string, name: string): BackstageEntity => {
  const found = entities.find((each) => each.kind === kind && each.metadata.name === name);
  if (found === undefined) throw new Error(`no ${kind} ${name}`);
  return found;
};

describe('exportBackstage (P119)', () => {
  const run = exportBackstage(bookshop(), { services: SERVICES, project: 'bookshop' });

  it('writes one Component per service, typed by what it is, with what the catalogue gives and unknown for the rest', () => {
    expect(entity(run.entities, 'Component', 'web').spec).toMatchObject({ type: 'website', lifecycle: 'production', owner: 'team-storefront', system: 'bookshop' });
    expect(entity(run.entities, 'Component', 'jobs').spec).toMatchObject({ type: 'function', lifecycle: 'unknown', owner: 'unknown' });
    expect(entity(run.entities, 'Component', 'jobs').spec['system']).toBeUndefined();
    const orders = entity(run.entities, 'Component', 'orders');
    expect(orders.metadata.description).toBe('Takes orders.');
    expect(entity(run.entities, 'Component', 'gateway').metadata.annotations).toEqual({
      'backstage.io/source-location': 'url:https://example.com/bookshop/gateway',
      'flowatlas/graph-id': 'repo:gateway',
    });
    expect(orders.metadata.annotations?.['backstage.io/source-location']).toBeUndefined();
    expect(run.summary.unset.owner).toEqual(['Sales Ledger', 'billing', 'jobs']);
    expect(run.summary.unset.lifecycle).toEqual(['Sales Ledger', 'billing', 'gateway', 'jobs']);
  });

  it('normalises a name a catalogue cannot hold, keeping the original as the title', () => {
    const ledger = entity(run.entities, 'Component', 'sales-ledger');
    expect(ledger.metadata.title).toBe('Sales Ledger');
    expect(run.summary.renamed).toContainEqual({ kind: 'Component', from: 'Sales Ledger', to: 'sales-ledger' });
    // Neither routes nor channels: a Component only.
    expect(ledger.spec['providesApis']).toBeUndefined();
  });

  it('writes one API per service and kind, pointing at a document when there is exactly one, inline otherwise', () => {
    const apis = run.entities.filter((each) => each.kind === 'API').map((each) => each.metadata.name);
    expect(apis.sort()).toEqual(['billing-openapi', 'gateway-openapi', 'orders-asyncapi', 'orders-openapi']);
    const inline = entity(run.entities, 'API', 'orders-openapi').spec['definition'] as string;
    expect(inline).toContain('openapi: 3.1.0');
    expect(inline).toContain('/orders/{param}:');
    expect(inline).toContain('operationId: GET /orders/:param');
    const channels = entity(run.entities, 'API', 'orders-asyncapi').spec['definition'] as string;
    expect(channels).toContain('address: order.created');
    expect(run.summary.inline).toEqual(['billing-openapi', 'gateway-openapi', 'orders-asyncapi', 'orders-openapi']);

    const documented = exportBackstage(bookshop(), {
      services: SERVICES,
      documents: [
        { service: 'orders', kind: 'openapi', file: 'orders.openapi.yaml', text: 'openapi: 3.1.0\n' },
        { service: 'orders', kind: 'asyncapi', file: 'orders.asyncapi.yaml', text: 'asyncapi: 3.0.0\n' },
        { service: 'billing', kind: 'asyncapi', file: 'billing.asyncapi.yaml', text: 'asyncapi: 3.0.0\n' },
      ],
    });
    expect(entity(documented.entities, 'API', 'orders-openapi').spec['definition']).toEqual({ $text: './orders.openapi.yaml' });
    // The document sits beside the entities; billing publishes nothing, so its AsyncAPI document is not an API of the catalogue.
    expect(documented.files.map((file) => file.path)).toContain('orders.openapi.yaml');
    expect(documented.files.map((file) => file.path)).not.toContain('billing.asyncapi.yaml');
    const location = entity(documented.entities, 'Location', 'flowatlas-project');
    expect(location.spec['targets']).not.toContain('./orders.openapi.yaml');
  });

  it('consumes only what a join reaches: the browser the gateway, the gateway orders, billing the publisher of what it takes', () => {
    expect(entity(run.entities, 'Component', 'web').spec['consumesApis']).toEqual(['gateway-openapi']);
    expect(entity(run.entities, 'Component', 'gateway').spec['consumesApis']).toEqual(['orders-openapi']);
    expect(entity(run.entities, 'Component', 'billing').spec['consumesApis']).toEqual(['orders-asyncapi']);
    expect(entity(run.entities, 'Component', 'orders').spec['providesApis']).toEqual(['orders-asyncapi', 'orders-openapi']);
    expect(run.summary.channelsWithoutPublisher).toEqual([{ channel: 'invoice.requested', consumers: ['billing'] }]);
  });

  it('depends on the tables queried, the hosts called and the functions started; a table two services write is one resource owned by the first', () => {
    expect(entity(run.entities, 'Component', 'billing').spec['dependsOn']).toEqual(['component:jobs', 'resource:invoices', 'resource:orders']);
    expect(entity(run.entities, 'Component', 'gateway').spec['dependsOn']).toEqual(['resource:pay.example.com']);
    const table = entity(run.entities, 'Resource', 'orders');
    expect(table.spec).toEqual({ type: 'database', owner: 'unknown' });
    expect(table.metadata.annotations).toEqual({
      'flowatlas/graph-id': 'table:billing#orders, table:orders#orders',
      'flowatlas/read-by': 'orders',
      'flowatlas/written-by': 'billing, orders',
    });
    expect(run.summary.sharedTables).toEqual([{ table: 'orders', writers: ['billing', 'orders'], owner: 'billing' }]);
    expect(entity(run.entities, 'Resource', 'pay.example.com').spec).toEqual({ type: 'external-api', owner: 'unknown' });
  });

  it('draws a heuristic join only when asked, and names it on the entity that holds it', () => {
    expect(run.summary.heuristic).toEqual({ drawn: 0, leftOut: 2 });
    const asked = exportBackstage(bookshop(), { services: SERVICES, includeHeuristic: true });
    const web = entity(asked.entities, 'Component', 'web');
    expect(web.spec['consumesApis']).toEqual(['gateway-openapi', 'orders-openapi']);
    expect(web.metadata.annotations?.['flowatlas/heuristic-relations']).toBe('api:orders-openapi');
    expect(entity(asked.entities, 'Component', 'gateway').spec['consumesApis']).toEqual(['orders-asyncapi', 'orders-openapi']);
    expect(asked.summary.heuristic).toEqual({ drawn: 2, leftOut: 0 });
  });

  it('marks a resource only a heuristic join reaches', () => {
    const graph = bookshop();
    const guessed = {
      nodes: [...graph.nodes, { id: 'db_query:orders#f.ts:9:1', type: 'db_query' as const, label: 'read audit', repo: 'orders', meta: { op: 'read' } }, { id: 'table:orders#audit', type: 'table' as const, label: 'audit', repo: 'orders' }],
      edges: [...graph.edges, { from: 'db_query:orders#f.ts:9:1', to: 'table:orders#audit', type: 'queries' as const, confidence: 'heuristic' as const }],
    };
    expect(exportBackstage(guessed, { services: SERVICES }).entities.some((each) => each.metadata.name === 'audit')).toBe(false);
    const asked = exportBackstage(guessed, { services: SERVICES, includeHeuristic: true });
    expect(entity(asked.entities, 'Resource', 'audit').metadata.annotations?.['flowatlas/confidence']).toBe('heuristic');
    expect(entity(asked.entities, 'Component', 'orders').metadata.annotations?.['flowatlas/heuristic-relations']).toBe('resource:audit');
  });

  it('writes no relation without a join in the graph (I3)', () => {
    const model = exportModelOf(bookshop(), SERVICES);
    for (const each of run.entities.filter((item) => item.kind === 'Component')) {
      const service = SERVICES.find((item) => item.name === each.metadata.title || item.name === each.metadata.name)!.name;
      const joins = model.joins.filter((join) => join.from === service);
      for (const ref of (each.spec['consumesApis'] as string[] | undefined) ?? []) {
        expect(joins.some((join) => (join.kind === 'http' && ref === `${join.to.service}-openapi`) || (join.kind === 'consume' && ref.endsWith('-asyncapi'))), `${service} ${ref}`).toBe(true);
      }
      for (const ref of (each.spec['dependsOn'] as string[] | undefined) ?? []) {
        expect(joins.some((join) => ref === `resource:${join.to.label}` || ref === `component:${join.to.service}`), `${service} ${ref}`).toBe(true);
      }
      for (const join of joins) expect(join.edges.length).toBeGreaterThan(0);
    }
  });

  it('writes the same bytes whatever order the graph comes in, every entity valid', () => {
    const graph = bookshop();
    const shuffled = { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
    expect(exportBackstage(shuffled, { services: [...SERVICES].reverse(), project: 'bookshop' }).files).toEqual(run.files);
    expect(catalogProblems(run.entities)).toEqual([]);
    expect(run.files.map((file) => file.path)).toEqual([
      'billing.yaml',
      'catalog-locations.yaml',
      'gateway.yaml',
      'jobs.yaml',
      'orders.yaml',
      'resources.yaml',
      'sales-ledger.yaml',
      'web.yaml',
    ]);
    expect(entity(run.entities, 'Location', 'flowatlas-bookshop').spec['targets']).toEqual([
      './billing.yaml',
      './gateway.yaml',
      './jobs.yaml',
      './orders.yaml',
      './resources.yaml',
      './sales-ledger.yaml',
      './web.yaml',
    ]);
  });

  it('writes only the services asked for, and the resources they depend on', () => {
    const one = exportBackstage(bookshop(), { services: SERVICES, only: ['gateway'] });
    expect(one.files.map((file) => file.path)).toEqual(['catalog-locations.yaml', 'gateway.yaml', 'resources.yaml']);
    expect(one.entities.filter((each) => each.kind === 'Resource').map((each) => each.metadata.name)).toEqual(['pay.example.com']);
  });
});

describe('yamlScalar', () => {
  it('writes a word bare and anything a reader could take for something else quoted', () => {
    expect(yamlScalar('orders-openapi')).toBe('orders-openapi');
    expect(yamlScalar('resource:orders')).toBe('resource:orders');
    expect(yamlScalar('GET /orders/:param')).toBe('GET /orders/:param');
    expect(yamlScalar('table:orders#orders')).toBe('"table:orders#orders"');
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('yes')).toBe('"yes"');
    expect(yamlScalar('3.1')).toBe('"3.1"');
    expect(yamlScalar('')).toBe('""');
    expect(yamlScalar('say "hi"')).toBe('"say \\"hi\\""');
  });
});
