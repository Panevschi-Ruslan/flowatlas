import { createHash } from 'node:crypto';
import type { DiffReport } from '@flowatlas/linker';
import { verdictOf } from '@flowatlas/mcp';
import { contractBreaks } from './contract-delta.js';
import { ruleBreaks } from './rule-delta.js';
import type { StaleDocs } from './stale-docs.js';

/**
 * A pull request's comment (P231): the verdict a reviewer reads in three
 * lines, then the whole `diff` report under it, with a hidden marker so one
 * comment is found and updated on every push instead of a new one each time.
 *
 * The marker names the configuration by its file name and its services, so a
 * repository with two projects keeps two comments, and one project's marker is
 * the same on every machine and checkout. Written by the command rather than the action, so the text is
 * tested against the same fixtures `diff` is, and a workflow that posts with
 * `gh` gets the same comment.
 */
export const COMMENT_MARK = 'flowatlas:diff';

/** Where `--format comment` writes its figures and marker, beside `diff.json`, for a workflow to read. */
export const COMMENT_FILE = 'diff-comment.json';

/** The marker of one configuration's comment. */
export const commentMarker = (configKey: string): string =>
  `<!-- ${COMMENT_MARK} config=${createHash('sha256').update(configKey).digest('hex').slice(0, 8)} -->`;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What the change reaches: the ways in under every changed node, and their services. */
const reachOf = (report: DiffReport): { entries: number; services: number } => {
  const entries = new Map<string, string>();
  for (const row of report.impact) for (const entry of row.entries) entries.set(entry.id, entry.service);
  return { entries: entries.size, services: new Set(entries.values()).size };
};

export interface CommentFacts {
  reaches: { entries: number; services: number };
  contractBreaks: number;
  ruleBreaks: number;
  staleDocs: number;
  verdict: string;
}

/** The figures the header says, and the action hands on as outputs. */
export const commentFacts = (report: DiffReport, docs: StaleDocs | undefined, failOnHeuristic = false): CommentFacts => ({
  reaches: reachOf(report),
  contractBreaks: contractBreaks(report.contracts).length,
  ruleBreaks: ruleBreaks(report.rules, failOnHeuristic).length,
  staleDocs: docs?.madeStale.length ?? 0,
  verdict: verdictOf(report).verdict,
});

/** The three lines a reviewer reads first. */
export const commentHeader = (facts: CommentFacts): string[] => [
  facts.reaches.entries === 0
    ? '**Reaches no way in.**'
    : `**Reaches ${plural(facts.reaches.entries, 'way', 'ways')} in, in ${plural(facts.reaches.services, 'service')}.**`,
  `${facts.contractBreaks === 0 ? 'No new contract break' : plural(facts.contractBreaks, 'new contract break')} · ${facts.ruleBreaks === 0 ? 'no new rule break' : plural(facts.ruleBreaks, 'new rule break')} · ${facts.staleDocs === 0 ? 'no doc made stale' : plural(facts.staleDocs, 'doc', 'docs') + ' made stale'}`,
  `Verdict: **${facts.verdict}** (\`what_changed({verdict: true})\` says why).`,
];

/** The comment's whole text: the marker, the header, and the report. */
export const renderDiffComment = (configKey: string, facts: CommentFacts, markdown: string): string =>
  `${commentMarker(configKey)}\n${commentHeader(facts).join('  \n')}\n\n${markdown.replace(/^## flowatlas diff\n/, '<details><summary>The whole report</summary>\n\n## flowatlas diff\n')}${markdown.startsWith('## flowatlas diff\n') ? '\n</details>\n' : ''}`;
