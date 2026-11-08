import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { toPosixPath, type Deployment, type DeploymentReadOptions, type DeploymentReader } from '@flowatlas/core';
import { COMPOSE_FILES, readCompose } from './compose.js';
import { readServiceFile } from './document.js';
import { emptyParts } from './reading.js';
import { readService } from './service.js';

export { readServiceFile, readServiceYaml, ServiceFileUnreadable } from './document.js';
export { COMPOSE_FILES, readCompose } from './compose.js';
export { Template, RESOURCE_KINDS, intrinsicOf, type Declares, type Deployed, type Exported, type Known, type Pseudo, type Resource, type TemplateOptions } from './cloudformation.js';
export { Variables, Unread, Imported, HOLE, DEFAULT_STAGE, DEFAULT_REGION, isRecord, textOf } from './variables.js';
export { readOutputs, readParameters, type ApiReference, type ImplicitOutput, type OutputApi, type OutputsOptions } from './outputs.js';
export { EVENT_READERS } from './events.js';
export { functionLogicalId, normalizedName } from './service.js';
export { asTarget, emptyParts, FileReading, writtenAs, type DeploymentParts, type Site } from './reading.js';
export { DESTINATION_KINDS, mappedKinds, mappedSource, pushFunctionUrl, readResources, RESOURCE_READERS, userPoolName, type ResourceReader } from './resources.js';
export { answerFor, readStateMachineResource, workflowNameOf, workflowOf } from './state-machines.js';

/** The names a service file goes by, in the order the framework looks for them. */
export const SERVICE_FILES = ['serverless.yml', 'serverless.yaml', 'serverless.json', 'serverless.ts', 'serverless.js'];

/** Directories that never hold a service of their own: installs, build output, the framework's own state. */
const NOT_SERVICES = new Set(['node_modules', '.serverless', '.build', '.esbuild', '.webpack', 'dist', 'build', 'cdk.out', '.flowatlas', '.git']);

/** How far below the repository a service file is looked for: `services/orders/serverless.yml` is two. */
const MOST_DEPTH = 4;

/**
 * Every service file of a repository, repo-relative and sorted: the one at the
 * top, and one per service directory of a repository that keeps several. A
 * directory holds one service; the first of its names the framework looks for
 * is the one it reads.
 */
export const serviceFiles = (repoDir: string): string[] => filesNamed(repoDir, SERVICE_FILES);

/** Every compose file of a repository (P249), repo-relative and sorted, found as service files are. */
export const composeFiles = (repoDir: string): string[] => filesNamed(repoDir, COMPOSE_FILES);

/** In each directory of a repository, the first of some names it holds. */
const filesNamed = (repoDir: string, looked: readonly string[]): string[] => {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const own = looked.find((name) => names.has(name));
    if (own !== undefined) found.push(toPosixPath(relative(repoDir, join(dir, own))));
    if (depth >= MOST_DEPTH) return;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !NOT_SERVICES.has(entry.name)) walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(repoDir, 0);
  return found.sort();
};

/** The service file a repo-relative directory holds: the first name the framework looks for. */
const serviceFileIn = (repoDir: string, dir: string): string | undefined => {
  const name = SERVICE_FILES.find((candidate) => existsSync(join(repoDir, dir, candidate)));
  return name === undefined ? undefined : dir === '.' || dir === '' ? name : `${dir}/${name}`;
};

const changedAt = (path: string): number | undefined => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
};

const stampOf = (paths: readonly string[]): string => paths.map((path) => `${path}@${changedAt(path) ?? '-'}`).join('|');

interface Reading {
  readonly deployment: Deployment;
  readonly stamp: string;
  /** Absolute paths of the files its variables loaded. */
  readonly loaded: readonly string[];
  readonly loadedStamp: string;
}

/**
 * The last reading of each repository, by what it is read with, taken again
 * only once a service file or a file one of them loaded has changed - as the
 * Terraform reader keeps its readings (R176): a build asks for one deployment
 * several times.
 */
const readings = new Map<string, Reading>();

const readingOf = (options: DeploymentReadOptions): Reading => {
  const { repoDir } = options;
  const composed = composeFiles(repoDir);
  const files = serviceFiles(repoDir);
  const given = options.service?.infra?.options ?? {};
  const key = `${repoDir}\0${JSON.stringify(given)}`;
  const stamp = stampOf([...composed, ...files].map((file) => join(repoDir, file)));
  const kept = readings.get(key);
  if (kept !== undefined && kept.stamp === stamp && stampOf(kept.loaded) === kept.loadedStamp) return kept;
  const parts = emptyParts();
  const loaded = new Set<string>();
  // The services a compose file lists are read through it, with its params,
  // and not again on their own (P249).
  const read = new Set<string>();
  for (const file of composed) {
    for (const done of readCompose(parts, { repoDir, file, options: given, loaded, serviceFileIn: (dir) => serviceFileIn(repoDir, dir) })) read.add(done);
  }
  for (const file of files) if (!read.has(file)) readService(parts, { repoDir, file, options: given, loaded });
  const reading: Reading = { deployment: parts, stamp, loaded: [...loaded].sort(), loadedStamp: stampOf([...loaded].sort()) };
  readings.set(key, reading);
  return reading;
};

/**
 * The Serverless Framework, read from the service files alone (P57).
 *
 * Nothing here runs the framework: no `serverless print`, no plugin, no
 * account. What the framework would resolve from the options it is run with,
 * a `.env` file, another file or its own defaults is resolved the same way;
 * what it would ask the account for is not, and the rows say which.
 */
/**
 * Whether a service file deploys to AWS: its `provider.name`, which is written
 * out in every file the framework reads, or absent. A file that deploys
 * elsewhere declares nothing this reads, and a repository that keeps one only
 * for its variables is not a repository of functions.
 */
const deploysToAws = (repoDir: string, file: string): boolean => {
  if (/\.[cm]?[jt]s$/.test(file)) {
    let text: string;
    try {
      text = readFileSync(join(repoDir, file), 'utf8');
    } catch {
      return false;
    }
    const named = /\bname\s*:\s*['"`]([\w-]+)['"`]/.exec(text.slice(text.indexOf('provider')));
    return named === null || named[1] === 'aws';
  }
  try {
    const document = readServiceFile(join(repoDir, file)).value as { provider?: { name?: unknown } } | null;
    const name = document?.provider?.name;
    return name === undefined || name === 'aws';
  } catch {
    // A file that does not parse is still a service file, and its row says so.
    return true;
  }
};

export const serverlessReader: DeploymentReader = {
  name: 'serverless',
  declares: (repoDir) => serviceFiles(repoDir).some((file) => deploysToAws(repoDir, file)),
  read: (options) => readingOf(options).deployment,
  files: (repoDir, options) => {
    const files = [...composeFiles(repoDir), ...serviceFiles(repoDir)];
    if (files.length === 0) return [];
    const { loaded } = readingOf({ repoDir, config: options?.config as DeploymentReadOptions['config'], ...(options?.service === undefined ? {} : { service: options.service }) });
    return [...new Set([...files, ...loaded.map((path) => toPosixPath(relative(repoDir, path)))])].sort();
  },
};
