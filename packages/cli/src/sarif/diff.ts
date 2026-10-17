/**
 * What a revision did to the findings, as SARIF findings (P115).
 *
 * Only what a reviewer acts on: the contract findings and rule violations it
 * introduced (`new`, placed on the head side) and the ones it fixed
 * (`absent`, placed where they were on the base side). A changed node is not
 * a finding, so the node diff is not written (§2 Out).
 */
import type { DiffContracts, DiffRules, SpecDiffReport } from '@flowatlas/linker';
import { contractFinding } from './contracts.js';
import type { NodeLookup } from './places.js';
import { ruleViolationFinding } from './rules.js';
import { specFinding } from './spec.js';
import type { SarifFinding } from './types.js';

export const diffFindings = (
  report: { contracts: DiffContracts; rules: DiffRules; spec?: SpecDiffReport | null },
  lookups: { head?: NodeLookup; base?: NodeLookup } = {},
): SarifFinding[] => {
  const on = (lookup: NodeLookup | undefined): { lookup?: NodeLookup } => (lookup === undefined ? {} : { lookup });
  return [
    ...report.contracts.new.map((finding) => contractFinding(finding, { ...on(lookups.head), baselineState: 'new' })),
    ...report.contracts.fixed.map((finding) => contractFinding(finding, { ...on(lookups.base), baselineState: 'absent' })),
    ...report.rules.new.map((violation) => ruleViolationFinding(violation, { ...on(lookups.head), baselineState: () => 'new' })),
    ...report.rules.fixed.map((violation) => ruleViolationFinding(violation, { ...on(lookups.base), baselineState: () => 'absent' })),
    // With `--spec` (P118): the API changes a reviewer acts on; an added
    // route or field cannot break anything and is not a finding.
    ...(report.spec?.changes ?? []).filter((change) => change.level !== 'info').map(specFinding),
  ];
};
