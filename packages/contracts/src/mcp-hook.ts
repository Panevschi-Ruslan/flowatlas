/**
 * The field-level half of `check_contract`.
 *
 * The server can already say whether two hashes agree. What it cannot say
 * without this is *which field* disagrees, which is the only part of the answer
 * an agent can act on. It is handed in rather than imported, so the server
 * still runs with this package absent.
 */
import type { ProjectGraph } from '@flowatlas/core';
import { boundaries } from './boundary.js';
import { checkContracts } from './check.js';
import { edgeKeyOf } from './key.js';
import { asLookup } from './lookup.js';
import type { CheckOptions, ContractFinding, GraphLookup } from './types.js';

/** What the server asks, in the shape it asks it (P06). */
export interface ContractCheckerInput {
  edge: { from: string; to: string; type: string };
  left?: { id: string; structuralHash: string };
  right?: { id: string; structuralHash: string };
}

export type ContractChecker = (input: ContractCheckerInput) => ContractFinding[];

/**
 * A checker for one graph, answering one edge at a time.
 *
 * Both directions of the edge are answered, not the one the server happened to
 * classify: a caller that sends a body the handler cannot read and a handler
 * that answers with a shape the caller does not expect are different bugs, and
 * an agent asking about the edge wants to hear about both.
 *
 * A message on a channel is a contract between the publisher and the handler,
 * with the channel only the medium, so an edge into a channel is answered with
 * every handler that listens on it.
 */
export const createContractChecker = (
  source: ProjectGraph | GraphLookup,
  options: CheckOptions = {},
): ContractChecker => {
  const lookup = asLookup(source);
  let byKey: Map<string, ContractFinding[]> | undefined;

  const index = (): Map<string, ContractFinding[]> => {
    if (byKey !== undefined) return byKey;
    const report = checkContracts(lookup, options);
    const found = new Map<string, ContractFinding[]>();
    const add = (key: string, finding: ContractFinding): void => {
      const list = found.get(key);
      if (list === undefined) found.set(key, [finding]);
      else list.push(finding);
    };
    for (const finding of [...report.findings, ...report.ignored]) add(finding.edgeKey, finding);

    // A publisher's edge points at the channel, so that is how it is asked
    // about, while the finding is keyed by the pair it is really between.
    for (const exchange of boundaries(lookup)) {
      if (exchange.edge.type !== 'emits') continue;
      const channel = lookup.edgesFrom(exchange.edge.from, ['emits'])[0]?.to;
      if (channel === undefined) continue;
      const asked = edgeKeyOf({ from: exchange.edge.from, type: 'emits', to: channel });
      if (asked === exchange.edgeKey) continue;
      for (const finding of found.get(exchange.edgeKey) ?? []) add(asked, finding);
    }
    byKey = found;
    return found;
  };

  return (input) => index().get(edgeKeyOf(input.edge)) ?? [];
};
