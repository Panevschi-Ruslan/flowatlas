/**
 * A contract report, drawn three ways.
 *
 * The terminal is for a person scanning it, the document is for a pull request,
 * and the JSON is for whatever reads it next. All three are the same report and
 * none of them decides anything: what is worth saying was already settled by
 * the check, and this only chooses how much of it fits.
 */
import {
  SEVERITY_RANK,
  type ContractFinding,
  type ContractReport,
  type Severity,
  type UncheckedEdge,
} from '@flowatlas/contracts';
import { moreRows, renderTable, section } from '../format/table.js';

export interface ContractRenderOptions {
  /** The least severe thing worth printing. Everything worse is printed too. */
  severity?: Severity;
  /** Most findings to print. The file on disk is always complete (I9). */
  maxNodes?: number;
  /** Include the excused findings in their own section. */
  showIgnored?: boolean;
}

const DEFAULTS = { severity: 'info' as Severity, maxNodes: 150, showIgnored: true };

/** The one line that says what was looked at, whatever else is printed. */
export const summaryLine = (report: ContractReport): string => {
  const { summary } = report;
  return (
    `contracts: edges=${summary.edges} shared=${summary.shared} identical=${summary.identical} ` +
    `drift=${summary.hash_differs} unchecked=${summary.unchecked} errors=${summary.errors} ` +
    `warnings=${summary.warnings} infos=${summary.infos} ignored=${summary.ignored}`
  );
};

/** Findings at or above the level asked for, worst first. */
export const shown = (
  findings: readonly ContractFinding[],
  severity: Severity,
): ContractFinding[] =>
  findings.filter((finding) => SEVERITY_RANK[finding.severity] <= SEVERITY_RANK[severity]);

const where = (finding: ContractFinding): string =>
  `${finding.sender.service} → ${finding.receiver.service}`;

const rows = <T>(all: readonly T[], max: number): { rows: T[]; dropped: number } => ({
  rows: all.slice(0, max),
  dropped: Math.max(all.length - max, 0),
});

/** `… 12 more findings; the whole list is in <file>` — never a silent cut (I9). */
export const truncationNote = (dropped: number, file?: string): string =>
  `${moreRows(dropped).replace('rows', 'findings')}${file === undefined ? '' : `; the whole list is in ${file}`}`;

export const renderContractsText = (
  report: ContractReport,
  options: ContractRenderOptions & { file?: string } = {},
): string => {
  const settings = { ...DEFAULTS, ...options };
  const found = rows(shown(report.findings, settings.severity), settings.maxNodes);
  const lines: string[] = [summaryLine(report), ''];

  // A project where nothing reaches another service has no contract to check,
  // which is an answer rather than a failure — and a different answer from
  // "everything agrees", which is what an empty table would read as.
  if (report.summary.edges === 0 && report.summary.unchecked === 0) {
    lines.push(
      'no boundary between services in this graph: nothing calls another service, and no channel has both a publisher and a handler',
      'See flowatlas link --report for why nothing was joined.',
    );
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    ...section(
      'findings',
      renderTable(found.rows, [
        { header: 'severity', value: (finding) => finding.severity },
        { header: 'kind', value: (finding) => finding.kind },
        { header: 'between', value: where },
        { header: 'direction', value: (finding) => finding.direction },
        { header: 'field', value: (finding) => finding.field || '(whole type)' },
        { header: 'what', value: (finding) => finding.message },
      ]),
    ),
    ...(found.dropped > 0 ? [`  ${truncationNote(found.dropped, options.file)}`] : []),
  );

  if (settings.showIgnored && report.ignored.length > 0) {
    const excused = rows(report.ignored, settings.maxNodes);
    lines.push(
      ...section(
        'ignored',
        renderTable(excused.rows, [
          { header: 'kind', value: (finding) => finding.kind },
          { header: 'between', value: where },
          { header: 'field', value: (finding) => finding.field || '(whole type)' },
          { header: 'by', value: (finding) => finding.ignoredBy ?? '' },
        ]),
      ),
      ...(excused.dropped > 0 ? [`  ${truncationNote(excused.dropped, options.file)}`] : []),
    );
  }

  if (report.unchecked.length > 0) {
    const rest = rows(byReason(report.unchecked), settings.maxNodes);
    lines.push(
      ...section(
        'unchecked',
        renderTable(rest.rows, [
          { header: 'reason', value: (row) => row.reason },
          { header: 'places', value: (row) => String(row.count), align: 'right' },
          { header: 'first', value: (row) => row.first.edgeKey.split('|')[0] ?? '' },
          { header: 'what to do', value: (row) => row.first.hint },
        ]),
      ),
      ...(rest.dropped > 0 ? [`  ${truncationNote(rest.dropped, options.file)}`] : []),
    );
  }
  return `${lines.join('\n')}\n`;
};

interface UncheckedGroup {
  reason: string;
  count: number;
  first: UncheckedEdge;
}

/**
 * The unchecked list folded to one row per reason and remedy.
 *
 * Three hundred rows saying "this call declares no body type" teach a reader to
 * stop reading the list, and the three hundredth says nothing the first did
 * not. The count is kept beside the reason so nothing is hidden, and the whole
 * list is in the file.
 *
 * Folded by the remedy as well as the reason, because one reason can have two:
 * a request with no type wants a typed argument and a response with no type
 * wants a return type, and a row standing for both would send half its sites to
 * the wrong file.
 */
export const byReason = (unchecked: readonly UncheckedEdge[]): UncheckedGroup[] => {
  const found = new Map<string, UncheckedGroup>();
  for (const row of unchecked) {
    const key = `${row.reason}\0${row.hint}`;
    const group = found.get(key);
    if (group === undefined) found.set(key, { reason: row.reason, count: 1, first: row });
    else group.count += 1;
  }
  return [...found.values()].sort(
    (a, b) => b.count - a.count || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0),
  );
};

const escape = (text: string): string => text.replace(/\|/g, '\\|');

/** One row of a document table, with the bars a reader's renderer expects. */
const markdownRow = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

export const renderContractsMarkdown = (
  report: ContractReport,
  options: ContractRenderOptions & { file?: string } = {},
): string => {
  const settings = { ...DEFAULTS, ...options };
  const found = rows(shown(report.findings, settings.severity), settings.maxNodes);
  const lines: string[] = ['## Contracts', '', summaryLine(report), ''];

  if (found.rows.length === 0) {
    lines.push('Nothing at or above this level.', '');
  } else {
    lines.push(
      '| severity | kind | between | direction | field | what |',
      '|---|---|---|---|---|---|',
      ...found.rows.map((finding) =>
        markdownRow([
          finding.severity,
          finding.kind,
          escape(where(finding)),
          finding.direction,
          escape(finding.field || '(whole type)'),
          escape(finding.message),
        ]),
      ),
    );
    lines.push('');
    if (found.dropped > 0) lines.push(truncationNote(found.dropped, options.file), '');
  }

  if (settings.showIgnored && report.ignored.length > 0) {
    lines.push('### Ignored', '', '| kind | between | field | by |', '|---|---|---|---|');
    for (const finding of report.ignored.slice(0, settings.maxNodes)) {
      lines.push(
        markdownRow([
          finding.kind,
          escape(where(finding)),
          escape(finding.field || '(whole type)'),
          escape(finding.ignoredBy ?? ''),
        ]),
      );
    }
    lines.push('');
  }

  if (report.unchecked.length > 0) {
    lines.push('### Unchecked', '', '| reason | places | what to do |', '|---|---|---|');
    for (const group of byReason(report.unchecked)) {
      lines.push(markdownRow([group.reason, String(group.count), escape(group.first.hint)]));
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
};

/**
 * The report as data.
 *
 * Filtered the same way the other two are, so a script asking for errors gets
 * the errors it would have read on screen. The file written beside the graph is
 * the unfiltered one, and the command says so.
 */
export const renderContractsJson = (
  report: ContractReport,
  options: ContractRenderOptions = {},
): string => {
  const settings = { ...DEFAULTS, ...options };
  return `${JSON.stringify(
    {
      ...report,
      findings: shown(report.findings, settings.severity),
    },
    null,
    2,
  )}\n`;
};
