import { accessOf, rankByReach, waysInOf, type GraphNode } from '@flowatlas/core';
import type { GraphDb, UnresolvedRow } from '@flowatlas/linker';
import { projectDetail } from '../query/detail.js';
import { failsOf } from '../query/fails.js';
import { buildFlowTree, REVERSE_EDGES } from '../query/flow.js';
import { nextFor } from '../query/next.js';
import type { CompactNode, FlowEdge, FlowNode } from '../query/types.js';
import type { PromptGap, PromptStep, PromptSubject } from './describe.js';

/** What stands in front of a way in, a line per check and per opt-out (P76). */
const accessLines = (node: GraphNode): string[] => {
  const access = node.type === 'entry' ? accessOf(node) : undefined;
  if (access === undefined) return [];
  return [
    ...access.guards.map(
      (guard) => `\`${guard.name}\` — ${guard.where}, ${guard.via}${guard.skippedBy === undefined ? '' : `; switched off here by @${guard.skippedBy}`}`,
    ),
    ...(access.optOuts ?? []).map(
      (item) =>
        `@${item.decorator} on the ${item.where === 'controller' ? 'controller' : 'handler'}` +
        `${item.public ? ', open on purpose' : ''}${item.skips.length === 0 ? '; no check in front reads it' : `; read by ${item.skips.join(', ')}`}`,
    ),
  ];
};

/** How many nodes the walk under a prompt may visit; the renderer cuts further. */
const WALK_NODES = 120;

/** How many ways in are named for a subject that is not one. */
const MAX_REACHED_FROM = 5;

const step = (node: CompactNode, depth: number, edge?: FlowEdge): PromptStep => ({
  depth,
  id: node.id,
  label: node.label,
  type: node.type,
  ...(node.kind === undefined ? {} : { kind: node.kind }),
  ...(node.service === undefined ? {} : { service: node.service }),
  ...(node.loc === undefined ? {} : { loc: node.loc }),
  ...(edge === undefined
    ? {}
    : {
        via: { type: edge.type, confidence: edge.confidence, ...(edge.because === undefined ? {} : { because: edge.because }) },
        ...(edge.params === undefined ? {} : { params: edge.params }),
        ...(edge.returns === undefined ? {} : { returns: edge.returns }),
      }),
  ...(node.ref === true ? { repeat: true } : {}),
});

/** The tree as lines in reading order, depth first, as a person reads a call chain. */
const stepsOf = (root: FlowNode): PromptStep[] => {
  const steps: PromptStep[] = [];
  const visit = (item: FlowNode, depth: number): void => {
    steps.push(step(item.node, depth, item.edge));
    for (const child of item.children) visit(child, depth + 1);
  };
  for (const child of root.children) visit(child, 1);
  return steps;
};

const gapOf = (row: UnresolvedRow & { meta?: Record<string, unknown> }, id: string): PromptGap => ({
  reason: row.reason,
  message: row.message,
  id,
  ...(row.service === null ? {} : { service: row.service }),
  ...(row.file === null ? {} : { loc: row.line === null ? row.file : `${row.file}:${row.line}` }),
  ...(row.hint === null ? {} : { hint: row.hint }),
  ...(waysInOf(row) === undefined ? {} : { waysIn: waysInOf(row) }),
});

/** A node the graph points at and does not hold is a gap too, with a reason. */
const missingGap = (item: PromptStep): PromptGap => ({
  reason: 'node-missing',
  message: `the graph points at ${item.id} and holds no such node`,
  id: item.id,
});

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Everything the Markdown says about one node, read from the graph.
 *
 * The walk is the one `get_flow` answers with, so the prompt and the tool never
 * disagree about the chain. A channel adds what publishes onto it; anything
 * that is not a way in adds the ways in that reach it.
 */
export const gatherPromptSubject = (db: GraphDb, node: GraphNode): PromptSubject => {
  const flow = buildFlowTree(db, node.id, { maxNodes: WALK_NODES, detail: 1 });
  const steps = stepsOf(flow.root);

  const gaps: PromptGap[] = [];
  for (const id of [node.id, ...new Set(steps.map((item) => item.id))]) {
    for (const row of db.unresolvedFor(id)) gaps.push(gapOf(row, id));
  }
  // A loop reached from more ways in first, among the loops (P89).
  gaps.splice(0, gaps.length, ...rankByReach(gaps, (gap) => gap.waysIn));
  for (const item of steps) if (item.type === 'missing') gaps.push(missingGap(item));

  const producers =
    node.type === 'channel'
      ? db
          .edgesTo(node.id, ['emits'])
          .map((edge) => db.node(edge.from))
          .filter((found): found is GraphNode => found !== undefined)
          .sort(byId)
          .map((found) => step(projectDetail(found, 1), 1))
      : undefined;

  const reachedFrom =
    node.type === 'entry' || node.type === 'channel'
      ? undefined
      : db
          .reverseReach(node.id, { edgeTypes: REVERSE_EDGES, maxDepth: 12, maxNodes: 2000 })
          .rows.filter((row) => row.type === 'entry' && row.id !== node.id)
          .map((row) => db.node(row.id))
          .filter((found): found is GraphNode => found !== undefined)
          .sort(byId)
          .slice(0, MAX_REACHED_FROM)
          .map((found) => step(projectDetail(found, 1), 1));

  const compact = projectDetail(node, 1);
  const fails = failsOf(node);
  const access = accessLines(node);
  const firstReal = steps.find((item) => item.type !== 'missing' && item.repeat !== true);
  return {
    id: node.id,
    label: node.label,
    type: node.type,
    ...(compact.kind === undefined ? {} : { kind: compact.kind }),
    ...(compact.service === undefined ? {} : { service: compact.service }),
    ...(compact.loc === undefined ? {} : { loc: compact.loc }),
    ...(fails.length === 0 ? {} : { fails }),
    ...(access.length === 0 ? {} : { access }),
    steps,
    stepsCut: flow.truncated === undefined ? 0 : Number.parseInt(flow.truncated.replace(/^\D+/, ''), 10) || 0,
    ...(producers === undefined ? {} : { producers }),
    ...(reachedFrom === undefined ? {} : { reachedFrom }),
    gaps,
    askNext: nextFor(node, reachedFrom?.[0], firstReal),
  };
};
