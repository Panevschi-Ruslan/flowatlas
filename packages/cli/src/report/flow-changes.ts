/**
 * The flows a branch changed (P116): each way in the impact reaches, walked on
 * the base and the head graph and compared step by step.
 *
 * The impact table says which ways in reach a changed node; this says what
 * each of them does now that it did not do before. The ways in are the ones
 * the blast radius already found (`BlastRow.entries`, both sides) and the ways
 * in the branch added or removed, so nothing is walked that the diff did not
 * point at. Walking is the only thing here that reads a graph; the step lists
 * and their comparison are the linker's pure `sequenceOf` and `diffSequences`.
 */
import {
  flowChanged,
  flowChangeOf,
  servicesCrossed,
  typeNotesOf,
  type DiffReport,
  type FlowChange,
  type GraphDb,
  type SequenceDetail,
  type WalkedSide,
} from '@flowatlas/linker';
import { walkSequence } from '../query/sequence.js';

/** A way in worth walking, and how many changed nodes it reaches. */
export interface FlowCandidate {
  id: string;
  label: string;
  service: string;
  reaches: number;
}

export interface FlowLimits {
  /** Most ways in to walk; the rest are counted (I9). */
  maxFlows: number;
  /** Nodes each walk may show, the same on both sides. */
  maxNodes: number;
  detail: SequenceDetail;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The ways in to walk: every entry an impact row lists, counted once per row
 * that lists it, and every way in the branch added or removed (which reaches
 * itself). The most reached first, then by id, so the bound keeps the ones a
 * reviewer most needs.
 */
export const flowCandidates = (
  report: Pick<DiffReport, 'impact' | 'nodes'>,
  dbs: { head: GraphDb; base: GraphDb },
): FlowCandidate[] => {
  const found = new Map<string, FlowCandidate>();
  for (const row of report.impact) {
    for (const entry of row.entries) {
      const held = found.get(entry.id);
      if (held === undefined) found.set(entry.id, { id: entry.id, label: entry.label, service: entry.service, reaches: 1 });
      else held.reaches += 1;
    }
  }
  for (const id of [...report.nodes.added, ...report.nodes.removed]) {
    if (found.has(id)) continue;
    const node = dbs.head.node(id) ?? dbs.base.node(id);
    if (node === undefined || node.type !== 'entry') continue;
    found.set(id, { id, label: node.label, service: node.repo, reaches: 1 });
  }
  return [...found.values()].sort((a, b) => b.reaches - a.reaches || byText(a.id, b.id));
};

/**
 * The flows, the changed first; within each, the way in that reaches more
 * changed nodes, then the one that crosses more services, then by id.
 */
const rank = (a: FlowChange, b: FlowChange): number =>
  Number(flowChanged(b)) - Number(flowChanged(a)) ||
  b.reaches - a.reaches ||
  servicesCrossed(b).length - servicesCrossed(a).length ||
  byText(a.entry, b.entry);

/**
 * Walks each way in on the sides that have it and compares the two. A way in
 * only one side has is all added or all removed (drawn from the base graph
 * when it is gone). `skipped` is how many ways in were past `maxFlows`.
 */
export const flowChanges = (
  report: Pick<DiffReport, 'impact' | 'nodes' | 'types'>,
  dbs: { head: GraphDb; base: GraphDb },
  limits: FlowLimits,
): { flows: FlowChange[]; skipped: number } => {
  const candidates = flowCandidates(report, dbs);
  const taken = candidates.slice(0, limits.maxFlows);
  const typeNotes = typeNotesOf(report.types.changed);
  const walk = (db: GraphDb, id: string): WalkedSide | undefined =>
    db.node(id) === undefined ? undefined : walkSequence(db, id, { maxNodes: limits.maxNodes, detail: limits.detail });
  const flows: FlowChange[] = [];
  for (const candidate of taken) {
    const head = walk(dbs.head, candidate.id);
    const base = walk(dbs.base, candidate.id);
    const flow = flowChangeOf(candidate, { ...(base === undefined ? {} : { base }), ...(head === undefined ? {} : { head }) }, { typeNotes });
    if (flow !== undefined) flows.push(flow);
  }
  return { flows: flows.sort(rank), skipped: candidates.length - taken.length };
};
