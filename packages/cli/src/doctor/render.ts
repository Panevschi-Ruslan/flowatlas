/**
 * A health check, drawn three ways.
 *
 * The terminal is for the person who ran it, the JSON for whatever reads it
 * next, and the annotations for a pull request, where the useful place to say
 * "this annotation is a lie" is on the line the annotation is written. All
 * three are the same report; none of them decides anything.
 */
import { resolve } from 'node:path';
import type { ContractFinding } from '@flowatlas/contracts';
import { isInstalled, partialReadNotice, type ReadRepo } from '../partial-read.js';
import { moreRows, renderTable, section } from '../format/table.js';
import type { MarkerIssue } from './markers.js';
import type { DoctorReport } from './schema.js';
import { noWayInSentence } from './ways-in.js';

/** `… 12 more rows; the whole list is in <file>` — never a silent cut (I9). */
const more = (dropped: number | undefined, file?: string): string[] =>
  dropped === undefined
    ? []
    : [`  ${moreRows(dropped)}${file === undefined ? '' : `; the whole list is in ${file}`}`];

/**
 * The one line that says everything, for a build log nobody will scroll.
 *
 * Two numbers for unresolved because they answer different questions: how many
 * places a person could act on, which is what fails a build, and how long the
 * list actually is.
 */
export const summaryLine = (report: DoctorReport): string => {
  const { unresolved, markers, desync, contracts, baseline, verdict } = report;
  const against =
    baseline.status === 'ok' || baseline.status === 'grew'
      ? `baseline ${baseline.total.baseline}, ${baseline.total.delta >= 0 ? '+' : ''}${baseline.total.delta}`
      : baseline.status;
  return (
    `unresolved: total=${unresolved.total} (${against}) · ` +
    `markers: errors=${markers.errors} warnings=${markers.warnings} · ` +
    `desync=${desync.rows.length + (desync.truncated ?? 0)} · ` +
    `contracts: errors=${contracts.errorCount} ignored=${contracts.ignored} · ` +
    `exit=${verdict.exitCode}`
  );
};

const at = (file: string, line: number): string => `${file}:${line === 0 ? '?' : line}`;

/**
 * Where a row is, spelled so a terminal can open it.
 *
 * A row carries the service it belongs to and a path inside that service's
 * repository, which is the right pair to store and the wrong one to print: a
 * reader is at the project root and `orders src/x.ts:12` is not anywhere. Given
 * where the configuration says each repository is, the two join into a path
 * that is. Without that, the service name and the path stay as they were.
 */
const where = (
  service: string,
  file: string,
  line: number,
  repoDirs: ReadonlyMap<string, string>,
): string => {
  const dir = repoDirs.get(service);
  if (dir !== undefined) return at(`${dir}/${file}`, line);
  return `${service === '' ? '' : `${service} `}${at(file, line)}`;
};

const NO_REPOS: ReadonlyMap<string, string> = new Map();

/**
 * A symbol on one line, however many the source spread it over.
 *
 * Rows name the expression they gave up on as it is written, and an expression
 * written over four lines would otherwise put four lines into a list whose
 * shape is what makes it scannable.
 */
const oneLine = (text: string, width = 100): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
};

/**
 * Where a contract finding is, worked out from the id of the symbol it names.
 *
 * A finding is about two declarations rather than about a place, so it carries
 * no file of its own. The id of the end that has to change does: it is built
 * from the file the symbol is declared in, which is where a reader is going.
 */
export const placeOf = (symbol: string): { file: string; line: number } | undefined => {
  const hash = symbol.indexOf('#');
  if (hash < 0) return undefined;
  const rest = symbol.slice(hash + 1);
  const colon = rest.indexOf(':');
  if (colon < 0) return undefined;
  const file = rest.slice(0, colon);
  if (!file.includes('/') && !file.includes('.')) return undefined;
  const line = /#L(\d+)$/.exec(symbol);
  return { file, line: line === null ? 0 : Number(line[1]) };
};

/** What a group of one level is marked with, where it is not the ordinary case. */
const LEVEL_TAG = {
  action: '',
  info: ' (info)',
  nothing: ' (nothing to join)',
} as const;

const unresolvedSection = (
  report: DoctorReport,
  repoDirs: ReadonlyMap<string, string>,
  file?: string,
): string[] => {
  const { unresolved } = report;
  if (unresolved.status === 'skipped') return [];
  // In the words the build summary uses, and only where it says something: a
  // project whose every body was read has no gap to size.
  const { found, read } = unresolved.waysIn;
  const ways =
    read === found
      ? []
      : [`  ways in: ${found} found, ${read} with a handler that was read, ${found - read} without`];
  if (unresolved.byReason.length === 0) return ['unresolved: none', ...ways];

  const lines: string[] = [
    `unresolved: ${unresolved.total} to act on over ${unresolved.rows} row${unresolved.rows === 1 ? '' : 's'}` +
      (unresolved.info.rows === 0
        ? ''
        : `, and ${unresolved.info.sites} place${unresolved.info.sites === 1 ? '' : 's'} static reading cannot see, folded into ${unresolved.info.rows}`),
    ...ways,
  ];
  // Said on a line of its own, in the words the build summary uses: these are
  // sites where nothing joins, not sites where something was missed.
  if (unresolved.nothing.rows > 0) {
    lines.push(
      `  ${unresolved.nothing.sites} site${unresolved.nothing.sites === 1 ? '' : 's'} with nothing to join, folded into ${unresolved.nothing.rows} row${unresolved.nothing.rows === 1 ? '' : 's'}, counted in none of the above`,
    );
  }
  for (const group of unresolved.byReason) {
    const tag = LEVEL_TAG[group.level] || (group.excluded ? ' (not counted)' : '');
    const folded = group.sites === group.count ? '' : ` over ${group.sites} places`;
    lines.push(
      `  ${group.reason}${tag}: ${group.count} row${group.count === 1 ? '' : 's'}${folded}`,
      `    ${group.hint}`,
    );
    for (const row of group.rows) {
      const place = where(row.service, row.file, row.line, repoDirs);
      lines.push(`      ${place}${row.symbol === null ? '' : `  ${oneLine(row.symbol)}`}`);
      // The heading says what the kind means; this says what this place is.
      // Marked, because an unmarked sentence between two sites is read as
      // belonging to the one below it (R35), and indentation alone was not
      // enough to stop that.
      if (row.hint !== group.hint) lines.push(`        ↳ ${row.hint}`);
    }
    lines.push(...more(group.truncated, file));
  }
  if (unresolved.unknownReasons.length > 0) {
    lines.push(
      `  doctor: unknown reasons — ${unresolved.unknownReasons.join(', ')}`,
      '    Register them in packages/cli/src/doctor/hints.ts so each row can say what to do.',
    );
  }
  return lines;
};

const markerSection = (report: DoctorReport, file?: string): string[] => {
  const { markers } = report;
  if (markers.status === 'skipped') return [];
  const note = markers.note === null ? [] : [`  note: ${markers.note}`];
  if (markers.issues.length === 0) {
    return [`markers: none${markers.note === null ? '' : ''}`, ...note];
  }
  return [
    ...section(
      `markers: ${markers.errors} error${markers.errors === 1 ? '' : 's'}, ${markers.warnings} warning${markers.warnings === 1 ? '' : 's'}`,
      renderTable(markers.issues, [
        { header: 'severity', value: (issue) => issue.severity },
        { header: 'code', value: (issue) => issue.code },
        { header: 'where', value: (issue) => `${issue.service} ${at(issue.file, issue.line)}` },
        { header: 'what', value: (issue) => issue.message },
        { header: 'to do', value: (issue) => issue.hint },
      ]),
    ),
    ...note,
    ...more(markers.truncated, file),
  ];
};

const desyncSection = (report: DoctorReport, file?: string): string[] => {
  const { desync } = report;
  if (desync.status === 'skipped') return [];
  if (desync.rows.length === 0) return ['desync: none'];
  return [
    ...section(
      `desync: ${desync.rows.length + (desync.truncated ?? 0)}`,
      renderTable(desync.rows, [
        { header: 'reason', value: (row) => row.reason },
        { header: 'where', value: (row) => `${row.service} ${at(row.file, row.line)}` },
        {
          header: 'call',
          value: (row) => `${row.method ?? '?'} ${row.path ?? '?'}`,
        },
        { header: 'target', value: (row) => row.targetService ?? row.baseUrlEnv ?? '?' },
        { header: 'to do', value: (row) => row.hint },
      ]),
    ),
    ...more(desync.truncated, file),
  ];
};

const between = (finding: ContractFinding): string =>
  `${finding.sender.service} → ${finding.receiver.service}`;

const contractSection = (report: DoctorReport, file?: string): string[] => {
  const { contracts } = report;
  if (contracts.status === 'skipped') return [];
  if (contracts.status === 'unavailable') {
    return ['contracts: not checked', `  ${contracts.note ?? ''}`];
  }
  const tail = `, ${contracts.ignored} excused, ${contracts.unchecked} boundary directions nothing could be compared on`;
  if (contracts.errors.length === 0) return [`contracts: no errors${tail}`];
  return [
    ...section(
      `contracts: ${contracts.errorCount} error${contracts.errorCount === 1 ? '' : 's'}${tail}`,
      renderTable(contracts.errors, [
        { header: 'kind', value: (finding) => finding.kind },
        { header: 'between', value: between },
        { header: 'direction', value: (finding) => finding.direction },
        { header: 'field', value: (finding) => finding.field || '(whole type)' },
        { header: 'what', value: (finding) => finding.message },
      ]),
    ),
    ...more(contracts.truncated, file),
  ];
};

const baselineSection = (report: DoctorReport): string[] => {
  const { baseline } = report;
  if (baseline.status === 'skipped') return [];
  const head = `baseline: ${baseline.status} (${baseline.total.baseline} accepted, ${baseline.total.current} now, ${baseline.total.delta >= 0 ? '+' : ''}${baseline.total.delta})`;
  const lines = [head];
  if (baseline.note !== null) lines.push(`  ${baseline.note}`);
  for (const row of baseline.byReason.filter((entry) => entry.delta !== 0)) {
    lines.push(
      `  ${row.reason}: ${row.baseline} → ${row.current} (${row.delta >= 0 ? '+' : ''}${row.delta})`,
    );
  }
  if (baseline.newKeys.length > 0) {
    lines.push(`  new (${baseline.newKeys.length}):`);
    for (const key of baseline.newKeys.slice(0, 20)) lines.push(`    ${key}`);
    if (baseline.newKeys.length > 20) lines.push(`    ${moreRows(baseline.newKeys.length - 20)}`);
  }
  if (baseline.goneKeys.length > 0) {
    lines.push(`  gone (${baseline.goneKeys.length}):`);
    for (const key of baseline.goneKeys.slice(0, 20)) lines.push(`    ${key}`);
    if (baseline.goneKeys.length > 20) lines.push(`    ${moreRows(baseline.goneKeys.length - 20)}`);
  }
  return lines;
};

/**
 * Types this run could not resolve, from the folded report (R129).
 *
 * The group is the only place the count survives folding, and it is the count of
 * *sites* rather than of rows, because a row here may stand for four hundred
 * places and the number worth saying is how much of the source went unread.
 */
const unresolvedTypes = (report: DoctorReport): number =>
  report.unresolved.status === 'skipped'
    ? 0
    : (report.unresolved.byReason.find((group) => group.reason === 'type-unresolved')?.sites ?? 0);

/**
 * What the report says above its first line, about how its services were read.
 *
 * One rule per kind of read that went wrong, most telling first. A service is
 * spoken for by the first rule that takes it, and no later rule names it again:
 * a service with no way in is told so, and is not then told to install its
 * dependencies as if that were what it lacked (R170).
 */
interface HeadRule {
  /** The services, of those no earlier rule took, that this rule speaks for. */
  takes(report: DoctorReport, repos: readonly ReadRepo[]): readonly string[];
  /** What it says about the services it took, a paragraph each. */
  says(report: DoctorReport, repos: readonly ReadRepo[]): string[];
}

/**
 * A service that has no way in, named before anything about its dependencies,
 * because installing them would not give it one; where they are not installed
 * either, it says so in the same breath.
 */
const NOT_INSTALLED_EITHER = '; its dependencies are not installed either, and installing them would not give it one';

const noWayInHead: HeadRule = {
  takes: (report) => (report.unresolved.withoutWaysIn ?? []).map(({ service }) => service),
  says: (report, repos) =>
    (report.unresolved.withoutWaysIn ?? []).map((service) => {
      const repo = repos.find((each) => each.name === service.service);
      const uninstalled = repo !== undefined && !isInstalled(repo.dir);
      return `${noWayInSentence(service)}${uninstalled ? NOT_INSTALLED_EITHER : ''}.`;
    }),
};

/**
 * The one sentence about dependencies that are not installed (R129).
 *
 * At the head rather than beside the rows, and once rather than per row, because
 * hundreds of `type-unresolved` rows already imply it and a reader either infers
 * a partial read from them or does not. By the time somebody reaches the rows
 * they have already read the summary line as a measurement.
 *
 * `rootDir` is what makes it possible to answer honestly: `repoDirs` is spelled
 * relative to the project so a row can be printed as a path somebody can open,
 * and resolving it is the difference between establishing that nothing is
 * installed and assuming it. Without a root, nothing is claimed.
 */
const partialReadHead: HeadRule = {
  takes: (_report, repos) => repos.map((repo) => repo.name),
  says: (report, repos) => {
    const notice = partialReadNotice(repos, unresolvedTypes(report));
    return notice === undefined ? [] : [notice];
  },
};

const HEAD_RULES: readonly HeadRule[] = Object.freeze([noWayInHead, partialReadHead]);

const headOf = (
  report: DoctorReport,
  repoDirs: ReadonlyMap<string, string>,
  rootDir: string | undefined,
): string[] => {
  let left: readonly ReadRepo[] =
    rootDir === undefined
      ? []
      : [...repoDirs.entries()].map(([name, dir]) => ({ name, dir: resolve(rootDir, dir) }));
  const said: string[] = [];
  for (const rule of HEAD_RULES) {
    const taken = new Set(rule.takes(report, left));
    if (taken.size === 0) continue;
    said.push(...rule.says(report, left.filter((repo) => taken.has(repo.name))));
    left = left.filter((repo) => !taken.has(repo.name));
  }
  return said.flatMap((paragraph) => [paragraph, '']);
};

export const renderDoctorText = (
  report: DoctorReport,
  options: { file?: string; repoDirs?: ReadonlyMap<string, string>; rootDir?: string } = {},
): string => {
  const blocks = [
    unresolvedSection(report, options.repoDirs ?? NO_REPOS, options.file),
    markerSection(report, options.file),
    desyncSection(report, options.file),
    contractSection(report, options.file),
    baselineSection(report),
  ].filter((block) => block.length > 0);

  const verdict =
    report.verdict.reasons.length === 0
      ? report.strict
        ? ['verdict: nothing that fails a strict run']
        : []
      : ['verdict:', ...report.verdict.reasons.map((reason) => `  ${reason}`)];

  return `${[
    ...headOf(report, options.repoDirs ?? NO_REPOS, options.rootDir),
    summaryLine(report),
    '',
    ...blocks.flatMap((block) => [...block, '']),
    ...verdict,
  ]
    .join('\n')
    .replace(/\n+$/, '')}\n`;
};

export const renderDoctorJson = (report: DoctorReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

/**
 * The two escapes a workflow command needs, which are not the same escape.
 *
 * A message only has to survive being one line: a per cent sign and the two
 * line endings. A property value additionally sits inside a comma-separated
 * list of `key=value`, so a comma or a colon in one would end it early — which
 * is how a title carrying `POST /orders: renamed` truncates its own annotation.
 */
const escapeData = (value: string): string =>
  value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const escapeProperty = (value: string): string =>
  escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

export interface GithubOptions {
  /** Where the complete report was written, named in every truncation note. */
  file?: string;
  /**
   * Where each service's repository sits, relative to the checkout.
   *
   * A row's file is relative to the repository it was read from, and an
   * annotation's is relative to wherever the workflow is running. In a project
   * whose repositories are checked out side by side those are one prefix apart,
   * and without it every annotation lands on a path that does not exist.
   */
  repoDir?: (service: string) => string | undefined;
  /**
   * Where a service is written in the configuration, for a finding about the
   * service as a whole rather than a line of its code: a service with no way
   * in (R173).
   */
  serviceAt?: (service: string) => { file: string; line: number } | undefined;
}

const annotation = (
  level: 'error' | 'warning',
  place: { file: string; line: number } | undefined,
  title: string,
  message: string,
): string => {
  const where =
    place === undefined || place.file === ''
      ? ''
      : `file=${escapeProperty(place.file)}${place.line > 0 ? `,line=${place.line}` : ''},`;
  return `::${level} ${where}title=${escapeProperty(title)}::${escapeData(message)}`;
};

/** A row's file as the checkout sees it, when the configuration says where. */
const inRepo = (
  file: string,
  service: string,
  repoDir: GithubOptions['repoDir'],
): string => {
  const dir = repoDir?.(service);
  return dir === undefined || dir === '' ? file : `${dir}/${file}`;
};

/**
 * The report as workflow commands, so a pull request is annotated in place.
 *
 * The text report goes out too: an annotation is attached to a line and a
 * person reading the log still wants the numbers. A row whose file cannot be
 * placed is annotated without one rather than dropped — GitHub attaches it to
 * the job, which is worse than the right line and much better than silence.
 */
export const renderDoctorGithub = (report: DoctorReport, options: GithubOptions = {}): string => {
  const lines: string[] = [];
  const at = (file: string, line: number, service: string): { file: string; line: number } => ({
    file: inRepo(file, service, options.repoDir),
    line,
  });

  // First, as the verdict says it first (R170): a warning, as it decides no exit.
  for (const service of report.unresolved.withoutWaysIn ?? []) {
    lines.push(
      annotation('warning', options.serviceAt?.(service.service), `${service.service}: no way in`, `${noWayInSentence(service)}.`),
    );
  }
  for (const issue of report.markers.issues) {
    lines.push(
      annotation(
        issue.severity,
        at(issue.file, issue.line, issue.service),
        `${issue.service}: ${issue.code}`,
        `${issue.message}. ${issue.hint}`,
      ),
    );
  }
  for (const row of report.desync.rows) {
    lines.push(
      annotation(
        'error',
        at(row.file, row.line, row.service),
        `${row.service}: ${row.reason}`,
        `${row.message}. ${row.hint}`,
      ),
    );
  }
  for (const finding of report.contracts.errors) {
    // Whichever end has to change is the end to annotate, and that is the
    // sender: the receiver is declaring what it needs, which is its right.
    const ends = [
      { place: placeOf(finding.sender.symbol), service: finding.sender.service },
      { place: placeOf(finding.receiver.symbol), service: finding.receiver.service },
    ];
    const end = ends.find((candidate) => candidate.place !== undefined);
    lines.push(
      annotation(
        'error',
        end === undefined
          ? undefined
          : at(
              (end.place as { file: string; line: number }).file,
              (end.place as { file: string; line: number }).line,
              end.service,
            ),
        `${between(finding)}: ${finding.kind}`,
        finding.message,
      ),
    );
  }
  if (report.baseline.status === 'grew') {
    lines.push(
      annotation(
        'error',
        undefined,
        'unresolved grew',
        `${report.baseline.total.baseline} places were accepted and there are now ${report.baseline.total.current}. Run flowatlas doctor to see which, or flowatlas doctor --accept to accept them.`,
      ),
    );
  }
  return `${lines.join('\n')}${lines.length === 0 ? '' : '\n'}${renderDoctorText(report, options)}`;
};
