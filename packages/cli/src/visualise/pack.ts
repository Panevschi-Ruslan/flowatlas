import type { GraphEdge, GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, LinkReport } from '@flowatlas/linker';

/**
 * The graph, small enough to ship inside one file.
 *
 * Every repeated string becomes an index into a dictionary and every node loses
 * its id, since the page never shows one and a position identifies a node just
 * as well. On a project of eleven thousand nodes that is thirteen megabytes down
 * to one, which is the difference between a page that opens and one that does
 * not.
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
const META_FIELDS: ReadonlyArray<readonly [field: string, key: string, enumerated: boolean]> = [
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
  ['route', 'rt', false],
  ['event', 'ev', true],
  ['stateType', 'st', true],
  ['workflow', 'wf', false],
  ['module', 'md', true],
  ['decorator', 'dc', true],
  ['declaredBy', 'dy', false],
  ['unreferenced', 'un', false],
  ['bodyKeys', 'bk', false],
];

/** How many of `META_FIELDS` the walk and the lists read, and so always ship. */
const LISTED = 8;

/** A value worth a line in the panel: a word, a number, a yes, or a list of words. */
const shippable = (value: unknown): boolean =>
  typeof value === 'string'
    ? value !== ''
    : typeof value === 'number' || value === true
      ? true
      : Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');

const metaPacker = (nodes: readonly GraphNode[]) => {
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
    META_FIELDS.forEach(([field, key, isEnum], index) => {
      const value = meta[field];
      if (!shippable(value)) return;
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
  return { values, pack, keys, enumerated: enumerated.map(([, key]) => key) };
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
}

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
  const meta = metaPacker(input.nodes);

  const position = new Map(input.nodes.map((node, index) => [node.id, index]));
  const entryIds: Record<string, number> = {};
  input.nodes.forEach((node, index) => {
    if (node.type === 'entry') entryIds[node.id] = index;
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
  const edges = input.edges.filter(known).map((edge) => [
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
