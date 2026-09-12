/**
 * What the shell learns from a command.
 *
 * `0` the question was answered, `1` the answer is "no" or "which one did you
 * mean", `2` the question could not be asked at all. A script can tell a failed
 * check from a broken setup without reading a word of the output.
 *
 * The three words below are the whole table, and every command uses them the
 * same way. Spelled out for the two commands a build is likely to be hung on:
 *
 * | command | 0 | 1 | 2 |
 * |---|---|---|---|
 * | `doctor` | nothing to report, or a run without `--strict` | a strict violation: an annotation the graph contradicts, a contract error nothing excused, or unresolved grown past the baseline | no graph, a schema from another version, a baseline that cannot be read, `--strict` with no baseline and no `--no-baseline` |
 * | `contracts` | ran, nothing at or above `--fail-on` | findings at or above `--fail-on` | no graph, or no types in it to compare |
 * | every query | the question was answered | nothing matched, or more than one thing did | no graph, or a flag that makes no sense |
 *
 * `doctor --accept` writes the baseline and exits 0 whatever it found, since
 * accepting is not a check. It refuses on 2, because a baseline taken over a
 * run that could not complete is worse than no baseline at all.
 */
export const EXIT = {
  /** Nothing to report. */
  ok: 0,
  /** A check failed: a strict violation, a broken contract, an entry nobody can name. */
  failed: 1,
  /** Could not run: no graph, a schema from another version, bad arguments. */
  cannotRun: 2,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * A stop with an exit code attached.
 *
 * `details` are the lines that follow the message on stderr: the candidates of
 * an ambiguous reference, or the nearest names to one that matched nothing.
 */
export class CliError extends Error {
  readonly code: ExitCode;
  readonly details: readonly string[];

  constructor(message: string, code: ExitCode, details: readonly string[] = []) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
  }
}

/** Nothing to answer with: no database, no configuration, an unusable flag. */
export const cannotRun = (message: string, details: readonly string[] = []): CliError =>
  new CliError(message, EXIT.cannotRun, details);

/** The question was well formed, and the answer is none or more than one. */
export const notFound = (message: string, details: readonly string[] = []): CliError =>
  new CliError(message, EXIT.failed, details);
