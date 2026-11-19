import { questionLogSettings, questionOf, recordQuestion } from '@flowatlas/mcp';
import { handleFor, type DbOptions } from '../db.js';
import { CliError } from '../exit.js';

/**
 * The asking commands' half of the question log (P235): `flow`, `impact`,
 * `channel`, `path` and `explain` log as the MCP tools do, with `via: cli`,
 * when the configuration or `FLOWATLAS_LOG_QUESTIONS=1` turns the log on.
 * A question that failed is logged too: a name that matched nothing is what
 * the log is most for.
 */

/** What the running command printed, set by `present` (and `explain`) as it prints it. */
let presented: { answer: object; chars: number } | undefined;

export const noteAnswer = (answer: object, chars: number): void => {
  presented = { answer, chars };
};

/** A failed question as a tool would have answered it: the error, and the candidates when several matched. */
const failureOf = (error: unknown): object => {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof CliError && / matches \d+ \w+$/.test(message) ? { error: message, candidates: error.details } : { error: message };
};

/** Runs one asking command, logging it when the log is on. The answer and the exit are the command's own. */
export const askedCommand = <T>(tool: string, args: Record<string, unknown>, options: DbOptions, run: () => T): T => {
  presented = undefined;
  let failed: unknown;
  try {
    return run();
  } catch (error) {
    failed = error;
    throw error;
  } finally {
    log(tool, args, options, failed);
  }
};

const log = (tool: string, args: Record<string, unknown>, options: DbOptions, failed: unknown): void => {
  try {
    const handle = handleFor(options);
    const settings = questionLogSettings(handle.config);
    if (!settings.enabled) return;
    const answer = failed === undefined ? (presented?.answer ?? {}) : failureOf(failed);
    const chars = failed === undefined ? (presented?.chars ?? 0) : 0;
    const opened = handle.open();
    const db = 'db' in opened ? opened.db : undefined;
    try {
      // How long the command took, start-up included: what the person waited.
      const ms = Math.round(performance.now());
      const defined = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
      const entry = questionOf({ via: 'cli', tool, args: defined, answer, chars, ms, failed: failed !== undefined }, db, settings);
      recordQuestion(handle.path, entry, settings.maxBytes);
    } finally {
      db?.close();
    }
  } catch {
    // A log that cannot be written changes nothing about the answer.
  }
};
