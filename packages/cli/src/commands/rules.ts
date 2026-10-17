/**
 * `flowatlas rules` — who may call, write, publish to or consume what (P114).
 *
 * The rules are written in `flowatlas.config.json` (`rules[]`, with
 * `services[].tags`), checked over the joined graph by the linker's
 * `evaluateRules`, and answered here in the shape `contracts` answers in:
 * the whole report in `rules.json` beside the database, the view the flags
 * ask for on stdout, and an exit code a build can be hung on (`--fail-on`).
 *
 * A violation along a guessed edge is shown at its rule's severity and fails
 * a run only with `rulesSettings.failOnHeuristic` (D4); a rule a side of which
 * names nothing is unchecked and fails at its severity like a violation (I3).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { ConfigInvalidError, FlowatlasError, loadConfig, readAccepted, ruleSetOf, type RuleSet } from '@flowatlas/core';
import {
  evaluateRules,
  RULE_FAIL_LEVELS,
  ruleFailures,
  ruleGraphOf,
  RULES_FILE,
  type GraphDb,
  type RuleFailLevel,
  type RulesReport,
} from '@flowatlas/linker';
import type { Command } from 'commander';
import { openProjectDb } from '../analysis/open.js';
import { dbPathFor } from '../db.js';
import { cannotRun, CliError, EXIT } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import {
  renderRulesGithub,
  renderRulesJson,
  renderRulesList,
  renderRulesMarkdown,
  renderRulesText,
} from '../render/rules.js';

export const RULES_FORMATS = ['text', 'json', 'markdown', 'github'] as const;

export interface RulesOptions {
  config?: string;
  db?: string;
  format?: string;
  /** Only these rules, by name (repeatable). */
  rule?: string[];
  service?: string;
  failOn?: string;
  maxNodes?: string;
  /** Where to write `rules.json`. Defaults to the configured output. */
  out?: string;
  /** Print the configured rules with how many nodes each side selects. */
  list?: boolean;
}

export interface RulesRun {
  /** The whole report, as written to `rules.json`. */
  report: RulesReport;
  /** As the flags narrowed it: what was printed. */
  shown: RulesReport;
  text: string;
  file?: string;
  exitCode: number;
}

/** What the configuration says about rules, and where things are. */
export interface RulesContext {
  ruleSet: RuleSet;
  outputDir?: string;
  /** Each service's directory as the configuration writes it, `./` stripped. */
  repoDirs: Map<string, string>;
}

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, flag: string): T => {
  if (value === undefined) return fallback;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw cannotRun(`${flag} must be one of ${allowed.join(', ')}, not ${JSON.stringify(value)}`);
  return found;
};

const whole = (value: string | undefined, fallback: number, flag: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw cannotRun(`${flag} must be a whole number of at least 1, not ${JSON.stringify(value)}`);
  return parsed;
};

/**
 * The rules the configuration declares, read strictly: a rule that fails its
 * schema stops the run with exit 2, naming it (`rule-invalid`), because a
 * rule nobody can read is a check that is not being made.
 */
export const rulesContextOf = (options: Pick<RulesOptions, 'config' | 'db'>): RulesContext => {
  try {
    const from = options.config ?? (options.db === undefined ? process.cwd() : dirname(dirname(resolve(options.db))));
    const loaded = loadConfig(from, { checkRepos: false });
    const repoDirs = new Map<string, string>();
    for (const service of loaded.config.services) {
      if (service.document !== undefined) continue;
      const dir = service.repo.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
      if (dir !== '' && dir !== '.') repoDirs.set(service.name, dir);
    }
    return { ruleSet: ruleSetOf(loaded.config), outputDir: loaded.outputDir, repoDirs };
  } catch (cause) {
    if (cause instanceof ConfigInvalidError) {
      throw cannotRun(cause.message, cause.hint === undefined ? [] : [cause.hint]);
    }
    if (cause instanceof FlowatlasError && options.db !== undefined) {
      // A bare database with no configuration beside it has no rules to check.
      return { ruleSet: { rules: [], tags: {}, failOnHeuristic: false }, outputDir: dirname(resolve(options.db)), repoDirs: new Map() };
    }
    throw cannotRun(cause instanceof Error ? cause.message : String(cause));
  }
};

/** The rules checked over one database, with what `accepted.json` beside it excuses. */
export const ruleReportOf = (db: GraphDb, ruleSet: RuleSet, dbPath?: string): RulesReport =>
  evaluateRules(ruleGraphOf(db, ruleSet.tags), ruleSet.rules, dbPath === undefined ? {} : { accepted: readAccepted(dbPath).gaps });

/** The report as the flags narrowed it; the file is always the whole thing. */
export const narrowRules = (report: RulesReport, filters: { rules?: readonly string[]; service?: string }): RulesReport => {
  const wanted = filters.rules === undefined || filters.rules.length === 0 ? undefined : new Set(filters.rules);
  if (wanted === undefined && filters.service === undefined) return report;
  const keepRule = (name: string): boolean => wanted === undefined || wanted.has(name);
  const touches = (item: { fromService: string; toService: string | null }): boolean =>
    filters.service === undefined || item.fromService === filters.service || item.toService === filters.service;
  const violations = report.violations.filter((item) => keepRule(item.rule) && touches(item));
  const excused = report.excused.filter((item) => keepRule(item.rule) && touches(item));
  const rules = report.rules
    .filter((rule) => keepRule(rule.name))
    .map((rule) => {
      const own = violations.filter((item) => item.rule === rule.name).length;
      return {
        ...rule,
        violations: own,
        excused: excused.filter((item) => item.rule === rule.name).length,
        status: rule.status === 'unchecked' ? rule.status : own > 0 ? ('broken' as const) : ('held' as const),
      };
    });
  const level = (severity: string): number => violations.filter((item) => item.severity === severity).length;
  return {
    ...report,
    rules,
    violations,
    excused,
    unchecked: report.unchecked.filter((item) => keepRule(item.rule)),
    notes: report.notes.filter((item) => keepRule(item.rule) && (filters.service === undefined || item.service === filters.service)),
    summary: {
      rules: rules.length,
      held: rules.filter((rule) => rule.status === 'held').length,
      broken: rules.filter((rule) => rule.status === 'broken').length,
      unchecked: rules.filter((rule) => rule.status === 'unchecked').length,
      errors: level('error'),
      warnings: level('warning'),
      infos: level('info'),
      heuristic: violations.filter((item) => item.heuristic).length,
      excused: excused.length,
    },
  };
};

/**
 * Runs the rules and draws them.
 *
 * The complete report is written before anything is printed or any exit code
 * decided, so a failing run still leaves the file that says why.
 */
export const runRules = (options: RulesOptions, io: QueryIo = processIo): RulesRun => {
  const format = oneOf(options.format, RULES_FORMATS, 'text', '--format');
  const failOn = oneOf(options.failOn, RULE_FAIL_LEVELS, 'none', '--fail-on') as RuleFailLevel;
  const maxNodes = whole(options.maxNodes, 150, '--max-nodes');
  const context = rulesContextOf(options);
  if (context.ruleSet.rules.length === 0) {
    throw cannotRun('no rules are configured, so there is nothing to check', [
      'Add rules[] to flowatlas.config.json: docs/CLI.md "rules" has the four shapes.',
    ]);
  }
  const unknown = (options.rule ?? []).filter((name) => !context.ruleSet.rules.some((rule) => rule.name === name));
  if (unknown.length > 0) {
    throw cannotRun(`no rule named ${unknown.map((name) => JSON.stringify(name)).join(', ')}`, [
      `Configured rules: ${context.ruleSet.rules.map((rule) => rule.name).join(', ')}.`,
    ]);
  }
  const { db, close } = openProjectDb(options);
  try {
    const report = ruleReportOf(db, context.ruleSet, dbPathFor(options));
    const out = options.out ?? context.outputDir;
    let file: string | undefined;
    if (out !== undefined) {
      const directory = isAbsolute(out) ? out : resolve(out);
      mkdirSync(directory, { recursive: true });
      file = join(directory, RULES_FILE);
      writeFileSync(file, renderRulesJson(report), 'utf8');
    }
    const shown = narrowRules(report, {
      ...(options.rule === undefined ? {} : { rules: options.rule }),
      ...(options.service === undefined ? {} : { service: options.service }),
    });
    const drawing = { maxNodes, repoDirs: context.repoDirs, ...(file === undefined ? {} : { file }) };
    const text =
      options.list === true
        ? renderRulesList(shown)
        : format === 'json'
          ? renderRulesJson(shown)
          : format === 'markdown'
            ? renderRulesMarkdown(shown, drawing)
            : format === 'github'
              ? renderRulesGithub(shown, drawing)
              : renderRulesText(shown, drawing);
    io.out(text);
    const failing = ruleFailures(shown, failOn, context.ruleSet.failOnHeuristic);
    const fails = options.list !== true && (failing.violations.length > 0 || failing.unchecked.length > 0);
    return { report, shown, text, ...(file === undefined ? {} : { file }), exitCode: fails ? EXIT.failed : EXIT.ok };
  } finally {
    close();
  }
};

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

export const registerRules = (program: Command): void => {
  program
    .command('rules')
    .description('check the architecture rules in the configuration: who may call, write, publish to or consume what')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--format <name>', `one of ${RULES_FORMATS.join(', ')}`)
    .option('--rule <name>', 'only this rule (repeatable)', collect)
    .option('--service <name>', 'only violations this service is on either end of')
    .option('--fail-on <level>', `exit 1 on a violation, or an unchecked rule, at this level or worse: ${RULE_FAIL_LEVELS.join(', ')}`)
    .option('--max-nodes <n>', 'most violations to print; the file is always complete')
    .option('--out <dir>', `where to write ${RULES_FILE} (default: the configured output)`)
    .option('--list', 'print the configured rules with how many nodes each side selects')
    .action((options: RulesOptions) => {
      const { exitCode } = runRules(options);
      if (exitCode !== EXIT.ok) throw new CliError('rule violations at or above --fail-on', EXIT.failed);
    });
};
