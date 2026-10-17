/**
 * Call cycles as SARIF findings (P115): one result per cycle, at the node the
 * walk starts from, with every hop a step of its code flow in order, so the
 * loop is shown across the repositories it runs through.
 */
import type { Cycle } from '../analysis/scc.js';
import { cycleRule } from './catalogue.js';
import { KEYS } from './fingerprints.js';
import { sarifLevelOf } from './levels.js';
import { nodePlace, type NodeLookup } from './places.js';
import type { SarifFinding, SarifStep } from './types.js';

const labelOf = (id: string, lookup?: NodeLookup): string => {
  const node = lookup?.node(id);
  if (node === undefined) return id;
  return node.repo === '' ? node.label : `${node.repo}:${node.label}`;
};

export const cycleFinding = (cycle: Cycle, lookup?: NodeLookup): SarifFinding => {
  const start = cycle.edges[0]?.from ?? cycle.id;
  const flow: SarifStep[] = [
    { place: nodePlace(lookup?.node(start)), message: labelOf(start, lookup) },
    ...cycle.edges.map((edge) => ({
      place: nodePlace(lookup?.node(edge.to)),
      message: `${edge.type}${edge.via === undefined ? '' : ` (${edge.via})`} ${labelOf(edge.to, lookup)}`,
    })),
  ];
  const at = nodePlace(lookup?.node(start));
  const around = cycle.services.length === 0 ? '' : ` through ${cycle.services.join(', ')}`;
  return {
    rule: cycleRule(),
    level: sarifLevelOf({ from: 'cycle' }),
    message: `a cycle of ${cycle.length} node${cycle.length === 1 ? '' : 's'}${around} comes back to ${labelOf(start, lookup)}${cycle.truncatedEdges === undefined ? '' : ` (${cycle.truncatedEdges} hops not shown)`}`,
    at,
    ...(at?.service === undefined ? {} : { fallbackService: at.service }),
    flow,
    key: { kind: 'cycle', value: KEYS.cycle(cycle.nodes) },
    properties: { crossService: cycle.crossService, confidence: cycle.confidence, length: cycle.length },
  };
};

export const cycleFindings = (cycles: readonly Cycle[], lookup?: NodeLookup): SarifFinding[] =>
  cycles.map((cycle) => cycleFinding(cycle, lookup));
