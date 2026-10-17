import {
  acceptedKeyOf,
  describeAccepted,
  describeAcceptedProblem,
  failuresOf,
  groupFailures,
  type FailureGroup,
  gapIdOf,
  isRule,
  kindOfRow,
  rankByReach,
  readAccepted,
  waysInOf,
  type AcceptedRead,
  type GraphNode,
  type RowKind,
} from '@flowatlas/core';
import { acceptedSplitOf, type AnchoredUnresolvedRow, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, truncate } from '../query/detail.js';
import { MAX_NEXT, nextFor, withNext, type Identified } from '../query/next.js';
import type { CompactNode } from '../query/types.js';
import { rankMatches } from './entries.js';
import {
  bound,
  callOf,
  commonInput,
  inService,
  nextOutput,
  pageInput,
  READ_ONLY,
  serviceInput,
  withDb,
  type Bounded,
  type ToolContext,
} from './common.js';

/**
 * One search box over everything a question starts from (P72).
 *
 * A Strategy per kind: each says how to find its rows for a query, and every
 * row carries the `id` the next tool takes, so a search hands straight on to
 * get_flow, who_emits, get_type or impact. A gap's id is
 * `gap:<service>|<file>|<reason>`, the one `flowatlas accept` takes.
 */
export const SEARCH_KINDS = ['routes', 'channels', 'tables', 'types', 'gaps', 'fails', 'classes'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Node types that are a class in the code: what DI wires and what a page renders. */
const CLASS_TYPES = ['provider', 'module', 'guard', 'interceptor', 'pipe', 'middleware', 'ui_component'] as const;

export interface GapHit {
  id: string;
  type: 'gap';
  reason: string;
  /**
   * What the row is about (P81): `gap` when the reader could not follow
   * something, `note` for how a join or a reading was made, `finding` for
   * something about the code itself. Every row is searched, whatever its kind.
   */
  kind: RowKind;
  service?: string;
  loc?: string;
  message: string;
  accepted?: true;
  note?: string;
  /** The rule that accepted it, when a rule did rather than an entry for this one place (P76). */
  acceptedBy?: string;
  /** `likely` or `note`, where the row says how sure it is (P89: a loop that runs a query per item). */
  severity?: string;
  /** How many ways in of its service reach the place, where the row says; hits are ranked by it (P89). */
  waysIn?: number;
}

export interface TypeHit {
  id: string;
  type: 'type';
  label: string;
  service?: string;
}

/** A way in that can fail with an exception: the id is the way in's, for get_flow. */
export interface FailHit {
  id: string;
  type: 'entry';
  label: string;
  /** The first answer on the route the query matched, by status then exception. */
  exception: string;
  status?: number;
  /** That status is the framework's default, written nowhere on the path (P87). */
  assumed?: true;
  /** How many places on the route raise that answer. */
  sites: number;
  /** Other answers on the same route the query matched too, when there are any. */
  more?: number;
  service?: string;
}

type Hit = CompactNode | GapHit | TypeHit | FailHit;

interface SearchQuery {
  db: GraphDb;
  text: string;
  service: string | undefined;
  limit: number;
  /** Where each kind's page starts (P93): one offset pages every kind at once. */
  offset: number;
  bounded: Bounded;
  accepted: AcceptedRead;
}

type Finder = (query: SearchQuery) => { rows: Hit[]; total: number };

/** One page of a kind's rows, and how many it has in all. */
const cut = <T>(rows: readonly T[], limit: number, offset: number): { rows: T[]; total: number } => {
  const page = truncate(rows, limit, offset);
  return { rows: page.items, total: page.total };
};

const nodesOf =
  (types: readonly string[]): Finder =>
  ({ db, text, service, limit, offset, bounded }) => {
    const pool: GraphNode[] = types.flatMap((type) => db.nodesByType(type)).filter(inService(service));
    const ranked = rankMatches(pool, text);
    return cut(
      ranked.map((match) => projectDetail(match.node, bounded.detail)),
      limit,
      offset,
    );
  };

const types: Finder = ({ db, text, service, limit, offset }) => {
  const wanted = text.toLowerCase();
  const rows = db
    .allTypes(service === undefined ? {} : { repo: service })
    .filter((entry) => entry.name.toLowerCase().includes(wanted) || entry.id.toLowerCase().includes(wanted))
    .sort((a, b) => a.name.length - b.name.length || (a.id < b.id ? -1 : 1))
    .map((entry): TypeHit => ({
      id: entry.id,
      type: 'type',
      label: entry.name,
      service: entry.declaredIn.split('#')[0] ?? '',
    }));
  return cut(rows, limit, offset);
};

const gapText = (row: AnchoredUnresolvedRow): string =>
  `${row.reason} ${row.file ?? ''} ${row.message}`.toLowerCase();

const gaps: Finder = ({ db, text, service, limit, offset, accepted }) => {
  const wanted = text.toLowerCase();
  const seen = new Set<string>();
  const rows: GapHit[] = [];
  // Rows reached from more ways in first, among themselves (P89), so the one
  // hit a file keeps is its busiest, and the hits are ranked the same way. A
  // finding before a note reached alike: a file holding a likely N+1 and a
  // per-item loop shares one gap id, and keeps the hit worth fixing (P130).
  const candidates = rankByReach(
    db.allUnresolved().filter((row) => (service === undefined || row.service === service) && gapText(row).includes(wanted)),
    waysInOf,
    (a, b) => Number(kindOfRow(a) === 'note') - Number(kindOfRow(b) === 'note'),
  );
  // Which entry took each row, as every other surface decides it (P80).
  const split = acceptedSplitOf(db, candidates, accepted);
  candidates.forEach((row, index) => {
    const id = gapIdOf(row);
    const entry = split.byEntry[index];
    // One row per gap id: the same reason in one file is one thing to accept —
    // unless a route rule took some of that file's rows and not the others.
    const key = `${id}\u0000${entry === undefined ? '' : acceptedKeyOf(entry)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      id,
      type: 'gap',
      reason: row.reason,
      kind: kindOfRow(row),
      ...(row.service === null ? {} : { service: row.service }),
      ...(row.file === null ? {} : { loc: row.line === null ? row.file : `${row.file}:${row.line}` }),
      message: row.message,
      ...(typeof row.meta?.['severity'] === 'string' ? { severity: row.meta['severity'] } : {}),
      ...(waysInOf(row) === undefined ? {} : { waysIn: waysInOf(row) }),
      ...(entry === undefined
        ? {}
        : {
            accepted: true as const,
            ...(entry.note === '' ? {} : { note: entry.note }),
            ...(isRule(entry) ? { acceptedBy: describeAccepted(entry) } : {}),
          }),
    });
  });
  // New gaps first: an accepted one is the least likely to be the question.
  rows.sort((a, b) => Number(a.accepted === true) - Number(b.accepted === true));
  return cut(rows, limit, offset);
};

/**
 * Ways in by what they can fail with: the exception's name or its status
 * (P68). One hit per route, naming the first answer that matched and how many
 * more did (P87).
 */
const fails: Finder = ({ db, text, service, limit, offset }) => {
  const wanted = text.toLowerCase();
  const rows: FailHit[] = [];
  for (const node of db.nodesByType('entry').filter(inService(service))) {
    // A helper's choices are what it can answer (P90): found by any of them.
    const said = (group: FailureGroup): string =>
      [
        group.status === undefined ? group.exception : `${group.status} ${group.exception}`,
        ...(group.chosenFrom ?? []).map((choice) => (choice.status === undefined ? choice.exception : `${choice.status} ${choice.exception}`)),
      ].join('\n');
    const matched = groupFailures(failuresOf(node)).filter((group) => said(group).toLowerCase().includes(wanted));
    const [first] = matched;
    if (first === undefined) continue;
    rows.push({
      id: node.id,
      type: 'entry',
      label: node.label,
      exception: first.exception,
      ...(first.status === undefined ? {} : { status: first.status }),
      ...(first.assumed === true ? { assumed: true as const } : {}),
      sites: first.sites,
      ...(matched.length > 1 ? { more: matched.length - 1 } : {}),
      service: node.repo,
    });
  }
  rows.sort((a, b) => (a.exception < b.exception ? -1 : a.exception > b.exception ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cut(rows, limit, offset);
};

const FINDERS: ReadonlyMap<SearchKind, Finder> = new Map<SearchKind, Finder>([
  ['routes', nodesOf(['entry'])],
  ['channels', nodesOf(['channel'])],
  ['tables', nodesOf(['table'])],
  ['types', types],
  ['gaps', gaps],
  ['fails', fails],
  ['classes', nodesOf(CLASS_TYPES)],
]);

/** The hint for a gap row: what reaches the place, read off the node it names. */
const anchorOf = (hit: Hit): Identified | undefined => (hit.type === 'gap' ? undefined : hit);

/** What search answers: per kind, how many match in all and one page of them. */
export const searchOutput = {
  query: z.string(),
  counts: z.record(z.string(), z.number()),
  results: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        label: z.string().optional(),
        loc: z.string().optional(),
        service: z.string().optional(),
        kind: z.string().optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
        reason: z.string().optional(),
        message: z.string().optional(),
        accepted: z.literal(true).optional(),
        note: z.string().optional(),
        acceptedBy: z.string().optional(),
        severity: z.string().optional(),
        waysIn: z.number().optional(),
        exception: z.string().optional(),
        status: z.number().optional(),
        assumed: z.literal(true).optional(),
        sites: z.number().optional(),
        more: z.number().optional(),
      }),
    ),
  ),
  truncated: z.string().optional(),
  nextOffset: z.number().optional(),
  note: z.string().optional(),
  next: nextOutput,
};

export const runSearch = (
  db: GraphDb,
  input: { query: string; kinds?: readonly SearchKind[]; service?: string; limit: number; offset?: number },
  bounded: Bounded,
  accepted: AcceptedRead,
): {
  results: Partial<Record<SearchKind, Hit[]>>;
  counts: Partial<Record<SearchKind, number>>;
  next: string[];
  /** Kinds with rows past this page, and how many each has left. */
  more: Partial<Record<SearchKind, number>>;
} => {
  const text = input.query.trim();
  const offset = input.offset ?? 0;
  const kinds = input.kinds === undefined || input.kinds.length === 0 ? SEARCH_KINDS : input.kinds;
  const results: Partial<Record<SearchKind, Hit[]>> = {};
  const counts: Partial<Record<SearchKind, number>> = {};
  const more: Partial<Record<SearchKind, number>> = {};
  const firsts: Array<Identified | undefined> = [];
  for (const kind of kinds) {
    const found = FINDERS.get(kind)!({ db, text, service: input.service, limit: input.limit, offset, bounded, accepted });
    if (found.total === 0) continue;
    results[kind] = found.rows;
    counts[kind] = found.total;
    const left = found.total - Math.min(offset, found.total) - found.rows.length;
    if (left > 0) more[kind] = left;
    if (found.rows[0] !== undefined) firsts.push(anchorOf(found.rows[0]));
  }
  return { results, counts, more, next: nextFor(...firsts) };
};

/** The defaults a hint for the next page leaves out. */
const SEARCH_DEFAULTS: Readonly<Record<string, unknown>> = { limit: 10, detail: 1, maxNodes: 150, offset: 0 };

export const registerSearch = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'search',
    {
      title: 'Search everything',
      description: 'One query over routes, channels, tables, types, gaps, failures and classes.',
      inputSchema: {
        query: z.string().min(1),
        kinds: z.array(z.enum(SEARCH_KINDS)).optional(),
        limit: z.number().int().min(1).max(100).default(10).describe('rows per kind'),
        service: serviceInput,
        ...commonInput,
        ...pageInput,
      },
      outputSchema: searchOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const bounded = bound(input);
        const accepted = readAccepted(ctx.handle.path);
        const limit = Math.min(input.limit, bounded.maxNodes);
        const { results, counts, more, next } = runSearch(
          db,
          {
            query: input.query,
            ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
            ...(input.service === undefined ? {} : { service: input.service }),
            limit,
            offset: input.offset,
          },
          bounded,
          accepted,
        );
        if (Object.keys(counts).length === 0) return { error: `nothing matches ${JSON.stringify(input.query)}` };
        // An accepted.json that could not be read marks nothing accepted, and says so (P80).
        const notes = [
          ...(bounded.note === undefined ? [] : [bounded.note]),
          ...(accepted.problem === undefined || counts.gaps === undefined ? [] : [`${describeAcceptedProblem(accepted.problem)}.`]),
        ];
        // One offset pages every kind; the next page asks again for the kinds that have more.
        const cutKinds = Object.keys(more) as SearchKind[];
        const nextOffset = input.offset + limit;
        const paging =
          cutKinds.length === 0
            ? {}
            : {
                truncated: `${cutKinds.map((kind) => `${kind} ${more[kind]!} more`).join(', ')}; next page offset ${nextOffset}`,
                nextOffset,
              };
        const page =
          cutKinds.length === 0
            ? []
            : [
                callOf(
                  'search',
                  { query: input.query, kinds: cutKinds, limit: input.limit, service: input.service, detail: input.detail, maxNodes: input.maxNodes, offset: nextOffset },
                  SEARCH_DEFAULTS,
                ),
              ];
        return withNext(
          { query: input.query, counts, results, ...paging, ...(notes.length === 0 ? {} : { note: notes.join(' ') }) },
          [...page, ...next].slice(0, MAX_NEXT),
        );
      }),
  );
};
