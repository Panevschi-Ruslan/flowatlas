import {
  CHANNEL_DECLARED_META,
  WHERE_DECLARED_META,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { cmp } from './order.js';

/**
 * Keeps a write that is a publish only where it is one (P51).
 *
 * A write to a table is a message to whatever reads the table's stream, and
 * to nobody when the table has none - and whether it has one is declared in
 * the deployment, in whichever repository deploys the table, never in the
 * call. So the extractor draws such a write as a publisher marked
 * `whereDeclared`, onto the channel it would be, and this decides once every
 * repository is merged and every address completed from the environment:
 *
 * - an edge onto a channel some deployment declares (`declaredBy`) stays;
 * - any other edge goes, and a publisher left with none goes with its rows -
 *   a table with no stream is no channel and nothing to fix - and so does a
 *   channel left with no edge at all;
 * - a declared channel something reads and nothing writes is one `info` row:
 *   its writer may be outside the configured services, or the platform itself.
 */

const isDeclared = (node: GraphNode | undefined): boolean => node?.meta?.[CHANNEL_DECLARED_META] !== undefined;

/** Removes, in place, every row about one node in one service. */
const dropRowsAbout = (rows: Unresolved[], node: GraphNode): void => {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index] as Unresolved;
    if (row.symbol === node.id && (row.service === undefined || row.service === node.repo)) rows.splice(index, 1);
  }
};

export const keepWhereDeclared = (
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  rowLists: readonly Unresolved[][],
): Unresolved[] => {
  const writers = new Set(
    [...nodes.values()].filter((node) => node.type === 'producer' && node.meta?.[WHERE_DECLARED_META] === true).map((node) => node.id),
  );
  const kept = new Set<string>();
  const touched = new Set<string>();
  for (const [key, edge] of edges) {
    if (edge.type !== 'emits' || !writers.has(edge.from)) continue;
    if (isDeclared(nodes.get(edge.to))) {
      kept.add(edge.from);
      continue;
    }
    touched.add(edge.to);
    edges.delete(key);
  }
  const dropped = [...writers].filter((id) => !kept.has(id));
  for (const id of dropped) {
    const writer = nodes.get(id) as GraphNode;
    nodes.delete(id);
    for (const rows of rowLists) dropRowsAbout(rows, writer);
  }
  const gone = new Set(dropped);
  for (const [key, edge] of edges) if (gone.has(edge.from) || gone.has(edge.to)) edges.delete(key);

  const ends = new Set<string>();
  for (const edge of edges.values()) {
    ends.add(edge.from);
    ends.add(edge.to);
  }
  for (const id of touched) if (!ends.has(id) && !isDeclared(nodes.get(id))) nodes.delete(id);

  const written = new Set<string>();
  const read = new Set<string>();
  for (const edge of edges.values()) {
    if (edge.type === 'emits') written.add(edge.to);
    if (edge.type === 'consumes') read.add(edge.from);
  }
  return [...nodes.values()]
    .filter((channel) => channel.type === 'channel' && isDeclared(channel) && read.has(channel.id) && !written.has(channel.id))
    .sort((a, b) => cmp(a.id, b.id))
    .map(
      (channel): Unresolved => ({
        service: channel.repo,
        file: channel.file ?? '',
        line: channel.line ?? 0,
        reason: 'stream-no-writer',
        level: 'info',
        message: `${channel.label} is read by a function and nothing in the configured services writes to it`,
        hint: 'Its writer may be in a repository the configuration does not name, or outside any: another account, a console, the platform. Nothing to fix if it is.',
        symbol: channel.id,
      }),
    );
};
