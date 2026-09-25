import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuralHash, type GraphNode, type TypeEntry, type TypeRegistry } from '@flowatlas/core';
import { checkContracts } from '@flowatlas/contracts';
import { describe, expect, it } from 'vitest';

/**
 * What a new descriptor is worth downstream, asked of the thing that asks it.
 *
 * `stripImpact` in `@flowatlas/contracts` answers what a field a validation
 * pipe strips off a request body actually costs, and it answers `stored` only
 * when the handler reaches a write that names a document declaring that field.
 * Before P18 a repository whose data layer was mongoose reached no write the
 * graph could see, so every stripped field on it degraded to `unknown` — a
 * whole service's worth of rows that said nothing.
 *
 * The write node and the document below are read out of the `nest-mongoose`
 * fixture's own snapshot rather than written here, so what is being checked is
 * what the descriptor actually emits. A test that hand-wrote the node would
 * pass whatever the descriptor did.
 */
const fixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'fixtures',
      'nest-mongoose',
      'expected.graph.json',
    ),
    'utf8',
  ),
) as { nodes: GraphNode[]; types: TypeRegistry };

const write = fixture.nodes.find(
  (node) => node.type === 'db_query' && node.meta?.['op'] === 'write',
);
const document = fixture.types['type:nest-mongoose#OrderDocument'];

/**
 * An object shape, optionally decorated.
 *
 * A pipe is only read as whitelisting when the type it validates carries at
 * least one validation decorator, so the receiver's fields are declared with
 * one. Without it the strip is not a strip and there is no finding to ask an
 * impact of.
 */
const object = (name: string, fields: string[], validated = false): TypeEntry => {
  const entry: TypeEntry = {
    name,
    kind: 'object',
    declaredIn: `caller#${name}.ts`,
    structuralHash: '',
    fields: fields.map((field) => ({
      name: field,
      type: 'string',
      optional: false,
      ...(validated ? { meta: { validators: ['IsString'] } } : {}),
    })),
  };
  return { ...entry, structuralHash: structuralHash(entry, {}) };
};

/**
 * One route: a caller posting an order, a handler behind a whitelisting pipe
 * whose body type declares less than the caller sends, and the write the
 * fixture recorded.
 */
const report = (reached: boolean) => {
  const types: TypeRegistry = {
    ...fixture.types,
    'type:caller#Order': object('Order', ['id', 'userId', 'total', 'note', 'couponCode']),
    'type:nest-mongoose#CreateOrderDto': object('CreateOrderDto', ['id', 'userId', 'total'], true),
  };
  const handler = 'nest-mongoose#OrdersController.create';
  const entry = 'entry:nest-mongoose:http:POST:/orders';
  return checkContracts(
    {
      schemaVersion: 3,
      builtAt: '2026-01-01T00:00:00.000Z',
      services: [],
      nodes: [
        { id: 'caller#Client.create', type: 'method', label: 'create', repo: 'caller' },
        { id: 'http_out:caller#1', type: 'http_out', label: 'POST /orders', repo: 'caller' },
        { id: entry, type: 'entry', label: 'POST /orders', repo: 'nest-mongoose', kind: 'http' },
        { id: handler, type: 'method', label: 'create', repo: 'nest-mongoose' },
        {
          id: 'nest-mongoose#main.ts:ValidationPipe(x)',
          type: 'provider',
          label: 'ValidationPipe(x)',
          repo: 'nest-mongoose',
          meta: { factoryArgs: [{ whitelist: true }] },
        },
        ...(reached ? [write!] : []),
      ],
      edges: [
        {
          from: 'caller#Client.create',
          to: 'http_out:caller#1',
          type: 'calls',
          confidence: 'static',
        },
        {
          from: 'http_out:caller#1',
          to: entry,
          type: 'http_calls',
          confidence: 'static',
          params: ['type:caller#Order'],
        },
        {
          from: entry,
          to: handler,
          type: 'handles',
          confidence: 'static',
          params: ['type:nest-mongoose#CreateOrderDto'],
          meta: { body: 'type:nest-mongoose#CreateOrderDto' },
        },
        {
          from: entry,
          to: 'nest-mongoose#main.ts:ValidationPipe(x)',
          type: 'guarded_by',
          confidence: 'static',
          meta: { layer: 'pipe', scope: 'global' },
        },
        ...(reached
          ? [{ from: handler, to: write!.id, type: 'calls' as const, confidence: 'static' as const }]
          : []),
      ],
      types,
      unresolved: [],
    },
    { generatedAt: '2026-01-01T00:00:00.000Z' },
  );
};

const impactOf = (field: string, reached: boolean): string | undefined =>
  report(reached).findings.find(
    (finding) => finding.rule === 'whitelist-strip' && finding.field === field,
  )?.impact;

describe('what a write through a new descriptor is worth to the strip check', () => {
  it('records a write the fixture can be asked about at all', () => {
    expect(write?.meta?.['entityTypeId']).toBe('type:nest-mongoose#OrderDocument');
    expect(document?.fields?.map((each) => each.name)).toContain('note');
  });

  it('says a stripped field is stored when the mongoose write declares it', () => {
    expect(impactOf('note', true)).toBe('stored');
  });

  it('still says nothing about a field no written document declares', () => {
    expect(impactOf('couponCode', true)).toBe('unknown');
  });

  it('is the write that makes the difference, not the route', () => {
    // The same route without the write reaches nothing stored, and every
    // stripped field on it costs nothing — which is the answer a repository
    // with an unrecognised data layer used to get for writes as well.
    expect(impactOf('note', false)).toBe('none');
  });
});
