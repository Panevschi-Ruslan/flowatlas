/**
 * `flowatlas patterns test | explain | suggest` - the project's own extraction
 * patterns (P121).
 *
 * A pattern file says in code what a call of an in-house wrapper is; the build
 * compiles each rule into the description the readers already read. These
 * three are the author's side of that: run each rule's tests before a build
 * trusts it, see how far each rule got at a place it was meant to read, and
 * have starters written for the wrappers the reader could not follow most
 * often. Read-only, except `suggest --out`, which writes starters beside the
 * configuration and never into a repository it reads.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { compilePattern, isCompiled, loadConfig, patternFilesFor, readPatternFile, type LoadedConfig } from '@flowatlas/core';
import type { Command } from 'commander';
import { CliError, EXIT } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { explainPlaces, placesNamed, renderPatternsExplain, type PatternsExplainReport } from '../patterns/explain.js';
import { renderPatternsSuggest, suggestPatterns, writeStarters, type PatternsSuggestReport } from '../patterns/suggest.js';
import { renderPatternsTest, testPatternFiles, type PatternsTestReport } from '../patterns/test.js';
import { runSample, type SampleRun } from '../patterns/sample.js';
import { cantFollowRowsOf } from './doctor.js';

export interface PatternsTestOptions {
  config?: string;
  sample?: string;
  service?: string;
  rule?: string;
  showDescriptor?: boolean;
  json?: boolean;
}

export interface PatternsExplainOptions {
  config?: string;
  db?: string;
  service?: string;
  json?: boolean;
}

export interface PatternsSuggestOptions {
  config?: string;
  db?: string;
  service?: string;
  cause?: string;
  minSites?: string;
  out?: string;
  force?: boolean;
  json?: boolean;
}

const loaded = (config: string | undefined): LoadedConfig | undefined => {
  try {
    return loadConfig(config ?? process.cwd(), { checkRepos: false });
  } catch (error) {
    if (config !== undefined) throw error;
    return undefined;
  }
};

const nameFrom = (root: string) => (path: string): string => {
  const rel = relative(root, path);
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel.split(sep).join('/');
};

const whole = (value: string | undefined, fallback: number, flag: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new CliError(`${flag} takes a whole number of at least 1, not ${value}`, EXIT.cannotRun);
  return parsed;
};

export interface PatternsRun<R> {
  report: R;
  text: string;
  exitCode: number;
}

/**
 * Runs the tests of the files named, or of every file the configuration
 * lists. Exit 0 when every test passes, 1 when one fails, 2 when a rule or a
 * file cannot be read - the build would not read it either.
 */
export const runPatternsTest = async (
  files: readonly string[],
  options: PatternsTestOptions,
  io: QueryIo = processIo,
): Promise<PatternsRun<PatternsTestReport>> => {
  const project = loaded(options.config);
  const root = project?.rootDir ?? process.cwd();
  const service = options.service === undefined ? undefined : project?.config.services.find((each) => each.name === options.service);
  if (options.service !== undefined && (project === undefined || service === undefined)) {
    throw new CliError(`no service named ${JSON.stringify(options.service)}`, EXIT.cannotRun);
  }
  const paths =
    files.length > 0
      ? files.map((file) => resolve(process.cwd(), file))
      : project === undefined
        ? []
        : [...new Set(project.config.services.flatMap((each) => patternFilesFor(project.config, each, project.rootDir)))];
  if (paths.length === 0) throw new CliError('no pattern files: name one, or list them under "patterns" in flowatlas.config.json', EXIT.cannotRun);
  const readings = paths.map(readPatternFile);
  const sampleService =
    project === undefined || service === undefined ? undefined : { service, repoDir: project.repoDir(service), configDir: project.rootDir };

  if (options.sample !== undefined) {
    // Every rule over a file of code instead of its own tests: what each draws there.
    const code = readFileSync(resolve(process.cwd(), options.sample), 'utf8');
    const report = await testPatternFiles(
      readings.map((reading) => ({
        ...reading,
        rules: reading.rules.map((each) => (each.rule === undefined ? each : { ...each, rule: { ...each.rule, tests: [] } })),
      })),
      nameFrom(root),
      { ...(project === undefined ? {} : { config: project.config }), ...(options.rule === undefined ? {} : { only: options.rule }) },
    );
    const lines: string[] = [];
    const sample: Array<{ id: string } & SampleRun> = [];
    for (const reading of readings) {
      for (const each of reading.rules) {
        if (each.rule === undefined || (options.rule !== undefined && each.id !== options.rule)) continue;
        const compiled = compilePattern(each.rule);
        if (!isCompiled(compiled)) continue;
        const run = await runSample(each.rule, compiled.compiled, code, {
          asFile: true,
          ...(project === undefined ? {} : { config: project.config }),
          ...(sampleService === undefined ? {} : { service: sampleService }),
        });
        sample.push({ id: each.rule.id, ...run });
        lines.push(`${each.rule.id}: ${run.drawn.length === 0 ? 'matches nothing in the sample' : `${run.drawn.length} match(es)`}`);
        for (const drawn of run.drawn) lines.push(`  ${drawn.node} ${drawn.label}`);
        for (const row of run.rows) lines.push(`  row ${row.reason}`);
      }
    }
    const refusals = report.rules.filter((rule) => rule.refused !== undefined);
    for (const rule of refusals) lines.push(`refused  ${rule.id}: ${rule.refused?.part}: ${rule.refused?.reason}`);
    const text = options.json === true ? `${JSON.stringify({ ...report, sample }, null, 2)}\n` : `${lines.join('\n')}\n`;
    io.out(text);
    return { report, text, exitCode: refusals.length > 0 ? EXIT.cannotRun : EXIT.ok };
  }

  const report = await testPatternFiles(readings, nameFrom(root), {
    ...(project === undefined ? {} : { config: project.config }),
    ...(options.rule === undefined ? {} : { only: options.rule }),
    ...(sampleService === undefined ? {} : { sample: sampleService }),
  });
  const text =
    options.json === true
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderPatternsTest(report, { ...(options.showDescriptor === undefined ? {} : { showDescriptor: options.showDescriptor }) });
  io.out(text);
  const unread = report.files.some((file) => file.problem !== undefined);
  const exitCode = report.total.refused > 0 || unread ? EXIT.cannotRun : report.total.failed > 0 ? EXIT.failed : EXIT.ok;
  return { report, text, exitCode };
};

export const runPatternsExplain = (
  place: string,
  options: PatternsExplainOptions,
  io: QueryIo = processIo,
): PatternsRun<PatternsExplainReport> => {
  const project = loadConfig(options.config ?? process.cwd(), { checkRepos: false });
  const places = placesNamed(project, place, options.service, () => cantFollowRowsOf(options).fresh);
  const report = explainPlaces(project, places);
  const text = options.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderPatternsExplain(report);
  io.out(text);
  return { report, text, exitCode: EXIT.ok };
};

export const runPatternsSuggest = async (
  options: PatternsSuggestOptions,
  io: QueryIo = processIo,
): Promise<PatternsRun<PatternsSuggestReport>> => {
  const project = loadConfig(options.config ?? process.cwd(), { checkRepos: false });
  const { fresh } = cantFollowRowsOf(options);
  const report = await suggestPatterns(project, fresh, {
    minSites: whole(options.minSites, 3, '--min-sites'),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
    ...(options.service === undefined ? {} : { service: options.service }),
  });
  if (options.out !== undefined) writeStarters(project, report, options.out, options.force === true);
  const text = options.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderPatternsSuggest(report);
  io.out(text);
  return { report, text, exitCode: EXIT.ok };
};

export const registerPatterns = (program: Command): void => {
  const patterns = program
    .command('patterns')
    .description("the project's own extraction patterns: test them, explain a near miss, suggest starters");
  patterns
    .command('test [files...]')
    .description("run every rule's tests by the reader the build runs; exit 1 on a failing test, 2 on a rule that does not compile")
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--sample <file>', 'run the rules over a file of code instead, and list every match')
    .option('--service <name>', "type the code against this service's own program")
    .option('--rule <id>', 'only this rule')
    .option('--show-descriptor', 'print what each rule compiles to, as it would be written in flowatlas.config.json')
    .option('--json', 'print the answer as JSON')
    .action(async (files: string[], options: PatternsTestOptions) => {
      const { exitCode } = await runPatternsTest(files, options);
      process.exitCode = exitCode;
    });
  patterns
    .command('explain <place>')
    .description('which rules were tried at a place the reader could not follow, and the first part of each that did not fit')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read a gap id from (default: the configured one)')
    .option('--service <name>', 'the service a <file>:<line> place is in')
    .option('--json', 'print the answer as JSON')
    .action((place: string, options: PatternsExplainOptions) => {
      runPatternsExplain(place, options);
    });
  patterns
    .command('suggest')
    .description('starter rules for the wrappers the reader could not follow most often')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--service <name>', 'only the places of one service')
    .option('--cause <cause>', 'only places of this reason or cause')
    .option('--min-sites <n>', 'fewest calls a starter is written for (default 3)')
    .option('--out <dir>', 'write each starter to a file in this directory, beside the configuration')
    .option('--force', 'with --out: write over a file that is there already')
    .option('--json', 'print the answer as JSON')
    .action(async (options: PatternsSuggestOptions) => {
      await runPatternsSuggest(options);
    });
};
