import { acceptedFor, describeAccepted, gapIdOf, isRule, splitAccepted, STEP_OF_META, type AcceptedGap, type GraphEdge, type GraphNode, type TypeEntry } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, LinkReport } from '@flowatlas/linker';
import { stableKeys, type PackedKeys } from './keys.js';
import { packMap, type PackedMap } from './map-pack.js';
import type { Observed } from '../observe/match.js';
import { packObserved, type PackedObserved } from './observed.js';

export type { PackedObserved };
import { packShapes, type PackedShapes } from './shapes.js';
import { packSites, type PackedSites } from './sites.js';
import { packBusiest, type PackedBusiest } from './busiest.js';
import type { PackedChanges } from './changes.js';

export type { PackedBusiest, PackedChanges };
import { packFails, type PackedFails } from './fails.js';
import { packAccess, type PackedAccess } from './access.js';
import { packCantFollow, type PackedCantFollow } from './cant-follow.js';

export type { PackedAccess };

export type { PackedFails, PackedCantFollow };

export type PackedLogs = Record<number, Array<[level: string, line: number, text?: string]>>;

type LogLine = { level?: unknown; text?: unknown; at?: unknown };

/** What each node logs, kept to a level, a line and a template. */
const packLogs = (nodes: readonly GraphNode[]): { logs?: PackedLogs } => {
  const out: PackedLogs = {};
  nodes.forEach((node, index) => {
    const list = node.meta?.['logs'];
    if (!Array.isArray(list)) return;
    const lines = (list as LogLine[]).flatMap((item): PackedLogs[number] => {
      if (typeof item?.level !== 'string') return [];
      const at = typeof item.at === 'number' ? item.at : 0;
      return [typeof item.text === 'string' && item.text !== '' ? [item.level, at, item.text] : [item.level, at]];
    });
    if (lines.length > 0) out[index] = lines;
  });
  return Object.keys(out).length === 0 ? {} : { logs: out };
};

/**
 * The graph, small enough to ship inside one file.
 *
 * Every repeated string becomes an index into a dictionary and every node loses
 * its id, since the page never shows one and a position identifies a node just
 * as well within the page. On a project of eleven thousand nodes that is
 * thirteen megabytes down to one, which is the difference between a page that
 * opens and one that does not. What a link carries from one build's page to the
 * next is a six-character key hashed from the id, not the id.
 */
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
    levels: string[];
    hints: string[];
  };
  /** `[type, label, repo, kind, file, line, meta]`, by position. */
  nodes: unknown[][];
  /** `[from, to, type, confidence]`, all four as indices. */
  edges: number[][];
  /** One row per reason, with a count and one example. */
  unresolved: Array<{ reason: string; count: number; service: string; example: string }>;
  /**
   * Every finding, `[node, repo, file, line, reason, level, sites, message, hint]`.
   *
   * `node` is the position of the node the row names, or -1 when it names none;
   * `repo`, `file`, `reason`, `level` and `hint` are indices, -1 for absent.
   */
  rows: unknown[][];
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
   * `joins` is keyed by an edge's position in `edges`, or by `fromKey>toKey`
   * in the nodes' stable keys; `entries` by an entry's id (as `entryIds`
   * names it) or its stable key.
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
   */
  accepted?: {
    rows: number[];
    ids: Record<string, string>;
    notes: Record<string, string>;
    rules?: string[];
    byRule?: Record<string, number>;
  };
  /** What stands in front of each way in, and from where (P76). See `access.ts`. */
  access?: PackedAccess;
  /** The methods most things lean on, as `hotspots` ranks them (P73). See `busiest.ts`. */
  busiest: PackedBusiest;
  /** What a branch changed, when the page was made with `--diff <ref>` (P73). See `changes.ts`. */
  changes?: PackedChanges;
  /** What each way in can fail with, by entry position (P68). Absent when none says. See `fails.ts`. */
  fails?: PackedFails;
  /**
   * The lines each method or function logs (P71), by node position, as
   * `[level, line, template?]`. Absent when nothing logs.
   */
  logs?: PackedLogs;
  /**
   * What the reader could not follow, by cause and package, less what was
   * accepted (P75). Absent when everything read was followed. See `cant-follow.ts`.
   */
  cantFollow?: PackedCantFollow;
  report: unknown;
}


const dictionary = (values: Iterable<string>): [string[], Map<string, number>] => {
  const list = [...new Set(values)].sort();
  return [list, new Map(list.map((value, index) => [value, index]))];
};

/**
 * Node metadata the page shows, as `[field, key, enumerated]`.
 *
 * Keys are short because there is one per node and eleven thousand nodes;
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
  // The value a request's base address was taken from, and the file it is in (P77).
  ['baseUrl', 'bu', false],
  ['baseUrlFrom', 'bf', true],
];

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
      // event and handler. On a real project that is a third of what the
      // panel would otherwise add to the page.
      if (index >= LISTED && typeof value === 'string' && node.label.includes(value)) return;
      out[key] = isEnum && typeof value === 'string' ? valueIx.get(value) : value;
    });
    return Object.keys(out).length === 0 ? 0 : out;
  };
  const keys = Object.fromEntries(META_FIELDS.map(([field, key]) => [key, field]));
  const nodeRefs = META_FIELDS.filter(([field]) => NODE_REFS.has(field)).map(([, key]) => key);
  return { values, pack, keys, enumerated: enumerated.map(([, key]) => key), nodeRefs };
};

/** One row per reason, since that is the shape the page shows them in. */
const byReason = (rows: readonly AnchoredUnresolvedRow[]): PackedGraph['unresolved'] => {
  const found = new Map<string, PackedGraph['unresolved'][number]>();
  for (const row of rows) {
    const seen = found.get(row.reason);
    if (seen === undefined) {
      found.set(row.reason, {
        reason: row.reason,
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
  /** What `flowatlas accept` wrote, when it did. */
  accepted?: readonly AcceptedGap[];
  /** What `visualise --diff` compared, already packed. */
  changes?: PackedChanges;
}

const packAccepted = (
  accepted: readonly AcceptedGap[],
  rows: readonly AnchoredUnresolvedRow[],
): NonNullable<PackedGraph['accepted']> => {
  const out: NonNullable<PackedGraph['accepted']> = { rows: [], ids: {}, notes: {} };
  const rules: string[] = [];
  const byRule: Record<string, number> = {};
  rows.forEach((row, index) => {
    const entry = acceptedFor(accepted, row);
    if (entry === undefined) return;
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
  return rules.length === 0 ? out : { ...out, rules, byRule };
};
const withFails = (fails: PackedFails | undefined): { fails?: PackedFails } => (fails === undefined ? {} : { fails });
const withAccess = (access: PackedAccess | undefined): { access?: PackedAccess } => (access === undefined ? {} : { access });

export const packGraph = (input: PackInput): PackedGraph => {
  const rowsIn = input.unresolved;
  const [types, typeIx] = dictionary(input.nodes.map((node) => node.type));
  const [repos, repoIx] = dictionary(input.nodes.map((node) => node.repo));
  const [kinds, kindIx] = dictionary(input.nodes.map((node) => node.kind ?? ''));
  const [files, fileIx] = dictionary([
    ...input.nodes.map((node) => node.file ?? ''),
    ...rowsIn.map((row) => row.file ?? ''),
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
  const rows = rowsIn.map((row) => [
    row.node === null ? -1 : (position.get(row.node) ?? -1),
    indexOr(repoIx, row.service),
    indexOr(fileIx, row.file),
    row.line ?? 0,
    reasonIx.get(row.reason) as number,
    levelIx.get(row.level) as number,
    row.sites,
    row.message,
    indexOr(hintIx, row.hint),
  ]);

  const shapes = packShapes({
    nodes: input.nodes,
    edges: input.edges,
    position,
    typeOf: input.typeOf ?? (() => undefined),
  });
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
      levels,
      hints,
    },
    nodes,
    edges,
    unresolved: byReason(rowsIn),
    rows,
    entryIds,
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
    }),
    shapes,
    sites: packSites(packedEdges),
    busiest: packBusiest(input.nodes, packedEdges, position),
    ...(input.changes === undefined ? {} : { changes: input.changes }),
    ...withFails(packFails(input.nodes, position)),
    ...withAccess(packAccess(input.nodes)),
    ...packLogs(input.nodes),
    ...(input.observed === undefined ? {} : { observed: packObserved(input.observed, packedEdges, entryIds) }),
    ...(input.accepted === undefined || input.accepted.length === 0
      ? {}
      : { accepted: packAccepted(input.accepted, rowsIn) }),
    ...packCantFollow(splitAccepted(input.accepted ?? [], rowsIn).fresh, position),
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
      totals: report.totals,
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
