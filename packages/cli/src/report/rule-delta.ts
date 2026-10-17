/**
 * What this revision did to the architecture rules, rather than how many
 * violations there are (P114): the four words `classifyContracts` uses for
 * contracts - new, fixed, already there, excused.
 *
 * Keyed on `rule|<name>|<from>|<to>`, which carries no line (D5), so a
 * violation stays the same violation after somebody adds an import above it.
 */
import { ruleFailures, type DiffRules, type RulesReport, type RuleViolation } from '@flowatlas/linker';

const keysOf = (violations: readonly RuleViolation[]): Set<string> => new Set(violations.map((item) => item.key));

/** The two sides' reports read against each other. */
export const classifyRules = (base: Pick<RulesReport, 'violations' | 'excused'>, head: Pick<RulesReport, 'violations' | 'excused'>): DiffRules => {
  const before = keysOf(base.violations);
  const after = keysOf(head.violations);
  // Excused on the head side, which is the side that ships: a violation a
  // person accepted on this branch is not one this branch fixed.
  const excused = keysOf(head.excused);
  return {
    new: head.violations.filter((item) => !before.has(item.key)),
    fixed: base.violations.filter((item) => !after.has(item.key) && !excused.has(item.key)),
    existing: head.violations.filter((item) => before.has(item.key)),
    excused: [...head.excused],
  };
};

/**
 * What this revision broke: new violations at `error`, a guessed one only
 * with `failOnHeuristic` (D4). An old one is somebody else's, an excused one
 * nobody's.
 */
export const ruleBreaks = (rules: DiffRules, failOnHeuristic = false): RuleViolation[] =>
  ruleFailures({ violations: rules.new, unchecked: [] }, 'error', failOnHeuristic).violations;
