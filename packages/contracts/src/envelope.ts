/**
 * A message compared through the wrapping it is delivered in (R172).
 *
 * A publisher writes the message; the platform between the two ends wraps it,
 * and the code at the far end reaches into the wrapping for it. Which wrapping,
 * and where in it the message sits, is not decided here: the reader that drew
 * the delivery wrote it on the node as an `Envelope` - a path, and whether the
 * message is text there - and the extractor wrote, on the entry the delivery
 * reaches, what the code there takes from each such path. This only puts the
 * two together, so nothing here knows any platform's shapes.
 */
import {
  CARRIES_ON_META,
  ELEMENT,
  ENVELOPE_META,
  envelopePath,
  formatTypeRef,
  parseTypeRef,
  READS_META,
  type Envelope,
  type GraphNode,
  type TypeRefAst,
} from '@flowatlas/core';
import type { GraphLookup, UncheckedReason } from './types.js';

/** Why an end could not be read through the wrapping, as the report says it. */
export interface Blocked {
  reason: UncheckedReason;
  subject: string;
  detail?: string;
}

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Envelope).at) &&
  typeof (value as Envelope).text === 'boolean';

/** The wrapping a node says its target is handed the message in. */
export const envelopeOf = (node: GraphNode | undefined): Envelope | undefined => {
  const said = node?.meta?.[ENVELOPE_META];
  return isEnvelope(said) ? said : undefined;
};

/** What the code behind an entry was read to take, or `undefined` when it was not read for it. */
const readsOf = (node: GraphNode): Readonly<Record<string, string>> | undefined => {
  const said = node.meta?.[READS_META];
  return typeof said === 'object' && said !== null ? (said as Record<string, string>) : undefined;
};

const parse = (ref: string): TypeRefAst | undefined => {
  try {
    return parseTypeRef(ref);
  } catch {
    return undefined;
  }
};

/**
 * The reference at a path inside another, where the shape is written out or
 * declared in this project; nothing where it cannot be followed.
 *
 * A workflow says what its input must hold as one shape, and a delivery that
 * hands it the message under `detail` asks for the shape under `detail`.
 */
const refAt = (lookup: GraphLookup, ref: string | undefined, at: readonly string[]): string | undefined => {
  if (ref === undefined || at.length === 0) return ref;
  let ast = parse(ref);
  for (const step of at) {
    if (ast === undefined) return undefined;
    if (step === ELEMENT) {
      ast = ast.kind === 'array' ? ast.element : undefined;
      continue;
    }
    if (ast.kind === 'object') {
      ast = ast.fields.find((field) => field.name === step)?.type;
      continue;
    }
    const entry = ast.kind === 'id' && ast.args === undefined ? lookup.type(ast.id) : undefined;
    const field = entry?.fields?.find((each) => each.name === step);
    ast = field === undefined ? undefined : parse(field.type);
  }
  return ast === undefined ? undefined : formatTypeRef(ast);
};

/** What the code behind an entry reads of a message handed to it in a wrapping. */
export interface Reading {
  /** The node a reader opens: the handler, or the entry when no handler was read. */
  symbol: string;
  typeId: string | undefined;
  /** Set when the code reads nothing that can be compared. */
  blocked?: Blocked;
  /** The entry reads part of what it is handed and carries the rest on. */
  carriesOn: boolean;
  /** Clauses a finding adds, saying where the message was read from and how much of it. */
  via: string[];
}

const handlerOf = (lookup: GraphLookup, entryId: string): string =>
  lookup.edgesFrom(entryId, ['handles']).map((edge) => edge.to).sort()[0] ?? entryId;

/**
 * The type the code behind an entry takes from a message wrapped as the
 * envelope says.
 *
 * Where the message is text, only what the code parses it into will do: the
 * text itself says nothing about a shape. Where it is a value, the shape the
 * code declares for the whole of what it is handed answers too, followed down
 * the path.
 */
export const readThrough = (lookup: GraphLookup, entry: GraphNode, envelope: Envelope): Reading => {
  const reads = readsOf(entry);
  const path = envelopePath(envelope.at);
  const symbol = handlerOf(lookup, entry.id);
  if (reads === undefined) {
    return { symbol, typeId: undefined, carriesOn: false, via: [], blocked: { reason: 'handler-unread', subject: entry.id } };
  }
  const typeId = reads[path] ?? (envelope.text ? undefined : refAt(lookup, reads[''], envelope.at));
  const carriesOn = entry.meta?.[CARRIES_ON_META] === true;
  const via = [
    ...(path === '' ? [] : [`${entry.repo} reads the message at ${path} of what it is handed${envelope.text ? ', as text it parses' : ''}`]),
    ...(carriesOn ? [`${entry.label} reads part of what it is handed and carries the rest on`] : []),
  ];
  if (typeId !== undefined) return { symbol, typeId, carriesOn, via };
  return {
    symbol,
    typeId,
    carriesOn,
    via,
    blocked: {
      reason: envelope.text ? 'message-unparsed' : 'message-undeclared',
      subject: symbol,
      ...(path === '' ? {} : { detail: path }),
    },
  };
};

/**
 * What a delivery hands on, as one shape: the message inside the wrapping.
 *
 * The keys beside the message are present and say nothing about their values,
 * so a reader further on that expects one of them is satisfied and one that
 * expects a key of the message at the top is told it is not there - which is
 * exactly what reading a wrapped message as though it were bare does.
 */
export const wrapped = (ref: string, envelope: Envelope): string | undefined => {
  let ast: TypeRefAst | undefined = envelope.text ? { kind: 'primitive', name: 'string' } : parse(ref);
  if (ast === undefined) return undefined;
  for (const step of [...envelope.at].reverse()) {
    ast =
      step === ELEMENT
        ? { kind: 'array', element: ast }
        : { kind: 'object', fields: [{ name: step, optional: false, type: ast }] };
  }
  if (ast.kind === 'object' && envelope.beside !== undefined) {
    const unknown: TypeRefAst = { kind: 'primitive', name: 'unknown' };
    const fields = [...ast.fields, ...envelope.beside.map((name) => ({ name, optional: false, type: unknown }))];
    ast = { kind: 'object', fields: fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) };
  }
  return formatTypeRef(ast);
};
