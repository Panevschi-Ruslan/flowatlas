import type { GraphEdge, GraphNode } from '@flowatlas/core';

/**
 * What a service's prompt reads that the graph on the page does not say
 * (P134): the findings ranked by reach, and the contract verdict on each
 * crossing between two services.
 *
 * Both are worked out where the database is, by the code the MCP server
 * runs - the findings by the linker's `rankFindings`, which walks from a
 * route to the writes it reaches and from a sender to the ways in that reach
 * it, and reads the contracts report beside the database; a verdict by the
 * `check_contract` rule, which reads the type registry - and shipped as their
 * results. The page lists the crossings itself, from the edges it holds, and
 * orders them by these verdicts as `crossingsBetween` does.
 *
 * `findings` is the whole project's list in rank order, one row each:
 * `[kind, id, service, loc, message]`. `kind` is a position in `kinds`; `id`
 * a node's position, or the id itself where the graph holds no such node (a
 * gap id); `service` a position in `dicts.repos`, the name where no node is in
 * that service, -1 for none; `loc` null for none.
 *
 * `verdicts` is keyed by a request's edge position (`"12"`) or a publish's
 * pair of edges, the publish and the subscription that takes it (`"12:30"`),
 * and holds the verdict's rank in `CONTRACT_STATUS_RANK` (0 shared,
 * 1 identical, 3 the shapes differ). A crossing not listed is unchecked (2),
 * which most are, so it is left out. Absent when every crossing is.
 */
export type PackedFinding = [kind: number, id: number | string, service: number | string, loc: string | null, message: string];

/**
 * Findings of one service counted rather than listed (P400), as the server's
 * `countedOf` says them: kind (a position in `kinds`), service, severity,
 * count and the call that lists them.
 */
export type PackedCounted = [kind: number, service: number | string, severity: string, count: number, call: string];

export interface PackedOverview {
  kinds: string[];
  findings: PackedFinding[];
  counted?: PackedCounted[];
  verdicts?: Record<string, number>;
}

/** A finding as the linker ranks it: as much of `FindingRow` as the prompt lists. */
export interface OverviewFinding {
  kind: string;
  id: string;
  service: string;
  loc?: string;
  message: string;
}

export interface OverviewInput {
  /** Every finding of the project the prompt lists, ranked (`rankedFindingsOf` in the MCP server). */
  findings?: readonly OverviewFinding[];
  /** Each service's findings counted rather than listed, with the call that lists them (P400). */
  counted?: ReadonlyArray<{ service: string; kind: string; severity: string; count: number; call: string }>;
  /** A crossing's verdict as its rank: a request edge, or a publish and the subscription that takes it. */
  verdictOf?: (edge: GraphEdge, consumed?: GraphEdge) => number;
}

/** The rank of an unchecked crossing, which is not shipped. */
const UNCHECKED = 2;

/** The edges that cross by a request, as `crossingsBetween` reads them. */
const REQUESTS = new Set(['http_calls', 'hits']);

export const packOverview = (
  input: OverviewInput,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  position: ReadonlyMap<string, number>,
  repoIx: ReadonlyMap<string, number>,
): { overview?: PackedOverview } => {
  const kinds: string[] = [];
  const kindIx = new Map<string, number>();
  const kindOf = (kind: string): number => {
    if (!kindIx.has(kind)) kindIx.set(kind, kinds.push(kind) - 1);
    return kindIx.get(kind) as number;
  };
  const serviceOf = (service: string): number | string => (service === '' ? -1 : (repoIx.get(service) ?? service));
  const findings = (input.findings ?? []).map((row): PackedFinding => [kindOf(row.kind), position.get(row.id) ?? row.id, serviceOf(row.service), row.loc ?? null, row.message]);
  const counted = (input.counted ?? []).map((row): PackedCounted => [kindOf(row.kind), serviceOf(row.service), row.severity, row.count, row.call]);

  const verdicts: Record<string, number> = {};
  const verdictOf = input.verdictOf;
  if (verdictOf !== undefined) {
    const repoOf = (id: string): string | undefined => {
      const at = position.get(id);
      return at === undefined ? undefined : nodes[at]!.repo;
    };
    const consumesFrom = new Map<string, number[]>();
    edges.forEach((edge, k) => {
      if (edge.type === 'consumes') consumesFrom.set(edge.from, [...(consumesFrom.get(edge.from) ?? []), k]);
    });
    const say = (key: string, rank: number): void => {
      if (rank !== UNCHECKED) verdicts[key] = rank;
    };
    edges.forEach((edge, k) => {
      const from = repoOf(edge.from);
      if (REQUESTS.has(edge.type)) {
        const target = nodes[position.get(edge.to) ?? -1];
        if (target?.type === 'entry' && target.repo !== from) say(String(k), verdictOf(edge));
      } else if (edge.type === 'emits') {
        for (const c of consumesFrom.get(edge.to) ?? []) {
          const consumed = edges[c]!;
          if (repoOf(consumed.to) !== from) say(`${k}:${c}`, verdictOf(edge, consumed));
        }
      }
    });
  }

  const some = Object.keys(verdicts).length > 0;
  if (findings.length === 0 && counted.length === 0 && !some) return {};
  return { overview: { kinds, findings, ...(counted.length === 0 ? {} : { counted }), ...(some ? { verdicts } : {}) } };
};
