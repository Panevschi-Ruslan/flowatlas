/**
 * What this revision did to the contract findings, rather than how many there are.
 *
 * A project with a backlog of drift has a hundred findings before anybody
 * touches it, and a check that fails on all of them fails on every branch and
 * is therefore switched off within a week. What a reviewer needs is the four
 * words: new, fixed, still there, excused.
 */
import { findingKey, type ContractFinding, type ContractReport } from '@flowatlas/contracts';
import type { DiffContracts } from '@flowatlas/linker';

const keysOf = (findings: readonly ContractFinding[]): Set<string> =>
  new Set(findings.map((finding) => findingKey(finding)));

/**
 * The two reports read against each other, keyed on what a refactor cannot move.
 *
 * `findingKey` is deliberately made of the edge, the direction, the kind, the
 * type and the field — not the line and not the sentence — so a finding stays
 * the same finding after somebody adds an import above it.
 */
export const classifyContracts = (base: ContractReport, head: ContractReport): DiffContracts => {
  const before = keysOf(base.findings);
  const after = keysOf(head.findings);
  // Excused on the head side, which is the side that ships. Never counted
  // against the change, and never left out of the report either (plan §7).
  const excused = keysOf(head.ignored);
  return {
    new: head.findings.filter((finding) => !before.has(findingKey(finding))),
    // A finding that is gone because somebody annotated it is not a finding
    // that was fixed. The two shapes still disagree; a person decided the
    // disagreement is deliberate. Counting it as fixed would let a branch that
    // annotated a break read as a branch that repaired one.
    fixed: base.findings.filter(
      (finding) => !after.has(findingKey(finding)) && !excused.has(findingKey(finding)),
    ),
    preexisting: head.findings.filter((finding) => before.has(findingKey(finding))),
    ignored: head.ignored,
  };
};

/**
 * Whether this revision introduced something that breaks.
 *
 * Only `new`, and only `error`. A pre-existing error is somebody else's
 * problem and an excused one is nobody's.
 */
export const contractBreaks = (contracts: DiffContracts): ContractFinding[] =>
  contracts.new.filter((finding) => finding.severity === 'error');
