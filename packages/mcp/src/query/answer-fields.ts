import { ANSWER_READ_META, ANSWER_UNREAD_META, parseTypeRef, type FieldRead, type FieldUnread, type TypeRefAst } from '@flowatlas/core';
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

/** The answer's fields as one route's clients read them, against what it answers. */
export interface AnswerSaid {
  /** What the route answers, as its handler declares it. */
  type?: string;
  reads: AnswerRead[];
  /** `guarded`: every read of it there checks it is there first, so the client copes without it (P395). */
  missing: Array<{ field: string; id: string; line: number; file?: string; guarded?: true }>;
  unused: Array<{ field: string }>;
}

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
  const compared = compareFields(
    fields === undefined ? [] : [{ id: entry, sends: fields }],
    readings.map(({ id, reading }) => ({ id, label: `the answer to ${db.node(id)?.label ?? id} (${id})`, reading })),
    field,
    (use) => db.node(use.id)?.label ?? use.id,
  );
  if (fields === undefined) left.push(`unsure: what ${db.node(entry)?.label ?? entry} answers is not a shape read, so no read was compared`);
  // A request no reader followed says so in its own words: its answer was not read.
  const said = compared.left
    .filter((line) => !line.startsWith('unsure: a receiver hands the value'))
    .map((line) => line.replace(/was not read for the fields it reads$/, 'was not read for the fields its client reads'));
  // A client that hands the answer where it is not read may read any field there: none is said unused.
  const handedOn = readings.some(({ reading }) => reading.unread.length > 0);
  const fileOf = (row: { field: string; id: string; line: number }): string | undefined => {
    for (const { reading } of readings) {
      for (const site of reading.reads) {
        if (topField(site.field) === row.field && site.id === row.id && site.line === row.line) return reading.files.get(`${site.field}|${site.id}|${site.line}`);
      }
    }
    return undefined;
  };
  /** Every read of the field at that place checks it is there first. */
  const guardedAt = (row: { field: string; id: string; line: number }): boolean => {
    const sites = readings.flatMap(({ reading }) =>
      reading.reads.filter((site) => topField(site.field) === row.field && site.id === row.id && site.line === row.line).map((site) => reading.guarded.has(`${site.field}|${site.id}|${site.line}`)),
    );
    return sites.length > 0 && sites.every(Boolean);
  };
  return {
    answer: {
      ...(type === undefined ? {} : { type }),
      reads: reads.slice(0, MOST_READS),
      missing: compared.missing.map((row) => {
        const file = fileOf(row);
        return { field: row.field, id: row.id, line: row.line, ...(file === undefined ? {} : { file }), ...(guardedAt(row) ? { guarded: true as const } : {}) };
      }),
      unused: handedOn ? [] : compared.unused.map((row) => ({ field: row.field })),
    },
    left: [...left, ...said],
  };
};
