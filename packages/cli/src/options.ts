import { DEFAULT_DETAIL, DEFAULT_MAX_NODES, type DetailLevel } from '@flowatlas/core';
import type { Command } from 'commander';
import { cannotRun } from './exit.js';

export const FORMATS = ['tree', 'json', 'mermaid'] as const;

export type Format = (typeof FORMATS)[number];

/** How far a walk goes before it stops, when nobody says otherwise. */
export const DEFAULT_DEPTH = 8;

/**
 * Formats meant to be looked at rather than parsed.
 *
 * Only these are ever coloured: an escape code inside a diagram or a document
 * would be pasted along with it and break whatever read it next.
 */
const DRAWN: readonly Format[] = ['tree'];

/** Flags as commander hands them over: every value is still text. */
export interface QueryOptions {
  db?: string;
  config?: string;
  detail?: string;
  format?: string;
  depth?: string;
  maxNodes?: string;
  service?: string;
  /** `false` only when `--no-color` was passed; commander defaults it to true. */
  color?: boolean;
  ascii?: boolean;
}

/** The same flags, resolved against the terminal and checked. */
export interface QuerySettings {
  detail: DetailLevel;
  format: Format;
  depth: number;
  maxNodes: number;
  color: boolean;
  ascii: boolean;
  db?: string;
  config?: string;
  service?: string;
}

export interface ResolveOptions {
  /** Formats this command can render. Defaults to all four. */
  formats?: readonly Format[];
  /** Where the answer goes, which decides the default format and colour. */
  stdout?: { isTTY?: boolean };
  /** Environment, read for `NO_COLOR`. */
  env?: Record<string, string | undefined>;
}

/**
 * The options every query command shares.
 *
 * Detail and format are two flags rather than one preset because they are two
 * questions: how much of each node, and how to draw it. Any pair of answers is
 * valid, so neither flag may imply the other.
 */
export interface QueryOptionSet {
  formats?: readonly Format[];
  /** False for a command that reports rather than walks, so has no walk to bound. */
  walks?: boolean;
}

/**
 * The options every query shares.
 *
 * A command that reports on the whole graph does not walk it, so it is not
 * offered `--depth` or `--max-nodes`: a flag that is accepted and ignored is
 * worse than one that is absent, because it looks like it worked.
 */
export const withQueryOptions = (command: Command, settings: QueryOptionSet = {}): Command => {
  const formats = settings.formats ?? FORMATS;
  const built = command
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--detail <level>', 'how much of each node to show, 0 to 3')
    .option('--format <name>', `one of ${formats.join(', ')}`);
  if (settings.walks !== false) {
    built
      .option('--depth <n>', 'how many hops to follow')
      .option('--max-nodes <n>', 'most nodes to print');
  }
  return built
    .option('--service <name>', 'narrow to one service')
    .option('--ascii', 'plain prefixes instead of icons; the tree format has icons, the others none')
    .option('--no-color', 'never colour the output');
};

const whole = (value: string | undefined, fallback: number, flag: string, least: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < least) {
    throw cannotRun(`${flag} must be a whole number of at least ${least}, not ${JSON.stringify(value)}`);
  }
  return parsed;
};

const asFormat = (value: string | undefined, allowed: readonly Format[], fallback: Format): Format => {
  if (value === undefined) return fallback;
  const found = allowed.find((format) => format === value);
  if (found === undefined) {
    throw cannotRun(`--format must be one of ${allowed.join(', ')}, not ${JSON.stringify(value)}`);
  }
  return found;
};

const asDetail = (value: string | undefined): DetailLevel => {
  if (value === undefined) return DEFAULT_DETAIL;
  const parsed = Number(value);
  if (parsed !== 0 && parsed !== 1 && parsed !== 2 && parsed !== 3) {
    throw cannotRun(`--detail must be 0, 1, 2 or 3, not ${JSON.stringify(value)}`);
  }
  return parsed;
};

/**
 * Resolves the flags, filling in what the terminal implies.
 *
 * A person at a terminal gets the tree in colour; a pipe gets JSON with no
 * escape codes, because whatever is on the other end is a program. `--format`
 * and `--no-color` always win over the guess.
 */
export const querySettings = (
  options: QueryOptions,
  resolve: ResolveOptions = {},
): QuerySettings => {
  const allowed = resolve.formats ?? FORMATS;
  const env = resolve.env ?? process.env;
  const tty = (resolve.stdout ?? process.stdout).isTTY === true;

  const preferred: Format = tty ? 'tree' : 'json';
  const fallback = allowed.includes(preferred) ? preferred : (allowed[0] as Format);
  const format = asFormat(options.format, allowed, fallback);

  return {
    detail: asDetail(options.detail),
    format,
    depth: whole(options.depth, DEFAULT_DEPTH, '--depth', 1),
    maxNodes: whole(options.maxNodes, DEFAULT_MAX_NODES, '--max-nodes', 1),
    // Colour is for a person watching, so anything that says nobody is watching
    // turns it off: a pipe, `NO_COLOR`, the flag, or a format that is data.
    color:
      options.color !== false && tty && (env['NO_COLOR'] ?? '') === '' && DRAWN.includes(format),
    ascii: options.ascii === true,
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.config === undefined ? {} : { config: options.config }),
    ...(options.service === undefined ? {} : { service: options.service }),
  };
};
