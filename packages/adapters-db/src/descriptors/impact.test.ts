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
 * The write node and the document below are read out of a fixture's own
 * snapshot rather than written here, so what is being checked is what the
 * reader actually emits. A test that hand-wrote the node would pass whatever
 * the reader did.
 *
 * Two fixtures, because the same question has a second half. `nest-mongoose`
 * writes a `Model<OrderDocument>`, whose name carries a wrapper suffix;
 * `fn-data-layer` writes a `Repository<Order>`, whose name carries none. The
 * document used to be recorded only when there was a suffix to strip, so the
 * second of them answered `unknown` about every stripped field — the answer
 * meaning "I could not tell", on a write the reader had understood perfectly
 * well (R48).
 */
const fixtureAt = (name: string): { nodes: GraphNode[]; types: TypeRegistry } =>
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '..',
        'fixtures',
        name,
        'expected.graph.json',
      ),
      'utf8',
    ),
  ) as { nodes: GraphNode[]; types: TypeRegistry };

const writeIn = (fixture: { nodes: GraphNode[] }, table: string): GraphNode | undefined =>
  fixture.nodes.find(
    (node) =>
      node.type === 'db_query' &&
      node.meta?.['op'] === 'write' &&
      node.meta['table'] === table,
  );

const fixture = fixtureAt('nest-mongoose');
const write = writeIn(fixture, 'orders');
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
const report = (reached: boolean, about = { repo: 'nest-mongoose', write, types: fixture.types }) => {
  const { repo } = about;
  const write = about.write;
  const types: TypeRegistry = {
    ...about.types,
    'type:caller#Order': object('Order', ['id', 'userId', 'total', 'note', 'couponCode']),
    [`type:${repo}#CreateOrderDto`]: object('CreateOrderDto', ['id', 'userId', 'total'], true),
  };
  const handler = `${repo}#OrdersController.create`;
  const entry = `entry:${repo}:http:POST:/orders`;
  return checkContracts(
    {
      schemaVersion: 3,
      builtAt: '2026-01-01T00:00:00.000Z',
      services: [],
      nodes: [
        { id: 'caller#Client.create', type: 'method', label: 'create', repo: 'caller' },
        { id: 'http_out:caller#1', type: 'http_out', label: 'POST /orders', repo: 'caller' },
        { id: entry, type: 'entry', label: 'POST /orders', repo, kind: 'http' },
        { id: handler, type: 'method', label: 'create', repo },
        {
          id: `${repo}#main.ts:ValidationPipe(x)`,
          type: 'provider',
          label: 'ValidationPipe(x)',
          repo,
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
          params: [`type:${repo}#CreateOrderDto`],
          meta: { body: `type:${repo}#CreateOrderDto` },
        },
        {
          from: entry,
          to: `${repo}#main.ts:ValidationPipe(x)`,
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

type About = { repo: string; write: GraphNode | undefined; types: TypeRegistry };

const impactOf = (field: string, reached: boolean, about?: About): string | undefined =>
  (about === undefined ? report(reached) : report(reached, about)).findings.find(
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

/**
 * The same question asked of an entity nobody suffixed.
 *
 * `fn-data-layer` writes a `Repository<Order>`: nothing to strip off the name,
 * which is why the document went unrecorded and why no test caught it —
 * `nest-typeorm` does not suffix its entity either, so the fixture and the
 * defect agreed.
 */
const plain = fixtureAt('fn-data-layer');
const plainWrite = writeIn(plain, 'Order');
const about: About = { repo: 'fn-data-layer', write: plainWrite, types: plain.types };

describe('a write whose entity name had no suffix to strip', () => {
  it('records the document it stores, exactly as a suffixed one does', () => {
    expect(plainWrite?.meta?.['entityTypeId']).toBe('type:fn-data-layer#Order');
    expect(plain.types['type:fn-data-layer#Order']?.fields?.map((each) => each.name)).toContain(
      'note',
    );
  });

  it('says a stripped field is stored when that document declares it', () => {
    expect(impactOf('note', true, about)).toBe('stored');
  });

  it('still says nothing about a field the document does not declare', () => {
    expect(impactOf('couponCode', true, about)).toBe('unknown');
  });
});
