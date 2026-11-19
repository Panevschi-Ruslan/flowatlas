import type { QuestionEntry } from '@flowatlas/mcp';
import { cannotRun } from '../exit.js';

/**
 * What the question log says (P235), for `stats --questions`: which tools are
 * asked, how often each comes back empty, cut short or with a name that did
 * not resolve, which are slow, which names were asked for and not found, and
 * which gaps the most questions ran into - the order to fix them in.
 */
export interface QuestionsSummary {
  questions: number;
  first?: string;
  last?: string;
  /** Lines of the log that could not be read. */
  unreadable: number;
  tools: ToolSummary[];
  /** Names asked for that matched nothing, the most asked first. */
  unresolved: Array<{ name: string; asked: number }>;
  /** Names that matched several things. */
  ambiguous: Array<{ name: string; asked: number }>;
  /**
   * The gaps on answers, by how many questions ran into each, with the
   * command that lists the rows of its reason. `fixed` when the graph no
   * longer has the gap: the questions ran into something since mended.
   */
  gaps: Array<{ gap: string; reason: string; asked: number; fixed: boolean; see: string }>;
  /** Questions whose answer cited files changed since the build. */
  stale: number;
  slowest: Array<{ tool: string; ms: number; ids: string[]; at: string }>;
}

export interface ToolSummary {
  tool: string;
  asked: number;
  mcp: number;
  cli: number;
  empty: number;
  cut: number;
  unresolved: number;
  ambiguous: number;
  failed: number;
  stale: number;
  /** The cut answers by the limit that cut them. */
  cutBy: Record<string, number>;
  medianMs: number;
  p95Ms: number;
  slowestMs: number;
  medianChars: number;
}

/** How many of each list are shown. */
export const QUESTIONS_TOP = 10;

const DURATION = /^(\d+)([hdw])$/;
const HOURS: Record<string, number> = { h: 1, d: 24, w: 24 * 7 };

/** `--since`: a date (`2026-11-01`), a time, or a span back from now (`24h`, `7d`, `2w`). */
export const sinceOf = (value: string | undefined, now: Date = new Date()): Date | undefined => {
  if (value === undefined) return undefined;
  const span = DURATION.exec(value);
  if (span !== null) return new Date(now.getTime() - Number(span[1]) * (HOURS[span[2] as string] as number) * 3_600_000);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw cannotRun(`--since must be a date or a span such as 24h, 7d or 2w, not ${JSON.stringify(value)}`);
  return date;
};

/** The value a share `at` of them are at or under (nearest rank). */
const percentile = (values: readonly number[], at: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(at * sorted.length) - 1)] as number;
};

const median = (values: readonly number[]): number => percentile(values, 0.5);

/** `gap:<service>|<file>|<reason>`: the reason is the last part. */
const reasonOfGap = (gap: string): string => gap.slice(gap.lastIndexOf('|') + 1);

/** The most counted first, then by name, at most `top`. */
const ranked = (counts: Map<string, number>, top: number): Array<[string, number]> =>
  [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, top);

const bump = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const tallied = (keys: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const key of keys) bump(counts, key);
  return counts;
};

export const summariseQuestions = (
  all: readonly QuestionEntry[],
  options: { since?: Date; unreadable?: number; top?: number; current?: ReadonlySet<string> } = {},
): QuestionsSummary => {
  const top = options.top ?? QUESTIONS_TOP;
  const since = options.since?.getTime();
  const entries = since === undefined ? all : all.filter((entry) => Date.parse(entry.at) >= since);
  const byTool = new Map<string, QuestionEntry[]>();
  const unresolved = new Map<string, number>();
  const ambiguous = new Map<string, number>();
  const gaps = new Map<string, number>();
  for (const entry of entries) {
    byTool.set(entry.tool, [...(byTool.get(entry.tool) ?? []), entry]);
    const name = entry.ids[0];
    if (name !== undefined && entry.resolved === 'none') bump(unresolved, name);
    if (name !== undefined && entry.resolved === 'ambiguous') bump(ambiguous, name);
    for (const gap of entry.gaps) bump(gaps, gap);
  }
  const tools = [...byTool].map(([tool, asked]): ToolSummary => ({
    tool,
    asked: asked.length,
    mcp: asked.filter((entry) => entry.via === 'mcp').length,
    cli: asked.filter((entry) => entry.via === 'cli').length,
    empty: asked.filter((entry) => entry.empty).length,
    cut: asked.filter((entry) => entry.stoppedBy !== null).length,
    unresolved: asked.filter((entry) => entry.resolved === 'none').length,
    ambiguous: asked.filter((entry) => entry.resolved === 'ambiguous').length,
    failed: asked.filter((entry) => entry.failed).length,
    stale: asked.filter((entry) => entry.stale).length,
    cutBy: Object.fromEntries(ranked(tallied(asked.flatMap((entry) => (entry.stoppedBy === null ? [] : [entry.stoppedBy]))), Infinity)),
    medianMs: median(asked.map((entry) => entry.ms)),
    p95Ms: percentile(asked.map((entry) => entry.ms), 0.95),
    slowestMs: Math.max(...asked.map((entry) => entry.ms)),
    medianChars: median(asked.map((entry) => entry.chars)),
  }));
  tools.sort((a, b) => b.asked - a.asked || (a.tool < b.tool ? -1 : 1));
  const slowest = [...entries]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, Math.min(top, 5))
    .map((entry) => ({ tool: entry.tool, ms: entry.ms, ids: entry.ids, at: entry.at }));
  return {
    questions: entries.length,
    ...(entries.length === 0 ? {} : { first: entries[0]?.at as string, last: entries[entries.length - 1]?.at as string }),
    unreadable: options.unreadable ?? 0,
    tools,
    unresolved: ranked(unresolved, top).map(([name, asked]) => ({ name, asked })),
    ambiguous: ranked(ambiguous, top).map(([name, asked]) => ({ name, asked })),
    gaps: ranked(gaps, top).map(([gap, asked]) => ({
      gap,
      reason: reasonOfGap(gap),
      asked,
      fixed: options.current !== undefined && !options.current.has(gap),
      see: `flowatlas doctor --unresolved --reason ${reasonOfGap(gap)}`,
    })),
    stale: entries.filter((entry) => entry.stale).length,
    slowest,
  };
};

const share = (part: number, whole: number): string => (part === 0 ? '0' : `${part} (${Math.round((part / whole) * 100)}%)`);

/** The summary as a person reads it. */
export const renderQuestions = (summary: QuestionsSummary): string[] => {
  if (summary.questions === 0) return ['no questions logged in this span'];
  const lines = [`${summary.questions} questions, ${summary.first?.slice(0, 10)} to ${summary.last?.slice(0, 10)}`];
  if (summary.unreadable > 0) lines.push(`  ${summary.unreadable} lines of the log could not be read`);
  if (summary.stale > 0) lines.push(`  ${share(summary.stale, summary.questions)} answered from a graph built before the code they cite changed`);
  lines.push('', 'by tool (asked · empty · cut short · name not found · several matched · median and p95 ms · median chars)');
  for (const tool of summary.tools) {
    const cutBy = Object.entries(tool.cutBy);
    lines.push(
      `  ${tool.tool}: ${tool.asked} · ${share(tool.empty, tool.asked)} · ${share(tool.cut, tool.asked)} · ${share(tool.unresolved, tool.asked)} · ${share(tool.ambiguous, tool.asked)} · ${tool.medianMs} and ${tool.p95Ms} · ${tool.medianChars}`,
      ...(cutBy.length === 0 ? [] : [`    cut by ${cutBy.map(([limit, count]) => `${limit} ${count}`).join(', ')}`]),
    );
  }
  if (summary.unresolved.length > 0) {
    lines.push('', 'names asked for that matched nothing');
    for (const row of summary.unresolved) lines.push(`  ${row.name}: ${row.asked}`);
  }
  if (summary.ambiguous.length > 0) {
    lines.push('', 'names that matched several things');
    for (const row of summary.ambiguous) lines.push(`  ${row.name}: ${row.asked}`);
  }
  if (summary.gaps.length > 0) {
    lines.push('', 'gaps the most questions ran into (fix these first; flowatlas doctor --unresolved lists them in this order)');
    for (const row of summary.gaps) lines.push(`  ${row.gap}: ${row.asked}${row.fixed ? ' (fixed since)' : `  ${row.see}`}`);
  }
  lines.push('', 'slowest');
  for (const row of summary.slowest) lines.push(`  ${row.tool} ${row.ids.join(' ')}: ${row.ms} ms`);
  return lines;
};
