/**
 * The flags every command that writes SARIF shares (P115), read once.
 *
 * `--format sarif` writes the log to stdout; with `--output <file>` it goes to
 * the file and stdout says one line about it, so a build log stays readable.
 * `--sarif-root <dir>` writes paths relative to one checkout, `--sarif-level`
 * leaves out what is quieter than it asks. None of them decides an exit code.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Command } from 'commander';
import { cannotRun } from '../exit.js';
import type { QueryIo } from '../query/answer.js';
import { DEFAULT_SARIF_RESULTS, renderSarif, sarifCounts, SARIF_RESULT_LIMIT } from './write.js';
import { SARIF_LEVELS, type SarifLevel, type SarifLog } from './types.js';

export interface SarifFlags {
  /** Where to write the log; stdout when absent. */
  output?: string;
  sarifRoot?: string;
  sarifLevel?: string;
}

/** `--sarif-level`, checked. */
export const sarifLevelFlag = (value: string | undefined): SarifLevel | undefined => {
  if (value === undefined) return undefined;
  const found = SARIF_LEVELS.find((level) => level === value);
  if (found === undefined) throw cannotRun(`--sarif-level must be one of ${SARIF_LEVELS.join(', ')}, not ${JSON.stringify(value)}`);
  return found;
};

/**
 * The bound on a log's results: the command's own flag when it was given,
 * otherwise what code scanning shows of a run. Never above what it accepts.
 */
export const sarifBound = (given: number | undefined): number => Math.min(given ?? DEFAULT_SARIF_RESULTS, SARIF_RESULT_LIMIT);

/** Adds the three flags to a command. `--output` is left to `diff`, which has it already. */
export const withSarifOptions = (command: Command, options: { output?: boolean } = {}): Command => {
  if (options.output !== false) command.option('--output <file>', 'with --format sarif: write the log to this file instead of stdout');
  return command
    .option('--sarif-root <dir>', 'with --format sarif: write paths relative to this checkout, for an upload to one repository')
    .option('--sarif-level <level>', `with --format sarif: leave out results below ${SARIF_LEVELS.join(' / ')}`);
};

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`;

/** One line about a log written to a file: how many results, how loud. */
export const sarifSaid = (log: SarifLog, file: string): string => {
  const counts = sarifCounts(log);
  const total = counts.error + counts.warning + counts.note;
  return `sarif: ${plural(total, 'result')} (${counts.error} error, ${counts.warning} warning, ${counts.note} note) written to ${file}\n`;
};

/**
 * Writes the log where the flags say, and returns what was printed: the log
 * itself, or the line about the file it went to.
 */
export const deliverSarif = (log: SarifLog, flags: SarifFlags, io: QueryIo): string => {
  const text = renderSarif(log);
  if (flags.output === undefined) {
    io.out(text);
    return text;
  }
  const target = isAbsolute(flags.output) ? flags.output : resolve(flags.output);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf8');
  const said = sarifSaid(log, target);
  io.out(said);
  return said;
};

