/**
 * The type registry written out as JSON Schema 2020-12 (P118): the inverse of
 * `registerComponents` in `./shapes.ts`.
 *
 * What is written is what goes over the wire, not what TypeScript declares
 * (D1). Every field passes through the contract check's wire rules before it
 * is written, so a `Date` is a string, a field typed `undefined` is not there,
 * an `@Exclude()`d field is left out and an `@Expose({ name })` one is renamed
 * - the document and `flowatlas contracts` never disagree about a field.
 *
 * Nothing unread is written as fact (I3). A shape this cannot say - `any`, a
 * type nothing registered, a package's type, one deeper than the cut - is the
 * empty schema with `x-flowatlas-unread: <reason>`, so a reader of the file
 * sees that it was not read rather than that it accepts anything. The writer
 * counts nothing itself: the reasons are in the document, and a run counts
 * them there (`unreadCounts`).
 *
 * Named types become components, referenced by `$ref`, so a shape that
 * contains itself is a `$ref` to itself and the walk ends (I5). Which name a
 * component gets is decided once every reference is known: a type rendered
 * the same for the side that sends it and the side that reads it is one
 * component; one the wire rules render differently per side is two.
 */
import { applyWireRules, type Side } from '@flowatlas/contracts';
import { formatTypeRef, parseTypeRef, type TypeEntry, type TypeField, type TypeRefAst } from '@flowatlas/core';
import { stableJson } from '../diff/fingerprint.js';

/** A JSON Schema, as plain data: written in a fixed key order so documents snapshot. */
export type JsonSchema = Record<string, unknown>;

/** How many named types deep a document follows a shape before it writes the cut (I5). */
export const DEFAULT_SPEC_DEPTH = 8;

/** The key a schema says it was not read with, and why. */
export const UNREAD_KEY = 'x-flowatlas-unread';

/** The key a component names the registry type it was written from with. */
export const TYPE_KEY = 'x-flowatlas-type';

/** Where a document keeps its named schemas, in both formats. */
export const SCHEMA_REF_PREFIX = '#/components/schemas/';

/**
 * Why a schema is `{}` rather than a shape, as the document says it.
 *
 * `any-typed` the declaration is `any` or `unknown` · `transformed` a
 * serialisation annotation decides the value · `too-deep` past `--depth` ·
 * `type-not-found` an id the registry does not hold · `external-type` a
 * package's type nothing here opens · `type-unread` registered but not read
 * as a shape · `generic-unread` a generic this cannot expand · `not-json` a
 * value JSON has no form for (`symbol`, a `Set` with its rule off) ·
 * `nothing-sent` a declaration that can hold no value · `ref-unparsed` a type
 * reference the grammar does not read. On a response or a message rather than
 * a schema: `answer-unread` what a route answers was not read ·
 * `status-unread` an exception whose status the code works out ·
 * `payload-unread` a message whose shape nothing states.
 */
export const SPEC_UNREAD_REASONS = [
  'any-typed',
  'transformed',
  'too-deep',
  'type-not-found',
  'external-type',
  'type-unread',
  'generic-unread',
  'not-json',
  'nothing-sent',
  'ref-unparsed',
  'answer-unread',
  'status-unread',
  'payload-unread',
] as const;

export type SpecUnreadReason = (typeof SPEC_UNREAD_REASONS)[number];

/** What the writer reads types from: a registry, a database, a lookup. */
export interface ShapeSource {
  type(id: string): TypeEntry | undefined;
}

export interface ShapeOptions {
  /** Named types followed from a root before the cut; `DEFAULT_SPEC_DEPTH`. */
  depth?: number;
  /** Wire rules switched off, by id, as `contracts.rules.disable` says. */
  disableRules?: readonly string[];
}

/** One shape a document starts from: a body, an answer, a payload, and which end writes it. */
export interface ShapeRoot {
  ref: string;
  side: Side;
}

export const unreadSchema = (reason: SpecUnreadReason): JsonSchema => ({ [UNREAD_KEY]: reason });

/** A placeholder `$ref`, replaced by the component's name once every name is known. */
const PLACEHOLDER = '\u0000shape:';

const parse = (ref: string): TypeRefAst | undefined => {
  try {
    return parseTypeRef(ref);
  } catch {
    return undefined;
  }
};

/** The type parameters of a generic, bound to what this use passes. */
type Env = ReadonlyMap<string, TypeRefAst>;

const NO_ENV: Env = new Map();

/** A reference with its type parameters replaced by what they are bound to. */
const substitute = (ast: TypeRefAst, env: Env): TypeRefAst => {
  if (env.size === 0) return ast;
  switch (ast.kind) {
    case 'primitive':
      return env.get(ast.name) ?? ast;
    case 'array':
      return { kind: 'array', element: substitute(ast.element, env) };
    case 'union':
      return { kind: 'union', members: ast.members.map((member) => substitute(member, env)) };
    case 'intersection':
      return { kind: 'intersection', members: ast.members.map((member) => substitute(member, env)) };
    case 'tuple':
      return { kind: 'tuple', elements: ast.elements.map((element) => substitute(element, env)) };
    case 'generic':
      return { kind: 'generic', name: ast.name, args: ast.args.map((arg) => substitute(arg, env)) };
    case 'object':
      return { kind: 'object', fields: ast.fields.map((field) => ({ ...field, type: substitute(field.type, env) })) };
    case 'id':
      return ast.args === undefined ? ast : { kind: 'id', id: ast.id, args: ast.args.map((arg) => substitute(arg, env)) };
    default:
      return ast;
  }
};

/** The entry an id use names: the instantiation as registered, else its declaration. */
const entryOf = (source: ShapeSource, ast: Extract<TypeRefAst, { kind: 'id' }>): { key: string; entry: TypeEntry | undefined } => {
  const key = formatTypeRef(ast);
  return { key, entry: source.type(key) ?? (ast.args === undefined ? undefined : source.type(ast.id)) };
};

const envOf = (entry: TypeEntry, ast: Extract<TypeRefAst, { kind: 'id' }>): Env => {
  const params = entry.typeParams ?? [];
  if (params.length === 0 || ast.args === undefined) return NO_ENV;
  return new Map(params.flatMap((name, at) => (ast.args?.[at] === undefined ? [] : [[name, ast.args[at] as TypeRefAst] as const])));
};

/** The named uses a reference makes, not looking inside an instantiation's arguments: its fields use them. */
const idsIn = (ast: TypeRefAst, out: Array<Extract<TypeRefAst, { kind: 'id' }>> = []): Array<Extract<TypeRefAst, { kind: 'id' }>> => {
  switch (ast.kind) {
    case 'id':
      out.push(ast);
      break;
    case 'array':
      idsIn(ast.element, out);
      break;
    case 'union':
    case 'intersection':
      for (const member of ast.members) idsIn(member, out);
      break;
    case 'tuple':
      for (const element of ast.elements) idsIn(element, out);
      break;
    case 'generic':
      for (const arg of ast.args) idsIn(arg, out);
      break;
    case 'object':
      for (const field of ast.fields) idsIn(field.type, out);
      break;
    default:
      break;
  }
  return out;
};

/** What an entry is made of, as references, with its parameters bound. */
const partsOf = (entry: TypeEntry, env: Env): TypeRefAst[] => {
  const refs = [
    ...(entry.fields ?? []).map((field) => field.type),
    ...(entry.members ?? []),
    ...(typeof entry.meta?.['alias'] === 'string' ? [entry.meta['alias'] as string] : []),
  ];
  return refs.flatMap((ref) => {
    const ast = parse(ref);
    return ast === undefined ? [] : [substitute(ast, env)];
  });
};

/**
 * How many named types deep each one is first reached, from every root at once.
 *
 * Measured before anything is written, so the cut is a property of the type
 * and not of the order operations happen to be written in: a type is either
 * within the depth everywhere it is written or cut everywhere.
 */
const depthsOf = (source: ShapeSource, roots: readonly ShapeRoot[]): Map<string, number> => {
  const depths = new Map<string, number>();
  let frontier: Array<Extract<TypeRefAst, { kind: 'id' }>> = [];
  for (const root of roots) {
    const ast = parse(root.ref);
    if (ast !== undefined) frontier.push(...idsIn(ast));
  }
  for (let depth = 1; frontier.length > 0; depth += 1) {
    const next: Array<Extract<TypeRefAst, { kind: 'id' }>> = [];
    for (const use of frontier) {
      const { key, entry } = entryOf(source, use);
      if (depths.has(key)) continue;
      depths.set(key, depth);
      if (entry === undefined) continue;
      for (const part of partsOf(entry, envOf(entry, use))) next.push(...idsIn(part));
    }
    frontier = next;
  }
  return depths;
};

const isNull = (ast: TypeRefAst): boolean => ast.kind === 'primitive' && ast.name === 'null';

const isUndefined = (ast: TypeRefAst): boolean => ast.kind === 'primitive' && (ast.name === 'undefined' || ast.name === 'void');

/** A numeric enum is written as numbers: the registry keeps every member as text. */
const enumValues = (members: readonly string[]): Array<string | number> => {
  const unquoted = members.map((member) => (/^'.*'$/.test(member) ? member.slice(1, -1).replace(/\\'/g, "'") : member));
  const numeric = unquoted.length > 0 && unquoted.every((member) => /^-?\d+(?:\.\d+)?$/.test(member));
  return numeric ? unquoted.map(Number) : unquoted;
};

const enumSchema = (values: Array<string | number | boolean>): JsonSchema => {
  const kinds = [...new Set(values.map((value) => typeof value))];
  return kinds.length === 1 ? { type: kinds[0] === 'number' ? 'number' : kinds[0], enum: values } : { enum: values };
};

/** `T | null`, written the way 2020-12 says it where it can be. */
const nullable = (schema: JsonSchema): JsonSchema => {
  if (typeof schema['type'] === 'string' && schema['$ref'] === undefined) {
    const widened: JsonSchema = { ...schema, type: [schema['type'], 'null'] };
    if (Array.isArray(schema['enum'])) widened['enum'] = [...(schema['enum'] as unknown[]), null];
    return widened;
  }
  return { anyOf: [schema, { type: 'null' }] };
};

const PRIMITIVE_SCHEMA: Readonly<Record<string, JsonSchema | SpecUnreadReason>> = {
  string: { type: 'string' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  null: { type: 'null' },
  object: { type: 'object' },
  any: 'any-typed',
  unknown: 'any-typed',
  undefined: 'nothing-sent',
  void: 'nothing-sent',
  never: 'nothing-sent',
  // Each has a wire rule that rewrites it before it gets here; met here, the
  // rule is switched off and nothing says what crosses instead.
  Date: 'not-json',
  bigint: 'not-json',
  Buffer: 'not-json',
  symbol: 'not-json',
};

/** The generics that are the shape of their arguments, by what they make of them. */
const GENERICS: Readonly<Record<string, (args: readonly JsonSchema[]) => JsonSchema | undefined>> = {
  Record: (args) => (args.length === 2 ? { type: 'object', additionalProperties: args[1] } : undefined),
  Array: (args) => (args.length === 1 ? { type: 'array', items: args[0] } : undefined),
  ReadonlyArray: (args) => (args.length === 1 ? { type: 'array', items: args[0] } : undefined),
  Readonly: (args) => (args.length === 1 ? args[0] : undefined),
  NonNullable: (args) => (args.length === 1 ? args[0] : undefined),
};

/** What one writer is asked for, and what it has written so far. */
interface Writing {
  readonly source: ShapeSource;
  readonly depth: number;
  readonly disable: readonly string[];
  readonly depths: Map<string, number>;
  /** `key|side` → the component as rendered; `null` while it is being rendered. */
  readonly rendered: Map<string, JsonSchema | null>;
  /** `key` → the registry entry's name and the names of its arguments, for the component's name. */
  readonly names: Map<string, string>;
}

const nameOfUse = (writing: Writing, ast: TypeRefAst): string => {
  switch (ast.kind) {
    case 'id': {
      const { entry } = entryOf(writing.source, ast);
      const base = entry?.name ?? ast.id.slice(ast.id.indexOf('#') + 1);
      return [base, ...(ast.args ?? []).map((arg) => nameOfUse(writing, arg))].join('_');
    }
    case 'primitive':
      return ast.name;
    case 'array':
      return `${nameOfUse(writing, ast.element)}List`;
    case 'literal':
      return String(ast.value);
    default:
      return 'Shape';
  }
};

/** One field as the wire carries it from this side, or nothing when it never leaves. */
const fieldSchema = (writing: Writing, field: TypeField, env: Env, side: Side): { name: string; schema: JsonSchema; optional: boolean } | undefined => {
  const view = applyWireRules(field, side, { disable: writing.disable });
  if (view.dropped) return undefined;
  if (isUndefined(view.type)) return undefined;
  if (view.opaque) {
    return { name: view.name, schema: unreadSchema(view.rules.includes('any-unknown-skip') ? 'any-typed' : 'transformed'), optional: view.optional };
  }
  const schema = renderAst(writing, substitute(view.type, env), side);
  // A date leaves as text in one known form; saying which is part of the wire.
  const declared = parse(view.declared);
  const dated = view.rules.includes('date-string') && declared?.kind === 'primitive' && declared.name === 'Date';
  return { name: view.name, schema: dated ? { ...schema, format: 'date-time' } : schema, optional: view.optional };
};

const objectSchema = (writing: Writing, fields: readonly TypeField[], env: Env, side: Side): JsonSchema => {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of fields) {
    const written = fieldSchema(writing, field, env, side);
    if (written === undefined || Object.hasOwn(properties, written.name)) continue;
    properties[written.name] = written.schema;
    if (!written.optional) required.push(written.name);
  }
  return { type: 'object', properties, ...(required.length === 0 ? {} : { required }) };
};

/** A component's body: the shape the entry declares, its parameters bound. */
const componentBody = (writing: Writing, entry: TypeEntry, key: string, env: Env, side: Side): JsonSchema => {
  const said = { [TYPE_KEY]: key };
  if (entry.kind === 'enum') return { ...enumSchema(enumValues(entry.members ?? [])), ...said };
  if (entry.kind === 'union') {
    const members = (entry.members ?? []).map((member) => parse(member));
    if (members.some((member) => member === undefined)) return { ...unreadSchema('ref-unparsed'), ...said };
    return { ...renderAst(writing, substitute({ kind: 'union', members: members as TypeRefAst[] }, env), side), ...said };
  }
  return { ...objectSchema(writing, entry.fields ?? [], env, side), ...said };
};

const renderId = (writing: Writing, ast: Extract<TypeRefAst, { kind: 'id' }>, side: Side): JsonSchema => {
  const { key, entry } = entryOf(writing.source, ast);
  if (entry === undefined) return unreadSchema('type-not-found');
  if (entry.kind === 'external') return unreadSchema('external-type');
  if (entry.kind === 'unknown') {
    const alias = entry.meta?.['alias'];
    const aliased = typeof alias === 'string' ? parse(alias) : undefined;
    return aliased === undefined ? unreadSchema('type-unread') : renderAst(writing, aliased, side);
  }
  if ((writing.depths.get(key) ?? Number.MAX_SAFE_INTEGER) > writing.depth) return unreadSchema('too-deep');
  const slot = `${key}|${side}`;
  if (!writing.rendered.has(slot)) {
    // Marked before rendering: a shape that contains itself meets the mark and
    // is a reference to itself, which is the whole of what a cycle is here (I5).
    writing.rendered.set(slot, null);
    writing.names.set(key, nameOfUse(writing, ast));
    writing.rendered.set(slot, componentBody(writing, entry, key, envOf(entry, ast), side));
  }
  return { $ref: `${PLACEHOLDER}${slot}` };
};

const renderUnion = (writing: Writing, members: readonly TypeRefAst[], side: Side): JsonSchema => {
  const kept = members.filter((member) => !isUndefined(member));
  if (kept.length === 0) return unreadSchema('nothing-sent');
  const nulls = kept.some(isNull);
  const others = kept.filter((member) => !isNull(member));
  if (others.length === 0) return { type: 'null' };
  if (others.every((member) => member.kind === 'literal')) {
    const values = others.map((member) => (member as Extract<TypeRefAst, { kind: 'literal' }>).value);
    const schema = enumSchema(values);
    return nulls ? nullable(schema) : schema;
  }
  const rendered = others.map((member) => renderAst(writing, member, side));
  const one = rendered.length === 1 ? (rendered[0] as JsonSchema) : { anyOf: rendered };
  return nulls ? nullable(one) : one;
};

const renderAst = (writing: Writing, ast: TypeRefAst, side: Side): JsonSchema => {
  switch (ast.kind) {
    case 'primitive': {
      const known = Object.hasOwn(PRIMITIVE_SCHEMA, ast.name) ? PRIMITIVE_SCHEMA[ast.name] : 'generic-unread';
      return typeof known === 'string' ? unreadSchema(known as SpecUnreadReason) : { ...(known as JsonSchema) };
    }
    case 'literal':
      return { const: ast.value };
    case 'id':
      return renderId(writing, ast, side);
    case 'array':
      return { type: 'array', items: renderAst(writing, ast.element, side) };
    case 'union':
      return renderUnion(writing, ast.members, side);
    case 'intersection':
      return { allOf: ast.members.map((member) => renderAst(writing, member, side)) };
    case 'tuple': {
      const elements = ast.elements.map((element) => renderAst(writing, element, side));
      const same = elements.every((element) => stableJson(element) === stableJson(elements[0]));
      const items = elements.length === 0 ? {} : same ? (elements[0] as JsonSchema) : { anyOf: elements };
      return { type: 'array', items, minItems: elements.length, maxItems: elements.length };
    }
    case 'generic': {
      const make = Object.hasOwn(GENERICS, ast.name) ? GENERICS[ast.name] : undefined;
      if (ast.name === 'Set' || ast.name === 'Map') return unreadSchema('not-json');
      const made = make?.(ast.args.map((arg) => renderAst(writing, arg, side)));
      return made ?? unreadSchema('generic-unread');
    }
    case 'object':
      return objectSchema(
        writing,
        ast.fields.map((field) => ({ name: field.name, optional: field.optional, type: formatTypeRef(field.type) })),
        NO_ENV,
        side,
      );
    default:
      return unreadSchema('ref-unparsed');
  }
};

/** A name a component key accepts in both formats: `^[A-Za-z0-9._-]+$`. */
const safeName = (name: string): string => {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned === '' ? 'Shape' : cleaned;
};

/** Every placeholder replaced by its component's reference, anywhere in a document. */
const replaceRefs = (value: unknown, refOf: (slot: string) => string): unknown => {
  if (Array.isArray(value)) return value.map((item) => replaceRefs(item, refOf));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = key === '$ref' && typeof item === 'string' && item.startsWith(PLACEHOLDER) ? refOf(item.slice(PLACEHOLDER.length)) : replaceRefs(item, refOf);
  }
  return out;
};

/** A writer over one registry, for the roots one document starts from. */
export interface ShapeWriter {
  /** The schema of a type reference as `side` writes it: inline, or a reference to a component. */
  schemaOf(ref: string, side: Side): JsonSchema;
  /**
   * The document with every reference named, and the components it uses,
   * sorted by name. Called once, after every `schemaOf`.
   */
  finish<T>(document: T): { document: T; components: Record<string, JsonSchema> };
}

/**
 * A writer for one document. The roots are every shape the document will ask
 * for, so the depth of each type is measured once, from all of them.
 */
export const shapeWriter = (source: ShapeSource, roots: readonly ShapeRoot[], options: ShapeOptions = {}): ShapeWriter => {
  const writing: Writing = {
    source,
    depth: options.depth ?? DEFAULT_SPEC_DEPTH,
    disable: options.disableRules ?? [],
    depths: depthsOf(source, roots),
    rendered: new Map(),
    names: new Map(),
  };
  return {
    schemaOf: (ref, side) => {
      const ast = parse(ref);
      if (ast === undefined) return unreadSchema('ref-unparsed');
      // The value as a whole goes through the same rules as a field does: a
      // body that is a bare `Date` is a string on the wire too.
      const written = fieldSchema(writing, { name: '', type: ref, optional: false }, NO_ENV, side);
      return written?.schema ?? unreadSchema('nothing-sent');
    },
    finish: (document) => {
      // A type both ends render the same way is one component; one the wire
      // rules render differently per side is one per side, named for it.
      const named = new Map<string, string>();
      const taken = new Set<string>();
      const claim = (wanted: string): string => {
        let name = wanted;
        for (let n = 2; taken.has(name); n += 1) name = `${wanted}_${n}`;
        taken.add(name);
        return name;
      };
      const keys = [...new Set([...writing.rendered.keys()].map((slot) => slot.slice(0, slot.lastIndexOf('|'))))].sort();
      for (const key of keys) {
        const base = safeName(writing.names.get(key) ?? key);
        const sent = writing.rendered.get(`${key}|sender`);
        const received = writing.rendered.get(`${key}|receiver`);
        if (sent !== undefined && received !== undefined && stableJson(sent) !== stableJson(received)) {
          named.set(`${key}|sender`, claim(`${base}.sent`));
          named.set(`${key}|receiver`, claim(`${base}.received`));
          continue;
        }
        const name = claim(base);
        named.set(`${key}|sender`, name);
        named.set(`${key}|receiver`, name);
      }
      const refOf = (slot: string): string => `${SCHEMA_REF_PREFIX}${named.get(slot) ?? safeName(slot)}`;
      const components: Record<string, JsonSchema> = {};
      const bySlot = [...writing.rendered.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [slot, schema] of bySlot) {
        const name = named.get(slot);
        if (name === undefined || schema === null || Object.hasOwn(components, name)) continue;
        components[name] = replaceRefs(schema, refOf) as JsonSchema;
      }
      const sorted = Object.fromEntries(Object.entries(components).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      return { document: replaceRefs(document, refOf) as typeof document, components: sorted };
    },
  };
};

/**
 * One type reference as JSON Schema with the components it uses: the writer
 * for a single shape, as a tool answering about one type asks for it.
 */
export const typeToJsonSchema = (
  ref: string,
  source: ShapeSource,
  options: ShapeOptions & { side?: Side } = {},
): { schema: JsonSchema; components: Record<string, JsonSchema> } => {
  const side = options.side ?? 'sender';
  const writer = shapeWriter(source, [{ ref, side }], options);
  const { document, components } = writer.finish(writer.schemaOf(ref, side));
  return { schema: document, components };
};

/** How many schemas of a document say they were not read, by reason (I3: every omission counted). */
export const unreadCounts = (document: unknown, into: Record<string, number> = {}): Record<string, number> => {
  if (Array.isArray(document)) {
    for (const item of document) unreadCounts(item, into);
    return into;
  }
  if (document === null || typeof document !== 'object') return into;
  for (const [key, value] of Object.entries(document as Record<string, unknown>)) {
    if (key === UNREAD_KEY && typeof value === 'string') into[value] = (into[value] ?? 0) + 1;
    else unreadCounts(value, into);
  }
  return into;
};
