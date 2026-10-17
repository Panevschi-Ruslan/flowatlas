import { kindOfRow, waysInOf, type GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, GraphDb } from '../db/reader.js';
import type { LinkReport } from '../report.js';
import type { RuleViolation } from '../rules/types.js';
import { deadChannels } from './dead.js';
import { byId } from './graph.js';

/**
 * What the reading found about the code, gathered into one list and ranked by
 * reach (P95): the "what should I look at" answer.
 *
 * Four kinds have a name of their own: a likely N+1 (`query-in-loop`, P69,
 * P89), a route nothing guards (`route-unguarded`, P76), a field two services
 * disagree about (the contracts report's errors and warnings) and a channel
 * with one end. Every other reason core classes a finding (P81) is listed under
 * its reason, so a finding added later is listed without a change here. A
 * broken architecture rule (P114) is a finding too, though no row records it:
 * kind `rule`, ranked by severity, then by the ways in reaching where it starts.
 */
export const FINDING_KINDS = ['n-plus-one', 'unguarded', 'contract-break', 'one-ended-channel', 'rule'] as const;
export type FindingKindName = (typeof FINDING_KINDS)[number];

/** The reasons whose rows are listed under a name of their own. */
const KIND_OF_REASON: Readonly<Record<string, FindingKindName>> = {
  'query-in-loop': 'n-plus-one',
  'route-unguarded': 'unguarded',
};

/** The kind a finding row is listed under: its own name, or its reason. */
export const findingKindOf = (reason: string): string => KIND_OF_REASON[reason] ?? reason;

/** What a rank was read from: the facts, so the order is one a reader can check. */
export interface FindingReach {
  /** The ways in that reach a loop's method (P89's `meta.waysIn`). */
  waysIn?: number;
  /** Writes and reads a route reaches. */
  writes?: number;
  reads?: number;
  /** Ways in that reach the sending side of a contract break. */
  callers?: number;
  /** Producers or consumers on the end of a channel that exists. */
  ends?: number;
}

export interface FindingRow {
  kind: string;
  /** The node the row is about: the loop's method, the route, the sending side, the channel. */
  id: string;
  /** The receiving side of a contract break. */
  to?: string;
  /** The method that handles a route. */
  method?: string;
  service: string;
  loc?: string;
  message: string;
  /** A contract break's severity. */
  severity?: string;
  reach: FindingReach;
  /** Place within its kind, 1 first; 0 until ranked. */
  rank: number;
}

/** As much of a contract finding as this reads: the contracts report is read loosely, as `dead` reads it. */
export interface ContractBreak {
  severity: string;
  kind: string;
  message: string;
  field?: string;
  edge: { from: string; to: string; type: string };
  ignored?: boolean;
}

/** Severities a contract finding is listed at, worst first; `info` is a remark, not a break. */
const SEVERITY_RANK: Readonly<Record<string, number>> = { error: 0, warning: 1 };

/** A rule's severities, worst first: an `info` rule is still a rule somebody wrote down. */
const RULE_SEVERITY_RANK: Readonly<Record<string, number>> = { error: 0, warning: 1, info: 2 };

export interface FindingSources {
  /** The rows to read, already split from the accepted ones. */
  rows: readonly AnchoredUnresolvedRow[];
  report?: LinkReport;
  contracts?: readonly ContractBreak[];
  /** The violations `evaluateRules` found, excused ones left out (P114). */
  rules?: readonly RuleViolation[];
}

export interface CollectedFindings {
  findings: FindingRow[];
  /**
   * Rows of a finding kind the reading set aside as notes, by kind: the
   * per-item loops (`query-in-loop` at `meta.severity: 'note'`), counted beside
   * the likely ones, never listed.
   */
  notes: Record<string, number>;
}

const locOf = (row: Pick<AnchoredUnresolvedRow, 'file' | 'line'>): string | undefined =>
  row.file === null ? undefined : row.line === null || row.line === 0 ? row.file : `${row.file}:${row.line}`;

const nodeLoc = (node: GraphNode | undefined): string | undefined =>
  node?.file === undefined ? undefined : node.line === undefined ? node.file : `${node.file}:${node.line}`;

/**
 * The route an unguarded row is about. The row names it as it is said
 * (`GET /orders/latest`), not by id, so the id is built from the service and
 * the words, and a route that is not where the words put it is looked for by
 * its label.
 */
const routeOfRow = (db: GraphDb, row: AnchoredUnresolvedRow): GraphNode | undefined => {
  if (row.node === null) return undefined;
  const exact = db.node(row.node);
  if (exact !== undefined) return exact;
  const said = /^([A-Z]+) (\S+)$/.exec(row.node);
  if (said === null || row.service === null) return undefined;
  return (
    db.node(`entry:${row.service}:http:${said[1]}:${said[2]}`) ??
    db.nodesByType('entry', 'http').find((entry) => entry.repo === row.service && entry.label === row.node)
  );
};

/** A row of the graph's findings as a finding: the node it is about, where, and what it says. */
const rowFinding = (db: GraphDb, row: AnchoredUnresolvedRow): FindingRow => {
  const kind = findingKindOf(row.reason);
  const route = kind === 'unguarded' ? routeOfRow(db, row) : undefined;
  const handler = route === undefined ? undefined : db.edgesFrom(route.id, ['handles'])[0]?.to;
  const loc = locOf(row);
  const ways = waysInOf(row);
  return {
    kind,
    id: route?.id ?? row.node ?? `gap:${row.service ?? ''}|${row.file ?? ''}|${row.reason}`,
    ...(handler === undefined ? {} : { method: handler }),
    service: row.service ?? route?.repo ?? '',
    ...(loc === undefined ? {} : { loc }),
    message: row.message,
    reach: ways === undefined ? {} : { waysIn: ways },
    rank: 0,
  };
};

/**
 * Every finding the sources hold, unranked.
 *
 * Rows the graph classes a finding (P81), a channel with one end (the rows
 * `dead` lists), and each contract break of the report that is an error or a
 * warning and not ignored. The per-item loops are notes and only counted.
 */
export const collectFindings = (db: GraphDb, sources: FindingSources): CollectedFindings => {
  const findings: FindingRow[] = [];
  const notes: Record<string, number> = {};
  for (const row of sources.rows) {
    const rowKind = kindOfRow(row);
    if (rowKind === 'note' && KIND_OF_REASON[row.reason] !== undefined) {
      const kind = findingKindOf(row.reason);
      notes[kind] = (notes[kind] ?? 0) + 1;
      continue;
    }
    if (rowKind !== 'finding' || row.level === 'nothing') continue;
    findings.push(rowFinding(db, row));
  }
  for (const channel of deadChannels(db, sources.report)) {
    const node = db.node(channel.id);
    const loc = nodeLoc(node);
    findings.push({
      kind: 'one-ended-channel',
      id: channel.id,
      service: [...channel.producers, ...channel.consumers][0] ?? node?.repo ?? '',
      ...(loc === undefined ? {} : { loc }),
      message: channel.reason,
      reach: {},
      rank: 0,
    });
  }
  for (const item of sources.contracts ?? []) {
    if (item.ignored === true || SEVERITY_RANK[item.severity] === undefined) continue;
    const sender = db.node(item.edge.from);
    const loc = nodeLoc(sender);
    findings.push({
      kind: 'contract-break',
      id: item.edge.from,
      to: item.edge.to,
      service: sender?.repo ?? '',
      ...(loc === undefined ? {} : { loc }),
      message: item.message,
      severity: item.severity,
      reach: {},
      rank: 0,
    });
  }
  for (const violation of sources.rules ?? []) {
    const loc = violation.at === undefined ? undefined : violation.at.line === undefined ? violation.at.file : `${violation.at.file}:${violation.at.line}`;
    findings.push({
      kind: 'rule',
      id: violation.from,
      to: violation.to,
      service: violation.fromService,
      ...(loc === undefined ? {} : { loc }),
      message: `${violation.rule}: ${violation.message}`,
      severity: violation.severity,
      reach: {},
      rank: 0,
    });
  }
  return { findings, notes };
};

/** The edges a walk from a route follows to what it reaches, as `get_flow` does. */
const FORWARD = ['handles', 'calls', 'queries', 'caches', 'emits', 'consumes', 'http_calls', 'hits', 'triggers'] as const;

/** How far the walks that measure reach go: far enough for a chain across services, bounded (I9). */
const REACH_WALK = { maxDepth: 12, maxNodes: 2000 } as const;

/** The writes and the reads a route reaches. */
const storeReachOf = (db: GraphDb, id: string): { writes: number; reads: number } => {
  let writes = 0;
  let reads = 0;
  for (const row of db.traverse({ from: id, direction: 'out', edgeTypes: FORWARD, ...REACH_WALK }).rows) {
    if (row.type !== 'db_query') continue;
    if (row.meta['op'] === 'write') writes += 1;
    else if (row.meta['op'] === 'read') reads += 1;
  }
  return { writes, reads };
};

/** The ways in that reach a node, itself included when it is one. */
const waysInto = (db: GraphDb, id: string): number =>
  db.traverse({ from: id, direction: 'in', edgeTypes: FORWARD, ...REACH_WALK }).rows.filter((row) => row.type === 'entry').length;

/** Most first, then by id and place, so a tie reads the same on every machine. */
const most = (a: number | undefined, b: number | undefined): number => (b ?? 0) - (a ?? 0);
const byPlace = (a: FindingRow, b: FindingRow): number => byId(a.id, b.id) || byId(a.loc ?? '', b.loc ?? '') || byId(a.message, b.message);

/**
 * How each kind measures and orders its rows (D3: the rank is a fact read off
 * the graph). A Strategy by kind; a kind with none ranks by the ways in a row
 * recorded, then by place.
 */
interface Ranker {
  measure?: (db: GraphDb, row: FindingRow) => FindingReach;
  order: (a: FindingRow, b: FindingRow) => number;
}

const RANKERS: Readonly<Record<string, Ranker>> = {
  'n-plus-one': { order: (a, b) => most(a.reach.waysIn, b.reach.waysIn) || byPlace(a, b) },
  unguarded: {
    measure: (db, row) => storeReachOf(db, row.id),
    order: (a, b) => most(a.reach.writes, b.reach.writes) || most(a.reach.reads, b.reach.reads) || byPlace(a, b),
  },
  'contract-break': {
    measure: (db, row) => ({ callers: waysInto(db, row.id) }),
    order: (a, b) =>
      (SEVERITY_RANK[a.severity ?? ''] ?? 9) - (SEVERITY_RANK[b.severity ?? ''] ?? 9) ||
      most(a.reach.callers, b.reach.callers) ||
      byPlace(a, b) ||
      byId(a.to ?? '', b.to ?? ''),
  },
  rule: {
    measure: (db, row) => ({ callers: waysInto(db, row.id) }),
    order: (a, b) =>
      (RULE_SEVERITY_RANK[a.severity ?? ''] ?? 9) - (RULE_SEVERITY_RANK[b.severity ?? ''] ?? 9) ||
      most(a.reach.callers, b.reach.callers) ||
      byPlace(a, b) ||
      byId(a.to ?? '', b.to ?? ''),
  },
  'one-ended-channel': {
    measure: (db, row) => ({ ends: db.edgesTo(row.id, ['emits']).length + db.edgesFrom(row.id, ['consumes']).length }),
    order: (a, b) => most(a.reach.ends, b.reach.ends) || byPlace(a, b),
  },
};

const DEFAULT_RANKER: Ranker = { order: (a: FindingRow, b: FindingRow) => most(a.reach.waysIn, b.reach.waysIn) || byPlace(a, b) };

/** The order kinds are listed in: the four named kinds, then every other by name. */
export const compareFindingKinds = (a: string, b: string): number => {
  const at = (kind: string): number => {
    const index = (FINDING_KINDS as readonly string[]).indexOf(kind);
    return index < 0 ? FINDING_KINDS.length : index;
  };
  return at(a) - at(b) || byId(a, b);
};

/**
 * The findings ranked by reach (P95): each kind measured and ordered by its
 * Strategy, `rank` its place within the kind, kinds in `compareFindingKinds`
 * order. The N+1 behind every request comes before the one behind an admin
 * export, an unguarded route that writes before one that only reads, an error
 * before a warning and a busier sender first.
 */
export const rankFindings = (db: GraphDb, rows: readonly FindingRow[]): FindingRow[] => {
  const byKind = new Map<string, FindingRow[]>();
  for (const row of rows) {
    const ranker = RANKERS[row.kind] ?? DEFAULT_RANKER;
    const measured = ranker.measure === undefined ? { ...row } : { ...row, reach: { ...row.reach, ...ranker.measure(db, row) } };
    byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), measured]);
  }
  return [...byKind.keys()].sort(compareFindingKinds).flatMap((kind) =>
    (byKind.get(kind) ?? [])
      .sort((RANKERS[kind] ?? DEFAULT_RANKER).order)
      .map((row, index) => ({ ...row, rank: index + 1 })),
  );
};
