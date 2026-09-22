/**
 * How bad a finding is, decided in one place and never argued with elsewhere.
 *
 * The kind of disagreement fixes it, and a named rule may only soften it. That
 * asymmetry is the point: a rule exists because JSON is less certain than
 * TypeScript, and less certainty can never make a verdict harsher than the
 * plain reading of the two declarations.
 */
import type { FindingKind, Severity, StripImpact } from './types.js';

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
  // A choice of shapes too wide to walk. Nothing was compared, so nothing was
  // found to disagree, and the row says what was not done rather than claiming
  // a mismatch it never established.
  'choice-too-wide': 'info',
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

/**
 * A strip, by what it can cost.
 *
 * The rule says the field is removed; this says what that removal can lose. A
 * handler that reaches no write at all cannot lose anything by dropping a
 * field — a pricing preview reads, answers and persists nothing — so its rows
 * are information and fold into a count.
 *
 * The other two are both warnings, deliberately. R30 expected a field of a
 * document the handler writes to be an error, on the reasoning that `_id` and
 * `createdAt` would fail that test on their own because a client is not the
 * thing that sets them. Measured, they do not fail it: they are declared on
 * the schema like every other field, and promoting `stored` to an error made
 * twenty-five errors of which almost all were a client echoing back a key the
 * server owns. The signal is good enough to sort by and not good enough to
 * stop a build with, and saying otherwise would be the same mistake this
 * ticket was raised about.
 */
const BY_IMPACT: Record<StripImpact, Severity> = {
  stored: 'warning',
  unknown: 'warning',
  none: 'info',
};

export const severityOf = (
  kind: FindingKind,
  rule: string | null,
  impact?: StripImpact,
): Severity => {
  const base = BY_KIND[kind];
  if (rule !== null && HARDENED_BY[rule] !== undefined && impact !== undefined) {
    // The impact refines the hardening, and like the hardening it may only
    // reach the level that rule is allowed to reach. Returning it outright
    // would let a measurement quietly soften a verdict the kind had made
    // harsher, which is the one direction this module does not travel.
    const measured = BY_IMPACT[impact];
    const hardest = HARDENED_BY[rule] as Severity;
    return SEVERITY_RANK[measured] < SEVERITY_RANK[hardest] ? hardest : measured;
  }
  const hardened = rule === null ? undefined : HARDENED_BY[rule];
  if (hardened !== undefined && SEVERITY_RANK[hardened] < SEVERITY_RANK[base]) return hardened;
  const softened = rule === null ? undefined : SOFTENED_BY[rule];
  if (softened === undefined) return base;
  return SEVERITY_RANK[softened] > SEVERITY_RANK[base] ? softened : base;
};

/** True when `severity` is at least as bad as `least`. */
export const atLeast = (severity: Severity, least: Severity): boolean =>
  SEVERITY_RANK[severity] <= SEVERITY_RANK[least];
