import { FlowatlasError } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { DbHandle, type DbHandleOptions } from '@flowatlas/mcp';

/** What every analysis command accepts on top of its own flags. */
export interface ReadOptions {
  config?: string;
  db?: string;
  format?: string;
  max?: string | number;
}

/** `--max`, as a number, with the bound every one of these commands shares. */
export const maxRows = (options: ReadOptions): number => {
  const value = options.max === undefined ? 150 : Number(options.max);
  if (!Number.isFinite(value) || value < 1) {
    throw new FlowatlasError('bad-argument', `--max must be a positive number, not ${options.max}`);
  }
  return Math.floor(value);
};

export const wantsJson = (options: ReadOptions): boolean => (options.format ?? 'table') === 'json';

/**
 * Opens the built graph, read only, or says why it could not.
 *
 * Every analysis here is a reader: the database is opened without write access
 * so that a bug in one of them cannot alter what a rebuild would produce.
 * Sharing the server's handle means "run flowatlas build first" and the schema
 * mismatch message are worded once.
 */
export const openProjectDb = (options: ReadOptions): { db: GraphDb; close: () => void } => {
  const settings: DbHandleOptions = {};
  if (options.db !== undefined) settings.dbPath = options.db;
  // The configuration is still worth loading beside an explicit database: it is
  // what names the repositories. Without either, it is also what locates one.
  if (options.config !== undefined) settings.configPath = options.config;
  else if (options.db === undefined) settings.configPath = process.cwd();

  const handle = new DbHandle(settings);
  const opened = handle.open();
  if ('error' in opened) {
    throw new FlowatlasError('no-graph', opened.error, 'Run flowatlas build, then ask again.');
  }
  return { db: opened.db, close: () => handle.close() };
};

/**
 * Prints one answer, as JSON or as lines.
 *
 * JSON goes to stdout because something downstream reads it; the table goes to
 * stdout as well, since the table is the answer rather than a progress note.
 */
export const print = (json: unknown, lines: readonly string[], asJson: boolean): void => {
  process.stdout.write(asJson ? `${JSON.stringify(json, null, 2)}\n` : `${lines.join('\n')}\n`);
};
