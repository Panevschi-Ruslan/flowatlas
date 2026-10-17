/**
 * Traffic as the third witness (P113): what actually went over the wire,
 * against what the code declares.
 *
 * The contract check compares one side's code with the other side's, and both
 * can be wrong the same way. A body built by hand - a spread of something
 * untyped, an `as any` - can carry fields neither declares. `flowatlas
 * observe --shapes` keeps the shape of each route's bodies (key names and
 * JSON types, never a value, `observed-shape.ts` in core), and this compares
 * that shape with the route's declared request type and with its declared
 * answer, through the same `diffRefs` and wire rules as any comparison, so a
 * `Date` declared and a string seen is not drift.
 *
 * Traffic is the sender both ways: it is what was sent, the request by a
 * caller and the answer by the route, and the declaration is what the code
 * says should have been. Read that way, a field sent and not declared is an
 * `extra_field`, a declared field never sent a `missing_required`, and a
 * field sent only sometimes where it is declared always present an
 * `optionality_mismatch` - the comparator's own words, with no new kinds but
 * one: a declared optional field no body carried in at least `minSamples`
 * bodies is `declared_never_sent`, information only.
 *
 * Traffic never makes an error on its own (D3): it is what one environment
 * exercised over one window. Every diff says how many bodies carried the
 * field (`seenIn`) of how many that could have (`of`), so "sent in 3 of 400
 * requests" reads as rare, not as a break.
 *
 * Pure: the shapes and the graph in, the comparison out. The traffic types
 * are built in memory for the comparison and never written into the registry
 * (I5).
 */
import {
  formatTypeRef,
  parseTypeRef,
  shapeAt,
  TRAFFIC_TYPE_PREFIX,
  trafficTypeOf,
  type EntryShapes,
  type GraphEdge,
  type Shape,
  type TypeEntry,
  type TypeField,
  type TypeRefAst,
} from '@flowatlas/core';
import { bodyTypeOf, handlesOf, namesAShape } from './boundary.js';
import { stripsUndecorated } from './check.js';
import { diffRefs } from './compare.js';
import { atLeast, severityOf } from './severity.js';
import { DEFAULT_DEPTH, FINDING_KINDS, type FieldDiff, type GraphLookup, type Severity } from './types.js';
import { applyWireRules } from './wire/index.js';

/** The comparator's four kinds, and the one only traffic can say. */
export const TRAFFIC_KINDS = [...FINDING_KINDS, 'declared_never_sent'] as const;

export type TrafficKind = (typeof TRAFFIC_KINDS)[number];

/** Bodies a declared optional field has to be missing from before its absence is said. */
export const TRAFFIC_MIN_SAMPLES = 50;

/** One disagreement between traffic and a declaration, with how often traffic carried the field. */
export interface TrafficDiff extends Omit<FieldDiff, 'kind'> {
  kind: TrafficKind;
  /** Never `error`: traffic alone does not break a contract (D3). */
  severity: Severity;
  /** Bodies that carried the field. */
  seenIn: number;
  /** Bodies that could have: those with the object the field sits in. */
  of: number;
}

/** What one direction was compared against: a declared type, and whose. */
export interface TrafficAgainst {
  /** The declared reference: a registry id, or a shape written out in place. */
  typeId: string;
  /** `route` when the route declares it; `caller` when only the code that calls the route does. */
  by: 'route' | 'caller';
  /** The node whose source declares it. */
  symbol: string;
  service: string;
}

export interface TrafficSide {
  against: TrafficAgainst;
  /** Bodies compared. */
  samples: number;
  diffs: TrafficDiff[];
  rulesApplied: string[];
}

/** Why a direction, or a status, was not compared. */
export const TRAFFIC_UNCHECKED = ['no-declared-type', 'type-unreadable', 'ambiguous-handler', 'status-not-declared'] as const;

export type TrafficUncheckedReason = (typeof TRAFFIC_UNCHECKED)[number];

export interface TrafficUnchecked {
  direction: 'request' | 'response';
  /** The status of a response that was not compared. */
  status?: string;
  reason: TrafficUncheckedReason;
  /** Bodies the shape is of; kept for when the code declares one. */
  samples: number;
}

export interface TrafficComparison {
  entry: string;
  /** Exchanges read for shapes. */
  samples: number;
  lastSeen: string | null;
  request?: TrafficSide;
  /** By status, the 2xx statuses whose answer the code declares. */
  responses?: Record<string, TrafficSide>;
  unchecked: TrafficUnchecked[];
  /** Fields that differ over both directions, `declared_never_sent` not counted: the page's chip. */
  differs: number;
}

export interface TrafficOptions {
  /** Bodies a declared optional field must be missing from before it is said (default 50). */
  minSamples?: number;
  /** The call being checked, when one is: its expected answer stands in when the route declares none. */
  caller?: GraphEdge;
  depth?: number;
  disableRules?: readonly string[];
}

const REQUEST_EDGES: readonly string[] = ['http_calls', 'hits'];

const TRAFFIC_ID = new RegExp(`${TRAFFIC_TYPE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}T\\d+`, 'g');

const parse = (ref: string): TypeRefAst | undefined => {
  try {
    return parseTypeRef(ref);
  } catch {
    return undefined;
  }
};

/** The registry entry an `id` reference names, its arguments included when the registry keys it so. */
const entryOf = (lookup: GraphLookup, ast: TypeRefAst): TypeEntry | undefined =>
  ast.kind !== 'id' ? undefined : ((ast.args === undefined ? undefined : lookup.type(formatTypeRef(ast))) ?? lookup.type(ast.id));

/**
 * Whether a declaration says what fields a body has: an object written out,
 * an object or generic entry, an array or a union of one. A library's type
 * nothing read (`external`), a shrug (`unknown`), or text is not.
 */
const readable = (lookup: GraphLookup, ref: string): boolean => {
  const check = (ast: TypeRefAst): boolean => {
    if (ast.kind === 'array') return check(ast.element);
    if (ast.kind === 'union') return ast.members.some(check);
    if (ast.kind === 'object') return ast.fields.length > 0;
    const entry = entryOf(lookup, ast);
    return entry !== undefined && (entry.kind === 'object' || (entry.kind === 'generic' && ast.kind === 'id' && ast.args === undefined));
  };
  const ast = namesAShape(ref) ? parse(ref) : undefined;
  return ast !== undefined && check(ast);
};

/**
 * Whether a reference says nothing a body could be compared with: none, a
 * shrug, or a primitive - a route whose only parameter is a path segment's
 * `string` declares no body at all.
 */
const declaresNone = (ref: string | undefined): boolean => {
  if (ref === undefined || !namesAShape(ref)) return true;
  return parse(ref)?.kind === 'primitive';
};

/** The fields a declared reference has, for the walk `declared_never_sent` makes. */
const fieldsOf = (lookup: GraphLookup, ast: TypeRefAst): readonly TypeField[] | undefined => {
  if (ast.kind === 'object') return ast.fields.map((field) => ({ name: field.name, type: formatTypeRef(field.type), optional: field.optional }));
  if (ast.kind === 'union') {
    const shaped = ast.members.map((member) => fieldsOf(lookup, member)).filter((fields) => fields !== undefined);
    return shaped.length === 1 ? shaped[0] : undefined;
  }
  const entry = entryOf(lookup, ast);
  return entry?.kind === 'object' || entry?.kind === 'generic' ? entry.fields : undefined;
};

/** The declared reference at a dotted path, walked field by field; nothing where it cannot be followed. */
const declaredAt = (lookup: GraphLookup, ref: string, path: string): TypeRefAst | undefined => {
  let ast = parse(ref);
  if (path === '') return ast;
  for (const part of path.split('.')) {
    const [, name = '', arrays = ''] = /^(.*?)((?:\[\])*)$/.exec(part) ?? [];
    if (ast === undefined) return undefined;
    if (name !== '') {
      const field = fieldsOf(lookup, ast)?.find((one) => one.name === name);
      ast = field === undefined ? undefined : parse(field.type);
    }
    for (let depth = arrays.length / 2; depth > 0 && ast !== undefined; depth -= 1) ast = ast.kind === 'array' ? ast.element : undefined;
  }
  return ast;
};

/** The base type every member of a set of literal values shares, when it is one. */
const literalBase = (lookup: GraphLookup, ast: TypeRefAst | undefined): string | undefined => {
  if (ast === undefined) return undefined;
  const bases = new Set<string>();
  const add = (member: TypeRefAst): boolean => {
    if (member.kind === 'literal') {
      bases.add(typeof member.value);
      return true;
    }
    if (member.kind === 'union') return member.members.every(add);
    const entry = entryOf(lookup, member);
    if (entry?.kind === 'enum') {
      for (const value of entry.members ?? []) bases.add(/^-?\d+(\.\d+)?$/.test(value) ? 'number' : 'string');
      return (entry.members ?? []).length > 0;
    }
    if (entry?.kind === 'union') return (entry.members ?? []).every((value) => add(parse(value) ?? { kind: 'primitive', name: value }));
    return false;
  };
  return add(ast) && bases.size === 1 ? [...bases][0] : undefined;
};

/** Traffic sending `string` where the code declares a set of strings: a value would tell, and values are not kept. */
const valueWouldTell = (lookup: GraphLookup, declared: string, diff: FieldDiff): boolean => {
  if (diff.kind !== 'type_mismatch' || diff.actual === null) return false;
  const base = literalBase(lookup, declaredAt(lookup, declared, diff.path));
  return base !== undefined && diff.actual.split(' | ').every((type) => type === base || type === 'null');
};

const parentOf = (path: string): string => {
  const at = path.lastIndexOf('.');
  if (at >= 0) return path.slice(0, at);
  // `items[]` sits in the body itself.
  return '';
};

/** How many bodies carried the field, of how many had the object it sits in. */
const seenOf = (shape: Shape, path: string): { seenIn: number; of: number } => {
  const of = shapeAt(shape, parentOf(path))?.n ?? shape.n;
  return { seenIn: shapeAt(shape, path)?.n ?? 0, of };
};

type Direction = 'request' | 'response';

const WORDS: Record<Direction, { many: string; one: string; send: string; sent: string }> = {
  request: { many: 'requests', one: 'request', send: 'send', sent: 'sent' },
  response: { many: 'responses', one: 'response', send: 'carry', sent: 'carried' },
};

const shown = (path: string, type: string | null): string => (path === '' ? `\`${type ?? 'nothing'}\`` : `\`${path}: ${type ?? 'nothing'}\``);
const named = (path: string): string => (path === '' ? 'the whole body' : `\`${path}\``);

/** The sentence a reader acts on, with neither the count nor the window: those are fields beside it. */
const sentenceOf = (diff: Omit<TrafficDiff, 'message' | 'severity'>, direction: Direction, against: string): string => {
  const words = WORDS[direction];
  const counted = ` (${diff.seenIn} of ${diff.of})`;
  const base = ((): string => {
    switch (diff.kind) {
      case 'extra_field':
        return `${words.many} ${words.send} ${shown(diff.path, diff.actual)}; ${against} declares no such field${counted}`;
      case 'missing_required':
        return `${against} ${direction === 'request' ? 'requires' : 'declares'} ${shown(diff.path, diff.expected)}; no ${words.one} ${words.sent} it${counted}`;
      case 'optionality_mismatch':
        return `${named(diff.path)} is required by ${against} and missing from ${diff.of - diff.seenIn} of ${diff.of} ${words.many}`;
      case 'type_mismatch':
        return diff.path === ''
          ? `${words.many} ${words.send} ${shown('', diff.actual)} where ${against} expects ${shown('', diff.expected)}`
          : `${words.many} ${words.send} \`${diff.path}\` as \`${diff.actual ?? 'nothing'}\`; ${against} declares it \`${diff.expected ?? 'nothing'}\``;
      case 'declared_never_sent':
        return `${named(diff.path)} is optional in ${against} and no ${words.one} of ${diff.of} ${words.sent} it`;
    }
  })();
  return diff.note === null || diff.note === undefined ? base : `${base}; ${diff.note}`;
};

/** The comparator's verdict, never worse than a warning (D3). */
const trafficSeverity = (kind: TrafficKind, rule: string | null): Severity => {
  if (kind === 'declared_never_sent') return 'info';
  const said = severityOf(kind, rule);
  return atLeast(said, 'error') ? 'warning' : said;
};

const cmpPath = (a: TrafficDiff, b: TrafficDiff): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;

/**
 * Declared optional fields no body carried, at the top and in the objects
 * traffic did carry, when at least `minSamples` bodies could have.
 */
const neverSent = (
  lookup: GraphLookup,
  shape: Shape,
  declared: string,
  minSamples: number,
  disable: readonly string[],
): Array<Omit<TrafficDiff, 'message' | 'severity'>> => {
  const found: Array<Omit<TrafficDiff, 'message' | 'severity'>> = [];
  const walk = (ast: TypeRefAst | undefined, at: Shape | undefined, path: string, depth: number): void => {
    if (ast === undefined || at === undefined || depth <= 0) return;
    if (ast.kind === 'array') {
      walk(ast.element, at.i, `${path}[]`, depth);
      return;
    }
    const fields = fieldsOf(lookup, ast);
    if (fields === undefined || at.f === undefined) return;
    for (const field of fields) {
      const view = applyWireRules(field, 'receiver', { disable });
      if (view.dropped) continue;
      const here = path === '' ? view.name : `${path}.${view.name}`;
      const carried = at.f[view.name];
      if (carried === undefined) {
        if (view.optional && at.n >= minSamples) {
          found.push({ kind: 'declared_never_sent', path: here, expected: formatTypeRef(view.type), actual: null, rule: null, seenIn: 0, of: at.n });
        }
        continue;
      }
      walk(parse(field.type), carried.s, here, depth - 1);
    }
  };
  walk(parse(declared), shape, '', DEFAULT_DEPTH);
  return found;
};

const compareSide = (
  lookup: GraphLookup,
  shape: Shape,
  direction: Direction,
  against: TrafficAgainst,
  options: { depth: number; disable: readonly string[]; whitelist: boolean; minSamples: number; label: string },
): TrafficSide => {
  const { ref, types } = trafficTypeOf(shape, options.label);
  const resolve = (id: string): TypeEntry | undefined => (Object.hasOwn(types, id) ? types[id] : lookup.type(id));
  const result = diffRefs(parseTypeRef(ref), parseTypeRef(against.typeId), resolve, {
    depth: options.depth,
    ...(options.disable.length === 0 ? {} : { disableRules: options.disable }),
    ...(options.whitelist ? { whitelist: true } : {}),
  });
  const rules = new Set(result.rulesApplied);
  const name = lookup.type(against.typeId)?.name ?? against.typeId;
  const whose = against.by === 'route' ? `the route's ${name}` : `${against.service}'s ${name}`;
  const kept = result.diffs.flatMap((diff): Array<Omit<TrafficDiff, 'message' | 'severity'>> => {
    // Traffic always carried a field the code says may be left out: nothing wrong with that.
    if (diff.kind === 'optionality_mismatch' && diff.optionalOn === 'receiver') return [];
    if (valueWouldTell(lookup, against.typeId, diff)) {
      rules.add(`traffic-values-not-kept:${diff.path === '' ? '.' : diff.path}`);
      return [];
    }
    const { message: _message, kind, ...rest } = diff;
    // A traffic object has an id only for the walk; a reader is told it is an object.
    if (rest.actual !== null) rest.actual = rest.actual.replace(TRAFFIC_ID, 'object');
    const counts = kind === 'missing_required' ? { seenIn: 0, of: shapeAt(shape, parentOf(diff.path))?.n ?? shape.n } : seenOf(shape, diff.path);
    return [{ ...rest, kind, ...counts }];
  });
  const all = [...kept, ...neverSent(lookup, shape, against.typeId, options.minSamples, options.disable)];
  // Keys in the order a reader takes them in: what, where, how often, how bad, the sentence.
  const diffs = all
    .map(({ kind, path, expected, actual, rule, seenIn, of, ...extra }): TrafficDiff => ({
      kind,
      path,
      expected,
      actual,
      rule,
      ...extra,
      seenIn,
      of,
      severity: trafficSeverity(kind, rule),
      message: sentenceOf({ kind, path, expected, actual, rule, seenIn, of, ...extra }, direction, whose),
    }))
    .sort(cmpPath);
  return { against, samples: shape.n, diffs, rulesApplied: [...rules].sort() };
};

/** The one shape-naming answer the calls into an entry expect, when they agree on one. */
const callersAnswer = (lookup: GraphLookup, entry: string, caller: GraphEdge | undefined): GraphEdge | undefined => {
  if (caller !== undefined) return caller.returns !== undefined && readable(lookup, caller.returns) ? caller : undefined;
  const asking = lookup
    .edgesTo(entry, REQUEST_EDGES)
    .filter((edge) => edge.returns !== undefined && readable(lookup, edge.returns))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const refs = new Set(asking.map((edge) => edge.returns));
  return refs.size === 1 ? asking[0] : undefined;
};

/** A 2xx status: the answer a handler's declared return type is. */
const declaresAnswer = (status: string): boolean => /^2\d\d$/.test(status);

/**
 * What a route was sent and answered with, as traffic carried it, against
 * what its code declares: the request against the route's body type, each
 * 2xx answer against the route's declared return type, or - when the route
 * declares nothing readable - against the one type the code calling it
 * expects back (`caller`, or every call into it when they agree).
 */
export const compareTraffic = (
  entry: string,
  shapes: EntryShapes,
  lookup: GraphLookup,
  options: TrafficOptions = {},
): TrafficComparison => {
  const handles = handlesOf(lookup, entry);
  const handler = handles[0];
  const handlerService = lookup.node(entry)?.repo ?? 'unknown';
  const settings = {
    depth: options.depth ?? DEFAULT_DEPTH,
    disable: options.disableRules ?? [],
    minSamples: options.minSamples ?? TRAFFIC_MIN_SAMPLES,
  };
  const unchecked: TrafficUnchecked[] = [];
  let request: TrafficSide | undefined;
  const responses: Record<string, TrafficSide> = {};

  if (shapes.request !== undefined) {
    const declared = handles.length === 1 ? bodyTypeOf(handler) : undefined;
    if (handles.length > 1) unchecked.push({ direction: 'request', reason: 'ambiguous-handler', samples: shapes.request.n });
    else if (declared === undefined || declaresNone(declared)) unchecked.push({ direction: 'request', reason: 'no-declared-type', samples: shapes.request.n });
    else if (!readable(lookup, declared)) unchecked.push({ direction: 'request', reason: 'type-unreadable', samples: shapes.request.n });
    else {
      request = compareSide(
        lookup,
        shapes.request,
        'request',
        { typeId: declared, by: 'route', symbol: handler!.to, service: handlerService },
        { ...settings, whitelist: stripsUndecorated(lookup, entry), label: 'request' },
      );
    }
  }

  const statuses = Object.keys(shapes.responses ?? {}).sort();
  if (statuses.length > 0) {
    const own = handles.length === 1 ? handler?.returns : undefined;
    const caller = own !== undefined && readable(lookup, own) ? undefined : callersAnswer(lookup, entry, options.caller);
    const against: TrafficAgainst | undefined =
      own !== undefined && readable(lookup, own)
        ? { typeId: own, by: 'route', symbol: handler!.to, service: handlerService }
        : caller !== undefined
          ? { typeId: caller.returns!, by: 'caller', symbol: caller.from, service: lookup.node(caller.from)?.repo ?? 'unknown' }
          : undefined;
    for (const status of statuses) {
      const shape = shapes.responses![status]!;
      if (!declaresAnswer(status)) unchecked.push({ direction: 'response', status, reason: 'status-not-declared', samples: shape.n });
      else if (handles.length > 1) unchecked.push({ direction: 'response', status, reason: 'ambiguous-handler', samples: shape.n });
      else if (against === undefined) {
        unchecked.push({ direction: 'response', status, reason: declaresNone(own) ? 'no-declared-type' : 'type-unreadable', samples: shape.n });
      } else {
        responses[status] = compareSide(lookup, shape, 'response', against, { ...settings, whitelist: false, label: `response ${status}` });
      }
    }
  }

  const differing = new Set<string>();
  for (const [where, side] of [['request', request] as const, ...Object.entries(responses)]) {
    for (const diff of side?.diffs ?? []) if (diff.kind !== 'declared_never_sent') differing.add(`${where}\u0000${diff.path}`);
  }
  return {
    entry,
    samples: shapes.samples,
    lastSeen: shapes.lastSeen,
    ...(request === undefined ? {} : { request }),
    ...(Object.keys(responses).length === 0 ? {} : { responses }),
    unchecked,
    differs: differing.size,
  };
};

/** Every route the observed file holds shapes for, compared, most differing first: the report's `traffic` section. */
export interface TrafficReport {
  /** The hours the shapes were seen over. */
  window: { since?: string; from: string | null; to: string | null };
  entries: TrafficComparison[];
}

/**
 * Each route's shapes against its code, most differing first, then by entry:
 * what `flowatlas contracts` reports and `observe --shapes` summarises.
 */
export const trafficReport = (
  shapes: Readonly<Record<string, EntryShapes>>,
  window: TrafficReport['window'],
  lookup: GraphLookup,
  options: TrafficOptions = {},
): TrafficReport => ({
  window,
  entries: Object.entries(shapes)
    .map(([entry, one]) => compareTraffic(entry, one, lookup, options))
    .sort((a, b) => b.differs - a.differs || (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0)),
});

/** The paths that differ, request first then by status, each once: what a summary line and the page's chip name. */
export const trafficPaths = (comparison: TrafficComparison): string[] => {
  const paths: string[] = [];
  const add = (prefix: string, side: TrafficSide | undefined): void => {
    for (const diff of side?.diffs ?? []) {
      if (diff.kind === 'declared_never_sent') continue;
      const said = `${prefix} ${diff.path === '' ? '(body)' : diff.path}`;
      if (!paths.includes(said)) paths.push(said);
    }
  };
  add('request', comparison.request);
  for (const [status, side] of Object.entries(comparison.responses ?? {})) add(status, side);
  return paths;
};
