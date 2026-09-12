/**
 * The comparison as a document, ready to paste into a pull request.
 *
 * The order is the order a reviewer needs it in: what this touches and who
 * would notice, then what it breaks, then what changed shape, then the
 * arithmetic. Everything that could be a floor rather than a total says so.
 */
import type { GraphNode } from '@flowatlas/core';
import type { ContractFinding } from '@flowatlas/contracts';
import type { BlastEntry, BlastRow, DiffReport, TypeChange } from '@flowatlas/linker';
import { groupEntries, reachableSummary } from '../query/callers.js';

export interface DiffMarkdownOptions {
  /** Most rows to print in any one table. The file on disk is complete (I9). */
  maxRows?: number;
  /** Where the whole document was written, named in every truncation note. */
  file?: string;
}

const DEFAULTS = { maxRows: 50 };

const escape = (text: string): string => text.replace(/\|/g, '\\|');

const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

const code = (text: string): string => `\`${escape(text)}\``;

const short = (sha: string | null): string => (sha === null ? 'working tree' : sha.slice(0, 8));

/**
 * A way in, as the summary line wants to read it.
 *
 * `reachableSummary` is P07's and is the one sentence `flowatlas impact` prints,
 * so a reviewer reading this document and a developer running the command see
 * the same words about the same change.
 */
const asNode = (entry: BlastEntry): GraphNode => ({
  id: entry.id,
  type: entry.type as GraphNode['type'],
  label: entry.label,
  repo: entry.service,
  kind: entry.kind,
});

const cut = <T>(all: readonly T[], max: number): { rows: T[]; dropped: number } => ({
  rows: all.slice(0, max),
  dropped: Math.max(all.length - max, 0),
});

const more = (dropped: number, what: string, file?: string): string[] =>
  dropped === 0
    ? []
    : [`… ${dropped} more ${what}${file === undefined ? '' : `; the whole list is in ${file}`}`, ''];

/** `main a1b2c3d → HEAD e4f5a6b`, per repository, on one line each. */
const sideLines = (report: DiffReport): string[] => {
  const names = Object.keys(report.head.services).sort();
  if (names.length === 0) return [];
  return [
    row(['service', 'base', 'head', 'read']),
    row(['---', '---', '---', '---']),
    ...names.map((name) => {
      const base = report.base.services[name];
      const head = report.head.services[name];
      const how =
        base?.cached === true ? 'base from cache' : base?.sha === head?.sha ? 'unchanged' : 'read';
      return row([code(name), short(base?.sha ?? null), short(head?.sha ?? null), how]);
    }),
    '',
  ];
};

/**
 * The plan's own sentence, one per changed node.
 *
 * "Affected: OrdersService.create. Reachable from: 2 ui_actions (web), 1 bot
 * callback (bot), 1 consumer (billing)." — which is the whole point of the
 * command, and much more concrete than the graph it is derived from.
 */
const impactLines = (report: DiffReport, options: Required<Pick<DiffMarkdownOptions, 'maxRows'>> & DiffMarkdownOptions): string[] => {
  const lines = ['## Impact', ''];
  if (report.impact.length === 0) {
    const missed = unread(report);
    // "Nothing changed" is only an answer when everything was read. Where it
    // was not, the sentence is about what the comparison covered, not about the
    // project.
    return [
      ...lines,
      missed.length === 0
        ? 'Nothing changed that anything reaches.'
        : `Nothing changed in what was read — and ${missed.join(', ')} ` +
          `${missed.length === 1 ? 'was' : 'were'} not read at either ref. See Warnings.`,
      '',
    ];
  }
  const shown = cut(report.impact, options.maxRows);
  lines.push(row(['changed', 'service', 'reachable from']), row(['---', '---', '---']));
  for (const item of shown.rows) {
    lines.push(row([code(item.label), item.service, escape(summaryOf(item))]));
  }
  lines.push('');
  lines.push(...more(shown.dropped, 'changed nodes', options.file));

  // The ways in themselves, under the table, because a count is what to worry
  // about and a list is what to retest.
  for (const item of shown.rows) {
    if (item.entries.length === 0) continue;
    lines.push(`<details><summary>${escape(item.label)} — ways in</summary>`, '');
    const ways = cut(item.entries, options.maxRows);
    lines.push(row(['entry', 'service', 'kind', 'confidence']), row(['---', '---', '---', '---']));
    for (const entry of ways.rows) {
      lines.push(
        row([
          code(entry.id),
          entry.service,
          entry.kind,
          entry.confidence === 'static' ? 'static' : `${entry.confidence} (heuristic path)`,
        ]),
      );
    }
    lines.push('');
    lines.push(...more(ways.dropped + item.truncated, 'ways in', options.file));
    lines.push('</details>', '');
  }
  return lines;
};

/** The one sentence, with every qualifier it has earned and no more. */
const summaryOf = (item: BlastRow): string => {
  const head = reachableSummary(item.entries.map(asNode), item.servicesWithoutEntry).replace(
    'Reachable from: ',
    '',
  );
  const parts = [head];
  if (item.side === 'base') parts.push('as of base — this node is gone in head');
  if (item.truncated > 0) parts.push(`${item.truncated} more not listed`);
  if (item.partial) parts.push('the walk was cut short, so these counts are a floor');
  if (item.entries.length === 0 && item.reached === 0) {
    return `no entry points and nothing reaches it — see \`flowatlas dead\`${item.side === 'base' ? ' (as of base)' : ''}`;
  }
  return parts.join('; ');
};

const findingRows = (findings: readonly ContractFinding[]): string[] => [
  row(['severity', 'kind', 'between', 'direction', 'field', 'what']),
  row(['---', '---', '---', '---', '---', '---']),
  ...findings.map((finding) =>
    row([
      finding.severity,
      finding.kind,
      escape(`${finding.sender.service} → ${finding.receiver.service}`),
      finding.direction,
      escape(finding.field === '' ? '(whole type)' : finding.field),
      escape(finding.message),
    ]),
  ),
  '',
];

const contractLines = (report: DiffReport, options: DiffMarkdownOptions & { maxRows: number }): string[] => {
  const { contracts } = report;
  const lines = ['## Contract changes', ''];
  const counts =
    `${contracts.new.length} new, ${contracts.fixed.length} fixed, ` +
    `${contracts.preexisting.length} already there, ${contracts.ignored.length} excused`;
  lines.push(counts, '');

  if (contracts.new.length === 0) {
    lines.push('This revision introduces no new contract finding.', '');
  } else {
    const shown = cut(contracts.new, options.maxRows);
    lines.push('### New', '', ...findingRows(shown.rows), ...more(shown.dropped, 'new findings', options.file));
  }

  if (contracts.fixed.length > 0) {
    const shown = cut(contracts.fixed, options.maxRows);
    lines.push('### Fixed', '', ...findingRows(shown.rows), ...more(shown.dropped, 'fixed findings', options.file));
  }
  if (contracts.preexisting.length > 0) {
    const shown = cut(contracts.preexisting, options.maxRows);
    lines.push(
      '### Already there',
      '',
      'Not introduced by this revision, and not counted against it.',
      '',
      ...findingRows(shown.rows),
      ...more(shown.dropped, 'pre-existing findings', options.file),
    );
  }
  if (contracts.ignored.length > 0) {
    const shown = cut(contracts.ignored, options.maxRows);
    lines.push(
      '### Excused',
      '',
      '`@ContractIgnore` or `contracts.ignoreEdges` says this drift is deliberate. Never counted, never hidden.',
      '',
      row(['kind', 'between', 'field', 'by']),
      row(['---', '---', '---', '---']),
      ...shown.rows.map((finding) =>
        row([
          finding.kind,
          escape(`${finding.sender.service} → ${finding.receiver.service}`),
          escape(finding.field === '' ? '(whole type)' : finding.field),
          code(finding.ignoredBy ?? 'configuration'),
        ]),
      ),
      '',
      ...more(shown.dropped, 'excused findings', options.file),
    );
  }
  return lines;
};

/** What an empty field diff on a differing hash actually means. */
const typeNote = (change: TypeChange): string =>
  change.fieldDiff.length > 0
    ? change.fieldDiff.map((field) => field.message).join('; ')
    : 'the shape differs below the top level, or only in ways JSON drops on the way through';

const typeLines = (report: DiffReport, options: DiffMarkdownOptions & { maxRows: number }): string[] => {
  const { types } = report;
  if (types.added.length === 0 && types.removed.length === 0 && types.changed.length === 0) return [];
  const lines = ['## Types', ''];
  if (types.changed.length > 0) {
    const shown = cut(types.changed, options.maxRows);
    lines.push(row(['type', 'what changed']), row(['---', '---']));
    for (const change of shown.rows) lines.push(row([code(change.id), escape(typeNote(change))]));
    lines.push('');
    lines.push(...more(shown.dropped, 'changed types', options.file));
  }
  if (types.added.length > 0) lines.push(`Added: ${types.added.map(code).join(', ')}`, '');
  if (types.removed.length > 0) lines.push(`Removed: ${types.removed.map(code).join(', ')}`, '');
  return lines;
};

const graphLines = (report: DiffReport): string[] => {
  const { nodes, edges } = report;
  return [
    '## Graph',
    '',
    row(['', 'added', 'removed', 'changed', 'moved']),
    row(['---', '---', '---', '---', '---']),
    row([
      'nodes',
      String(nodes.added.length),
      String(nodes.removed.length),
      String(nodes.changed.length),
      String(nodes.moved.length),
    ]),
    row([
      'edges',
      String(edges.added.length),
      String(edges.removed.length),
      String(edges.changed.length),
      '—',
    ]),
    row([
      'types',
      String(report.types.added.length),
      String(report.types.removed.length),
      String(report.types.changed.length),
      '—',
    ]),
    '',
  ];
};

/**
 * The same warning once, however many sides raised it.
 *
 * Both readings warn about a service neither of them could read, so a project
 * of four services produced eight identical lines and then four more.
 */
const distinct = (warnings: DiffReport['warnings']): DiffReport['warnings'] => {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.reason}\u0000${warning.service ?? ''}\u0000${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Services the comparison could not read at the ref it was given. */
const unread = (report: DiffReport): string[] => [
  ...new Set(
    report.warnings
      .filter((warning) => warning.reason === 'not-a-git-repo' || warning.reason === 'ref-not-found')
      .map((warning) => warning.service ?? '')
      .filter((name) => name !== ''),
  ),
];

/**
 * What could not be read, said before anything computed without it.
 *
 * This used to sit under the graph counts, three screens below a verdict of
 * "Nothing changed that anything reaches" that had been reached by reading
 * neither side of every service. A reader who stopped at the verdict — which is
 * the point of a verdict — was told the opposite of the truth.
 */
const warningLines = (report: DiffReport): string[] => {
  const rows = distinct(report.warnings);
  if (rows.length === 0) return [];
  return [
    '## Warnings',
    '',
    ...rows.map((warning) => `- **${warning.reason}** — ${warning.message} ${warning.hint}`),
    '',
  ];
};

/**
 * The last line, which is the one that says what the report does not cover.
 *
 * Rows and sites are both there because R07 folded an informational finding to
 * one row standing for many places: a delta of one row can be a delta of three
 * hundred places, and a reviewer should be able to see which.
 */
const footer = (report: DiffReport): string[] => {
  const base = report.counts.base.unresolved;
  const head = report.counts.head.unresolved;
  const delta = (value: number): string => (value > 0 ? `+${value}` : String(value));
  return [
    '---',
    '',
    `unresolved: ${head.rows} rows over ${head.sites} sites in head ` +
      `(${delta(head.rows - base.rows)} rows, ${delta(head.sites - base.sites)} sites against base)`,
    '',
    `base ${report.timing.baseMs}ms · head ${report.timing.headMs}ms · diff ${report.timing.diffMs}ms · ${report.timing.totalMs}ms total`,
    '',
  ];
};

export const renderDiffMarkdown = (report: DiffReport, options: DiffMarkdownOptions = {}): string => {
  const settings = { ...DEFAULTS, ...options };
  const lines = [
    '## flowatlas diff',
    '',
    `\`${report.base.ref ?? 'working tree'}\` → \`${report.head.ref ?? 'working tree'}\``,
    '',
    ...sideLines(report),
    ...warningLines(report),
    ...impactLines(report, settings),
    ...contractLines(report, settings),
    ...typeLines(report, settings),
    ...graphLines(report),
    ...footer(report),
  ];
  return `${lines.join('\n')}\n`;
};

/** The same thing in one line, for a terminal and for the top of a CI log. */
export const summariseDiff = (report: DiffReport): string => {
  const { nodes, edges, types, contracts } = report;
  return (
    `nodes +${nodes.added.length}/-${nodes.removed.length}/~${nodes.changed.length}` +
    ` (${nodes.moved.length} moved) · edges +${edges.added.length}/-${edges.removed.length}/~${edges.changed.length}` +
    ` · types +${types.added.length}/-${types.removed.length}/~${types.changed.length}` +
    ` · contracts ${contracts.new.length} new, ${contracts.fixed.length} fixed, ${contracts.preexisting.length} already there` +
    ` · impact ${report.impact.length} node(s)`
  );
};
