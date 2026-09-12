/**
 * The contract report, as one health check reads it.
 *
 * `flowatlas contracts` prints everything it found, because that is the question
 * it was asked. `flowatlas doctor` asks a narrower one — what fails a build, and
 * what did the annotations excuse — and this is that view, computed here rather
 * than in the command so the checker owns the meaning of its own report.
 */
import type { ContractFinding, ContractReport, Direction, UncheckedReason } from './types.js';
import { UNCHECKED_REASONS } from './types.js';
import { uncheckedNote } from './unchecked.js';

export interface DoctorSummary {
  /** Findings that fail a build: `error`, with the excused ones taken out. */
  errors: ContractFinding[];
  /** The same, grouped by the boundary they were found on, worst edge first. */
  byEdge: Record<string, ContractFinding[]>;
  /** How many findings an annotation or the configuration excused. */
  ignored: number;
  /** Directions of boundaries nothing could be compared on. */
  unchecked: number;
  /**
   * Every symbol named on either end of a boundary, in id order.
   *
   * `@ContractIgnore` on a symbol that is not one of these excuses nothing, and
   * this is what lets that be said without the marker check knowing how a
   * boundary is found.
   */
  parties: string[];
}

/** Which boundary carries the most errors, so the worst is read first. */
const byWorst = (a: [string, ContractFinding[]], b: [string, ContractFinding[]]): number =>
  b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/**
 * What `doctor` needs from a contract report.
 *
 * The excused findings are counted rather than listed: a person reading a
 * health check wants to know that three drifts were signed off, not to read
 * them again. `flowatlas contracts` is where they are read.
 */
export const summarizeForDoctor = (report: ContractReport): DoctorSummary => {
  const errors = report.findings.filter(
    (finding) => finding.severity === 'error' && !finding.ignored,
  );

  const grouped = new Map<string, ContractFinding[]>();
  for (const finding of errors) {
    const list = grouped.get(finding.edgeKey);
    if (list === undefined) grouped.set(finding.edgeKey, [finding]);
    else list.push(finding);
  }

  const parties = new Set<string>();
  for (const result of report.edges) {
    parties.add(result.sender.symbol);
    parties.add(result.receiver.symbol);
  }
  parties.delete('');

  return {
    errors,
    byEdge: Object.fromEntries([...grouped.entries()].sort(byWorst)),
    ignored: report.ignored.length,
    unchecked: report.unchecked.length,
    parties: [...parties].sort(),
  };
};

/**
 * What to do about a boundary that could not be checked, as one sentence.
 *
 * `doctor` keeps a catalogue of advice keyed by reason and needs these in it,
 * so they are taken from the same table `flowatlas contracts` prints rather than
 * copied into a second one that would drift from it.
 */
export const uncheckedHint = (reason: UncheckedReason, direction: Direction = 'request'): string =>
  uncheckedNote(reason, 'this end', direction).hint;

/** Every unchecked reason with its advice, for seeding a hint catalogue. */
export const UNCHECKED_HINTS: Readonly<Record<UncheckedReason, string>> = Object.freeze(
  Object.fromEntries(UNCHECKED_REASONS.map((reason) => [reason, uncheckedHint(reason)])),
) as Readonly<Record<UncheckedReason, string>>;
