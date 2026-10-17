import {
  countsOf,
  describeAccepted,
  describeAcceptedProblem,
  gapIdOf,
  isRule,
  kindOfRow,
  riskOf,
  ROW_KINDS,
  STEP_OF_META,
  type AcceptedGap,
  type AcceptedProblem,
  type GraphEdge,
  type GraphNode,
  type Risk,
  type RowKind,
  type TypeEntry,
  waysInOf,
} from '@flowatlas/core';
import type { AnchoredUnresolvedRow, LinkReport } from '@flowatlas/linker';
import { stableKeys, type PackedKeys } from './keys.js';
import { packMap, type MapInput, type PackedMap } from './map-pack.js';
import type { Observed } from '../observe/match.js';
import { packObserved, type PackedObserved } from './observed.js';

export type { PackedObserved };
import { packShapes, type PackedShapes } from './shapes.js';
import { packSites, type PackedSites } from './sites.js';
import { packBusiest, type PackedBusiest } from './busiest.js';
import type { PackedChanges } from './changes.js';

export type { PackedBusiest, PackedChanges };
import { failuresByEntry, packFails, type PackedFailRecord, type PackedFails } from './fails.js';
import { dictionary, wordsOf, type Word } from './dictionary.js';
import { packAccess, type PackedAccess } from './access.js';
import { packCantFollow, type PackedCantFollow } from './cant-follow.js';
import { packIds } from './node-ids.js';
import { packOverview, type OverviewInput, type PackedOverview } from './overview.js';

export type { PackedAccess };

export type { PackedFails, PackedFailRecord, PackedCantFollow };

/**
 * What each node logs (P71), by node position, as `[level, line, template?]`;
 * `level` is a position in `dicts.logLevels` and `template` one in
 * `dicts.logTexts`, or the word itself where listing it would not pay (P84,
 * `wordsOf`): a handful of levels repeat on every line, a template seldom.
 */
export type PackedLogs = Record<number, Array<[level: Word, line: number, text?: Word]>>;

type LogLine = { level?: unknown; text?: unknown; at?: unknown };

/** A doc block about a node, as the details panel lists it (P120). */
export type PackedDocs = Record<number, Array<[file: string, line: number, kind: string, state: string]>>;

/** One block of the index, as the pack reads it: about which node, where, and what a check said now. */
export interface PackDoc {
  node: string;
  file: string;
  line: number;
  kind: string;
  state: string;
}

const packDocs = (docs: readonly PackDoc[] | undefined, position: ReadonlyMap<string, number>): PackedDocs | undefined => {
  if (docs === undefined) return undefined;
  const packed: PackedDocs = {};
  for (const doc of docs) {
    const at = position.get(doc.node);
    if (at === undefined) continue;
    (packed[at] ??= []).push([doc.file, doc.line, doc.kind, doc.state]);
  }
  return Object.keys(packed).length === 0 ? undefined : packed;
};

/** What each node logs, kept to a level, a line and a template, with the dictionaries both index. */
const packLogs = (nodes: readonly GraphNode[]): { logs?: PackedLogs; logLevels?: string[]; logTexts?: string[] } => {
  const found: Array<[number, Array<[string, number, string?]>]> = [];
  nodes.forEach((node, index) => {
    const list = node.meta?.['logs'];
    if (!Array.isArray(list)) return;
    const lines = (list as LogLine[]).flatMap((item): Array<[string, number, string?]> => {
      if (typeof item?.level !== 'string') return [];
      const at = typeof item.at === 'number' ? item.at : 0;
      return [typeof item.text === 'string' && item.text !== '' ? [item.level, at, item.text] : [item.level, at]];
    });
    if (lines.length > 0) found.push([index, lines]);
  });
  if (found.length === 0) return {};
  const all = found.flatMap(([, lines]) => lines);
  const levels = wordsOf(all.map(([level]) => level), 'logLevels');
  const texts = wordsOf(all.flatMap(([, , text]) => (text === undefined ? [] : [text])), 'logTexts');
  const logs: PackedLogs = {};
  for (const [index, lines] of found) {
    logs[index] = lines.map(([level, line, text]) =>
      text === undefined ? [levels.word(level), line] : [levels.word(level), line, texts.word(text)],
    );
  }
  return {
    logs,
    ...(levels.list.length === 0 ? {} : { logLevels: levels.list }),
    ...(texts.list.length === 0 ? {} : { logTexts: texts.list }),
  };
};

/**
 * The graph, small enough to ship inside one file.
 *
 * Every repeated string becomes an index into a dictionary and every node loses
 * its id, since the page never shows one and a position identifies a node just
 * as well within the page. On a large project that shrinks the page many times
 * over, which is the difference between a page that opens and one that does
 * not. What a link carries from one build's page to the
 * next is a six-character key hashed from the id, not the id.
 *
 * The rule holds for every block, not only nodes and rows (P84): a failure
 * that stands in front of many ways in is one record they all point at, and a
 * log line's level and template, and an unmatched span's service and kind, are
 * indices too. Each block has one expander on the page, so every reader sees
 * the objects it always saw.
 */
/** A reason's kind and, for a finding, its risk: `['gap']`, `['finding', 'auth']`. */
export type ReasonClass = [kind: RowKind] | [kind: RowKind, risk: Risk];

/** What a reason is, as the page is told it: the registry's kind, and a finding's risk. */
const reasonClassOf = (reason: string): ReasonClass => {
  const kind = ROW_KINDS.get(reason) ?? 'gap';
  const risk = riskOf(reason);
  return risk === undefined ? [kind] : [kind, risk];
};

/** The rows whose own kind (`kindOfRow`, by what they recorded) is not their reason's. */
const rowKindsOf = (rows: readonly AnchoredUnresolvedRow[]): { rowKinds?: Record<string, RowKind> } => {
  const out: Record<string, RowKind> = {};
  rows.forEach((row, index) => {
    const kind = kindOfRow(row);
    if (kind !== (ROW_KINDS.get(row.reason) ?? 'gap')) out[String(index)] = kind;
  });
  return Object.keys(out).length === 0 ? {} : { rowKinds: out };
};

export interface PackedGraph {
  builtAt: string;
  dicts: {
    types: string[];
    repos: string[];
    kinds: string[];
    files: string[];
    edgeTypes: string[];
    confidences: string[];
    /** Short metadata key to the name the graph gives the field. */
    meta: Record<string, string>;
    /** The short keys whose value is an index into `values` rather than the value. */
    enumerated: string[];
    /** Strings an enumerated metadata field takes, shared by every such field. */
    values: string[];
    /** The short keys whose value is a list of nodes, by position, the panel jumps to (P50). */
    nodeRefs?: string[];
    reasons: string[];
    /**
     * What each reason is, aligned with `reasons` (P100): its row kind (P81)
     * and, for a finding, its risk. The Not joined tab splits by this, so it
     * never guesses from the words in a reason. A row whose own kind is not
     * its reason's is in `rowKinds`. Always written; optional so a graph
     * packed by hand reads every row as a gap, as the core does.
     */
    reasonClass?: ReasonClass[];
    levels: string[];
    hints: string[];
    /**
     * Each distinct failure once (P84), `[status, exception, at, file, line,
     * source, id?]`; `fails` below lists positions in it. See `fails.ts`.
     * Present only when some way in says what it fails with.
     */
    fails?: PackedFailRecord[];
    /** The exceptions a failure record names, the ones worth listing. */
    exceptions?: string[];
    /** Where a failure comes from: `throw`, `guard`, `pipe`, the ones worth listing. */
    failSources?: string[];
    /** The levels and templates a log line indexes (P84); each present only when it pays. */
    logLevels?: string[];
    logTexts?: string[];
  };
  /** `[type, label, repo, kind, file, line, meta]`, by position. */
  nodes: unknown[][];
  /** `[from, to, type, confidence]`, all four as indices. */
  edges: number[][];
  /**
   * One row per reason and kind, with a count and one example; the Not joined
   * tab lists them under their kind (P81): missed, notes, findings.
   */
  unresolved: Array<{ reason: string; kind: RowKind; count: number; service: string; example: string }>;
  /**
   * The rows whose kind is not their reason's (P89's per-item loops, a note
   * where `query-in-loop` is otherwise a finding), by position in `rows`.
   * Absent when every row is the kind of its reason.
   */
  rowKinds?: Record<string, RowKind>;
  /**
   * Every finding, `[node, repo, file, line, reason, level, sites, message, hint, waysIn?]`.
   *
   * `node` is the position of the node the row names, or -1 when it names none;
   * `repo`, `file`, `reason`, `level` and `hint` are indices, -1 for absent,
   * and `repo` the service's name where no node is in that service.
   * `waysIn` is there only on a row that counts the ways in reaching it (P89).
   */
  rows: unknown[][];
  /**
   * Every node's id, by position, each less what its type, service and file
   * already say (P97): see `node-ids.ts`. The prompt names steps by them.
   */
  ids: string[];
  /**
   * Edges whose target the graph does not hold, `[from, to, type, confidence,
   * line]`: `to` the id it names, `line` 0 for none, the rest as `edges` has
   * them. The prompt walks them into a missing step, as `get_flow` does.
   * Absent when there are none.
   */
  dangling?: Array<[from: number, to: string, type: number, confidence: number, line: number]>;
  /** Ids of the ways in, so a link can name one. */
  entryIds: Record<string, number>;
  /**
   * A short key per node, from its id, so a link names a node the same way in
   * every build where a position names whatever sits there now.
   */
  keys: PackedKeys;
  /**
   * Positions of the nodes that are one step of a chain (`STEP_OF_META`), so
   * an impact walk in the page lengthens itself the way `impact` does.
   */
  steps: number[];
  /**
   * Present only when asked for with `--editor-links`: which editor opens a
   * `file:line`, and each service's absolute root, by `dicts.repos` position.
   * Absent by default, since it writes local paths into the page.
   */
  editor?: { name: string; roots: Array<string | null> };
  /**
   * What each function takes and gives back, a route's request, a call's and
   * a channel's payload, and the types those reach. See `shapes.ts`.
   */
  shapes: PackedShapes;
  /** The project at the size of its services, for the Map tab. See `map.ts`. */
  map: PackedMap;
  /** Each edge's place among its siblings, and which run on a failure or side by side. See `sites.ts`. */
  sites: PackedSites;
  /**
   * What was seen at run time, when a trace was imported (P65). Absent, the
   * page shows only what the code says.
   *
   * `joins` is keyed by an edge's position in `edges`, `entries` by an
   * entry's id (as `entryIds` names it); `ambiguous` lists what fit several
   * places (P85). See `observed.ts`.
   */
  observed?: PackedObserved;
  /**
   * Gaps somebody accepted with `flowatlas accept` (P72), for the page to show
   * muted: `rows` holds positions in `rows` above, `ids` the gap id each
   * accepted row answers to (`gap:<service>|<file>|<reason>`), by position,
   * and `notes` why, keyed by the same id. Absent when nothing is accepted.
   *
   * A row a rule took (P76) — a reason over a whole service, a file glob, a
   * route pattern — names it: `rules` lists each rule once, as a line
   * (`route-unguarded · service catalog · path GET /public/*`), and `byRule`
   * the rule each such row was taken by, by position. Both absent when no row
   * was taken by a rule.
   *
   * `problem` is the sentence for an `accepted.json` that could not be read
   * (P80), shown on the accepted bar; nothing is accepted then. Present with
   * empty rows only for that.
   */
  accepted?: {
    rows: number[];
    ids: Record<string, string>;
    notes: Record<string, string>;
    rules?: string[];
    byRule?: Record<string, number>;
    problem?: string;
  };
  /** What stands in front of each way in, and from where (P76). See `access.ts`. */
  access?: PackedAccess;
  /** The methods most things lean on, as `hotspots` ranks them (P73). See `busiest.ts`. */
  busiest: PackedBusiest;
  /** What a branch changed, when the page was made with `--diff <ref>` (P73). See `changes.ts`. */
  changes?: PackedChanges;
  /**
   * What each way in can fail with (P68), by entry position, as positions in
   * `dicts.fails`. Absent when none says. See `fails.ts`.
   */
  fails?: PackedFails;
  /**
   * The lines each method or function logs (P71), by node position, as
   * `[level, line, template?]` through `dicts.logLevels` and `dicts.logTexts`.
   * Absent when nothing logs.
   */
  logs?: PackedLogs;
  /**
   * The doc blocks about each node (P120), by node position, as
   * `[file, line, kind, state]`, from the `docs.json` beside the database,
   * each checked against this graph. Absent when no block is about a node.
   */
  docs?: PackedDocs;
  /**
   * What the reader could not follow, by cause and package, less what was
   * accepted (P75). Absent when everything read was followed. See `cant-follow.ts`.
   */
  cantFollow?: PackedCantFollow;
  /**
   * Edges drawn through types a stand-in supplied (P78): the source of a
   * package nobody installed, or a shape file the project wrote. `edges` maps
   * an edge's position in `edges` to `[how, package]`, both positions in
   * `via` and `packages`. Absent when no edge was.
   */
  standIns?: { via: string[]; packages: string[]; edges: Record<string, [number, number]> };
  /**
   * What a service's prompt reads beside the graph (P134): the findings
   * ranked by reach, and the contract verdicts of the crossings. Absent when
   * there are no findings and every crossing is unchecked. See `overview.ts`.
   */
  overview?: PackedOverview;
  report: unknown;
}


/**
 * Node metadata the page shows, as `[field, key, enumerated]`.
 *
 * Keys are short because there is one per node and thousands of nodes;
 * everything not listed is dropped rather than shipped unread. A field marked
 * enumerated takes a handful of values across the whole graph (`read`,
 * `template-env`, `nestjs-http`), so it ships as an index into one shared list
 * rather than as the same word thousands of times.
 *
 * The first eight are what the walk and the lists already read; the rest are
 * what the details panel shows: the address, the table, the deployed name, and
 * how each of those was read.
 */
const META_FIELDS: ReadonlyArray<readonly [field: string, key: string, enumerated: boolean, either?: boolean]> = [
  ['method', 'm', false],
  ['path', 'p', false],
  ['targetService', 't', false],
  ['baseUrlEnv', 'e', false],
  ['host', 'h', false],
  ['operation', 'o', false],
  ['globalPrefix', 'g', false],
  ['key', 'k', false],
  ['table', 'tb', false],
  ['op', 'op', true],
  ['pattern', 'pt', false],
  ['channelKind', 'ck', true],
  ['producers', 'np', false],
  ['consumers', 'nc', false],
  ['name', 'nm', false],
  ['function', 'fn', false],
  ['api', 'ap', false],
  ['handler', 'hd', false],
  ['runtime', 'rn', true],
  ['declaredAs', 'da', false],
  ['deployedBy', 'dp', true],
  ['nameFrom', 'nf', true],
  ['adapter', 'ad', true],
  ['source', 'sr', true],
  ['via', 'vi', true],
  ['through', 'th', true],
  ['channelVia', 'cv', true],
  ['handlerVia', 'hv', true],
  ['confidence', 'cf', true],
  ['guessed', 'gu', false],
  ['client', 'cl', true],
  ['selector', 'sl', false],
  ['exportAs', 'ea', false],
  ['hostBindings', 'hb', false],
  // The methods those bindings call, shipped as the nodes' positions (P50).
  ['hostMembers', 'hm', false],
  // A pipe is pure unless it says otherwise, so both answers are worth a line (P45).
  ['pure', 'pu', false, true],
  ['route', 'rt', false],
  ['event', 'ev', true],
  ['stateType', 'st', true],
  ['workflow', 'wf', false],
  ['module', 'md', true],
  ['decorator', 'dc', true],
  ['declaredBy', 'dy', false],
  ['unreferenced', 'un', false],
  ['bodyKeys', 'bk', false],
  // When a schedule fires, and in which zone (P71).
  ['expression', 'ex', false],
  ['timeZone', 'tz', true],
  // How many steps a chain holds, which lengthens the walk under a prompt (P97).
  ['states', 'ss', false],
  // The value a request's base address was taken from, and the file it is in (P77).
  ['baseUrl', 'bu', false],
  ['baseUrlFrom', 'bf', true],
];

/** Fields a copied prompt says in full whatever the label says (P97): a schedule's expression. */
const SAID_IN_FULL: ReadonlySet<string> = new Set(['expression']);

/** How many of `META_FIELDS` the walk and the lists read, and so always ship. */
const LISTED = 8;

/**
 * A value worth a line in the panel: a word, a number, a yes, or a list of
 * words - and a no, for a field where either answer says something.
 */
const shippable = (value: unknown, either = false): boolean =>
  (either && value === false) ||
  typeof value === 'string'
    ? value !== ''
    : typeof value === 'number' || value === true
      ? true
      : Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');

/** Fields whose value is a list of node ids: shipped as positions, so the panel can jump to them. */
const NODE_REFS: ReadonlySet<string> = new Set(['hostMembers']);

const metaPacker = (nodes: readonly GraphNode[], position: ReadonlyMap<string, number>) => {
  const enumerated = META_FIELDS.filter(([, , isEnum]) => isEnum);
  const [values, valueIx] = dictionary(
    nodes.flatMap((node) =>
      enumerated
        .map(([field]) => node.meta?.[field])
        .filter((value): value is string => typeof value === 'string' && value !== ''),
    ),
  );
  const pack = (node: GraphNode): Record<string, unknown> | 0 => {
    const meta = node.meta ?? {};
    const out: Record<string, unknown> = {};
    META_FIELDS.forEach(([field, key, isEnum, either], index) => {
      if (NODE_REFS.has(field)) {
        const ids = Array.isArray(meta[field]) ? (meta[field] as unknown[]) : [];
        const at = ids.flatMap((id) => (typeof id === 'string' && position.has(id) ? [position.get(id) as number] : []));
        if (at.length > 0) out[key] = at;
        return;
      }
      const value = meta[field];
      if (!shippable(value, either)) return;
      // Past the fields the lists read, a word the label already says is not
      // said twice: `write orders` carries its table, `click="save()"` its
      // event and handler. On a real project that is a good share of what the
      // panel would otherwise add to the page.
      if (index >= LISTED && typeof value === 'string' && node.label.includes(value) && !SAID_IN_FULL.has(field)) return;
      out[key] = isEnum && typeof value === 'string' ? valueIx.get(value) : value;
    });
    return Object.keys(out).length === 0 ? 0 : out;
  };
  const keys = Object.fromEntries(META_FIELDS.map(([field, key]) => [key, field]));
  const nodeRefs = META_FIELDS.filter(([field]) => NODE_REFS.has(field)).map(([, key]) => key);
  return { values, pack, keys, enumerated: enumerated.map(([, key]) => key), nodeRefs };
};

/**
 * One row per reason, since that is the shape the page shows them in, and per
 * kind: a reason whose rows are notes or findings by what they recorded is two
 * rows, one under each heading.
 */
const byReason = (rows: readonly AnchoredUnresolvedRow[]): PackedGraph['unresolved'] => {
  const found = new Map<string, PackedGraph['unresolved'][number]>();
  for (const row of rows) {
    const kind = kindOfRow(row);
    const key = `${row.reason}\u0000${kind}`;
    const seen = found.get(key);
    if (seen === undefined) {
      found.set(key, {
        reason: row.reason,
        kind,
        count: 1,
        service: row.service ?? '',
        example: row.message,
      });
    } else seen.count += 1;
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
};

export interface PackInput {
  builtAt: string;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  unresolved: readonly AnchoredUnresolvedRow[];
  report: LinkReport;
  /** The editor `--editor-links` names, and where each service's sources are. */
  editor?: { name: string; rootOf: (service: string) => string | undefined };
  /** The type registry, one entry at a time; without it no type opens to its fields. */
  typeOf?: (id: string) => TypeEntry | undefined;
  /** What `flowatlas observe` wrote, when it did. */
  observed?: Observed;
  /**
   * What `flowatlas accept` wrote, as the one split worked it out over
   * `unresolved` (`acceptedSplitOf` in the linker, P80): the entry that took
   * each row by position, and the file's problem when it could not be read.
   */
  accepted?: PackAccepted;
  /** What `visualise --diff` compared, already packed. */
  changes?: PackedChanges;
  /** What the configuration says about routes nobody calls (P91), for the Map's counts. */
  routes?: MapInput['routes'];
  /** The doc blocks of `docs.json` that name a node, checked against this graph (P120). */
  docs?: readonly PackDoc[];
  /** The ranked findings and the crossings' verdicts, for the service prompt (P134). */
  overview?: OverviewInput;
}

/** The split, as the page needs it: `byEntry` lines up with the rows packed. */
export interface PackAccepted {
  byEntry: ReadonlyArray<AcceptedGap | undefined>;
  problem?: AcceptedProblem;
}

/**
 * One pass over the rows: what the accepted bar marks, and the rows left for
 * the breakdown of what could not be followed. Nothing is matched here; the
 * split already said which entry took each row.
 */
const packAccepted = (
  accepted: PackAccepted | undefined,
  rows: readonly AnchoredUnresolvedRow[],
): { packed?: NonNullable<PackedGraph['accepted']>; fresh: AnchoredUnresolvedRow[] } => {
  if (accepted === undefined) return { fresh: [...rows] };
  const out: NonNullable<PackedGraph['accepted']> = { rows: [], ids: {}, notes: {} };
  const fresh: AnchoredUnresolvedRow[] = [];
  const rules: string[] = [];
  const byRule: Record<string, number> = {};
  rows.forEach((row, index) => {
    const entry = accepted.byEntry[index];
    if (entry === undefined) {
      fresh.push(row);
      return;
    }
    const id = gapIdOf(row);
    out.rows.push(index);
    out.ids[String(index)] = id;
    if (entry.note !== '') out.notes[id] = entry.note;
    if (!isRule(entry)) return;
    const said = describeAccepted(entry);
    let at = rules.indexOf(said);
    if (at === -1) at = rules.push(said) - 1;
    byRule[String(index)] = at;
  });
  const problem = accepted.problem === undefined ? {} : { problem: `${describeAcceptedProblem(accepted.problem)}.` };
  if (out.rows.length === 0 && accepted.problem === undefined) return { fresh };
  return { packed: { ...out, ...(rules.length === 0 ? {} : { rules, byRule }), ...problem }, fresh };
};
const withAccess = (access: PackedAccess | undefined): { access?: PackedAccess } => (access === undefined ? {} : { access });

/** The ways a stand-in supplies an edge's types (P78), as `meta.because` names them. */
const STAND_IN_VIA: readonly string[] = ['package-from-repo', 'shape-file'];

/** Which edges a stand-in typed, by position, with how and whose types. */
const packStandIns = (edges: readonly GraphEdge[]): Pick<PackedGraph, 'standIns'> => {
  const packages: string[] = [];
  const marked: Record<string, [number, number]> = {};
  edges.forEach((edge, index) => {
    const because = Array.isArray(edge.meta?.['because']) ? (edge.meta?.['because'] as unknown[]) : [];
    const via = STAND_IN_VIA.findIndex((word) => because.includes(word));
    const pkg = edge.meta?.['typedBy'];
    if (via === -1 || typeof pkg !== 'string') return;
    let at = packages.indexOf(pkg);
    if (at === -1) at = packages.push(pkg) - 1;
    marked[String(index)] = [via, at];
  });
  return packages.length === 0 ? {} : { standIns: { via: [...STAND_IN_VIA], packages, edges: marked } };
};

/**
 * The report's totals with every row count worked out from the rows the page
 * is handed, by the one counter (P81), so the stat row says what the build line
 * says - and says it for a database built by 0.5.x, whose stored totals carry
 * `unresolved` alone.
 */
const totalsOf = (
  totals: Pick<LinkReport['totals'], 'nodes' | 'edges' | 'types'>,
  rows: readonly AnchoredUnresolvedRow[],
): LinkReport['totals'] => {
  const { missed, sites, notes, findings } = countsOf(rows);
  return { nodes: totals.nodes, edges: totals.edges, types: totals.types, missed, sites, notes, findings, unresolved: missed };
};

const withDocs = (docs: PackedDocs | undefined): Pick<PackedGraph, 'docs'> => (docs === undefined ? {} : { docs });

export const packGraph = (input: PackInput): PackedGraph => {
  const rowsIn = input.unresolved;
  const accepted = packAccepted(input.accepted, rowsIn);
  const [types, typeIx] = dictionary(input.nodes.map((node) => node.type));
  const [repos, repoIx] = dictionary(input.nodes.map((node) => node.repo));
  const [kinds, kindIx] = dictionary(input.nodes.map((node) => node.kind ?? ''));
  const failed = failuresByEntry(input.nodes);
  const [files, fileIx] = dictionary([
    ...input.nodes.map((node) => node.file ?? ''),
    ...rowsIn.map((row) => row.file ?? ''),
    ...failed.flatMap(([, fails]) => fails.flatMap((item) => (item.file === undefined ? [] : [item.file]))),
  ]);
  const [edgeTypes, edgeTypeIx] = dictionary(input.edges.map((edge) => edge.type));
  const [confidences, confIx] = dictionary(input.edges.map((edge) => edge.confidence));
  const [reasons, reasonIx] = dictionary(rowsIn.map((row) => row.reason));
  const [levels, levelIx] = dictionary(rowsIn.map((row) => row.level));
  const [hints, hintIx] = dictionary(rowsIn.flatMap((row) => (row.hint ? [row.hint] : [])));
  const position = new Map(input.nodes.map((node, index) => [node.id, index]));
  const meta = metaPacker(input.nodes, position);

  const entryIds: Record<string, number> = {};
  const steps: number[] = [];
  input.nodes.forEach((node, index) => {
    if (node.type === 'entry') entryIds[node.id] = index;
    if (node.meta?.[STEP_OF_META] !== undefined) steps.push(index);
  });

  const nodes = input.nodes.map((node) => [
    typeIx.get(node.type),
    node.label,
    repoIx.get(node.repo),
    kindIx.get(node.kind ?? ''),
    fileIx.get(node.file ?? ''),
    node.line ?? 0,
    meta.pack(node),
  ]);

  const known = (edge: GraphEdge): boolean => position.has(edge.from) && position.has(edge.to);
  const packedEdges = input.edges.filter(known);
  const dangling = input.edges
    .filter((edge) => position.has(edge.from) && !position.has(edge.to))
    .map((edge): [number, string, number, number, number] => [
      position.get(edge.from) as number,
      edge.to,
      edgeTypeIx.get(edge.type) as number,
      confIx.get(edge.confidence) as number,
      edge.line ?? 0,
    ]);
  const edges = packedEdges.map((edge) => [
    position.get(edge.from) as number,
    position.get(edge.to) as number,
    edgeTypeIx.get(edge.type) as number,
    confIx.get(edge.confidence) as number,
  ]);

  // A row's symbol is a node id only some of the time; the rest name the source
  // text they could not read. Only a symbol that is a node's id anchors a row,
  // and the others still carry their file, so the page can say where they are.
  const indexOr = (map: Map<string, number>, value: string | null): number =>
    value === null || value === '' ? -1 : (map.get(value) ?? -1);
  const rows = rowsIn.map((row) => {
    // A service no node is in (one that read nothing) is not in the page's
    // list of services, so its name ships as it is, as a word does (P84, P97).
    const service = row.service === null || row.service === '' || repoIx.has(row.service) ? indexOr(repoIx, row.service) : row.service;
    const packed: unknown[] = [
      row.node === null ? -1 : (position.get(row.node) ?? -1),
      service,
      indexOr(fileIx, row.file),
      row.line ?? 0,
      reasonIx.get(row.reason) as number,
      levelIx.get(row.level) as number,
      row.sites,
      row.message,
      indexOr(hintIx, row.hint),
    ];
    const waysIn = waysInOf(row);
    if (waysIn !== undefined) packed.push(waysIn);
    return packed;
  });

  const shapes = packShapes({
    nodes: input.nodes,
    edges: input.edges,
    position,
    typeOf: input.typeOf ?? (() => undefined),
  });
  const fails = packFails(failed, position, fileIx);
  const { logs, logLevels, logTexts } = packLogs(input.nodes);
  const report = input.report;
  return {
    builtAt: input.builtAt,
    dicts: {
      types,
      repos,
      kinds,
      files,
      edgeTypes,
      confidences,
      meta: meta.keys,
      enumerated: meta.enumerated,
      nodeRefs: meta.nodeRefs,
      values: meta.values,
      reasons,
      reasonClass: reasons.map(reasonClassOf),
      levels,
      hints,
      ...(fails === undefined ? {} : fails.tables),
      ...(logLevels === undefined ? {} : { logLevels }),
      ...(logTexts === undefined ? {} : { logTexts }),
    },
    nodes,
    edges,
    unresolved: byReason(rowsIn),
    rows,
    ...rowKindsOf(rowsIn),
    entryIds,
    ids: packIds(input.nodes),
    ...(dangling.length === 0 ? {} : { dangling }),
    keys: stableKeys(input.nodes.map((node) => node.id)),
    steps,
    map: packMap({
      nodes: input.nodes,
      edges,
      edgeTypes,
      confidences,
      services: input.report.services,
      rows: rowsIn,
      answers: shapes.answers.map(([node, kind]) => [node, shapes.answerKinds[kind] as string]),
      ...(input.routes === undefined ? {} : { routes: input.routes }),
    }),
    shapes,
    sites: packSites(packedEdges, position),
    busiest: packBusiest(input.nodes, packedEdges, position, rowsIn),
    ...(input.changes === undefined ? {} : { changes: input.changes }),
    ...(fails === undefined ? {} : { fails: fails.fails }),
    ...withAccess(packAccess(input.nodes)),
    ...(logs === undefined ? {} : { logs }),
    ...withDocs(packDocs(input.docs, position)),
    ...(input.observed === undefined ? {} : { observed: packObserved(input.observed, packedEdges, entryIds, position, input.nodes) }),
    ...(accepted.packed === undefined ? {} : { accepted: accepted.packed }),
    ...packCantFollow(accepted.fresh, position),
    ...packStandIns(packedEdges),
    ...packOverview(input.overview ?? {}, input.nodes, packedEdges, position, repoIx),
    ...(input.editor === undefined
      ? {}
      : { editor: { name: input.editor.name, roots: repos.map((name) => input.editor?.rootOf(name) ?? null) } }),
    report: {
      httpOut: report.httpOut,
      ui: report.ui ?? null,
      channels: report.channels,
      routes: {
        total: report.routes.total,
        called: report.routes.called,
        duplicated: report.routes.duplicated,
      },
      types: report.types,
      totals: totalsOf(report.totals, rowsIn),
      services: report.services.map((service) => ({
        name: service.name,
        type: service.type,
        nodes: service.nodes,
        edges: service.edges,
        unresolved: service.unresolved,
        durationMs: service.durationMs,
        skipped: service.skipped ?? null,
      })),
    },
  };
};
