import { catalogDefaults } from './defaults';
import { mergeConfig } from './merge';

type CatalogConfig = typeof catalogDefaults;

let current: CatalogConfig = catalogDefaults;

/** Lays what the catalog is started with over the defaults. Call it before bootstrapping. */
export function setConfig(given: Partial<CatalogConfig>) {
  current = mergeConfig(current, given);
}

/** The configuration as set so far. */
export function getConfig(): Readonly<CatalogConfig> {
  return current;
}
