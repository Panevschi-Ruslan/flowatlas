import { ENTRY_KINDS, type DetailLevel, type GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import {
  REVERSE_EDGES,
  projectDetail,
  projectEdge,
  truncationMessage,
  type FlowNode,
} from '@flowatlas/mcp';

export interface CallerOptions {
  depth: number;
  maxNodes: number;
  detail: DetailLevel;
  /** Keep only the entry points, hung straight off the target. */
  entriesOnly?: boolean;
}

export interface Callers {
  root: FlowNode;
  /** Entry points the target can be reached from, each named once. */
  entries: GraphNode[];
  /** How many nodes reach it at all, so "no entries" is not "nothing". */
  reached: number;
  /** Every service the walk touched, the target's own included. */
  services: string[];
  /**
   * Services the walk reached without finding an entry point in them.
   *
   * A change is visible in these too. Reporting only the entry points would say
   * "one entry, in this service" about a chain that crosses into another and
   * stops there, which reads as "nothing outside this service" and is not.
   */
  withoutEntry: string[];
  truncated?: string;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Everything that reaches a symbol, as a tree growing back towards its callers.
 *
 * The walk is the linker's, read the other way round, and the path it carries
 * on every row is what the tree is rebuilt from; nothing here re-implements a
 * traversal. Each child is something that calls its parent, so the root is the
 * thing that would change and the leaves are the ways in.
 */
export const callersOf = (db: GraphDb, target: GraphNode, options: CallerOptions): Callers => {
  const walk = db.traverse({
    from: target.id,
    direction: 'in',
    edgeTypes: REVERSE_EDGES,
    maxDepth: options.depth,
    maxNodes: options.maxNodes,
  });

  const root: FlowNode = { node: projectDetail(target, options.detail), children: [] };
  const byPath = new Map<string, FlowNode>([[target.id, root]]);
  const entries = new Map<string, GraphNode>();
  const reached = new Set<string>();
  const services = new Set<string>([target.repo]);
  const entryServices = new Set<string>();

  for (const row of walk.rows) {
    if (row.depth === 0) continue;
    reached.add(row.id);

    const segments = row.path.split('>');
    const parent = byPath.get(segments.slice(0, -1).join('>'));
    const node = db.node(row.id);
    if (parent === undefined || node === undefined) continue;
    services.add(node.repo);
    if (node.type === 'entry') {
      entries.set(node.id, node);
      entryServices.add(node.repo);
    }

    // The edge is stored pointing the way the call runs, so it is looked up
    // from the callee back to this caller rather than the other way about.
    const edge = db
      .edgesTo(segments[segments.length - 2] as string, row.edgeType === null ? undefined : [row.edgeType])
      .find((candidate) => candidate.from === row.id);

    const flow: FlowNode = {
      node: projectDetail(node, options.detail),
      ...(edge === undefined ? {} : { edge: projectEdge(edge, options.detail) }),
      children: [],
    };
    byPath.set(row.path, flow);
    parent.children.push(flow);
  }

  const sorted = [...entries.values()].sort((a, b) => cmp(a.id, b.id));
  if (options.entriesOnly === true) {
    root.children = sorted.map((entry) => ({
      node: projectDetail(entry, options.detail),
      children: [],
    }));
  }

  return {
    root,
    entries: sorted,
    reached: reached.size,
    services: [...services].sort(cmp),
    withoutEntry: [...services].filter((name) => !entryServices.has(name)).sort(cmp),
    // The walk stopped at the limit rather than at the end, and only says that
    // much, so the count is reported as a floor rather than invented.
    ...(walk.truncated ? { truncated: truncationMessage(1, false) } : {}),
  };
};

/** Singular and plural, since a summary that says "1 entries" reads as a bug. */
const KIND_LABEL: Record<string, [string, string]> = {
  http: ['http entry', 'http entries'],
  bot_command: ['bot command', 'bot commands'],
  bot_callback: ['bot callback', 'bot callbacks'],
  bot_event: ['bot event', 'bot events'],
  scene_step: ['scene step', 'scene steps'],
  event: ['consumer', 'consumers'],
  rpc: ['rpc entry', 'rpc entries'],
  cron: ['cron job', 'cron jobs'],
};

export interface ReachableGroup {
  kind: string;
  count: number;
  services: string[];
}

/** Entry points grouped the way the report wording groups them. */
export const groupEntries = (entries: readonly GraphNode[]): ReachableGroup[] => {
  const groups = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const kind = entry.kind ?? 'http';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    groups.set(kind, (groups.get(kind) ?? new Set()).add(entry.repo));
  }
  const order = [...ENTRY_KINDS, ...[...counts.keys()].filter((kind) => !ENTRY_KINDS.includes(kind as never))];
  return order
    .filter((kind) => counts.has(kind))
    .map((kind) => ({
      kind,
      count: counts.get(kind) as number,
      services: [...(groups.get(kind) ?? [])].sort(cmp),
    }));
};

/**
 * The one line P12's report repeats, so both say the same thing.
 *
 * `withoutEntry` names services the chain runs into and stops in, which are in
 * the blast radius whether or not anything was found above them. Leaving them
 * out is how "1 http entry (admin-api)" came to be the whole answer for a change
 * a bot in another repository also reaches.
 */
export const reachableSummary = (
  entries: readonly GraphNode[],
  withoutEntry: readonly string[] = [],
): string => {
  const groups = groupEntries(entries);
  const head =
    groups.length === 0
      ? 'Reachable from: no entry points'
      : `Reachable from: ${groups
          .map((group) => {
            const label = KIND_LABEL[group.kind] ?? [group.kind, `${group.kind}s`];
            return `${group.count} ${label[group.count === 1 ? 0 : 1]} (${group.services.join(', ')})`;
          })
          .join(', ')}`;
  if (withoutEntry.length === 0) return head;
  const also = withoutEntry.join(', ');
  return `${head}. Also reaches ${also}, where the chain stops before an entry point`;
};
