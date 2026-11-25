import { ANSWER_READ_META, ANSWER_UNREAD_META, answerWrapsOf, parseTypeRef, type FieldRead, type FieldUnread, type TypeRefAst } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { compareFields } from '../tools/fields-contract.js';
import { readsField, shapeFields, topField, type Reading } from './fields.js';

/**
 * The fields of a route's answer each client that asks for it reads (P391),
 * put together from what the front-end readers wrote on each request:
 * `answerRead`, the field, the code or template it is read in and the line,
 * and `answerUnread`, each use the reading could not follow. Set against
 * what the route's handler answers: a field read and never answered
 * (`missing`), and one answered and read by no client (`unused`, said only
 * where every caller's answer was read).
 */

/** The edges a request reaches a route by. */
const REQUEST_EDGES = ['http_calls', 'hits'] as const;

/** At most this many reads are listed; the rest are counted in `left`. */
const MOST_READS = 40;

/** One read of the answer: the field, where, and the request whose answer it is. */
export interface AnswerRead {
  field: string;
  id: string;
  line: number;
  /** The template it is written in, where the read is not in code. */
  file?: string;
  /** The request whose answer it reads, where the route has more than one caller. */
  call?: string;
  /** The code checks the field is there first: it handles its absence (P395). */
  guarded?: true;
}

/**
 * What one request's client reads of its answer, or that it was not read
 * (`known: false`, a request no front-end reader followed); `files` keys a
 * read written in a template (`field|id|line`) to that template.
 */
export const answerReadingOf = (db: GraphDb, call: string): Reading & { files: Map<string, string>; guarded: Set<string> } => {
  const meta = db.node(call)?.meta;
  const reads = meta?.[ANSWER_READ_META];
  const files = new Map<string, string>();
  const guarded = new Set<string>();
  if (!Array.isArray(reads)) return { known: false, reads: [], unread: [], files, guarded };
  const unread = meta?.[ANSWER_UNREAD_META];
  return {
    known: true,
    reads: (reads as FieldRead[]).map((row) => {
      const id = row.in ?? call;
      if (row.file !== undefined) files.set(`${row.field}|${id}|${row.line}`, row.file);
      if (row.guarded === true) guarded.add(`${row.field}|${id}|${row.line}`);
      return { field: row.field, id, line: row.line, ...(row.switched === undefined ? {} : { switched: row.switched }) };
    }),
    unread: (Array.isArray(unread) ? (unread as FieldUnread[]) : []).map((row) => ({ id: row.in ?? call, line: row.line, why: row.why })),
    files,
    guarded,
  };
};

const parse = (ref: string): TypeRefAst | undefined => {
  try {
    return parseTypeRef(ref);
  } catch {
    return undefined;
  }
};

/** Wrappers an answer is declared in that are not its shape: a list's element, a promise's or observable's value. */
const WRAPPERS: ReadonlySet<string> = new Set(['Promise', 'Observable', 'Array', 'ReadonlyArray']);

/** The fields an answer's shape holds, outermost, a list's element's for a list; undefined where it says none. */
const fieldsOf = (db: GraphDb, ast: TypeRefAst | undefined, depth = 0): string[] | undefined => {
  if (ast === undefined || depth > 4) return undefined;
  if (ast.kind === 'array') return fieldsOf(db, ast.element, depth + 1);
  if (ast.kind === 'generic' && WRAPPERS.has(ast.name)) return fieldsOf(db, ast.args[0], depth + 1);
  if (ast.kind === 'object') return ast.fields.map((field) => field.name);
  if (ast.kind === 'id') return shapeFields(db, ast.id);
  if (ast.kind === 'union') {
    const shaped = ast.members.filter((member) => !(member.kind === 'primitive' && ['null', 'undefined'].includes(member.name)));
    const parts = shaped.map((member) => fieldsOf(db, member, depth + 1));
    return parts.length === 0 || parts.some((part) => part === undefined) ? undefined : [...new Set(parts.flat() as string[])];
  }
  return undefined;
};

/** The fields a route answers with, by its handler's declared return; undefined where it is not a shape read. */
export const answerFieldsOf = (db: GraphDb, entry: string): string[] | undefined => {
  const returns = db.edgesFrom(entry, ['handles'])[0]?.returns;
  return returns === undefined ? undefined : fieldsOf(db, parse(returns));
};

/**
 * What the wire carries where interceptors reshape a route's answer on the
 * way out (P400), read off the route's `answerWraps`.
 */
export interface AnswerWire {
  /** The fields the outermost envelope holds, where one wraps the answer. */
  outer?: string[];
  /** The path to the declared answer inside the envelopes, outermost first: `data`, `result.data`. */
  path?: string;
  /** Fields of the answer's class left out on the way out, each with what leaves it out. */
  excluded: Map<string, string>;
  /** Why what an interceptor does to the answer was not read, where one was not. */
  unread?: string;
  /** In words, for an answer to say: `{ success, data: StoreCard } (EnvelopeInterceptor)`. */
  said: string;
}

/** What the interceptors around a route make of its answer; undefined where none reshapes it. */
export const answerWireOf = (db: GraphDb, entry: string): AnswerWire | undefined => {
  const wraps = answerWrapsOf(db.node(entry)?.meta);
  if (wraps.length === 0) return undefined;
  const excluded = new Map<string, string>();
  const unread = wraps.find((wrap) => wrap.unread !== undefined);
  // Innermost first: each envelope holds what the ones before it made.
  const intos: string[] = [];
  let outer: string[] | undefined;
  const type = db.edgesFrom(entry, ['handles'])[0]?.returns;
  let shape = typeSaid(type);
  for (const wrap of wraps) {
    for (const field of wrap.excluded ?? []) excluded.set(field, `${wrap.by} (@Exclude)`);
    if (wrap.envelope !== undefined) {
      intos.unshift(wrap.envelope.into);
      outer = wrap.envelope.fields;
      shape = `{ ${wrap.envelope.fields.map((field) => (field === wrap.envelope!.into ? `${field}: ${shape}` : field)).join(', ')} }`;
    }
  }
  const by = wraps.filter((wrap) => wrap.envelope !== undefined).map((wrap) => wrap.by);
  const left = [...excluded.keys()];
  const said = [
    ...(by.length === 0 ? [] : [`${shape} (${by.join(', ')})`]),
    ...(left.length === 0 ? [] : [`${left.join(', ')} left out by ${[...new Set(excluded.values())].join(', ')}`]),
    ...(unread === undefined ? [] : [`reshaped by ${unread.by} in a way not read (${unread.unread})`]),
  ].join('; ');
  return {
    ...(outer === undefined ? {} : { outer }),
    ...(intos.length === 0 ? {} : { path: intos.join('.') }),
    excluded,
    ...(unread?.unread === undefined ? {} : { unread: `${unread.by}: ${unread.unread}` }),
    said,
  };
};

/** A declared answer as a person writes it: `type:shop#Profile[]` is `Profile[]`. */
export const typeSaid = (type: string | undefined): string => (type === undefined ? 'a shape' : type.replace(/type:[^#\s]+#/g, ''));

/** One missing field of an answer, where it is read, and why it is missing. */
export interface AnswerMissing {
  field: string;
  id: string;
  line: number;
  file?: string;
  /** Every read of it there checks it is there first, so the client copes without it (P395). */
  guarded?: true;
  /** The field is the answer's, and what leaves it out on the way out (P400). */
  excluded?: string;
  /** Read at the top of an answer an envelope wraps (P400). */
  wrapped?: true;
  /** Why the comparison is not sure: an interceptor reshapes the answer in a way not read (P400). */
  unsure?: string;
}

/** The answer's fields as one route's clients read them, against what it answers. */
export interface AnswerSaid {
  /** What the route answers, as its handler declares it. */
  type?: string;
  /** What the wire carries, where interceptors reshape the answer on the way out (P400). */
  wire?: string;
  reads: AnswerRead[];
  missing: AnswerMissing[];
  unused: Array<{ field: string }>;
}

/** One client's reading as the part of the wire it reads: reads under `path` with it taken off, or the others. */
const partOf = (
  reading: Reading & { files: Map<string, string>; guarded: Set<string> },
  path: string,
  inner: boolean,
): Reading & { files: Map<string, string>; guarded: Set<string> } => {
  const files = new Map<string, string>();
  const guarded = new Set<string>();
  const reads = reading.reads.flatMap((site) => {
    const under = site.field.startsWith(`${path}.`);
    if (site.field === path || under !== inner) return [];
    const field = inner ? site.field.slice(path.length + 1) : site.field;
    const was = `${site.field}|${site.id}|${site.line}`;
    const now = `${field}|${site.id}|${site.line}`;
    const file = reading.files.get(was);
    if (file !== undefined) files.set(now, file);
    if (reading.guarded.has(was)) guarded.add(now);
    return [{ ...site, field }];
  });
  return { ...reading, reads, files, guarded };
};

/**
 * `check_contract` on a route, or on one request into it (P391): what the
 * clients read of the answer, with `field` only the reads of it, and where
 * that and the answer disagree. Undefined where no request into the route
 * was read for its answer and none could be.
 */
export const answerOf = (
  db: GraphDb,
  entry: string,
  field: string | undefined,
  only?: string,
): { answer: AnswerSaid; left: string[] } | undefined => {
  const callers = [...new Set(db.edgesTo(entry, [...REQUEST_EDGES]).map((edge) => edge.from))]
    .filter((id) => only === undefined || id === only)
    .sort();
  if (callers.length === 0) return undefined;
  const readings = callers.map((id) => ({ id, reading: answerReadingOf(db, id) }));
  // No client reads anything of the answer, nor hands it on: there is nothing to say about it.
  if (readings.every((each) => each.reading.reads.length === 0 && each.reading.unread.length === 0)) return undefined;
  const left: string[] = [];
  const fields = answerFieldsOf(db, entry);
  const type = db.edgesFrom(entry, ['handles'])[0]?.returns;
  const reads: AnswerRead[] = [];
  for (const { id, reading } of readings) {
    for (const site of reading.reads) {
      if (field !== undefined && !readsField(site.field, field)) continue;
      const file = reading.files.get(`${site.field}|${site.id}|${site.line}`);
      const guarded = reading.guarded.has(`${site.field}|${site.id}|${site.line}`);
      reads.push({
        field: site.field,
        id: site.id,
        line: site.line,
        ...(file === undefined ? {} : { file }),
        ...(callers.length > 1 ? { call: id } : {}),
        ...(guarded ? { guarded: true as const } : {}),
      });
    }
  }
  if (reads.length > MOST_READS) left.push(`page: ${reads.length - MOST_READS} more reads; ask with field`);
  // What the wire carries, where interceptors reshape the answer on the way out (P400).
  const wire = answerWireOf(db, entry);
  if (fields === undefined) left.push(`unsure: what ${db.node(entry)?.label ?? entry} answers is not a shape read, so no read was compared`);
  if (wire?.unread !== undefined) left.push(`unsure: the answer is reshaped on the way out in a way not read (${wire.unread}), so a field said missing may be sent`);
  const sent = fields === undefined ? undefined : fields.filter((name) => !(wire?.excluded.has(name) ?? false));
  const label = (id: string): string => `the answer to ${db.node(id)?.label ?? id} (${id})`;
  /** The reads of one part of the wire compared against what that part holds, each missing field named as the client reads it. */
  const comparePart = (part: 'inner' | 'outer'): { missing: AnswerMissing[]; unused: Array<{ field: string }>; left: string[] } => {
    const path = wire?.path;
    const parted = readings.map(({ id, reading }) => ({ id, reading: path === undefined ? reading : partOf(reading, path, part === 'inner') }));
    const holds = part === 'inner' ? sent : wire?.outer;
    const compared = compareFields(holds === undefined ? [] : [{ id: entry, sends: holds }], parted.map(({ id, reading }) => ({ id, label: label(id), reading })), field, (use) => db.node(use.id)?.label ?? use.id);
    const sitesOf = (row: { field: string; id: string; line: number }): Array<{ file: string | undefined; guarded: boolean }> =>
      parted.flatMap(({ reading }) =>
        reading.reads
          .filter((site) => topField(site.field) === row.field && site.id === row.id && site.line === row.line)
          .map((site) => {
            const key = `${site.field}|${site.id}|${site.line}`;
            return { file: reading.files.get(key), guarded: reading.guarded.has(key) };
          }),
      );
    const missing = compared.missing.map((row): AnswerMissing => {
      const sites = sitesOf(row);
      const file = sites.find((site) => site.file !== undefined)?.file;
      const excluded = part === 'inner' ? wire?.excluded.get(row.field) : undefined;
      return {
        field: part === 'inner' && path !== undefined ? `${path}.${row.field}` : row.field,
        id: row.id,
        line: row.line,
        ...(file === undefined ? {} : { file }),
        ...(sites.length > 0 && sites.every((site) => site.guarded) ? { guarded: true as const } : {}),
        ...(excluded === undefined ? {} : { excluded }),
        ...(part === 'outer' ? { wrapped: true as const } : {}),
        ...(wire?.unread === undefined ? {} : { unsure: wire.unread }),
      };
    });
    return { missing, unused: compared.unused.map((row) => ({ field: part === 'inner' && path !== undefined ? `${path}.${row.field}` : row.field })), left: compared.left };
  };
  const inner = comparePart('inner');
  // Read at the top of an answer an envelope wraps: compared against the envelope's own fields.
  const outer = wire?.path === undefined ? undefined : comparePart('outer');
  // A request no reader followed says so in its own words: its answer was not read.
  const said = [...new Set([...inner.left, ...(outer?.left ?? [])])]
    .filter((line) => !line.startsWith('unsure: a receiver hands the value'))
    .map((line) => line.replace(/was not read for the fields it reads$/, 'was not read for the fields its client reads'));
  // A client that hands the answer where it is not read may read any field there: none is said unused.
  const handedOn = readings.some(({ reading }) => reading.unread.length > 0);
  return {
    answer: {
      ...(type === undefined ? {} : { type }),
      ...(wire === undefined ? {} : { wire: wire.said }),
      reads: reads.slice(0, MOST_READS),
      missing: [...(outer?.missing ?? []), ...inner.missing],
      unused: handedOn ? [] : inner.unused,
    },
    left: [...left, ...said],
  };
};
