import { isMessageTypeNode, rowKindOf, waysInOf, type GraphNode, type Precision } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, GraphDb } from '../db/reader.js';
import type { LinkReport } from '../report.js';
import type { RuleViolation } from '../rules/types.js';
import { promoteGap, typesNeverPublished, type BoundaryFinding, type HeldBack } from './boundary.js';
import { deadChannels } from './dead.js';
import { byId } from './graph.js';

/**
 * What the reading found about the code, gathered into one list and ranked by
 * reach (P95): the "what should I look at" answer.
 *
 * What looks broken between the services comes first (P384): a call to a route
 * that does not exist, a field read that no sender sends, a type of message
 * handled that nothing publishes, a contract break, a route left unguarded
 * among guarded siblings, an annotation naming a missing route, a value the
 * deployment does not set. Each is gated on the fact that makes it a defect
 * (`boundary.ts`) and carries a `precision`; a candidate whose fact does not
 * hold is counted under `heldBack` with why.
 *
 * Four kinds have a name of their own: a likely N+1 (`query-in-loop`, P69,
 * P89), a route nothing guards (`route-unguarded`, P76), a field two services
 * disagree about (the contracts report's errors and warnings) and a channel
 * with one end. Every other reason core classes a finding (P81) is listed under
 * its reason, so a finding added later is listed without a change here. A
 * broken architecture rule (P114) is a finding too, though no row records it:
 * kind `rule`, ranked by severity, then by the ways in reaching where it starts.
 */
export const FINDING_KINDS = [
  'call-to-missing-route',
  'field-never-sent',
  'type-never-published',
  'contract-break',
  'unguarded-among-guarded',
  'annotation-to-missing-route',
  'env-not-set',
  'n-plus-one',
  'unguarded',
  'one-ended-channel',
  'rule',
] as const;
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
  /** Routes beside an unguarded one, in its controller, that a guard is in front of. */
  guardedSiblings?: number;
  /** Browser requests and screen or bot ways in that reach a route: a person can send it. */
  people?: number;
  /** Requests from other services that reach a route. */
  services?: number;
}

export interface FindingRow {
  kind: string;
  /** The node the row is about: the loop's method, the route, the sending side, the channel. */
  id: string;
  /** The sending side, where the row is about the receiving one: the request whose body lacks a field read (P384). */
  from?: string;
  /** The receiving side of a contract break; the channel, type or route of a defect between the services. */
  to?: string;
  /** The method that handles a route. */
  method?: string;
  service: string;
  loc?: string;
  message: string;
  /** A contract break's severity. */
  severity?: string;
  /** How often a finding of its kind is a real defect where its evidence holds (P384). */
  precision: Precision;
  /** The fact that makes it a defect, where one had to hold (P384). */
  evidence?: string;
  /** The nearest fix: the route it was probably meant for, the field or type it was probably renamed from. */
  fix?: string;
  /** The ids the fix names. */
  nearest?: string[];
  /** The ways in that reach the sending side: who meets it. */
  seenBy?: string[];
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
  /**
   * Every row of the graph, accepted ones too, that the evidence of a defect
   * is read from (P384): a route accepted as unread is still unread. `rows`
   * when absent.
   */
  all?: readonly AnchoredUnresolvedRow[];
  /** Findings worked out elsewhere, listed and ranked with these: the fields read that no sender sends (P384). */
  extra?: readonly FindingRow[];
}

export interface CollectedFindings {
  findings: FindingRow[];
  /**
   * Rows of a finding kind the reading set aside as notes, by kind: the
   * per-item loops (`query-in-loop` at `meta.severity: 'note'`), counted beside
   * the likely ones, never listed.
   */
  notes: Record<string, number>;
  /** Candidates whose evidence did not hold, by kind: how many, and why the first was held back (P384). */
  heldBack: Record<string, { count: number; why: string }>;
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

/**
 * How often a finding of each kind is a real defect where its evidence holds
 * (P384). A contract break is `high` at error and `medium` at warning; a kind
 * not named here, a reason listed under itself, is `medium`.
 */
const PRECISION: Readonly<Record<string, Precision>> = {
  'call-to-missing-route': 'high',
  'field-never-sent': 'high',
  'type-never-published': 'high',
  'annotation-to-missing-route': 'high',
  'unguarded-among-guarded': 'medium',
  'env-not-set': 'medium',
  'n-plus-one': 'medium',
  // Internal services are often unguarded by design: worth a look, not a verdict.
  unguarded: 'low',
  'one-ended-channel': 'medium',
  rule: 'high',
};

/** How sure a finding of a kind is, at a severity where the kind has several. */
export const precisionOf = (kind: string, severity?: string): Precision =>
  kind === 'contract-break' ? (severity === 'error' ? 'high' : 'medium') : (PRECISION[kind] ?? 'medium');

/** Wrapping that can refuse a request, as the route audit reads it. */
const GATE_LAYERS: ReadonlySet<string> = new Set(['guard', 'middleware']);

/** The guards in front of a route, by label; none for a route nothing guards. */
const gatesOf = (db: GraphDb, id: string): string[] =>
  db
    .edgesFrom(id, ['guarded_by'])
    .filter((edge) => GATE_LAYERS.has(String(edge.meta?.['layer'] ?? '')))
    .map((edge) => db.node(edge.to)?.label ?? edge.to);

/**
 * The routes beside one, in its controller (or its file where no controller
 * is named), that a guard is in front of: the deviance an unguarded route is
 * ranked by (P384, after "bugs as deviant behaviour"). A sibling the audit
 * itself calls unguarded, its guard skipped, is not counted.
 */
const guardedSiblingsOf = (
  db: GraphDb,
  route: GraphNode,
  unguarded: ReadonlySet<string>,
): { siblings: number; guarded: number; guards: string[]; controller: string } => {
  const controller = String(route.meta?.['controller'] ?? '');
  const siblings = db
    .nodesByType('entry', 'http')
    .filter(
      (other) =>
        other.id !== route.id &&
        other.repo === route.repo &&
        (controller === '' ? other.file === route.file : String(other.meta?.['controller'] ?? '') === controller),
    );
  const guards = new Set<string>();
  let guarded = 0;
  for (const sibling of siblings) {
    if (unguarded.has(sibling.id)) continue;
    const gates = gatesOf(db, sibling.id);
    if (gates.length === 0) continue;
    guarded += 1;
    for (const gate of gates) guards.add(gate);
  }
  return { siblings: siblings.length, guarded, guards: [...guards].sort(byId), controller: controller === '' ? (route.file ?? '') : controller };
};

/** A sentence without its full stop, so a clause can follow it. */
const unstopped = (text: string): string => (text.endsWith('.') ? text.slice(0, -1) : text);

/** A row of the graph's findings as a finding: the node it is about, where, and what it says. */
const rowFinding = (db: GraphDb, row: AnchoredUnresolvedRow, unguarded: ReadonlySet<string>): FindingRow => {
  const kind = findingKindOf(row.reason);
  const route = kind === 'unguarded' ? routeOfRow(db, row) : undefined;
  const handler = route === undefined ? undefined : db.edgesFrom(route.id, ['handles'])[0]?.to;
  const loc = locOf(row);
  const ways = waysInOf(row);
  const beside = route === undefined ? undefined : guardedSiblingsOf(db, route, unguarded);
  const deviant = beside !== undefined && beside.guarded > 0;
  const named = deviant ? 'unguarded-among-guarded' : kind;
  return {
    kind: named,
    id: route?.id ?? row.node ?? `gap:${row.service ?? ''}|${row.file ?? ''}|${row.reason}`,
    ...(handler === undefined ? {} : { method: handler }),
    service: row.service ?? route?.repo ?? '',
    ...(loc === undefined ? {} : { loc }),
    message: deviant
      ? `${unstopped(row.message)}, while ${beside.guarded} of the ${beside.siblings} other routes of ${beside.controller} have ${beside.guards.join(', ')} in front`
      : row.message,
    precision: precisionOf(named),
    ...(deviant ? { evidence: `the routes beside it in ${beside.controller} are guarded` } : {}),
    reach: { ...(ways === undefined ? {} : { waysIn: ways }), ...(deviant ? { guardedSiblings: beside.guarded } : {}) },
    rank: 0,
  };
};

/** A defect between the services as a finding row. */
const boundaryRow = (found: BoundaryFinding): FindingRow => ({
  kind: found.kind,
  id: found.id,
  ...(found.to === undefined ? {} : { to: found.to }),
  service: found.service,
  ...(found.loc === undefined ? {} : { loc: found.loc }),
  message: found.message,
  precision: found.precision,
  evidence: found.evidence,
  ...(found.fix === undefined ? {} : { fix: found.fix }),
  ...(found.nearest === undefined ? {} : { nearest: found.nearest }),
  ...(found.seenBy === undefined ? {} : { seenBy: found.seenBy }),
  reach: found.waysIn !== undefined ? { waysIn: found.waysIn } : found.seenBy === undefined ? {} : { waysIn: found.seenBy.length },
  rank: 0,
});

/** Counts one candidate held back under its kind, keeping why the first was. */
const holdBack = (into: Record<string, { count: number; why: string }>, held: HeldBack): void => {
  const already = into[held.kind];
  into[held.kind] = already === undefined ? { count: 1, why: held.why } : { ...already, count: already.count + 1 };
};

/** The reasons the route audit gives a route nothing in front of refuses. */
const UNGUARDED_REASONS: ReadonlySet<string> = new Set(['route-unguarded', 'route-guard-skipped']);

/**
 * Every finding the sources hold, unranked.
 *
 * Rows the graph classes a finding (P81), the gaps that are defects where
 * their evidence holds and the types of message handled that nothing
 * publishes (P384), a channel with one end (the rows `dead` lists), and each
 * contract break of the report that is an error or a warning and not ignored.
 * The per-item loops are notes and only counted; a defect whose evidence did
 * not hold is counted under `heldBack`.
 */
export const collectFindings = (db: GraphDb, sources: FindingSources): CollectedFindings => {
  const findings: FindingRow[] = [];
  const notes: Record<string, number> = {};
  const heldBack: Record<string, { count: number; why: string }> = {};
  const all = sources.all ?? sources.rows;
  const unguarded = new Set(all.filter((row) => UNGUARDED_REASONS.has(row.reason)).flatMap((row) => routeOfRow(db, row)?.id ?? []));
  for (const row of sources.rows) {
    const rowKind = rowKindOf(row);
    if (rowKind === 'note' && KIND_OF_REASON[row.reason] !== undefined) {
      const kind = findingKindOf(row.reason);
      notes[kind] = (notes[kind] ?? 0) + 1;
      continue;
    }
    if (rowKind === 'gap') {
      const promoted = promoteGap(db, row, all);
      if (promoted === undefined) continue;
      if ('held' in promoted) holdBack(heldBack, promoted.held);
      else findings.push(boundaryRow(promoted.finding));
      continue;
    }
    if (rowKind !== 'finding' || row.level === 'nothing') continue;
    findings.push(rowFinding(db, row, unguarded));
  }
  // Read off the graph rather than the rows, as the one-ended channels are:
  // only where the report is handed in, so counting a slice of rows does not
  // count them again.
  for (const promoted of sources.report === undefined ? [] : typesNeverPublished(db)) {
    if ('held' in promoted) holdBack(heldBack, promoted.held);
    else findings.push(boundaryRow(promoted.finding));
  }
  for (const channel of deadChannels(db, sources.report)) {
    const node = db.node(channel.id);
    // A type of message nothing selects is its own finding, listed by its reason (P358).
    if (isMessageTypeNode(node)) continue;
    const loc = nodeLoc(node);
    findings.push({
      kind: 'one-ended-channel',
      id: channel.id,
      service: [...channel.producers, ...channel.consumers][0] ?? node?.repo ?? '',
      ...(loc === undefined ? {} : { loc }),
      message: channel.reason,
      precision: precisionOf('one-ended-channel'),
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
      precision: precisionOf('contract-break', item.severity),
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
      precision: precisionOf('rule'),
      reach: {},
      rank: 0,
    });
  }
  findings.push(...(sources.extra ?? []));
  return { findings, notes, heldBack };
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
    // A delete changes stored data as a write does (P384).
    if (row.meta['op'] === 'write' || row.meta['op'] === 'delete') writes += 1;
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

/** The ways in a person reaches directly: a screen, a bot's command, button or event. */
const PERSON_KINDS: ReadonlySet<string> = new Set(['screen', 'bot_command', 'bot_callback', 'bot_event', 'scene_step']);

/**
 * Who sends a route directly (P384): a person, through a browser's request or
 * a request a bot or a screen's code makes, or only another service's code.
 * A route a person can send is ranked above one only services call, which is
 * often internal by design. Only the requests joined to the route itself are
 * counted: a person reaching another service that calls this one is that
 * service's caller, and its guard is the one in front of them.
 */
const sendersOf = (db: GraphDb, id: string): { people?: number; services?: number } => {
  let people = 0;
  let services = 0;
  for (const edge of db.edgesTo(id, ['hits', 'http_calls'])) {
    const request = db.node(edge.from);
    if (request?.type === 'ui_api_call') {
      people += 1;
      continue;
    }
    // Within the sending service only: the calls and handlers behind the request.
    const behind = db.traverse({ from: edge.from, direction: 'in', edgeTypes: ['calls', 'handles', 'triggers'], ...REACH_WALK }).rows;
    if (behind.some((row) => row.type === 'entry' && PERSON_KINDS.has(row.kind ?? ''))) people += 1;
    else services += 1;
  }
  return { ...(people === 0 ? {} : { people }), ...(services === 0 ? {} : { services }) };
};

/**
 * An unguarded route, ranked by deviance (P384): one whose siblings are
 * guarded first, then one that writes, then one a person can send, then one
 * that reads; one only other services call last.
 */
const UNGUARDED_RANKER: Ranker = {
  measure: (db, row) => ({ ...storeReachOf(db, row.id), ...sendersOf(db, row.id) }),
  order: (a, b) =>
    most(a.reach.guardedSiblings, b.reach.guardedSiblings) ||
    most(a.reach.writes, b.reach.writes) ||
    most(a.reach.people, b.reach.people) ||
    most(a.reach.reads, b.reach.reads) ||
    byPlace(a, b),
};

const RANKERS: Readonly<Record<string, Ranker>> = {
  'n-plus-one': { order: (a, b) => most(a.reach.waysIn, b.reach.waysIn) || byPlace(a, b) },
  unguarded: UNGUARDED_RANKER,
  'unguarded-among-guarded': UNGUARDED_RANKER,
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

/** The order kinds are listed in: what looks broken between the services first, the named kinds, then every other by name. */
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
 * export, an unguarded route among guarded siblings before one that writes,
 * and that before one only another service calls, an error before a warning
 * and a busier sender first.
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
