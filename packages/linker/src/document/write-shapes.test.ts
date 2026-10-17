import type { TypeEntry, TypeRegistry } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { shapeWriter, typeToJsonSchema, unreadCounts } from './write-shapes.js';

const object = (name: string, fields: TypeEntry['fields'], extra: Partial<TypeEntry> = {}): TypeEntry => ({
  name,
  kind: 'object',
  declaredIn: `shop#src/${name}.ts`,
  structuralHash: name,
  fields,
  ...extra,
});

const registry: TypeRegistry = {
  'type:shop#Book': object('Book', [
    { name: 'isbn', type: 'string', optional: false },
    { name: 'publishedAt', type: 'Date', optional: false },
    { name: 'price', type: 'bigint', optional: false },
    { name: 'cover', type: 'Buffer', optional: true },
    { name: 'blurb', type: 'string | undefined', optional: false },
    { name: 'gone', type: 'undefined', optional: false },
    { name: 'author', type: 'type:shop#Author', optional: false },
    { name: 'format', type: "'paper' | 'ebook'", optional: false },
    { name: 'scores', type: 'Record<string, number>', optional: false },
    { name: 'pair', type: '[string, number]', optional: false },
  ]),
  'type:shop#Author': object('Author', [
    { name: 'name', type: 'string', optional: false },
    { name: 'mentor', type: 'type:shop#Author', optional: true },
    { name: 'agent', type: 'type:shop#Agent', optional: true },
  ]),
  'type:shop#Agent': object('Agent', [{ name: 'firm', type: 'type:shop#Firm', optional: false }]),
  'type:shop#Firm': object('Firm', [{ name: 'name', type: 'string', optional: false }]),
  'type:shop#Note': object('Note', [{ name: 'text', type: 'string', optional: true, meta: { optionalBy: 'IsOptional' } }]),
  'type:shop#Rating': { name: 'Rating', kind: 'enum', declaredIn: 'shop#src/rating.ts', structuralHash: 'r', members: ['1', '2', '3'] },
  'type:shop#Answer': { name: 'Answer', kind: 'union', declaredIn: 'shop#src/answer.ts', structuralHash: 'a', members: ['type:shop#Firm', 'null'] },
  'type:shop#Opaque': { name: 'Opaque', kind: 'unknown', declaredIn: 'shop#src/opaque.ts', structuralHash: 'o' },
};

const source = { type: (id: string) => (Object.hasOwn(registry, id) ? registry[id] : undefined) };

describe('typeToJsonSchema (P118)', () => {
  it('writes a field the way JSON carries it, by the wire rules (D1)', () => {
    const { schema, components } = typeToJsonSchema('type:shop#Book', source);
    expect(schema).toEqual({ $ref: '#/components/schemas/Book' });
    const book = components['Book']!;
    expect(book['properties']).toEqual({
      isbn: { type: 'string' },
      publishedAt: { type: 'string', format: 'date-time' },
      price: { type: 'string' },
      cover: { type: 'string' },
      blurb: { type: 'string' },
      author: { $ref: '#/components/schemas/Author' },
      format: { type: 'string', enum: ['paper', 'ebook'] },
      scores: { type: 'object', additionalProperties: { type: 'number' } },
      pair: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] }, minItems: 2, maxItems: 2 },
    });
    // `undefined` vanishes from the JSON, so the field that holds only it is not there, and one that may hold it is optional.
    expect(book['required']).toEqual(['isbn', 'publishedAt', 'price', 'author', 'format', 'scores', 'pair']);
    expect(book['x-flowatlas-type']).toBe('type:shop#Book');
  });

  it('writes a value JSON has no form for as unread when its rule is off', () => {
    const { components } = typeToJsonSchema('type:shop#Book', source, { disableRules: ['date-string', 'bigint-string'] });
    expect((components['Book']!['properties'] as Record<string, unknown>)['publishedAt']).toEqual({ 'x-flowatlas-unread': 'not-json' });
    expect((components['Book']!['properties'] as Record<string, unknown>)['price']).toEqual({ 'x-flowatlas-unread': 'not-json' });
  });

  it('ends a shape that contains itself in a reference to itself, and cuts past the depth (I5)', () => {
    const deep = typeToJsonSchema('type:shop#Author', source, { depth: 2 });
    expect(deep.components['Author']!['properties']).toMatchObject({ mentor: { $ref: '#/components/schemas/Author' }, agent: { $ref: '#/components/schemas/Agent' } });
    expect(deep.components['Agent']!['properties']).toEqual({ firm: { 'x-flowatlas-unread': 'too-deep' } });
    expect(Object.keys(deep.components)).toEqual(['Agent', 'Author']);
    expect(unreadCounts(deep.components)).toEqual({ 'too-deep': 1 });
  });

  it('writes enums, unions and nulls as 2020-12 spells them', () => {
    expect(typeToJsonSchema('type:shop#Rating', source).components['Rating']).toEqual({ type: 'number', enum: [1, 2, 3], 'x-flowatlas-type': 'type:shop#Rating' });
    expect(typeToJsonSchema('type:shop#Answer', source).components['Answer']).toEqual({
      anyOf: [{ $ref: '#/components/schemas/Firm' }, { type: 'null' }],
      'x-flowatlas-type': 'type:shop#Answer',
    });
    expect(typeToJsonSchema('string | null', source).schema).toEqual({ type: ['string', 'null'] });
    expect(typeToJsonSchema("'a' | 'b' | null", source).schema).toEqual({ type: ['string', 'null'], enum: ['a', 'b', null] });
  });

  it('says why it wrote nothing (I3)', () => {
    expect(typeToJsonSchema('any', source).schema).toEqual({ 'x-flowatlas-unread': 'any-typed' });
    expect(typeToJsonSchema('type:shop#Missing', source).schema).toEqual({ 'x-flowatlas-unread': 'type-not-found' });
    expect(typeToJsonSchema('type:shop#Opaque', source).schema).toEqual({ 'x-flowatlas-unread': 'type-unread' });
    expect(typeToJsonSchema('{name:', source).schema).toEqual({ 'x-flowatlas-unread': 'ref-unparsed' });
    expect(typeToJsonSchema('Partial<type:shop#Firm>', source).schema).toEqual({ 'x-flowatlas-unread': 'generic-unread' });
  });

  it('writes one component per side where the wire rules read the sides differently', () => {
    const writer = shapeWriter(source, [
      { ref: 'type:shop#Note', side: 'sender' },
      { ref: 'type:shop#Note', side: 'receiver' },
    ]);
    const document = { sent: writer.schemaOf('type:shop#Note', 'sender'), received: writer.schemaOf('type:shop#Note', 'receiver') };
    const { document: done, components } = writer.finish(document);
    expect(done).toEqual({ sent: { $ref: '#/components/schemas/Note.sent' }, received: { $ref: '#/components/schemas/Note.received' } });
    expect((components['Note.received']!['properties'] as Record<string, unknown>)['text']).toEqual({ type: ['string', 'null'] });
    expect((components['Note.sent']!['properties'] as Record<string, unknown>)['text']).toEqual({ type: 'string' });
    // A shape both sides read alike is one component.
    const same = shapeWriter(source, [{ ref: 'type:shop#Firm', side: 'sender' }]);
    const both = same.finish([same.schemaOf('type:shop#Firm', 'sender'), same.schemaOf('type:shop#Firm', 'receiver')]);
    expect(Object.keys(both.components)).toEqual(['Firm']);
  });
});
