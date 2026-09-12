/**
 * `flowatlas cache` — the graphs of commits `diff` keeps, and how to be rid of them.
 *
 * A cache nobody can look inside is a cache nobody trusts, which is how a stale
 * answer goes unnoticed for an afternoon (R10). Three verbs and no cleverness:
 * what is there, drop all but the newest few, drop the lot.
 */
import { resolve } from 'node:path';
import { loadConfig } from '@flowatlas/core';
import type { Command } from 'commander';
import { cannotRun, EXIT } from '../exit.js';
import { GraphCache, type CacheRow } from '../git/graph-cache.js';
import { moreRows, renderTable } from '../format/table.js';
import { processIo, type QueryIo } from '../query/answer.js';

export const CACHE_ACTIONS = ['ls', 'prune', 'clear'] as const;
export type CacheAction = (typeof CACHE_ACTIONS)[number];

export interface CacheOptions {
  config?: string;
  out?: string;
  keep?: string;
  json?: boolean;
  max?: string;
}

export interface CacheRun {
  action: CacheAction;
  rows: CacheRow[];
  /** Entries removed, for `prune` and `clear`. */
  removed: number;
  text: string;
  exitCode: number;
}

const whole = (value: string | undefined, fallback: number, flag: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw cannotRun(`${flag} must be a whole number, not ${JSON.stringify(value)}`);
  }
  return parsed;
};

/** Where the cache lives, and what the project asked `prune` to keep. */
const settingsOf = (options: CacheOptions): { dir: string; keep: number } => {
  if (options.out !== undefined) return { dir: resolve(options.out), keep: 10 };
  const loaded = loadConfig(options.config ?? process.cwd(), { checkRepos: false });
  return { dir: loaded.outputDir, keep: 10 };
};

const kb = (bytes: number): string => `${Math.round(bytes / 1024)}K`;

const table = (rows: readonly CacheRow[], max: number): string[] => {
  if (rows.length === 0) return ['cache: empty'];
  const shown = rows.slice(0, max);
  return [
    ...renderTable(shown, [
      { header: 'commit', value: (row) => row.sha.slice(0, 8) },
      { header: 'service', value: (row) => row.service },
      { header: 'ref', value: (row) => row.ref ?? '' },
      { header: 'read', value: (row) => row.extractedAt },
      { header: 'size', value: (row) => kb(row.bytes), align: 'right' },
      { header: 'usable', value: (row) => (row.usable ? 'yes' : 'no — another build of the tool') },
    ]),
    ...(rows.length > shown.length ? [moreRows(rows.length - shown.length)] : []),
  ];
};

export const runCache = (
  action: string,
  options: CacheOptions,
  io: QueryIo = processIo,
): CacheRun => {
  const verb = CACHE_ACTIONS.find((candidate) => candidate === action);
  if (verb === undefined) {
    throw cannotRun(`unknown action ${JSON.stringify(action)}`, [
      `Use one of ${CACHE_ACTIONS.join(', ')}.`,
    ]);
  }
  const { dir, keep } = settingsOf(options);
  const cache = new GraphCache(dir);
  const max = whole(options.max, 150, '--max');

  if (verb === 'ls') {
    const rows = cache.list();
    const text = options.json === true
      ? `${JSON.stringify({ root: cache.root, entries: rows }, null, 2)}\n`
      : `${table(rows, max).join('\n')}\n`;
    io.out(text);
    return { action: verb, rows, removed: 0, text, exitCode: EXIT.ok };
  }

  if (verb === 'prune') {
    const dropped = cache.prune(whole(options.keep, keep, '--keep'));
    const text =
      options.json === true
        ? `${JSON.stringify({ root: cache.root, removed: dropped }, null, 2)}\n`
        : `removed ${dropped.length} of ${dropped.length + cache.list().length}\n`;
    io.out(text);
    return { action: verb, rows: dropped, removed: dropped.length, text, exitCode: EXIT.ok };
  }

  const removed = cache.clear();
  const text =
    options.json === true
      ? `${JSON.stringify({ root: cache.root, removed }, null, 2)}\n`
      : `removed ${removed}\n`;
  io.out(text);
  return { action: verb, rows: [], removed, text, exitCode: EXIT.ok };
};

export const registerCache = (program: Command): void => {
  program
    .command('cache')
    .description('list, prune or clear the graphs of commits that flowatlas diff keeps')
    .argument('<action>', `one of ${CACHE_ACTIONS.join(', ')}`)
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--out <dir>', 'output directory holding the cache (default: the configured one)')
    .option('--keep <n>', 'entries prune keeps, newest first (default: 10)')
    .option('--max <n>', 'most rows to print')
    .option('--json', 'print the answer as JSON')
    .action((action: string, options: CacheOptions) => {
      runCache(action, options);
    });
};
