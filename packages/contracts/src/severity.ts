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
 * A collection JSON cannot carry is reported whatever the two declarations say,
 * so it must not be able to fail a build on its own. A `null` an unvalidated
 * receiver reads where it declared the field optional breaks nothing at run
 * time, and says only that the declaration is imprecise.
 */
const SOFTENED_BY: Record<string, Severity> = {
  'set-map-json': 'warning',
  // A `null` arriving where an unvalidated receiver declares the field optional.
  'null-for-optional': 'warning',
};

/**
 * The one exception to softening only.
 *
 * A rule that softens stands for JSON being less certain than TypeScript. This
 * one stands for the opposite: the receiver's own validation pipe is recorded on
 * the route, and it removes the field before the handler runs. A field sent and
 * silently thrown away is not waste, it is data the sender believes arrived.
 */
const HARDENED_BY: Record<string, Severity> = { 'whitelist-strip': 'warning' };

export const severityOf = (kind: FindingKind, rule: string | null): Severity => {
  const base = BY_KIND[kind];
  const hardened = rule === null ? undefined : HARDENED_BY[rule];
  if (hardened !== undefined && SEVERITY_RANK[hardened] < SEVERITY_RANK[base]) return hardened;
  const softened = rule === null ? undefined : SOFTENED_BY[rule];
  if (softened === undefined) return base;
  return SEVERITY_RANK[softened] > SEVERITY_RANK[base] ? softened : base;
};

/** True when `severity` is at least as bad as `least`. */
export const atLeast = (severity: Severity, least: Severity): boolean =>
  SEVERITY_RANK[severity] <= SEVERITY_RANK[least];
