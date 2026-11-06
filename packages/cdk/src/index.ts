import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Deployment, DeploymentReadOptions, DeploymentReader } from '@flowatlas/core';
import { appFiles, readApp } from './app.js';
import type { DeploymentParts } from './deployment.js';

export { appFiles } from './app.js';
export { cdkModuleOf } from './modules.js';
export { runtimeOf } from './statics.js';
export { Interpreter } from './interpret.js';

const changedAt = (path: string): number | undefined => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
};

interface Reading {
  readonly deployment: Deployment;
  /** Repo-relative files the reading read: the apps' `cdk.json` and their sources. */
  readonly files: readonly string[];
  readonly stamp: string;
}

const stampOf = (repoDir: string, files: readonly string[]): string => files.map((file) => `${file}@${changedAt(join(repoDir, file)) ?? '-'}`).join('|');

/**
 * The last reading of each repository, taken again only once one of the files
 * it read has changed, as the other readers keep theirs (R176).
 */
const readings = new Map<string, Reading>();

const readingOf = (options: DeploymentReadOptions): Reading => {
  const { repoDir } = options;
  const given = options.service?.infra?.options ?? {};
  const key = `${repoDir}\0${JSON.stringify(given)}`;
  const kept = readings.get(key);
  if (kept !== undefined && stampOf(repoDir, kept.files) === kept.stamp && appFiles(repoDir).every((file) => kept.files.includes(file))) return kept;
  const parts: DeploymentParts & { roots: [] } = { functions: [], routes: [], roots: [], workflows: [], deliveries: [], streams: [], rows: [] };
  const files = appFiles(repoDir).flatMap((file) => readApp(parts, { repoDir, file, options: given }));
  const reading: Reading = { deployment: parts, files: [...new Set(files)].sort(), stamp: '' };
  const stamped = { ...reading, stamp: stampOf(repoDir, reading.files) };
  readings.set(key, stamped);
  return stamped;
};

/**
 * An AWS CDK app in TypeScript, read statically (P57).
 *
 * Nothing here runs `cdk synth`, needs the app's dependencies installed, or
 * reads `cdk.out`: the app is interpreted from the entry its `cdk.json` names,
 * and what it would only know once deployed - a token, a lookup, an import - is
 * unread, with a row that says so.
 */
export const cdkReader: DeploymentReader = {
  name: 'cdk',
  declares: (repoDir) => appFiles(repoDir).length > 0,
  read: (options) => readingOf(options).deployment,
  files: (repoDir, options) => {
    if (appFiles(repoDir).length === 0) return [];
    return readingOf({ repoDir, config: options?.config as DeploymentReadOptions['config'], ...(options?.service === undefined ? {} : { service: options.service }) }).files;
  },
};
