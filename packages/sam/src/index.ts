import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { toPosixPath, type Deployment, type DeploymentReadOptions, type DeploymentReader } from '@flowatlas/core';
import { emptyParts, readServiceFile } from '@flowatlas/serverless';
import { CONFIG_FILES, deployConfigOf } from './config.js';
import { localPath } from './reading.js';
import { nestedFilesOf, readTemplate, SAM_TRANSFORM } from './template.js';

export { readToml, TomlUnreadable } from './toml.js';
export { deployConfigOf, parameterOverrides, CONFIG_FILES, type DeployConfig } from './config.js';
export { Resolver, expandLoops } from './intrinsics.js';
export { SAM_KINDS, SAM_TRANSFORM, readTemplate, transformsOf } from './template.js';
export { withGlobals } from './functions.js';

/** The names `sam` looks for a template under, in its order. */
export const TEMPLATE_FILES = ['template.yaml', 'template.yml', 'template.json'];

/** Directories that never hold a template of their own: installs, build output, the CLI's own (`.aws-sam`). */
const NOT_TEMPLATES = new Set(['node_modules', 'dist', 'build', 'cdk.out', '.aws-sam', '.serverless', '.flowatlas', '.git']);

/** How far below the repository a template is looked for: `services/orders/template.yaml` is two. */
const MOST_DEPTH = 4;

/** Whether a file is a template written for the SAM transform: cheap, before anything is parsed. */
const isSamTemplate = (path: string): boolean => {
  try {
    return readFileSync(path, 'utf8').includes(SAM_TRANSFORM);
  } catch {
    return false;
  }
};

/**
 * Every SAM template of a repository, repo-relative and sorted: in a
 * directory, the one its `samconfig` names, else the first of the names the
 * CLI looks for, when it is written for the transform. A template another
 * one nests is read as part of it, not again on its own.
 */
export const templateFiles = (repoDir: string): string[] => {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const rel = toPosixPath(relative(repoDir, dir)) || '.';
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const configured = CONFIG_FILES.some((name) => names.has(name)) ? deployConfigOf(repoDir, rel, {}).template : undefined;
    const named = configured === undefined ? undefined : localPath(rel, configured);
    const own = named ?? TEMPLATE_FILES.map((name) => (rel === '.' ? name : `${rel}/${name}`)).find((file) => names.has(posix.basename(file)));
    if (own !== undefined && isSamTemplate(join(repoDir, own))) found.push(own);
    if (depth >= MOST_DEPTH) return;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !NOT_TEMPLATES.has(entry.name)) walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(repoDir, 0);
  const all = [...new Set(found)].sort();
  const nested = new Set<string>();
  for (const file of all) {
    try {
      for (const child of nestedFilesOf(readServiceFile(join(repoDir, file)).value, posix.dirname(file))) if (child !== file) nested.add(child);
    } catch {
      // A template that does not parse nests nothing; its own reading says why.
    }
  }
  const roots = all.filter((file) => !nested.has(file));
  // Templates that only nest one another have no root: the first is read as one.
  return roots.length === 0 ? all.slice(0, 1) : roots;
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
  /** Absolute paths of the files read beside the templates: configuration, nested templates, definitions, bodies. */
  readonly loaded: readonly string[];
  readonly loadedStamp: string;
}

/**
 * The last reading of each repository, by what it is read with, taken again
 * only once a template or a file read beside one has changed, as the other
 * readers keep theirs (R176).
 */
const readings = new Map<string, Reading>();

const readingOf = (options: DeploymentReadOptions): Reading => {
  const { repoDir } = options;
  const files = templateFiles(repoDir);
  const given = options.service?.infra?.options ?? {};
  const key = `${repoDir}\0${JSON.stringify(given)}`;
  const stamp = stampOf(files.map((file) => join(repoDir, file)));
  const kept = readings.get(key);
  if (kept !== undefined && kept.stamp === stamp && stampOf(kept.loaded) === kept.loadedStamp) return kept;
  const parts = emptyParts();
  const loaded = new Set<string>();
  for (const file of files) readTemplate(parts, { repoDir, file, options: given, loaded });
  const sorted = [...loaded].sort();
  const reading: Reading = { deployment: parts, stamp, loaded: sorted, loadedStamp: stampOf(sorted) };
  readings.set(key, reading);
  return reading;
};

/**
 * AWS SAM, read from the templates alone (P246).
 *
 * Nothing here runs `sam build`, `sam validate` or the transform, or asks the
 * account: a template is read as written, with what `samconfig.toml` and the
 * service's options give its parameters, and what only a deployment would
 * know - a name the platform generates, a value from another stack, a branch
 * under a condition nothing settles - is a stand-in or a row that says so.
 */
export const samReader: DeploymentReader = {
  name: 'sam',
  declares: (repoDir) => templateFiles(repoDir).length > 0,
  read: (options) => readingOf(options).deployment,
  files: (repoDir, options) => {
    const files = templateFiles(repoDir);
    if (files.length === 0) return [];
    const { loaded } = readingOf({ repoDir, config: options?.config as DeploymentReadOptions['config'], ...(options?.service === undefined ? {} : { service: options.service }) });
    return [...new Set([...files, ...loaded.map((path) => toPosixPath(relative(repoDir, path)))])].sort();
  },
};
