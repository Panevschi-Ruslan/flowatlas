import type { Project, TypeChecker } from 'ts-morph';
import type { GraphBuilder } from '../builder.js';
import type { FlowatlasConfig, ServiceConfig } from '../config.js';
import type { PackageJson } from './manifest.js';
import type { DetectedAdapters } from './registry.js';

// What a repository declares it depends on is answered in `manifest.js`, which
// is where the shape of a manifest lives too. It is a question about the tree on
// disk rather than about the session being assembled here, and answering it
// means resolving a workspace, which is work enough to be its own module.

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/** Writes to stderr so that graph output on stdout stays machine-readable. */
export const createLogger = (level: LogLevel = 'info'): Logger => {
  const enabled = (at: LogLevel): boolean => LEVEL_RANK[at] >= LEVEL_RANK[level];
  const write = (at: LogLevel, message: string, meta?: unknown): void => {
    if (!enabled(at)) return;
    const suffix = meta === undefined ? '' : ` ${JSON.stringify(meta)}`;
    process.stderr.write(`${at} ${message}${suffix}\n`);
  };
  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
};

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Everything an adapter is given to do its job.
 *
 * The context is the only channel between the core, the extractor and the
 * adapters, so an adapter never reaches for a global and the core never learns
 * what a particular adapter needs.
 */
export interface ExtractContext {
  /** Owning repository, equal to `services[].name`. */
  readonly repo: string;
  /** Absolute path to the repository root. */
  readonly repoDir: string;
  readonly service: ServiceConfig;
  readonly config: FlowatlasConfig;
  readonly pkg: PackageJson;
  readonly project: Project;
  readonly checker: TypeChecker;
  readonly builder: GraphBuilder;
  readonly adapters: DetectedAdapters;
  readonly logger: Logger;
  readonly meta?: Record<string, unknown>;
}
