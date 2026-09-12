import { FlowatlasError } from '@flowatlas/core';
import { DbHandle, type SourceRoots } from '@flowatlas/mcp';
import type { GraphDb } from '@flowatlas/linker';
import { cannotRun } from './exit.js';

export interface DbOptions {
  /** Path to `graph.db`. Defaults to the one the configuration implies. */
  db?: string;
  /** Path to `flowatlas.config.json`, or a directory to find it from. */
  config?: string;
}

const handleFor = (options: DbOptions): DbHandle => {
  try {
    return new DbHandle({
      ...(options.db === undefined ? {} : { dbPath: options.db }),
      // With neither flag the working directory is where the configuration is
      // looked for, which is where a person standing in a repository expects it.
      ...(options.config === undefined
        ? options.db === undefined
          ? { configPath: process.cwd() }
          : {}
        : { configPath: options.config }),
    });
  } catch (cause) {
    // The hint travels with the error and used to be dropped here, so the same
    // bad configuration produced two different answers: `build` said which
    // directory the paths are relative to, and every query command said only
    // that one of them is not a directory. `CliError` carries details; give it
    // the sentence rather than throwing it away.
    const hint = cause instanceof FlowatlasError ? cause.hint : undefined;
    throw cannotRun(
      cause instanceof Error ? cause.message : String(cause),
      hint === undefined ? [] : [hint],
    );
  }
};

/**
 * The graph a query reads, or a stop saying why there is none.
 *
 * Every query command comes through here, so "no database" and "built by
 * another version" are one sentence and one exit code rather than a different
 * accident per command.
 */
export const openDbFromOptions = (options: DbOptions): GraphDb => {
  const opened = handleFor(options).open();
  if ('error' in opened) throw cannotRun(opened.error);
  return opened.db;
};

/**
 * Where each service's sources live, for the levels that quote code.
 *
 * Reads the configuration and stops there: no database is opened, since a
 * caller that wants both opens it itself. Pointed at a bare database with no
 * configuration beside it there is nothing to say, and saying so is better than
 * refusing to answer the rest of the question.
 */
export const sourceRootsFor = (options: DbOptions): SourceRoots => {
  try {
    return handleFor(options);
  } catch {
    return { repoDir: () => undefined };
  }
};
