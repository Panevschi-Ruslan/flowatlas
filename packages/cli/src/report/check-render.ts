/**
 * `flowatlas check` as text and as Markdown (P117): the verdict first, then
 * why, then what already runs, then how the answer was reached. The
 * Markdown carries `diff`'s whole body under it - the same sections, the
 * deployed side as base - so a reviewer reads one document either way.
 */
import type { CheckReason, CheckReport } from '@flowatlas/linker';
import { renderDiffMarkdown, type DiffMarkdownOptions } from './diff-markdown.js';

/** Most reasons listed in either format; the file has every one (I9). */
export const CHECK_MAX_ROWS = 50;

const short = (sha: string | null): string => (sha === null ? 'working tree' : sha.slice(0, 8));

const escape = (text: string): string => text.replace(/\|/g, '\\|');

const code = (text: string): string => `\`${escape(text)}\``;

const placeSaid = (reason: CheckReason): string =>
  reason.at === undefined ? '' : `${reason.at.service} ${reason.at.file}${reason.at.line === undefined ? '' : `:${reason.at.line}`}`;

const cut = <T>(rows: readonly T[], max: number): { rows: T[]; dropped: number } => ({
  rows: rows.slice(0, max),
  dropped: Math.max(rows.length - max, 0),
});

const pinSaid = (pin: CheckReport['pins'][number]): string => `${pin.service} ${pin.ref} (${short(pin.sha)})`;

const moveSaid = (move: CheckReport['moved'][number]): string =>
  `${move.service} ${move.from.ref === null ? 'not deployed' : `${move.from.ref} (${short(move.from.sha)})`} → ${move.to.ref ?? 'working tree'}${move.to.sha === null ? '' : ` (${short(move.to.sha)})`}${move.to.dirty ? ' with uncommitted changes' : ''}`;

/** `1 reason deploying orders introduces`, said the same in both formats. */
const headline = (report: CheckReport): string => {
  const { verdict } = report.verdict;
  if (verdict === 'undecided') return 'could not decide';
  const count = report.verdict.reasons.length;
  const moved = report.moved.map((move) => move.service).join(', ');
  if (report.moved.length === 0) return 'nothing to deploy';
  return count === 0
    ? `deploying ${moved} introduces nothing that breaks`
    : `${count} ${count === 1 ? 'reason' : 'reasons'} deploying ${moved} introduces`;
};

/* ── text ── */

const reasonLine = (reason: CheckReason): string => {
  const where = placeSaid(reason);
  return `  - [${reason.kind}] ${reason.message}${where === '' ? '' : `  (${where})`}`;
};

const listed = (title: string, reasons: readonly CheckReason[], file: string): string[] => {
  if (reasons.length === 0) return [];
  const shown = cut(reasons, CHECK_MAX_ROWS);
  return [title, ...shown.rows.map(reasonLine), ...(shown.dropped === 0 ? [] : [`  … ${shown.dropped} more in ${file}`])];
};

/** One environment's answer in a terminal. */
export const renderCheckText = (report: CheckReport, file: string): string => {
  const { verdict } = report;
  const lines = [`check ${report.environment}: ${verdict.verdict} — ${headline(report)}`];
  if (verdict.verdict === 'undecided') {
    lines.push(...verdict.undecided.map((refusal) => `  - ${refusal.message}. ${refusal.hint}`));
  } else {
    if (report.pins.length > 0) lines.push(`deployed: ${report.pins.map(pinSaid).join(' · ')}`);
    if (report.moved.length > 0) lines.push(`moving: ${report.moved.map(moveSaid).join(' · ')}`);
    lines.push(...listed('not deployable, because deploying introduces:', verdict.reasons, file));
    lines.push(...listed('already deployed (listed, not counted):', verdict.already, file));
  }
  if (report.notDeployed.length > 0) lines.push(`not deployed in ${report.environment}: ${report.notDeployed.join(', ')}`);
  if (verdict.notes.length > 0) lines.push('notes:', ...verdict.notes.map((note) => `  - ${note}`));
  lines.push(`the whole answer: ${file}`);
  return `${lines.join('\n')}\n`;
};

/* ── Markdown ── */

const reasonRows = (reasons: readonly CheckReason[], file: string): string[] => {
  const shown = cut(reasons, CHECK_MAX_ROWS);
  return [
    '| kind | what | where | confidence |',
    '| --- | --- | --- | --- |',
    ...shown.rows.map((reason) => {
      const where = placeSaid(reason);
      return `| ${reason.kind} | ${escape(reason.message)} | ${where === '' ? '—' : code(where)} | ${reason.confidence}${reason.heuristic ? ' (guess)' : ''} |`;
    }),
    '',
    ...(shown.dropped === 0 ? [] : [`… ${shown.dropped} more; the whole list is in ${file}`, '']),
  ];
};

const pinRows = (report: CheckReport): string[] => {
  if (report.pins.length === 0 && report.moved.length === 0) return [];
  const moved = new Map(report.moved.map((move) => [move.service, move]));
  const names = [...new Set([...report.pins.map((pin) => pin.service), ...moved.keys()])].sort();
  const pins = new Map(report.pins.map((pin) => [pin.service, pin]));
  return [
    '| service | deployed | pinned by | candidate |',
    '| --- | --- | --- | --- |',
    ...names.map((name) => {
      const pin = pins.get(name);
      const move = moved.get(name);
      const deployed = pin === undefined ? 'not deployed' : `${code(pin.ref)} ${short(pin.sha)}`;
      const by = pin === undefined ? '—' : pin.replaced === undefined ? pin.from : `${pin.from}, in place of ${code(pin.replaced.ref)} from ${pin.replaced.from}`;
      const candidate =
        move === undefined ? 'as deployed' : `${move.to.ref === null ? 'working tree' : code(move.to.ref)}${move.to.sha === null ? '' : ` ${short(move.to.sha)}`}${move.to.dirty ? ', uncommitted changes' : ''}`;
      return `| ${code(name)} | ${deployed} | ${by} | ${candidate} |`;
    }),
    '',
  ];
};

/** The verdict and its reasons, above `diff`'s body. */
const leadOf = (report: CheckReport, file: string): string[] => {
  const { verdict } = report;
  const lines = [`## flowatlas check · ${report.environment}`, '', `**${verdict.verdict}** — ${headline(report)}`, ''];
  if (verdict.verdict === 'undecided') {
    lines.push(...verdict.undecided.map((refusal) => `- **${refusal.reason}** — ${escape(refusal.message)}. ${escape(refusal.hint)}`), '');
  }
  lines.push(...pinRows(report));
  if (verdict.reasons.length > 0) lines.push('### Why not', '', ...reasonRows(verdict.reasons, file));
  if (verdict.already.length > 0) {
    lines.push('### Already deployed', '', `Running in ${report.environment} now, and not counted against this deploy.`, '', ...reasonRows(verdict.already, file));
  }
  if (report.notDeployed.length > 0) lines.push(`Not deployed in ${report.environment}: ${report.notDeployed.map(code).join(', ')}.`, '');
  if (verdict.notes.length > 0) lines.push('### Notes', '', ...verdict.notes.map((note) => `- ${escape(note)}`), '');
  return lines;
};

/** One environment's answer as a document; with a comparison, `diff`'s body under the verdict. */
export const renderCheckMarkdown = (report: CheckReport, file: string, options: Omit<DiffMarkdownOptions, 'file' | 'lead'> = {}): string => {
  const lead = leadOf(report, file);
  if (report.diff === null) return `${[...lead, `The whole answer is in ${file}.`, ''].join('\n')}\n`;
  return renderDiffMarkdown(report.diff, { ...options, file, lead });
};

/** One line per environment, for stderr and the top of a CI log. */
export const summariseCheck = (report: CheckReport): string => {
  const { verdict } = report;
  if (verdict.verdict === 'undecided') return `check ${report.environment}: undecided · ${verdict.undecided.length} refusal(s)`;
  return (
    `check ${report.environment}: ${verdict.verdict} · ${verdict.reasons.length} reason(s) · ` +
    `${verdict.already.length} already deployed · moved ${report.moved.length === 0 ? 'nothing' : report.moved.map((move) => move.service).join(', ')}`
  );
};
