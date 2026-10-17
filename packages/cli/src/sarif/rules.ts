/**
 * Architecture rule violations as SARIF findings (P115, P114's mapping).
 *
 * The primary location is the crossing hop, where the fix goes; the target a
 * related location; the path a code flow, so the chain shows across
 * repositories. A rule that could not be checked has no place in a file and
 * is placed at the line of the configuration that names it (I3).
 */
import type { RuleUnchecked, RuleViolation } from '@flowatlas/linker';
import { architectureRule } from './catalogue.js';
import { KEYS } from './fingerprints.js';
import { sarifLevelOf } from './levels.js';
import { nodePlace, type NodeLookup } from './places.js';
import type { BaselineState, SarifFinding, SarifStep } from './types.js';

const labelOf = (id: string, lookup?: NodeLookup): string => lookup?.node(id)?.label ?? id;

/** The path as steps: where it starts, then where each hop lands. */
const flowOf = (violation: RuleViolation, lookup?: NodeLookup): SarifStep[] => {
  const [first] = violation.path;
  if (first === undefined) return [];
  return [
    { place: nodePlace(lookup?.node(first.from)), message: `${violation.fromService} ${labelOf(first.from, lookup)}` },
    ...violation.path.map((hop) => ({
      place: nodePlace(lookup?.node(hop.to)),
      message: `${hop.type} ${labelOf(hop.to, lookup)}${hop.confidence === 'static' ? '' : ` (${hop.confidence})`}`,
    })),
  ];
};

const sentence = (text: string): string => text.replace(/\.+$/, '');

export interface RuleFindingOptions {
  lookup?: NodeLookup;
  baselineState?: (violation: { key: string }) => BaselineState | undefined;
}

export const ruleViolationFinding = (violation: RuleViolation, options: RuleFindingOptions = {}): SarifFinding => {
  const level = sarifLevelOf({ from: 'rule', severity: violation.severity });
  const target = nodePlace(options.lookup?.node(violation.to));
  const state = options.baselineState?.(violation);
  const flow = flowOf(violation, options.lookup);
  return {
    rule: architectureRule(violation, level ?? 'note'),
    level,
    message: `${sentence(violation.message)}.${violation.note === undefined ? '' : ` ${sentence(violation.note)}.`}`,
    at: violation.at === undefined ? undefined : { service: violation.at.service, file: violation.at.file, ...(violation.at.line === undefined ? {} : { line: violation.at.line }) },
    fallbackRule: violation.rule,
    fallbackService: violation.fromService,
    ...(target === undefined ? {} : { related: [{ place: target, message: `target ${labelOf(violation.to, options.lookup)}` }] }),
    ...(flow.length === 0 ? {} : { flow }),
    key: { kind: 'rule', value: violation.key },
    // Excused by accepted.json: written, and shown dismissed rather than new.
    ...(violation.excusedBy === undefined
      ? state === undefined
        ? {}
        : { baselineState: state }
      : { baselineState: 'unchanged' as const, suppression: { kind: 'external' as const, justification: violation.excusedBy } }),
    properties: {
      shape: violation.shape,
      via: violation.via,
      confidence: violation.confidence,
      heuristic: violation.heuristic,
      ...(violation.partial === undefined ? {} : { partial: violation.partial }),
    },
  };
};

export const ruleUncheckedFinding = (item: RuleUnchecked, options: RuleFindingOptions = {}): SarifFinding => {
  const level = sarifLevelOf({ from: 'rule', severity: item.severity });
  const state = options.baselineState?.(item);
  return {
    rule: architectureRule(item, level ?? 'note'),
    level,
    message: `${sentence(item.message)} (${item.reason}).`,
    at: undefined,
    fallbackRule: item.rule,
    key: { kind: 'rule', value: item.key },
    ...(state === undefined ? {} : { baselineState: state }),
    properties: { shape: item.shape, reason: item.reason, side: item.side },
  };
};

/** A rules report's violations, the ones accepted.json excused, and the rules that could not be checked. */
export const ruleFindings = (
  report: { violations: readonly RuleViolation[]; excused?: readonly RuleViolation[]; unchecked?: readonly RuleUnchecked[] },
  options: RuleFindingOptions = {},
): SarifFinding[] => [
  ...report.violations.map((violation) => ruleViolationFinding(violation, options)),
  ...(report.excused ?? []).map((violation) => ruleViolationFinding(violation, options)),
  ...(report.unchecked ?? []).map((item) => ruleUncheckedFinding(item, options)),
];
