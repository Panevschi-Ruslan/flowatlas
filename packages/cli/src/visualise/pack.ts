import type { GraphEdge, GraphNode } from '@flowatlas/core';
import type { LinkReport, UnresolvedRow } from '@flowatlas/linker';

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
  };
  /** `[type, label, repo, kind, file, line, meta]`, by position. */
  nodes: unknown[][];
  /** `[from, to, type, confidence]`, all four as indices. */
  edges: number[][];
  /** One row per reason, with a count and one example. */
  unresolved: Array<{ reason: string; count: number; service: string; example: string }>;
  /** Ids of the ways in, so a link can name one. */
  entryIds: Record<string, number>;
  report: unknown;
}

const dictionary = (values: Iterable<string>): [string[], Map<string, number>] => {
  const list = [...new Set(values)].sort();
  return [list, new Map(list.map((value, index) => [value, index]))];
};

/**
 * Node metadata the page actually reads.
 *
 * Keys are one letter because there is one per node and eleven thousand nodes;
 * everything the page does not show is dropped rather than shipped unread.
 */
const metaOf = (node: GraphNode): Record<string, unknown> | 0 => {
  const meta = node.meta ?? {};
  const out: Record<string, unknown> = {};
  const carry = (from: string, to: string): void => {
    if (typeof meta[from] === 'string') out[to] = meta[from];
  };
  carry('method', 'm');
  carry('path', 'p');
  carry('targetService', 't');
  carry('baseUrlEnv', 'e');
  carry('host', 'h');
  carry('operation', 'o');
  carry('globalPrefix', 'g');
  carry('key', 'k');
  return Object.keys(out).length === 0 ? 0 : out;
};

/** One row per reason, since that is the shape the page shows them in. */
const byReason = (rows: readonly UnresolvedRow[]): PackedGraph['unresolved'] => {
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
  unresolved: readonly UnresolvedRow[];
  report: LinkReport;
}

export const packGraph = (input: PackInput): PackedGraph => {
  const [types, typeIx] = dictionary(input.nodes.map((node) => node.type));
  const [repos, repoIx] = dictionary(input.nodes.map((node) => node.repo));
  const [kinds, kindIx] = dictionary(input.nodes.map((node) => node.kind ?? ''));
  const [files, fileIx] = dictionary(input.nodes.map((node) => node.file ?? ''));
  const [edgeTypes, edgeTypeIx] = dictionary(input.edges.map((edge) => edge.type));
  const [confidences, confIx] = dictionary(input.edges.map((edge) => edge.confidence));

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
    metaOf(node),
  ]);

  const known = (edge: GraphEdge): boolean => position.has(edge.from) && position.has(edge.to);
  const edges = input.edges.filter(known).map((edge) => [
    position.get(edge.from) as number,
    position.get(edge.to) as number,
    edgeTypeIx.get(edge.type) as number,
    confIx.get(edge.confidence) as number,
  ]);

  const report = input.report;
  return {
    builtAt: input.builtAt,
    dicts: { types, repos, kinds, files, edgeTypes, confidences },
    nodes,
    edges,
    unresolved: byReason(input.unresolved),
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
