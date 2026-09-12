/**
 * How bad a finding is, decided in one place and never argued with elsewhere.
 *
 * The kind of disagreement fixes it, and a named rule may only soften it. That
 * asymmetry is the point: a rule exists because JSON is less certain than
 * TypeScript, and less certainty can never make a verdict harsher than the
 * plain reading of the two declarations.
 */
import type { FindingKind, Severity } from './types.js';

const BY_KIND: Record<FindingKind, Severity> = {
  missing_required: 'error',
  type_mismatch: 'error',
  optionality_mismatch: 'warning',
  extra_field: 'info',
};

/** Worst first, so "at least a warning" is a comparison rather than a list. */
export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Rules that soften a verdict, and how far.
 *
 * Only one so far. A collection JSON cannot carry is reported whatever the two
 * declarations say, so it must not be able to fail a build on its own.
 */
const SOFTENED_BY: Record<string, Severity> = { 'set-map-json': 'warning' };

export const severityOf = (kind: FindingKind, rule: string | null): Severity => {
  const base = BY_KIND[kind];
  const softened = rule === null ? undefined : SOFTENED_BY[rule];
  if (softened === undefined) return base;
  return SEVERITY_RANK[softened] > SEVERITY_RANK[base] ? softened : base;
};

/** True when `severity` is at least as bad as `least`. */
export const atLeast = (severity: Severity, least: Severity): boolean =>
  SEVERITY_RANK[severity] <= SEVERITY_RANK[least];
