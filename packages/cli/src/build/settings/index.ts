import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LoadedConfig, RepoSettings } from '@flowatlas/core';
import { isDeclared } from '../declared.js';
import { readProjectSettings } from './read.js';

export { readProjectSettings } from './read.js';

/**
 * What every configured repository's own files say its settings are (P77),
 * or nothing where the configuration turns that off.
 *
 * Read on every build rather than cached with a repository's graph: it is a
 * handful of small files at the top of each repository, and what one of them
 * says about a container belongs to another repository's requests, which no
 * one repository's cache entry could know to invalidate.
 */
export const settingsOfProject = (loaded: LoadedConfig): Record<string, RepoSettings> => {
  const { config } = loaded;
  if (config.settingFiles.read === false) return {};
  const services = config.services
    .filter((service) => !isDeclared(service))
    .map((service) => ({ name: service.name, dir: loaded.repoDir(service) }))
    .filter((service) => existsSync(service.dir));
  const { environment, overlays, chartValues } = config.settingFiles;
  const at = (path: string): string => resolve(loaded.rootDir, path);
  return readProjectSettings({
    services,
    rootDir: loaded.rootDir,
    ...(environment === undefined ? {} : { environment }),
    ...(overlays === undefined ? {} : { overlays: overlays.map(at) }),
    ...(chartValues === undefined ? {} : { chartValues: Object.fromEntries(Object.entries(chartValues).map(([chart, files]) => [at(chart), files.map(at)])) }),
  });
};
