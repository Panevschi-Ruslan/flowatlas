import { lookupOf } from '@flowatlas/contracts';
import { describe, expect, it } from 'vitest';
import { specGraph, type SpecGraphOptions } from '../document/__fixtures__/spec-graph.js';
import { writeSpecs } from '../document/specs.js';
import type { WrittenSpec } from '../document/written.js';
import { diffSpecs, specFailures } from './diff.js';
import { parseSpecDiff } from './schema.js';
import { SPEC_CHANGE_KIND_NAMES, type SpecChange } from './types.js';

const SERVICES = ['orders', 'billing', 'mailer'];

const specs = (options: SpecGraphOptions = {}): WrittenSpec[] => writeSpecs(lookupOf(specGraph(options)), SERVICES);

const said = (changes: readonly SpecChange[]): string[] => changes.map((change) => `${change.level} ${change.kind} ${change.document} ${change.operation}${change.field === null ? '' : ` ${change.field}`}`);

/** A head side edited by hand, for a change no option of the fixture makes. */
const edited = (edit: (documents: Map<string, WrittenSpec>) => void, options: SpecGraphOptions = {}): WrittenSpec[] => {
  const head = structuredClone(specs(options));
  edit(new Map(head.map((spec) => [`${spec.kind}|${spec.name}`, spec])));
  return head;
};

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const openapi = (documents: Map<string, WrittenSpec>): Doc => documents.get('openapi|orders')!.document as Doc;
const asyncapi = (documents: Map<string, WrittenSpec>, name: string): Doc => documents.get(`asyncapi|${name}`)!.document as Doc;

describe('diffSpecs (P118)', () => {
  it('finds nothing between a side and itself', () => {
    expect(diffSpecs(specs(), specs()).changes).toEqual([]);
  });

  it('reports a required request field the caller does not send as breaking, with the caller', () => {
    const report = diffSpecs(specs(), specs({ requiredChannel: true }));
    expect(said(report.changes)).toEqual(['error request-property-added-required orders POST /orders body.channel']);
    const [change] = report.changes;
    expect(change!.callers).toEqual([{ id: 'http_out:gateway#src/orders.client.ts:21:5', service: 'gateway', file: 'src/orders.client.ts', line: 21, confidence: 'static', via: 'http_calls' }]);
    expect(change!.place).toEqual({ side: 'base', file: 'src/orders.controller.ts', line: 10 });
    expect(change!.key).toBe('request-property-added-required|orders|POST /orders|body.channel');
    expect(parseSpecDiff(report)).toEqual(report);
  });

  it('makes a breaking change nobody calls and nobody marked public a warning saying so (D2)', () => {
    const report = diffSpecs(specs({ uncalled: true }), specs({ uncalled: true, requiredChannel: true }));
    expect(said(report.changes)).toEqual(['warning request-property-added-required orders POST /orders body.channel']);
    expect(report.changes[0]!.note).toBe('no caller in this project');
    expect(report.changes[0]!.message).toMatch(/\(no caller in this project\)$/);
    expect(report.summary).toMatchObject({ errors: 0, warnings: 1, breaking: 1, uncalled: 1 });
    expect(specFailures(report, 'error')).toEqual([]);
    expect(specFailures(report, 'warning')).toHaveLength(1);
  });

  it('keeps a breaking change on a public route an error with no caller', () => {
    const report = diffSpecs(specs(), specs({ healthQuery: true }));
    expect(said(report.changes)).toEqual(['error request-property-added-required orders GET /health query.verbose']);
    expect(report.changes[0]!.public).toBe('@flowatlas-public load balancer probes');
  });

  it('sorts every kind of the catalogue, each once', () => {
    const graphs = [
      diffSpecs(specs(), specs({ dropFindOne: true })),
      diffSpecs(specs({ dropFindOne: true }), specs()),
      diffSpecs(specs(), specs({ totalAsText: true, dropPlacedAt: true, dropConsumer: true, conflict: true, secondGuard: true })),
      diffSpecs(
        specs(),
        edited((documents) => {
          const doc = openapi(documents);
          // method-removed: `/orders` still answers GET.
          delete doc['paths']['/orders']['post'];
          documents.get('openapi|orders')!.operations = documents.get('openapi|orders')!.operations.filter((operation) => operation.key !== 'POST /orders');
          // request-property-became-required and request-property-removed on a query value.
          const parameters = doc['paths']['/orders/{id}']['get']['parameters'] as Doc[];
          parameters.find((parameter) => parameter['name'] === 'page')!['required'] = true;
          doc['paths']['/orders/{id}']['get']['parameters'] = parameters.filter((parameter) => parameter['name'] !== 'q');
          // response-status-removed: the success answer moved from 2XX to 201.
          const health = doc['paths']['/health']['get']['responses'];
          health['201'] = health['2XX'];
          delete health['2XX'];
          // response-property-became-optional.
          doc['components']['schemas']['Order']['required'] = ['total', 'shipping'];
          // description-changed on a failure status.
          doc['paths']['/orders/{id}']['get']['responses']['403']['description'] = 'ForbiddenException';
          // channel-removed, message-property-type-changed and -became-optional on what billing sends.
          const billing = asyncapi(documents, 'billing');
          billing['components']['schemas']['Receipt']['properties']['amount'] = { type: 'string' };
          billing['components']['schemas']['Receipt']['required'] = ['amount'];
          const orders = asyncapi(documents, 'orders');
          delete orders['operations']['send.order.created'];
          documents.get('asyncapi|orders')!.operations = [];
        }),
      ),
      // A body's field retyped, one added optional, one added required; an answer's field gone.
      diffSpecs(
        specs(),
        edited(
          (documents) => {
            const schemas = openapi(documents)['components']['schemas'];
            schemas['CreateOrder']['properties']['customerId'] = { type: 'number' };
            schemas['CreateOrder']['properties']['giftWrap'] = { type: 'boolean' };
            delete schemas['Order']['properties']['id'];
            schemas['Order']['required'] = ['total', 'shipping'];
          },
          { requiredChannel: true },
        ),
      ),
      // path-param-added: the route now takes a value in its path.
      diffSpecs(
        specs(),
        edited((documents) => {
          const spec = documents.get('openapi|orders')!;
          const doc = spec.document as Doc;
          doc['paths']['/health/{probe}'] = doc['paths']['/health'];
          delete doc['paths']['/health'];
          const operation = spec.operations.find((each) => each.key === 'GET /health')!;
          Object.assign(operation, { key: 'GET /health/{probe}', route: 'GET:/health/:param', pointer: ['paths', '/health/{probe}', 'get'] });
        }),
      ),
    ];
    const kinds = new Set(graphs.flatMap((report) => report.changes.map((change) => change.kind)));
    expect([...kinds].sort()).toEqual([...SPEC_CHANGE_KIND_NAMES].sort());
    expect(said(graphs[0]!.changes)).toEqual(['error endpoint-removed orders GET /orders/{id}']);
    expect(said(graphs[1]!.changes)).toEqual(['info endpoint-added orders GET /orders/{id}']);
    expect(said(graphs[2]!.changes)).toEqual([
      'error response-property-type-changed orders GET /orders/{id} response.total',
      'error response-property-type-changed orders POST /orders response.total',
      'error message-property-removed orders send order.created payload.placedAt',
      'warning channel-consumer-removed billing receive order.created',
      // Nobody calls the page of orders.
      'warning response-property-type-changed orders GET /orders response.items[].total',
      'warning security-added orders POST /orders guards',
      'warning response-status-added orders POST /orders status 409',
    ]);
    expect(said(graphs[4]!.changes)).toEqual([
      'error response-property-removed orders GET /orders/{id} response.id',
      'error request-property-added-required orders POST /orders body.channel',
      'error request-property-type-changed orders POST /orders body.customerId',
      'error response-property-removed orders POST /orders response.id',
      'warning response-property-removed orders GET /orders response.items[].id',
      'info optional-property-added orders POST /orders body.giftWrap',
    ]);
    // No caller, and public: still breaking.
    expect(said(graphs[5]!.changes)).toEqual(['error path-param-added orders GET /health']);
  });

  it('matches routes by what a request matches, so a renamed parameter is no change', () => {
    const head = edited((documents) => {
      const spec = documents.get('openapi|orders')!;
      const doc = spec.document as Doc;
      doc['paths']['/orders/{orderId}'] = doc['paths']['/orders/{id}'];
      delete doc['paths']['/orders/{id}'];
      doc['paths']['/orders/{orderId}']['get']['parameters'][0]['name'] = 'orderId';
      Object.assign(spec.operations.find((operation) => operation.key === 'GET /orders/{id}')!, { key: 'GET /orders/{orderId}', pointer: ['paths', '/orders/{orderId}', 'get'] });
    });
    expect(diffSpecs(specs(), head).changes).toEqual([]);
  });

  it('weighs a change by the callers an override gives', () => {
    const report = diffSpecs(specs(), specs({ requiredChannel: true }), { callers: () => [] });
    expect(said(report.changes)).toEqual(['warning request-property-added-required orders POST /orders body.channel']);
  });
});
