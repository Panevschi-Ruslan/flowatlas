/**
 * Where a chain of calls ends: data, cache, outgoing requests, configuration.
 *
 * The mechanism is in the core and is the same for all four. What lives here is
 * data: which package means which kind of leaf, and which of its methods reads
 * and which writes.
 */
export const PACKAGE_NAME = '@flowatlas/adapters-db';

export { extractLeaves, leavesPass } from './leaves-pass.js';
export {
  dataNameHints,
  dbAdapters,
  drizzleDescriptor,
  knexDescriptor,
  localBaseDescriptor,
  mongodbDescriptor,
  mongooseDescriptor,
  pgDescriptor,
  prismaDescriptor,
  sequelizeDescriptor,
  tableLocators,
  typeormDescriptor,
} from './descriptors/index.js';
export { locateTable } from './descriptors/table.js';
export type { TableLocator } from './descriptors/table.js';
export { sqlOperation, sqlTables } from './sql.js';
export { readConfig } from './leaves/config.js';
export type { ConfigRead, ConfigSource } from './leaves/config.js';
export { analyzeUrl } from './leaves/url.js';
export type { UrlInfo } from './leaves/url.js';
export { dataLayerOf } from './leaves/silence.js';
export type { DataLayer } from './leaves/silence.js';

import type { AdapterRegistry } from '@flowatlas/core';
import { dbAdapters } from './descriptors/index.js';

export const registerDbAdapters = (registry: AdapterRegistry): AdapterRegistry =>
  registry.registerAll('db', dbAdapters);
