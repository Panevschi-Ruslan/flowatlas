/**
 * The identity of a finding, which is what makes two reports comparable.
 *
 * Deliberately made of the things a refactor does not move: which edge, which
 * half of the exchange, what kind of disagreement, whose type, which field.
 * Not the line it was found on and not the sentence describing it, because
 * `diff` has to be able to say "this is the same finding as before" after
 * someone has added a line above it or reworded the report.
 */
import type { ContractFinding } from './types.js';

export const findingKey = (finding: ContractFinding): string =>
  [finding.edgeKey, finding.direction, finding.kind, finding.typeId, finding.field].join('|');

/** `from|type|to`, the identity of an edge, shared with `diff` (P12). */
export const edgeKeyOf = (edge: { from: string; type: string; to: string }): string =>
  `${edge.from}|${edge.type}|${edge.to}`;
