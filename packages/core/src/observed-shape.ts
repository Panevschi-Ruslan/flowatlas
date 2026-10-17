import type { TypeEntry, TypeField, TypeRegistry } from './model/types.js';

/**
 * The shape of a JSON body, and nothing else of it (P113): key names, JSON
 * types and how many bodies carried each key. `flowatlas observe --shapes`
 * hands a body it parsed to `shapeOf` and drops the body in the same function,
 * so what survives is this. No value of any kind is kept: not a string, not a
 * number, not an enum member, not a length, not a format (D1).
 *
 * A key that is itself a value - an id, an email, a token, a UUID - is not a
 * name, so it is not kept as one: every such key of an object folds into
 * `idx`, an index signature of the merged shape of their values, by the same
 * rule a path segment is masked by (`isValueKey`, D2).
 *
 *   Shape = { t, ts?, f?: { [key]: { s: Shape, n, opt? } }, i?: Shape, idx?: Shape, cut?, n }
 *
 * `t` is one JSON type, or `mixed` with `ts` the types seen; `f` the named keys
 * of an object, `i` the merged shape of an array's items, `idx` the merged
 * shape of the values under value-like keys. `n` counts bodies, never items:
 * `n` on a shape is how many bodies had something at that place, on a field
 * how many carried that key, so an array's length is never written down.
 * `opt` says some object at that place lacked the key. `cut` marks an object
 * or array a cap stopped the walk at, whose insides were not looked at.
 *
 * Technology-agnostic: JSON is not a technology, and the contracts package
 * and the CLI both read it, so it lives here.
 */

export const SHAPE_TYPES = ['string', 'number', 'boolean', 'null', 'object', 'array', 'mixed'] as const;

export type ShapeType = (typeof SHAPE_TYPES)[number];

/** A JSON type that is one type. */
export type JsonType = Exclude<ShapeType, 'mixed'>;

export interface FieldShape {
  s: Shape;
  /** Bodies that carried this key at this place. */
  n: number;
  /** Some object at this place did not carry it. */
  opt?: true;
}

export interface Shape {
  t: ShapeType;
  /** With `mixed`: the types seen, sorted. */
  ts?: JsonType[];
  /** Named keys of an object, sorted. */
  f?: Record<string, FieldShape>;
  /** Items of an array, merged into one shape. */
  i?: Shape;
  /** Values under value-like keys, merged: an index signature. */
  idx?: Shape;
  /** A cap stopped the walk here: what is inside was not looked at. */
  cut?: true;
  /** Bodies that had something at this place. */
  n: number;
}

/** Deeper than this is an object (or array) with nothing said of what is in it. */
export const SHAPE_DEPTH = 6;
/** An object with more keys than this is a map: it folds wholly into its index signature. */
export const SHAPE_KEYS = 64;
/** Objects one body is walked for, at most; the rest are `cut`. */
export const SHAPE_OBJECTS = 200;
/** A body larger than this is not parsed at all; the reader counts it. */
export const SHAPE_BODY_BYTES = 1_048_576;

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const HEX_TOKEN = /^[0-9a-f]{16,}$/i;

/**
 * A key, or a path segment, that carries a value rather than a name (D2): any
 * digit, longer than 32 characters, an `@` inside it (an email; `@type` is a
 * name), a UUID or a long hex token, or nothing at all. One rule for paths and
 * keys, so a new kind of id is fixed once.
 */
export const isValueKey = (key: string): boolean =>
  key === '' || /\d/.test(key) || key.length > 32 || /.@./.test(key) || UUID.test(key) || HEX_TOKEN.test(key);

interface Budget {
  objects: number;
}

const typeOfValue = (value: unknown): JsonType | undefined => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return undefined;
  }
};

const sortedKeys = <V>(record: Record<string, V>): Record<string, V> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** The types a shape stands for: its own, or each of a mixed one's. */
const typesOf = (shape: Shape): readonly JsonType[] => (shape.t === 'mixed' ? (shape.ts ?? []) : [shape.t]);

/** True when an object at this place was walked, so a key it lacked was really absent. */
const walkedObject = (shape: Shape): boolean => typesOf(shape).includes('object') && shape.cut !== true;

const walk = (value: unknown, depth: number, budget: Budget): Shape => {
  const type = typeOfValue(value);
  // `undefined`, a function, a symbol: JSON.parse never makes one, and a caller handing one in gets nothing of it.
  if (type === undefined) return { t: 'null', n: 1 };
  if (type === 'array') {
    if (depth >= SHAPE_DEPTH) return { t: 'array', cut: true, n: 1 };
    let items: Shape | undefined;
    for (const item of value as unknown[]) {
      const one = walk(item, depth + 1, budget);
      items = items === undefined ? one : merge(items, one, true);
    }
    return items === undefined ? { t: 'array', n: 1 } : { t: 'array', i: items, n: 1 };
  }
  if (type !== 'object') return { t: type, n: 1 };
  if (depth >= SHAPE_DEPTH || budget.objects <= 0) return { t: 'object', cut: true, n: 1 };
  budget.objects -= 1;
  const entries = Object.entries(value as Record<string, unknown>);
  const fields: Record<string, FieldShape> = {};
  let idx: Shape | undefined;
  const fold = (inner: unknown): void => {
    const one = walk(inner, depth + 1, budget);
    idx = idx === undefined ? one : merge(idx, one, true);
  };
  if (entries.length > SHAPE_KEYS) {
    for (const [, inner] of entries) fold(inner);
  } else {
    for (const [key, inner] of entries) {
      if (isValueKey(key)) fold(inner);
      else fields[key] = { s: walk(inner, depth + 1, budget), n: 1 };
    }
  }
  const shape: Shape = { t: 'object', n: 1 };
  if (Object.keys(fields).length > 0) shape.f = sortedKeys(fields);
  if (idx !== undefined) shape.idx = idx;
  return shape;
};

/**
 * The shape of one parsed body: key names and JSON types, value-like keys
 * folded, at most `SHAPE_DEPTH` deep and `SHAPE_OBJECTS` objects walked.
 */
export const shapeOf = (json: unknown): Shape => walk(json, 0, { objects: SHAPE_OBJECTS });

const mergeOptional = (a: Shape | undefined, b: Shape | undefined, within: boolean): Shape | undefined =>
  a === undefined ? b : b === undefined ? a : merge(a, b, within);

const mergeFields = (a: Shape, b: Shape, within: boolean): Record<string, FieldShape> | undefined => {
  const left = a.f ?? {};
  const right = b.f ?? {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  if (keys.length === 0) return undefined;
  const count = (x: number, y: number): number => (within ? Math.max(x, y) : x + y);
  const merged: Record<string, FieldShape> = {};
  for (const key of keys) {
    const x = left[key];
    const y = right[key];
    if (x !== undefined && y !== undefined) {
      const field: FieldShape = { s: merge(x.s, y.s, within), n: count(x.n, y.n) };
      if (x.opt === true || y.opt === true) field.opt = true;
      merged[key] = field;
      continue;
    }
    const only = (x ?? y)!;
    // Absent on the other side only says something when an object there was looked at.
    const absent = x === undefined ? walkedObject(a) : walkedObject(b);
    merged[key] = absent ? { ...only, opt: true } : { ...only };
  }
  return sortedKeys(merged);
};

const merge = (a: Shape, b: Shape, within: boolean): Shape => {
  const types = [...new Set([...typesOf(a), ...typesOf(b)])].sort() as JsonType[];
  const shape: Shape =
    types.length === 1 ? { t: types[0]!, n: within ? Math.max(a.n, b.n) : a.n + b.n } : { t: 'mixed', ts: types, n: within ? Math.max(a.n, b.n) : a.n + b.n };
  const objects = [a, b].filter((one) => typesOf(one).includes('object'));
  const arrays = [a, b].filter((one) => typesOf(one).includes('array'));
  if (objects.length > 0) {
    const fields = mergeFields(a, b, within);
    if (fields !== undefined) shape.f = fields;
    const idx = mergeOptional(a.idx, b.idx, within);
    if (idx !== undefined) shape.idx = idx;
  }
  if (arrays.length > 0) {
    const items = mergeOptional(a.i, b.i, within);
    if (items !== undefined) shape.i = items;
  }
  // Cut only when every side with insides was cut: one side walked says what the other did not.
  const containers = [...new Set([...objects, ...arrays])];
  if (containers.length > 0 && containers.every((one) => one.cut === true)) shape.cut = true;
  return shape;
};

/**
 * Two shapes of the same place as one, across bodies: counts add up, a key
 * some object lacked is optional, differing types become `mixed`.
 */
export const mergeShapes = (a: Shape, b: Shape): Shape => merge(a, b, false);

// --- what a route was sent and answered ------------------------------------------

/** One route's bodies, merged (P113): the request's shape and each status's answer, by entry id in `observed.json`. */
export interface EntryShapes {
  request?: Shape;
  /** By status, `"200"`; only statuses that answered with a JSON body. */
  responses?: Record<string, Shape>;
  /** Exchanges read for shapes, with a body or not. */
  samples: number;
  lastSeen: string | null;
}

const later = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a > b ? a : b);

export const mergeEntryShapes = (a: EntryShapes, b: EntryShapes): EntryShapes => {
  const merged: EntryShapes = { samples: a.samples + b.samples, lastSeen: later(a.lastSeen, b.lastSeen) };
  const request = mergeOptional(a.request, b.request, false);
  if (request !== undefined) merged.request = request;
  const statuses = [...new Set([...Object.keys(a.responses ?? {}), ...Object.keys(b.responses ?? {})])].sort();
  if (statuses.length > 0) {
    merged.responses = Object.fromEntries(
      statuses.map((status) => [status, mergeOptional(a.responses?.[status], b.responses?.[status], false)!]),
    );
  }
  // Keys in the order the file writes them.
  return {
    ...(merged.request === undefined ? {} : { request: merged.request }),
    ...(merged.responses === undefined ? {} : { responses: merged.responses }),
    samples: merged.samples,
    lastSeen: merged.lastSeen,
  };
};

/** Two records of route shapes as one, sorted by entry id. */
export const mergeShapeRecords = (
  a: Readonly<Record<string, EntryShapes>>,
  b: Readonly<Record<string, EntryShapes>>,
): Record<string, EntryShapes> => {
  const merged: Record<string, EntryShapes> = { ...a };
  for (const [id, shapes] of Object.entries(b)) merged[id] = merged[id] === undefined ? shapes : mergeEntryShapes(merged[id]!, shapes);
  return sortedKeys(merged);
};

/** The shape at a dotted path (`total.amount`, `items[].price`), as the contracts package names fields. */
export const shapeAt = (shape: Shape, path: string): Shape | undefined => {
  if (path === '') return shape;
  let at: Shape | undefined = shape;
  for (const part of path.split('.')) {
    const match = /^(.*?)((?:\[\])*)$/.exec(part)!;
    const name = match[1]!;
    if (name !== '') at = at?.f?.[name]?.s;
    for (let depth = match[2]!.length / 2; depth > 0; depth -= 1) at = at?.i;
    if (at === undefined) return undefined;
  }
  return at;
};

// --- as a type the contracts package can walk -------------------------------------

/** The registry ids a traffic shape's objects are given; never written into the graph's registry (I5). */
export const TRAFFIC_TYPE_PREFIX = 'type:traffic#';

export interface TrafficType {
  /** The reference the whole body is: a traffic id, an array of one, a primitive or a union. */
  ref: string;
  /** Every object the shape holds, as registry entries, by their traffic id. In memory only. */
  types: TypeRegistry;
}

const wrapped = (ref: string): string => (ref.includes('|') ? `(${ref})` : ref);

/**
 * A shape as a type reference, its objects as registry entries in `types`: a
 * field is optional when some object lacked it, a value-like key is the
 * entry's `meta.indexSignature`, and an object a cap stopped at, or one with
 * no key at all, is `object`, which claims nothing.
 */
export const trafficTypeOf = (shape: Shape, name: string): TrafficType => {
  const types: TypeRegistry = {};
  let counter = 0;
  const refOf = (at: Shape, label: string): string => {
    const refs = typesOf(at).map((type): string => {
      if (type === 'array') return at.i === undefined ? 'unknown[]' : `${wrapped(refOf(at.i, `${label}[]`))}[]`;
      if (type !== 'object') return type;
      const fields = Object.entries(at.f ?? {});
      if (at.cut === true && fields.length === 0) return 'object';
      if (fields.length === 0) return at.idx === undefined ? 'object' : `Record<string, ${refOf(at.idx, `${label}[key]`)}>`;
      counter += 1;
      const id = `${TRAFFIC_TYPE_PREFIX}T${counter}`;
      const entry: TypeEntry = {
        name: label,
        kind: 'object',
        declaredIn: 'traffic',
        structuralHash: `traffic:${counter}`,
        fields: [],
      };
      types[id] = entry;
      entry.fields = fields.map(([key, field]): TypeField => ({
        name: key,
        type: refOf(field.s, label === '' ? key : `${label}.${key}`),
        optional: field.opt === true,
      }));
      if (at.idx !== undefined) entry.meta = { indexSignature: refOf(at.idx, `${label}[key]`) };
      return id;
    });
    return refs.join(' | ');
  };
  return { ref: refOf(shape, name), types };
};

/**
 * An object shape as one registry entry (`declaredIn: 'traffic'`), its nested
 * objects written into `into` by their traffic ids so a resolver finds them.
 * A shape that is not an object is an entry with no fields.
 */
export const toTypeEntry = (shape: Shape, name: string, into: TypeRegistry = {}): TypeEntry => {
  const { ref, types } = trafficTypeOf(shape, name);
  Object.assign(into, types);
  return types[ref] ?? { name, kind: 'object', declaredIn: 'traffic', structuralHash: 'traffic:0', fields: [] };
};
