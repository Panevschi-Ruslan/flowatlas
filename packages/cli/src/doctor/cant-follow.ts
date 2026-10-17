/**
 * `flowatlas doctor --unresolved` - what the reader could not follow, by cause
 * (P75).
 *
 * The ordinary report lists rows by reason, and a reason says what was not
 * read: a call, a type, an injection. This says why, and into which package:
 * the one list a person can work through from the top, because the first line
 * is the fix that recovers the most.
 */
import {
  causeLabel,
  describeAcceptedProblem,
  groupCantFollow,
  PATTERN_CAUSES,
  type AcceptedProblem,
  type CantFollow,
  type CantFollowOptions,
  type CantFollowRow,
} from '@flowatlas/core';
import { oneLine, where } from './render.js';

/** Version of the JSON this prints. Bump it when a field is removed or changes meaning. */
export const CANT_FOLLOW_FORMAT_VERSION = 1;

export interface CantFollowReport extends CantFollow {
  cantFollowFormatVersion: number;
  /** The service it was narrowed to, or null for the whole project. */
  service: string | null;
  /** The cause or package it was narrowed to, when it was. */
  cause: string | null;
  package: string | null;
  /** The reasons it was narrowed to (`--reason`, P141), as typed, or null for every one. */
  reasons: string[] | null;
  /**
   * Gaps `accepted.json` names, left out of every count above. Absent when
   * none and the file read; `problem` says why nothing was left out (P80).
   */
  accepted?: { rows: number; sites: number; problem?: AcceptedProblem };
  /** Set when the rows had to be taken from the database. */
  note: string | null;
}

export const cantFollowReport = (
  rows: readonly CantFollowRow[],
  options: CantFollowOptions & {
    accepted?: { rows: number; sites: number; problem?: AcceptedProblem };
    note?: string;
    /** Said in the report; the rows handed in are already narrowed to them. */
    reasons?: readonly string[];
  } = {},
): CantFollowReport => {
  const { accepted, note, reasons, ...grouping } = options;
  return {
    cantFollowFormatVersion: CANT_FOLLOW_FORMAT_VERSION,
    service: grouping.service ?? null,
    cause: grouping.cause ?? null,
    package: grouping.package ?? null,
    reasons: reasons === undefined ? null : [...reasons],
    note: note ?? null,
    ...groupCantFollow(rows, grouping),
    ...(accepted === undefined || (accepted.rows === 0 && accepted.problem === undefined) ? {} : { accepted }),
  };
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const NO_REPOS: ReadonlyMap<string, string> = new Map();

/**
 * The breakdown, for a terminal: causes most places first, each with what to
 * do, its packages and a few places to open; then the packages on their own,
 * because "install this one" is a question about a package and not a cause.
 */
export const renderCantFollowText = (
  report: CantFollowReport,
  options: { repoDirs?: ReadonlyMap<string, string>; top?: number } = {},
): string => {
  const repoDirs = options.repoDirs ?? NO_REPOS;
  const narrowed = [
    report.service === null ? undefined : `service ${report.service}`,
    report.cause === null ? undefined : `cause ${report.cause}`,
    report.package === null ? undefined : `package ${report.package}`,
    report.reasons === null ? undefined : `reason ${report.reasons.join(', ')}`,
  ].filter((part): part is string => part !== undefined);
  const lines: string[] = [];
  if (report.note !== null) lines.push(`note: ${report.note}`, '');
  lines.push(
    `can't follow: ${plural(report.total.sites, 'place')} over ${plural(report.total.rows, 'row')}, by cause` +
      (narrowed.length === 0 ? '' : ` (${narrowed.join(', ')})`),
  );
  if (report.accepted?.problem !== undefined) {
    lines.push(`  warning: ${describeAcceptedProblem(report.accepted.problem)}; every place is counted`);
  } else if (report.accepted !== undefined) {
    lines.push(`  ${plural(report.accepted.rows, 'accepted gap')} left out (accepted.json; flowatlas accept --list)`);
  }
  if (report.causes.length === 0) {
    lines.push('  nothing: every step that was read was followed');
    return `${lines.join('\n')}\n`;
  }
  for (const cause of report.causes) {
    const services = cause.services.length === 0 ? '' : `  ${cause.services.length === 1 ? cause.services[0] : plural(cause.services.length, 'service')}`;
    lines.push('', `  ${cause.label}: ${plural(cause.sites, 'place')}${services}`, `    ${cause.hint}`);
    const reasons = cause.reasons.filter((reason) => reason !== cause.cause);
    if (reasons.length > 0) lines.push(`    rows: ${reasons.join(', ')}`);
    // A call on a wrapper of the project's own is what a pattern describes (P121).
    if (cause.reasons.some((reason) => PATTERN_CAUSES.includes(reason))) {
      lines.push(`    or, where the calls go through a wrapper of the project's own: flowatlas patterns suggest --cause ${cause.cause}`);
    }
    for (const pkg of cause.packages) {
      const named = cause.packages.length > 1 || (pkg.package !== null && cause.label === cause.cause);
      if (named) lines.push(`    ${causeLabel(cause.cause, pkg.package)}: ${plural(pkg.sites, 'place')}`);
      for (const sample of pkg.samples) {
        const place = where(sample.service ?? '', sample.file, sample.line, repoDirs);
        lines.push(`      ${place}${sample.symbol === undefined ? '' : `  ${oneLine(sample.symbol)}`}`);
      }
    }
    if (cause.truncated !== undefined) lines.push(`    … ${plural(cause.truncated, 'more package')}`);
  }
  if (report.packages.length > 0) {
    lines.push('', 'by package:');
    const width = Math.max(...report.packages.map((pkg) => pkg.package.length));
    for (const pkg of report.packages) {
      lines.push(
        `  ${pkg.package.padEnd(width)}  ${String(pkg.sites).padStart(5)}  ${pkg.causes.map((cause) => `${cause.cause} ${cause.sites}`).join(', ')}`,
      );
    }
  }
  const cut = report.truncated;
  if (cut !== undefined) {
    const parts = [
      cut.causes === undefined ? undefined : plural(cut.causes, 'more cause'),
      cut.packages === undefined ? undefined : plural(cut.packages, 'more package'),
    ].filter((part): part is string => part !== undefined);
    lines.push('', `… ${parts.join(' and ')}; --top ${(options.top ?? 10) * 2} lists more, --json lists them as data`);
  }
  return `${lines.join('\n')}\n`;
};

export const renderCantFollowJson = (report: CantFollowReport): string => `${JSON.stringify(report, null, 2)}\n`;
