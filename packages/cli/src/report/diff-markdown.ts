/**
 * The comparison as a document, ready to paste into a pull request.
 *
 * The order is the order a reviewer needs it in: what this touches and who
 * would notice, then what it breaks, then what changed shape, then the
 * arithmetic. Everything that could be a floor rather than a total says so.
 */
import type { Confidence, GraphNode } from '@flowatlas/core';
import type { ContractFinding } from '@flowatlas/contracts';
import {
  flowChanged,
  NEVER_PRODUCED,
  sayCounts,
  sayStep,
  servicesCrossed,
  type BlastEntry,
  type BlastRow,
  type DiffReport,
  type FlowChange,
  type LostJoin,
  type RuleViolation,
  type TypeChange,
} from '@flowatlas/linker';
import { groupEntries, reachableSummary } from '../query/callers.js';
import { foldSteps, notWalked, renderSequenceDiagram } from '../render/sequence.js';

export interface DiffMarkdownOptions {
  /** Most rows to print in any one table. The file on disk is complete (I9). */
  maxRows?: number;
  /** Where the whole document was written, named in every truncation note. */
  file?: string;
  /** Most changed flows drawn under "Changed flows"; the rest are named and counted (P116). */
  maxDiagrams?: number;
  /** Unchanged steps kept on each side of a change; a longer run folds to a count (D4). */
  context?: number;
  /**
   * About the most characters the document may take. Diagrams go first, from
   * the last, then whole flows, each counted, so the comment fits where it is
   * posted.
   */
  maxChars?: number;
  /** False for step lists without the Mermaid. */
  diagrams?: boolean;
  /**
   * Lines in place of the `## flowatlas diff` heading and its refs: what
   * `check` (P117) puts above the same body, its verdict first.
   */
  lead?: readonly string[];
}

/**
 * What a document leaves out when nobody says. `maxChars` stays under the
 * 65,536 characters a pull-request comment on GitHub may hold, with room for
 * whatever a workflow adds around it.
 */
export const DIFF_MARKDOWN_DEFAULTS: Readonly<Required<Omit<DiffMarkdownOptions, 'file' | 'lead'>>> = Object.freeze({
  maxRows: 50,
  maxDiagrams: 5,
  context: 3,
  maxChars: 60_000,
  diagrams: true,
});

const DEFAULTS = DIFF_MARKDOWN_DEFAULTS;

type Settings = Required<Omit<DiffMarkdownOptions, 'file' | 'lead'>> & DiffMarkdownOptions;

const escape = (text: string): string => text.replace(/\|/g, '\\|');

const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

/**
 * What to add after the level, in the confidence column of a way in.
 *
 * The column carries the weakest hop on the way to an entry, and the level
 * alone does not say why a reviewer should care, so each one names the kind of
 * path it stands for. A total record rather than a branch on `static`: the day
 * `declared` arrived, the branch read it as "declared (heuristic path)" — a
 * document's word for itself reported as somebody's guess — and nothing failed.
 */
const PATH_NOTE: Record<Confidence, string> = {
  static: '',
  marker: ' (asserted path)',
  declared: ' (via a declared service)',
  heuristic: ' (heuristic path)',
  runtime: ' (observed path)',
};

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
          `${entry.confidence}${PATH_NOTE[entry.confidence]}`,
        ]),
      );
    }
    lines.push('');
    lines.push(...more(ways.dropped + item.truncated, 'ways in', options.file));
    lines.push('</details>', '');
  }
  return lines;
};

/** Text inside an HTML element, which a `<summary>` is: Markdown is not read there. */
const html = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** What happened to a flow, for the line its `<details>` opens on. */
const flowSummary = (flow: FlowChange): string => {
  const crosses = servicesCrossed(flow);
  const steps = flow.steps.filter((step) => step.kind !== 'stop').length;
  const said =
    flow.side === 'head'
      ? `added, a way in the base did not have: ${steps} ${steps === 1 ? 'step' : 'steps'}`
      : flow.side === 'base'
        ? `removed, as of base: ${steps} ${steps === 1 ? 'step' : 'steps'} gone`
        : sayCounts(flow.counts);
  return `<code>${html(flow.label)}</code> (${html(flow.service)}) — ${html(said)}${crosses.length > 1 ? `; crosses ${html(crosses.join(' → '))}` : ''}`;
};

/** Where a step is written, said after it: `orders/src/orders.service.ts:22`. */
const stepPlace = (flow: FlowChange, step: Pick<FlowChange['steps'][number], 'from' | 'to' | 'file' | 'line'>): string => {
  if (step.file === undefined) return '';
  // Written in the service it leaves from; the request into a way in and a
  // handler taking a channel's message, in the service they reach.
  const serviceOf = (id: string): string | undefined => flow.participants.find((participant) => participant.id === id)?.service;
  const service = serviceOf(step.from) ?? serviceOf(step.to);
  return `  · ${service === undefined ? '' : `${service}/`}${step.file}${step.line === undefined ? '' : `:${step.line}`}`;
};

/**
 * The steps as text, under the diagram (D3): Mermaid does not render in every
 * place a comment is read, and a `diff` block colours the marks where it is.
 */
const stepList = (flow: FlowChange, context: number): string[] => [
  '```diff',
  ...foldSteps(flow.steps, context).map((item) =>
    'folded' in item ? `  … ${item.folded} unchanged steps` : `${sayStep(item.step, flow.participants)}${stepPlace(flow, item.step)}`,
  ),
  ...(flow.truncated === undefined ? [] : [`  … not walked: ${notWalked(flow.truncated)}`]),
  '```',
];

/** One changed flow: the summary line, the diagram unless left out, and the step list. */
const flowBlock = (flow: FlowChange, options: { open: boolean; diagram: boolean; context: number }): string[] => [
  `<details${options.open ? ' open' : ''}><summary>${flowSummary(flow)}</summary>`,
  '',
  ...(options.diagram
    ? [
        '```mermaid',
        renderSequenceDiagram(flow, { context: options.context, ...(flow.truncated === undefined ? {} : { truncated: flow.truncated }) }).trimEnd(),
        '```',
        '',
      ]
    : []),
  ...stepList(flow, options.context),
  '',
  '</details>',
  '',
];

/** How much of "Changed flows" a document has room for: flows drawn, and how many of them with a diagram. */
interface FlowRoom {
  drawn: number;
  diagrams: number;
}

/**
 * Each way in whose flow the branch changed, as a sequence diagram with its
 * steps listed under it (P116), the most changed first and the first open.
 * Past `maxDiagrams` a flow is named and counted; so is every flow `room`
 * left out to keep the document under `maxChars`; a way in whose steps did
 * not change is named on one line.
 */
const flowLines = (report: DiffReport, settings: Settings, room: FlowRoom): string[] => {
  if (report.flows.length === 0) return [];
  const changed = report.flows.filter(flowChanged);
  const same = report.flows.filter((flow) => !flowChanged(flow));
  const lines = ['## Changed flows', ''];
  if (changed.length === 0) lines.push('No way in the impact reaches does anything different.', '');
  const drawn = changed.slice(0, room.drawn);
  drawn.forEach((flow, at) => lines.push(...flowBlock(flow, { open: at === 0, diagram: settings.diagrams && at < room.diagrams, context: settings.context })));
  const where = settings.file === undefined ? 'diff.json' : settings.file;
  const notDrawn = changed.slice(drawn.length);
  // Flows past `maxDiagrams`, and those `maxChars` had no room for.
  const squeezed = Math.min(changed.length, settings.maxDiagrams) - drawn.length;
  const squeeze = `to keep this under ${settings.maxChars} characters`;
  if (notDrawn.length > 0) {
    const named = cut(notDrawn, settings.maxRows);
    lines.push(
      `… ${notDrawn.length} more changed ${notDrawn.length === 1 ? 'flow' : 'flows'}${squeezed > 0 ? ` (${squeezed} left out ${squeeze})` : ''}: ` +
        `${named.rows.map((flow) => code(flow.label)).join(', ')}${named.dropped > 0 ? ', …' : ''}; every flow is in ${where}`,
      '',
    );
  }
  const undrawn = settings.diagrams ? drawn.length - Math.min(room.diagrams, drawn.length) : 0;
  if (undrawn > 0) {
    lines.push(`… ${undrawn} ${undrawn === 1 ? 'diagram' : 'diagrams'} left out ${squeeze}; the steps are listed, and every flow is in ${where}`, '');
  }
  if (same.length > 0) {
    const named = cut(same, settings.maxRows);
    lines.push(
      `Ways in whose steps did not change: ${named.rows.map((flow) => `${code(flow.label)} (${flow.service})`).join(', ')}${named.dropped > 0 ? `, and ${named.dropped} more` : ''}`,
      '',
    );
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

const ruleRows = (violations: readonly RuleViolation[]): string[] => [
  row(['rule', 'severity', 'what crossed', 'where', 'confidence']),
  row(['---', '---', '---', '---', '---']),
  ...violations.map((item) => {
    const place = item.at === undefined ? '—' : code(`${item.at.service} ${item.at.file}${item.at.line === undefined ? '' : `:${item.at.line}`}`);
    return row([code(item.rule), item.severity, escape(item.message), place, `${item.confidence}${item.heuristic ? ' (guess)' : ''}`]);
  }),
  '',
];

/**
 * The architecture rules (P114): what this revision broke, fixed, left as it
 * was and had excused. Left out when no rule has a violation on either side.
 */
const ruleLines = (report: DiffReport, options: DiffMarkdownOptions & { maxRows: number }): string[] => {
  const { rules } = report;
  if (rules.new.length + rules.fixed.length + rules.existing.length + rules.excused.length === 0) return [];
  const lines = [
    '## Rules',
    '',
    `${rules.new.length} new, ${rules.fixed.length} fixed, ${rules.existing.length} already there, ${rules.excused.length} excused`,
    '',
  ];
  if (rules.new.length === 0) lines.push('This revision breaks no architecture rule it did not already break.', '');
  else {
    const shown = cut(rules.new, options.maxRows);
    lines.push('### New', '', ...ruleRows(shown.rows), ...more(shown.dropped, 'new violations', options.file));
    const why = [...new Map(shown.rows.filter((item) => item.note !== undefined).map((item) => [item.rule, item.note as string])).entries()];
    if (why.length > 0) lines.push(...why.map(([rule, note]) => `- ${code(rule)}: ${escape(note)}`), '');
  }
  if (rules.fixed.length > 0) {
    const shown = cut(rules.fixed, options.maxRows);
    lines.push('### Fixed', '', ...ruleRows(shown.rows), ...more(shown.dropped, 'fixed violations', options.file));
  }
  if (rules.existing.length > 0) {
    const shown = cut(rules.existing, options.maxRows);
    lines.push('### Already there', '', 'Not introduced by this revision, and not counted against it.', '', ...ruleRows(shown.rows), ...more(shown.dropped, 'violations already there', options.file));
  }
  if (rules.excused.length > 0) {
    const shown = cut(rules.excused, options.maxRows);
    lines.push(
      '### Excused',
      '',
      '`flowatlas accept rule:<name>` says this one is known. Never counted, never hidden.',
      '',
      ...shown.rows.map((item) => `- ${code(item.rule)}: ${escape(item.message)} — ${escape(item.excusedBy ?? 'accepted')}`),
      '',
      ...more(shown.dropped, 'excused violations', options.file),
    );
  }
  return lines;
};

/** How each kind of lost join is said in the table's last column. */
const LOST_SAY: Readonly<Record<LostJoin['kind'], (lost: LostJoin) => string>> = {
  'target-gone': (lost) => `${lost.targetRemoved ? 'its target is gone' : 'joins nothing'}; now ${code(lost.now)}`,
  'no-producer': (lost) => (lost.now === NEVER_PRODUCED ? 'a new handler of what nothing publishes' : 'nothing publishes it any more'),
  'no-consumer': () => 'nothing handles it any more',
};

/**
 * The calls this revision left with nothing to join (P96): the one thing a
 * renamed route breaks that no compiler on either side sees.
 */
const joinLines = (report: DiffReport, options: DiffMarkdownOptions & { maxRows: number }): string[] => {
  const lost = report.joins.lost;
  if (lost.length === 0) return [];
  const shown = cut(lost, options.maxRows);
  return [
    '## Calls that stopped joining',
    '',
    row(['caller', 'joined', 'what happened']),
    row(['---', '---', '---']),
    ...shown.rows.map((item) => row([code(item.caller), code(item.target), LOST_SAY[item.kind](item)])),
    '',
    ...more(shown.dropped, 'lost joins', options.file),
  ];
};

/** Gap ids the head has and the base does not (P96): places the reader can no longer see past. */
const gapLines = (report: DiffReport, options: DiffMarkdownOptions & { maxRows: number }): string[] => {
  const added = report.unresolved.added;
  const removed = report.unresolved.removed;
  if (added.length === 0 && removed.length === 0) return [];
  const lines = ['## Gaps and findings', '', `${added.length} new, ${removed.length} gone`, ''];
  if (added.length > 0) {
    const shown = cut(added, options.maxRows);
    lines.push(
      row(['kind', 'reason', 'where', 'in']),
      row(['---', '---', '---', '---']),
      ...shown.rows.map((ref) =>
        row([
          ref.kind,
          code(ref.reason),
          code(`${ref.service} ${ref.file}${ref.line === undefined ? '' : `:${ref.line}`}`),
          ref.node === undefined ? '—' : code(ref.node),
        ]),
      ),
      '',
      ...more(shown.dropped, 'new gaps', options.file),
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

/**
 * The whole document, under `maxChars`: the changed flows' diagrams are
 * dropped from the last one back, then the flows themselves, each said in a
 * line, before anything else is; every table is already bounded by `maxRows`.
 */
export const renderDiffMarkdown = (report: DiffReport, options: DiffMarkdownOptions = {}): string => {
  const settings = { ...DEFAULTS, ...options };
  const changed = report.flows.filter(flowChanged).length;
  const drawn = Math.min(changed, settings.maxDiagrams);
  const render = (room: FlowRoom): string => {
    const lines = [
      ...(settings.lead ?? [
        '## flowatlas diff',
        '',
        `\`${report.base.ref ?? 'working tree'}\` → \`${report.head.ref ?? 'working tree'}\``,
        '',
      ]),
      ...sideLines(report),
      ...warningLines(report),
      ...impactLines(report, settings),
      ...flowLines(report, settings, room),
      ...contractLines(report, settings),
      ...ruleLines(report, settings),
      ...joinLines(report, settings),
      ...gapLines(report, settings),
      ...typeLines(report, settings),
      ...graphLines(report),
      ...footer(report),
    ];
    return `${lines.join('\n')}\n`;
  };
  const room: FlowRoom = { drawn, diagrams: settings.diagrams ? drawn : 0 };
  let text = render(room);
  while (text.length > settings.maxChars && (room.diagrams > 0 || room.drawn > 0)) {
    if (room.diagrams > 0) room.diagrams -= 1;
    else room.drawn -= 1;
    text = render(room);
  }
  return text;
};

/** The same thing in one line, for a terminal and for the top of a CI log. */
export const summariseDiff = (report: DiffReport): string => {
  const { nodes, edges, types, contracts } = report;
  return (
    `nodes +${nodes.added.length}/-${nodes.removed.length}/~${nodes.changed.length}` +
    ` (${nodes.moved.length} moved) · edges +${edges.added.length}/-${edges.removed.length}/~${edges.changed.length}` +
    ` · types +${types.added.length}/-${types.removed.length}/~${types.changed.length}` +
    ` · contracts ${contracts.new.length} new, ${contracts.fixed.length} fixed, ${contracts.preexisting.length} already there` +
    ` · lost joins ${report.joins.lost.length} · gaps +${report.unresolved.added.length}/-${report.unresolved.removed.length}` +
    ` · impact ${report.impact.length} node(s)` +
    ` · flows ${report.flows.filter(flowChanged).length} changed` +
    ` · rules ${report.rules.new.length} new, ${report.rules.fixed.length} fixed`
  );
};
