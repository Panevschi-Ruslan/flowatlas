/**
 * The architecture rules' answer drawn for a person, a document or a build
 * log (P114). The file on disk is always the whole report; these draw the
 * view the flags asked for, at most `maxNodes` violations.
 */
import type { RulesReport, RuleViolation } from '@flowatlas/linker';

export interface RulesDrawing {
  /** Most violations listed before saying how many more. */
  maxNodes: number;
  /** Where the complete report was written, named under a cut. */
  file?: string;
  /** Where each service's repository sits, relative to where the run is, for a path a terminal can open. */
  repoDirs?: ReadonlyMap<string, string>;
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** A violation's crossing as a path: `web/src/app/x.ts:34`, or `web src/app/x.ts:34` without the layout. */
export const placeSaid = (violation: Pick<RuleViolation, 'at'>, repoDirs: ReadonlyMap<string, string> = new Map()): string | undefined => {
  if (violation.at === undefined) return undefined;
  const { service, file, line } = violation.at;
  const dir = repoDirs.get(service);
  const path = dir === undefined || dir === '' ? `${service} ${file}` : `${dir}/${file}`;
  return line === undefined || line === 0 ? path : `${path}:${line}`;
};

/** One line that says everything, for a build log nobody will scroll. */
export const rulesSummaryLine = (report: RulesReport): string => {
  const { summary } = report;
  return (
    `rules: ${summary.rules} checked · ${summary.broken} broken · ${summary.unchecked} unchecked · ` +
    `errors=${summary.errors} warnings=${summary.warnings} infos=${summary.infos}` +
    `${summary.heuristic === 0 ? '' : ` (${summary.heuristic} along a guessed edge)`} · excused=${summary.excused}`
  );
};

const more = (shown: number, total: number, file?: string): string[] =>
  total > shown ? [`  … ${total - shown} more${file === undefined ? '' : `; the whole report is in ${file}`}`] : [];

const violationLines = (violation: RuleViolation, repoDirs?: ReadonlyMap<string, string>): string[] => {
  const place = placeSaid(violation, repoDirs);
  const guess = violation.heuristic ? ', a guess: fails only with rulesSettings.failOnHeuristic' : '';
  return [
    `  ${violation.message}`,
    `    ${place === undefined ? 'at no place in a file' : `at ${place}`}  (${violation.via}, ${violation.confidence}${guess})`,
    ...(violation.partial === undefined ? [] : [`    read in part: ${violation.partial.join(', ')} (rule-over-partial-read)`]),
  ];
};

export const renderRulesText = (report: RulesReport, drawing: RulesDrawing): string => {
  const lines: string[] = [rulesSummaryLine(report)];
  let left = drawing.maxNodes;
  let cut = 0;
  for (const rule of report.rules) {
    const own = report.violations.filter((item) => item.rule === rule.name);
    const excused = report.excused.filter((item) => item.rule === rule.name);
    const counted = rule.status === 'broken' ? plural(own.length, 'violation') : rule.status;
    lines.push('', `${rule.name}  ${rule.shape}  ${rule.severity}  ${counted}${excused.length === 0 ? '' : ` · ${excused.length} excused`}${rule.walkCut === true ? ' · walk stopped at its bound' : ''}`);
    if (rule.note !== undefined) lines.push(`  why: ${rule.note}`);
    for (const item of report.unchecked.filter((each) => each.rule === rule.name)) lines.push(`  ${item.message} (${item.reason})`);
    for (const item of report.notes.filter((each) => each.rule === rule.name)) lines.push(`  ${item.message} (${item.reason})`);
    const shown = own.slice(0, Math.max(0, left));
    left -= shown.length;
    cut += own.length - shown.length;
    for (const violation of shown) lines.push(...violationLines(violation, drawing.repoDirs));
    for (const violation of excused) lines.push(`  excused: ${violation.message} (${violation.excusedBy ?? 'accepted'})`);
  }
  if (cut > 0) lines.push('', ...more(0, cut, drawing.file).map((line) => line.trim()));
  return `${lines.join('\n')}\n`;
};

export const renderRulesJson = (report: RulesReport): string => `${JSON.stringify(report, null, 2)}\n`;

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export const renderRulesMarkdown = (report: RulesReport, drawing: RulesDrawing): string => {
  const lines: string[] = ['## Architecture rules', '', rulesSummaryLine(report), '', '| Rule | Shape | Severity | Status | Why |', '|---|---|---|---|---|'];
  for (const rule of report.rules) {
    lines.push(`| \`${rule.name}\` | ${rule.shape} | ${rule.severity} | ${rule.status}${rule.violations === 0 ? '' : ` (${rule.violations})`} | ${cell(rule.note ?? '')} |`);
  }
  const shown = report.violations.slice(0, drawing.maxNodes);
  if (shown.length > 0) {
    lines.push('', '### Violations', '', '| Rule | What crossed | Where | Via | Confidence |', '|---|---|---|---|---|');
    for (const violation of shown) {
      const place = placeSaid(violation, drawing.repoDirs);
      lines.push(
        `| \`${violation.rule}\` | ${cell(violation.message)} | ${place === undefined ? '—' : `\`${cell(place)}\``} | ${violation.via} | ${violation.confidence}${violation.heuristic ? ' (guess)' : ''} |`,
      );
    }
    lines.push(...more(shown.length, report.violations.length, drawing.file).map((line) => line.trim()));
  }
  if (report.unchecked.length > 0) {
    lines.push('', '### Not checked', '');
    for (const item of report.unchecked) lines.push(`- \`${item.rule}\`: ${cell(item.message)} (\`${item.reason}\`)`);
  }
  if (report.excused.length > 0) {
    lines.push('', '### Excused', '');
    for (const item of report.excused) lines.push(`- \`${item.rule}\`: ${cell(item.message)} — ${cell(item.excusedBy ?? 'accepted')}`);
  }
  return `${lines.join('\n')}\n`;
};

/** A workflow command's escapes: a message survives as one line, a property inside its list. */
const escapeData = (value: string): string => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (value: string): string => escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

const LEVEL: Readonly<Record<string, string>> = { error: 'error', warning: 'warning', info: 'notice' };

/**
 * One annotation per violation at the crossing hop, then the text: a pull
 * request is annotated where the fix goes. A file is placed in the checkout
 * through `repoDirs`; a violation with no place is attached to the job.
 */
export const renderRulesGithub = (report: RulesReport, drawing: RulesDrawing): string => {
  const lines: string[] = [];
  for (const violation of report.violations) {
    const dir = violation.at === undefined ? undefined : drawing.repoDirs?.get(violation.at.service);
    const file = violation.at === undefined ? undefined : dir === undefined || dir === '' ? violation.at.file : `${dir}/${violation.at.file}`;
    const where = file === undefined ? '' : `file=${escapeProperty(file)}${violation.at?.line === undefined || violation.at.line === 0 ? '' : `,line=${violation.at.line}`},`;
    const why = violation.note === undefined ? '' : ` ${violation.note}`;
    lines.push(`::${LEVEL[violation.severity] ?? 'warning'} ${where}title=${escapeProperty(`rule ${violation.rule}`)}::${escapeData(`${violation.message}.${why}`)}`);
  }
  for (const item of report.unchecked) {
    lines.push(`::${LEVEL[item.severity] ?? 'warning'} title=${escapeProperty(`rule ${item.rule}: ${item.reason}`)}::${escapeData(item.message)}`);
  }
  return `${lines.join('\n')}${lines.length === 0 ? '' : '\n'}${renderRulesText(report, drawing)}`;
};

/** `--list`: each rule, its shape, and how many nodes each side selects. */
export const renderRulesList = (report: RulesReport): string => {
  const lines = report.rules.map((rule) => {
    const sides = Object.entries(rule.matched)
      .map(([side, count]) => `${side}=${count}`)
      .join(' ');
    return `${rule.name}  ${rule.shape}  ${rule.severity}  ${sides}${rule.status === 'unchecked' ? '  (unchecked: a side selects nothing)' : ''}`;
  });
  return `${lines.join('\n')}\n`;
};
