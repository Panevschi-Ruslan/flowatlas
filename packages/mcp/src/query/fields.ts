import {
  DISCRIMINATOR_FIELDS,
  FIELDS_READ_META,
  FIELDS_UNREAD_META,
  makeMessageTypeId,
  READS_NOTHING_META,
  parseTypeRef,
  type AbsenceExit,
  type FieldRead,
  type FieldSureness,
  type FieldUnread,
  type GraphNode,
  type SwitchedOver,
  type TypeRefAst,
} from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';

/**
 * The fields of a message or a request body each end of a crossing reads and
 * sends (P368), put together from what the reading wrote: `fieldsRead` on a
 * handler, a guard, an interceptor, a pipe or a middleware, and the shape a
 * publish or a request was read to send.
 */

/** One place a field is read: the field, the function, the line, and how sure, where it is read through a default key. */
export interface FieldSite {
  field: string;
  id: string;
  line: number;
  sureness?: FieldSureness;
  /** The code switches over the field's value, and what it does with a value no case names (P402). */
  switched?: SwitchedOver;
  /** The code checks the field is there before it counts on it (P405, for a message's handler). */
  guarded?: true;
  /** What the code does where the field is absent, where the check leaves the function (P405). */
  whenAbsent?: AbsenceExit;
}

/** One use of the value the reading could not follow. */
export interface UnreadSite {
  id: string;
  line: number;
  why: string;
}

/** What one piece of code reads, or that it was not read for fields at all. */
export interface Reading {
  known: boolean;
  reads: FieldSite[];
  unread: UnreadSite[];
  /** Handed nothing of the message (P405): a handler taking no parameter, run for the types chosen, that refetches. */
  nothing?: true;
}

const EMPTY: Reading = { known: false, reads: [], unread: [] };

/**
 * Keys a delivery commonly wraps a message under (`job.data`, `event.detail`,
 * `record.value`), as the message-type reader steps through them too.
 */
const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['data', 'payload', 'body', 'detail', 'message', 'value']);

/** A read through a wrapping, as the field of the message inside it: `data.label` is `label`. */
export const unwrapped = (read: string): string | undefined => {
  const [first, ...rest] = read.split('.');
  return first !== undefined && ENVELOPE_KEYS.has(first) && rest.length > 0 ? rest.join('.') : undefined;
};

/** Whether a field read is a wrapping's key alone: the whole message handed on, not a field of it. */
export const isWrapping = (read: string): boolean => ENVELOPE_KEYS.has(read);

const under = (read: string, field: string): boolean => read === field || read.startsWith(`${field}.`);

/**
 * A field asked about matches a read of it or of anything under it
 * (`address` matches `address.city`), and a read of it through a wrapping
 * (`data.address`).
 */
export const readsField = (read: string, field: string): boolean => {
  if (under(read, field)) return true;
  const inner = unwrapped(read);
  return inner !== undefined && under(inner, field);
};

/** The outermost name of a dotted field. */
export const topField = (field: string): string => field.split('.')[0] ?? field;

const underType = (when: readonly string[] | undefined, type: string | undefined): boolean =>
  type === undefined || when === undefined || when.includes(type);

/**
 * What the code written on node `id` reads of what it is handed, under one
 * type of message where `type` is given: a read inside a choice of another
 * type is not this type's.
 */
export const readingOf = (db: GraphDb, id: string, type?: string): Reading => {
  const node = db.node(id);
  const reads = node?.meta?.[FIELDS_READ_META];
  if (node === undefined || !Array.isArray(reads)) return EMPTY;
  const unread = node.meta?.[FIELDS_UNREAD_META];
  return {
    known: true,
    reads: (reads as FieldRead[])
      .filter((row) => underType(row.when, type))
      .map((row) => ({
        field: row.field,
        id: row.in ?? id,
        line: row.line,
        ...(row.sureness === undefined ? {} : { sureness: row.sureness }),
        ...(row.switched === undefined ? {} : { switched: row.switched }),
        ...(row.guarded === true ? { guarded: true as const } : {}),
        ...(row.whenAbsent === undefined ? {} : { whenAbsent: row.whenAbsent }),
      })),
    unread: (Array.isArray(unread) ? (unread as FieldUnread[]) : [])
      .filter((row) => underType(row.when, type))
      .map((row) => ({ id: row.in ?? id, line: row.line, why: row.why })),
  };
};

const merge = (a: Reading, b: Reading): Reading => {
  const seen = new Set(a.reads.map((row) => `${row.field}|${row.id}|${row.line}`));
  const seenUnread = new Set(a.unread.map((row) => `${row.why}|${row.id}|${row.line}`));
  return {
    known: a.known || b.known,
    reads: [...a.reads, ...b.reads.filter((row) => !seen.has(`${row.field}|${row.id}|${row.line}`))],
    unread: [...a.unread, ...b.unread.filter((row) => !seenUnread.has(`${row.why}|${row.id}|${row.line}`))],
  };
};

/**
 * The code a use the reading could not follow is in, as `left` names it
 * (P374): the method or function itself (`ClientGuard.suppliedId`), never
 * only the class a guard's rows are written on.
 */
export const unreadIn = (db: GraphDb, use: Pick<UnreadSite, 'id'>): string => db.node(use.id)?.label ?? use.id;

/** The function a consumer or an entry hands to, by its `handles` edge. */
const handlerOf = (db: GraphDb, id: string): string | undefined => db.edgesFrom(id, ['handles'])[0]?.to;

/**
 * What a consumer reads of a message, under `type` where one is asked (or
 * the types it is chosen for): its own handler's reads, and those of the
 * consumer whose dispatch chose it, made under its type.
 */
export const consumerReading = (db: GraphDb, consumer: GraphNode, type?: string): Reading => {
  // Handed nothing of the message (P405): it reads none of its fields, said rather than "not read".
  if (consumer.meta?.[READS_NOTHING_META] === true) return { known: true, reads: [], unread: [], nothing: true };
  const handler = handlerOf(db, consumer.id);
  let reading = handler === undefined ? EMPTY : readingOf(db, handler, type);
  const chooser = consumer.meta?.['selectedBy'];
  if (typeof chooser === 'string') {
    const types = type === undefined ? ((consumer.meta?.['messageTypes'] as string[] | undefined) ?? []) : [type];
    const chosen = handlerOf(db, chooser);
    for (const each of types.length === 0 ? [undefined] : types) {
      if (chosen !== undefined) reading = merge(reading, readingOf(db, chosen, each));
    }
  }
  return reading;
};

/** The names a reading reads, outermost, once each, in order. */
export const fieldNames = (reading: Reading): string[] => [...new Set(reading.reads.map((row) => topField(row.field)))].sort();

const parse = (ref: string): TypeRefAst | undefined => {
  try {
    return parseTypeRef(ref);
  } catch {
    return undefined;
  }
};

const literalOf = (ast: TypeRefAst | undefined): string | undefined =>
  ast?.kind === 'literal' && typeof ast.value === 'string' ? ast.value : undefined;

/** The discriminator value a shape says it is, when it says one. */
const discriminatorOf = (db: GraphDb, ast: TypeRefAst): string | undefined => {
  if (ast.kind === 'object') {
    for (const field of ast.fields) {
      if ((DISCRIMINATOR_FIELDS as readonly string[]).includes(field.name)) return literalOf(field.type);
    }
    return undefined;
  }
  if (ast.kind === 'id') {
    for (const field of db.type(ast.id)?.fields ?? []) {
      if ((DISCRIMINATOR_FIELDS as readonly string[]).includes(field.name)) return literalOf(parse(field.type));
    }
  }
  return undefined;
};

/**
 * The fields a shape holds, outermost, or undefined where it says none the
 * reading can name. A choice of shapes is narrowed to the one whose
 * discriminator is `type`, where one is; otherwise every member's fields.
 */
export const shapeFields = (db: GraphDb, ref: string | undefined, type?: string, depth = 0): string[] | undefined => {
  if (ref === undefined || depth > 4) return undefined;
  const ast = parse(ref);
  return ast === undefined ? undefined : astFields(db, ast, type, depth);
};

const astFields = (db: GraphDb, ast: TypeRefAst, type: string | undefined, depth: number): string[] | undefined => {
  // A type made of itself (`type Json = string | Json[]`) is not walked forever: past the depth a shape is read to, it is unknown.
  if (depth > 4) return undefined;
  if (ast.kind === 'object') return ast.fields.map((field) => field.name);
  if (ast.kind === 'id') {
    const entry = db.type(ast.id);
    if (entry === undefined) return undefined;
    if (entry.fields !== undefined && entry.fields.length > 0) return entry.fields.map((field) => field.name);
    if (entry.members !== undefined && entry.members.length > 0) {
      return choose(db, entry.members.map(parse).filter((member): member is TypeRefAst => member !== undefined), type, depth);
    }
    return entry.fields === undefined ? undefined : [];
  }
  if (ast.kind === 'union') return choose(db, ast.members, type, depth);
  if (ast.kind === 'intersection') {
    const parts = ast.members.map((member) => astFields(db, member, type, depth + 1));
    return parts.some((part) => part === undefined) ? undefined : [...new Set(parts.flat() as string[])];
  }
  return undefined;
};

const choose = (db: GraphDb, members: readonly TypeRefAst[], type: string | undefined, depth: number): string[] | undefined => {
  const shaped = members.filter((member) => !(member.kind === 'primitive' && ['null', 'undefined'].includes(member.name)));
  const picked = type === undefined ? [] : shaped.filter((member) => discriminatorOf(db, member) === type);
  const from = picked.length > 0 ? picked : shaped;
  const parts = from.map((member) => astFields(db, member, type, depth + 1));
  return parts.some((part) => part === undefined) ? undefined : [...new Set(parts.flat() as string[])];
};

/**
 * What a publish sends on a channel, under one type: the shape its edge
 * into the type's node (or the channel's) was read to carry.
 */
export const producerSends = (db: GraphDb, producer: GraphNode, channel: string, type?: string): string[] | undefined => {
  const typed = type === undefined ? undefined : makeMessageTypeId(channel, type);
  const edges = db.edgesFrom(producer.id, ['emits']);
  const edge = edges.find((each) => each.to === typed) ?? edges.find((each) => each.to === channel);
  return shapeFields(db, edge?.params?.[0], type);
};

/** One piece of code a request runs through, with what it reads of the body. */
export interface OnPath {
  id: string;
  /** `handler`, or the layer it runs in: guard, interceptor, pipe, middleware. */
  layer: string;
  reading: Reading;
}

/** The code a request to an entry runs through, in the order it runs: what runs first, then the handler. */
export const requestPath = (db: GraphDb, entry: string): OnPath[] => {
  const front = db
    .edgesFrom(entry, ['guarded_by'])
    .map((edge) => ({ edge, order: typeof edge.meta?.['order'] === 'number' ? (edge.meta['order'] as number) : 0 }))
    .sort((a, b) => a.order - b.order)
    .map(({ edge }) => ({ id: edge.to, layer: String(edge.meta?.['layer'] ?? db.node(edge.to)?.type ?? 'middleware'), reading: readingOf(db, edge.to) }));
  const handler = handlerOf(db, entry);
  return [...front, ...(handler === undefined ? [] : [{ id: handler, layer: 'handler', reading: readingOf(db, handler) }])];
};
