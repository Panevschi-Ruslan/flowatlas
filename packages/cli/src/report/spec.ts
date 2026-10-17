/**
 * The documents `flowatlas spec` writes, the inventory beside them, and the
 * change between two revisions' documents as text and as Markdown (P118).
 *
 * A document is written whole (I9: files complete); a printed table of
 * changes or routes is bounded by `maxRows`, with what was left out counted
 * and the complete file named.
 */
import {
  SPEC_CHANGE_KINDS,
  type InventoryRow,
  type SpecCaller,
  type SpecChange,
  type SpecDiffReport,
  type WrittenSpec,
} from '@flowatlas/linker';
import YAML from 'yaml';

/** The two ways a document is written to disk. */
export const SPEC_FORMATS = ['yaml', 'json'] as const;
export type SpecFormat = (typeof SPEC_FORMATS)[number];

/** `orders.openapi.yaml`, `orders@admin.openapi.json`, `billing.asyncapi.yaml`. */
export const specFileName = (spec: Pick<WrittenSpec, 'name' | 'kind'>, format: SpecFormat): string => `${spec.name}.${spec.kind}.${format}`;

/** The file's content: key order as written, no folding, so the bytes are the same every run. */
export const renderSpecFile = (spec: WrittenSpec, format: SpecFormat): string =>
  format === 'json' ? `${JSON.stringify(spec.document, null, 2)}\n` : YAML.stringify(spec.document, { lineWidth: 0, aliasDuplicateObjects: false });

const escape = (text: string): string => text.replace(/\|/g, '\\|');
const code = (text: string): string => `\`${escape(text)}\``;
const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

const more = (dropped: number, what: string, file?: string): string[] =>
  dropped === 0 ? [] : [`… and ${dropped} more ${what}${file === undefined ? '' : `, in ${file}`}.`, ''];

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const callersSaid = (callers: Record<string, number>): string => {
  const entries = Object.entries(callers);
  return entries.length === 0 ? '—' : entries.map(([service, n]) => `${service} ${n}`).join(', ');
};

/** One table of every route and procedure: the code inventory. */
export const renderInventoryMarkdown = (rows: readonly InventoryRow[], options: { maxRows?: number; file?: string } = {}): string => {
  const max = options.maxRows ?? rows.length;
  const shown = rows.slice(0, max);
  const lines = [
    '## Routes',
    '',
    `${plural(rows.filter((item) => item.kind === 'http').length, 'route')}, ${plural(rows.filter((item) => item.kind === 'procedure').length, 'procedure')}, read from the code; nothing here was run.`,
    '',
    row(['service', 'verb', 'path', 'guarded', 'public', 'callers', 'tables written', 'channels published', 'fails', 'where']),
    row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---']),
    ...shown.map((item) =>
      row([
        code(item.application === undefined ? item.service : `${item.service}@${item.application}`),
        item.kind === 'procedure' ? 'procedure' : item.verb,
        code(item.path),
        item.guarded ? 'yes' : 'no',
        item.public === undefined ? '—' : escape(item.public),
        callersSaid(item.callers),
        item.tables.length === 0 ? '—' : item.tables.map(code).join(', '),
        item.channels.length === 0 ? '—' : item.channels.map(code).join(', '),
        item.fails.length === 0 ? '—' : item.fails.join(', '),
        item.file === undefined ? '—' : code(`${item.file}${item.line === undefined ? '' : `:${item.line}`}`),
      ]),
    ),
    '',
    ...more(rows.length - shown.length, 'routes', options.file),
  ];
  return `${lines.join('\n')}\n`;
};

export const renderInventoryJson = (rows: readonly InventoryRow[]): string => `${JSON.stringify({ routes: rows }, null, 2)}\n`;

const placeOf = (caller: SpecCaller): string => `${caller.service}${caller.file === undefined ? '' : ` ${caller.file}${caller.line === undefined ? '' : `:${caller.line}`}`}`;

/** At most three callers, then how many more. */
const callersOf = (change: SpecChange, quote: (text: string) => string): string => {
  if (change.callers.length === 0) return change.public === null ? '—' : `none; public: ${change.public}`;
  const named = change.callers.slice(0, 3).map((caller) => quote(placeOf(caller)));
  return `${named.join(', ')}${change.callers.length > 3 ? `, +${change.callers.length - 3} more` : ''}`;
};

/** The message without the operation it already starts with. */
const said = (change: SpecChange): string =>
  change.message.startsWith(`${change.operation}: `) ? change.message.slice(change.operation.length + 2) : change.message;

/** How many changes of each level, and how many breaking ones nobody calls. */
export const summariseSpecDiff = (report: SpecDiffReport): string => {
  const { errors, warnings, infos, breaking, uncalled } = report.summary;
  return `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}, ${infos} info${infos === 1 ? '' : 's'} · ${breaking} breaking by kind, ${uncalled} of them with no caller in this project`;
};

/**
 * The changes as Markdown: one table, loudest first, bounded by `maxRows`.
 * `diff --spec` puts the same lines under "API changes"; `spec diff` under its
 * own heading.
 */
export const specDiffLines = (report: SpecDiffReport, options: { maxRows?: number; file?: string; heading?: string } = {}): string[] => {
  const max = options.maxRows ?? 50;
  const lines = [options.heading ?? '## API changes', '', summariseSpecDiff(report), ''];
  if (report.changes.length === 0) {
    lines.push(`No route or channel end changed between the two sides (${report.documents.base} document(s) before, ${report.documents.head} after).`, '');
    return lines;
  }
  const shown = report.changes.slice(0, max);
  lines.push(
    row(['level', 'change', 'operation', 'field', 'what', 'callers on the base side']),
    row(['---', '---', '---', '---', '---', '---']),
    ...shown.map((change) =>
      row([
        change.level,
        code(change.kind),
        `${code(change.document)} ${code(change.operation)}`,
        change.field === null ? '—' : code(change.field),
        escape(said(change)),
        callersOf(change, code),
      ]),
    ),
    '',
    ...more(report.changes.length - shown.length, 'changes', options.file),
  );
  const kinds = [...new Set(shown.filter((change) => change.level === 'error').map((change) => change.kind))];
  if (kinds.length > 0) lines.push(...kinds.map((kind) => `- ${code(kind)}: ${SPEC_CHANGE_KINDS[kind].help}`), '');
  return lines;
};

export const renderSpecDiffMarkdown = (
  report: SpecDiffReport,
  refs: { base: string | null; head: string | null },
  options: { maxRows?: number; file?: string } = {},
): string => {
  const lines = [
    '## flowatlas spec diff',
    '',
    `\`${refs.base ?? 'working tree'}\` → \`${refs.head ?? 'working tree'}\``,
    '',
    ...specDiffLines(report, { ...options, heading: '### Changes' }),
    ...(options.file === undefined ? [] : [`The complete report is ${code(options.file)}.`, '']),
  ];
  return `${lines.join('\n')}\n`;
};

/** The changes as lines for a terminal: the change, then why it matters and who it breaks. */
export const renderSpecDiffText = (
  report: SpecDiffReport,
  refs: { base: string | null; head: string | null },
  options: { maxRows?: number; file?: string } = {},
): string => {
  const max = options.maxRows ?? 50;
  const shown = report.changes.slice(0, max);
  const lines = [`spec diff ${refs.base ?? 'working tree'} -> ${refs.head ?? 'working tree'}`, ''];
  if (report.changes.length === 0) lines.push('no route or channel end changed', '');
  for (const change of shown) {
    lines.push(`${change.level.padEnd(7)} ${change.kind}  ${change.document}  ${change.operation}${change.field === null ? '' : `  ${change.field}`}`);
    lines.push(`        ${said(change)}`);
    // An addition breaks nobody, so whom it would break is not said.
    if (change.level !== 'info') lines.push(`        callers: ${callersOf(change, (text) => text)} (${change.confidence})`);
  }
  if (report.changes.length > shown.length) lines.push(`... and ${report.changes.length - shown.length} more changes${options.file === undefined ? '' : `, in ${options.file}`}`);
  if (shown.length > 0) lines.push('');
  lines.push(summariseSpecDiff(report));
  return `${lines.join('\n')}\n`;
};
