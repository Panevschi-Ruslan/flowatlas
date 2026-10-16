import { existsSync } from 'node:fs';
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
  return readProjectSettings({
    services,
    rootDir: loaded.rootDir,
    ...(config.settingFiles.environment === undefined ? {} : { environment: config.settingFiles.environment }),
  });
};
