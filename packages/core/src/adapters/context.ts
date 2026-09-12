import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project, TypeChecker } from 'ts-morph';
import type { GraphBuilder } from '../builder.js';
import type { FlowatlasConfig, ServiceConfig } from '../config.js';
import type { DetectedAdapters } from './registry.js';

/** The subset of a `package.json` this tool reads. */
export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

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
 * Reads a `package.json`, or returns undefined when there is none or it is not
 * valid JSON. Total on purpose: adapter detection must never crash on a repo
 * with an odd layout.
 */
export const readPackageJson = (dir: string): PackageJson | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJson) : undefined;
  } catch {
    return undefined;
  }
};

/** Every declared dependency, regardless of which section it sits in. */
export const allDependencies = (pkg: PackageJson): Record<string, string> => ({
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.peerDependencies,
  ...pkg.optionalDependencies,
});

export const hasDependency = (pkg: PackageJson, name: string): boolean =>
  Object.hasOwn(allDependencies(pkg), name);

/** True when any of the names is a declared dependency. */
export const hasAnyDependency = (pkg: PackageJson, names: readonly string[]): boolean => {
  const deps = allDependencies(pkg);
  return names.some((name) => Object.hasOwn(deps, name));
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
