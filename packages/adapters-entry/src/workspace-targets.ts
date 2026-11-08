import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ListenPort } from '@flowatlas/core';

/**
 * The targets a workspace tool runs a project's servers by, as the
 * project's own `project.json` writes them (P257): an Nx project names, per
 * target, the executor that runs it and the options it is run with, and a
 * dev server's port (`options.port`, and each configuration's) and its proxy
 * configuration (`options.proxyConfig`) are written there rather than in the
 * framework's own files.
 *
 * Only targets whose executor is one the caller knows to start a server are
 * read: `@nx/js:node` takes a `port` too, and it is the debugger's.
 */

/** One target of a project, with every set of options it is run with. */
export interface WorkspaceTarget {
  /** The target's name: `serve`, `dev`. */
  readonly name: string;
  readonly executor: string;
  /** Its `options`, then each of its `configurations`. */
  readonly options: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** `project.json`. */
  readonly file: string;
  /** The line a value is written on in the target, by its key and its value as JSON writes it. */
  readonly lineOf: (key: string, value: unknown) => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const FILE = 'project.json';

/** Every target of the project in a directory whose executor `executors` matches. */
export const workspaceTargets = (repoDir: string, executors: RegExp): WorkspaceTarget[] => {
  let text: string;
  let project: unknown;
  try {
    text = readFileSync(join(repoDir, FILE), 'utf8');
    project = JSON.parse(text);
  } catch {
    return [];
  }
  const targets = isRecord(project) ? project['targets'] : undefined;
  if (!isRecord(targets)) return [];
  return Object.entries(targets).flatMap(([name, target]) => {
    if (!isRecord(target)) return [];
    const executor = target['executor'] ?? target['builder'];
    if (typeof executor !== 'string' || !executors.test(executor)) return [];
    const options = [
      ...(isRecord(target['options']) ? [target['options']] : []),
      ...(isRecord(target['configurations']) ? Object.values(target['configurations']).filter(isRecord) : []),
    ];
    const from = Math.max(0, text.indexOf(JSON.stringify(name)));
    const lineOf = (key: string, value: unknown): number => {
      const at = text.indexOf(`${JSON.stringify(key)}`, from);
      const exact = new RegExp(`"${key}"\\s*:\\s*${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
      exact.lastIndex = from;
      const found = exact.exec(text);
      const offset = found?.index ?? at;
      return offset < 0 ? 1 : text.slice(0, offset).split('\n').length;
    };
    return [{ name, executor, options, file: FILE, lineOf }];
  });
};

const portOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536 ? value : undefined;

/** Every port the matching targets are run on, once each, a dev server's marked so where `devServer` says. */
export const targetPorts = (repoDir: string, executors: RegExp, devServer: boolean): ListenPort[] => {
  const found: ListenPort[] = [];
  for (const target of workspaceTargets(repoDir, executors)) {
    for (const options of target.options) {
      const port = portOf(options['port']);
      if (port === undefined || found.some((seen) => seen.port === port)) continue;
      found.push({ port, file: target.file, line: target.lineOf('port', port), ...(devServer ? { devServer: true as const } : {}) });
    }
  }
  return found;
};

/** The proxy configuration files the matching targets are run with, and where each is named. */
export const targetProxyConfigs = (repoDir: string, executors: RegExp): Array<{ path: string; file: string; line: number }> => {
  const found: Array<{ path: string; file: string; line: number }> = [];
  for (const target of workspaceTargets(repoDir, executors)) {
    for (const options of target.options) {
      const path = options['proxyConfig'];
      if (typeof path === 'string' && !found.some((seen) => seen.path === path)) found.push({ path, file: target.file, line: target.lineOf('proxyConfig', path) });
    }
  }
  return found;
};

/** A workspace tool's executors that start Next's server. */
export const NEXT_SERVER_EXECUTORS = /^@(?:nx|nrwl)\/next:server$/;
/** Its executors that start a Vite dev or preview server. */
export const VITE_SERVER_EXECUTORS = /^@(?:nx|nrwl)\/vite:(?:dev-server|preview-server)$/;
/** Its executors that start a webpack dev server. */
export const WEBPACK_SERVER_EXECUTORS = /^@(?:nx|nrwl)\/(?:webpack|react|web):dev-server$/;
