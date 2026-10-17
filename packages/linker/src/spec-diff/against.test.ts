import { lookupOf } from '@flowatlas/contracts';
import { describe, expect, it } from 'vitest';
import { specGraph } from '../document/__fixtures__/spec-graph.js';
import { writeSpecs } from '../document/specs.js';
import type { WrittenSpec } from '../document/written.js';
import { declaredSpecs, specAgainst, type CommittedDocument } from './against.js';
import { parseSpecAgainst } from './schema.js';
import type { SpecChange } from './types.js';

/**
 * A committed document against the code (P195): the document read through
 * its reader, written back in the code's normal form, and compared with the
 * code's document - the document as the base side, the code as the head.
 */
const SERVICES = ['orders', 'billing', 'mailer'];

const code = (): WrittenSpec[] => writeSpecs(lookupOf(specGraph()), SERVICES);

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The code's own document of a service and kind, as somebody would commit it, edited by hand. */
const committed = (kind: 'openapi' | 'asyncapi', service: string, edit: (document: Doc) => void = () => undefined): CommittedDocument => {
  const spec = code().find((each) => each.kind === kind && each.service === service);
  if (spec === undefined) throw new Error(`no ${kind} document for ${service}`);
  const raw = structuredClone(spec.document) as Doc;
  edit(raw);
  // A line per path, as a positioned reading of the file would give one.
  const lineAt = (path: readonly (string | number)[]): number | undefined => (path.length === 3 ? 100 + path.join('/').length : path.length === 2 ? 200 : undefined);
  return { kind, service, file: `${service}/${kind}.yaml`, raw, lineAt };
};

const said = (changes: readonly SpecChange[]): string[] => changes.map((change) => `${change.level} ${change.kind} ${change.operation}${change.field === null ? '' : ` ${change.field}`}`);

describe('a committed document against the code (P195)', () => {
  it('finds nothing between the code and the document written from it', () => {
    const report = specAgainst([committed('openapi', 'orders'), committed('asyncapi', 'orders'), committed('asyncapi', 'billing')], code());
    expect(said(report.changes)).toEqual([]);
    // Every operation declared is one the code wrote, and the admin application is not this document's.
    expect(report.documents.every((document) => document.declared === document.written && document.declared > 0)).toBe(true);
    expect(report.documents.map((document) => `${document.kind} ${document.service}`)).toEqual(['openapi orders', 'asyncapi orders', 'asyncapi billing']);
    expect(parseSpecAgainst(report)).toEqual(report);
  });

  it('compares a document of one application with the code of that application', () => {
    const admin = code().find((spec) => spec.application !== undefined);
    expect(admin).toBeDefined();
    const document: CommittedDocument = { kind: 'openapi', service: admin!.service, application: admin!.application!, file: 'admin.yaml', raw: structuredClone(admin!.document) };
    expect(said(specAgainst([document], code()).changes)).toEqual([]);
  });

  it('names a declared route the code no longer answers as an error at the document\'s line, and a route the document leaves out', () => {
    const document = committed('openapi', 'orders', (raw) => {
      raw.paths['/refunds'] = { post: { operationId: 'refund', responses: { '201': { description: 'Refunded' } } } };
      delete raw.paths['/health'];
    });
    const report = specAgainst([document], code());
    expect(said(report.changes)).toEqual(['error endpoint-removed POST /refunds', 'info endpoint-added GET /health']);
    const [removed, added] = report.changes;
    expect(removed!.place).toEqual({ side: 'base', file: 'orders/openapi.yaml', line: 100 + 'paths//refunds/post'.length });
    expect(removed!.public).toBe('declared in orders/openapi.yaml');
    expect(removed!.message).toBe('POST /refunds: the document declares this route; the code no longer answers it');
    expect(added!.place?.side).toBe('head');
    expect(added!.message).toBe('GET /health: the code answers this; the document does not say it');
  });

  it('compares the query values and failure statuses the document declares, which its reader does not keep', () => {
    const document = committed('openapi', 'orders', (raw) => {
      const operation = raw.paths['/orders'].post;
      operation.parameters = [...(operation.parameters ?? []), { name: 'dryRun', in: 'query', required: false, schema: { $ref: '#/components/parameters/Flag' } }];
      raw.components = { ...raw.components, parameters: { Flag: { type: 'boolean' } } };
      for (const [status, response] of Object.entries(operation.responses as Doc)) if (!status.startsWith('2')) delete (operation.responses as Doc)[status];
    });
    const changes = specAgainst([document], code()).changes;
    expect(said(changes)).toContainEqual('warning request-property-removed POST /orders query.dryRun');
    expect(changes.find((change) => change.field === 'query.dryRun')?.message).toBe('POST /orders: the document declares `query.dryRun`; the code does not read it');
    // Nothing about descriptions or guards: neither is compared with a document.
    expect(changes.some((change) => change.kind === 'description-changed' || change.kind === 'security-added')).toBe(false);
  });

  it('says a channel end the document promises and the code does not have', () => {
    const document = committed('asyncapi', 'orders', (raw) => {
      raw.channels['order.cancelled'] = { address: 'order.cancelled', messages: { cancelled: { payload: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } } };
      raw.operations['sendOrderCancelled'] = { action: 'send', channel: { $ref: '#/channels/order.cancelled' } };
    });
    const report = specAgainst([document], code());
    expect(said(report.changes)).toEqual(['error channel-removed send order.cancelled']);
    expect(report.changes[0]!.place).toEqual({ side: 'base', file: 'orders/asyncapi.yaml', line: 200 });
  });

  it('writes a document in the code\'s normal form, each operation placed in the file', () => {
    const [spec] = declaredSpecs(committed('openapi', 'orders'));
    expect(spec!.operations.every((operation) => operation.file === 'orders/openapi.yaml' && operation.line !== undefined && operation.callers.length === 0)).toBe(true);
  });
});
