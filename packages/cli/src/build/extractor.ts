import {
  ADAPTER_SLOTS,
  AdapterRegistry,
  type FlowatlasConfig,
  type PackageJson,
} from '@flowatlas/core';
import { brokersPass, registerBrokerAdapters } from '@flowatlas/adapters-broker';
import { leavesPass, registerDbAdapters } from '@flowatlas/adapters-db';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { registerFrontendAdapters } from '@flowatlas/extractor-angular';
import type { NestExtractorPass } from '@flowatlas/extractor-nestjs';

export const NESTJS_EXTRACTOR = '@flowatlas/extractor-nestjs';
export const ANGULAR_EXTRACTOR = '@flowatlas/extractor-angular';

/** Package that reads each kind of repository. */
export const EXTRACTORS: Record<string, string> = {
  nestjs: NESTJS_EXTRACTOR,
  angular: ANGULAR_EXTRACTOR,
};

/**
 * Kinds of repository that run in a browser.
 *
 * They are the slowest to read and the least likely to have changed while
 * someone works on a service, which is the whole reason for leaving them out of
 * a build on request.
 */
const FRONTEND_TYPES = new Set(['angular']);

export const isFrontend = (type: string): boolean => FRONTEND_TYPES.has(type);

/** Steps the adapter packages contribute, run after the built-in ones. */
export const EXTRA_PASSES: readonly NestExtractorPass[] = [leavesPass, brokersPass];

/** Every adapter the command line knows how to offer an extractor. */
export const createRegistry = (): AdapterRegistry => {
  const registry = new AdapterRegistry();
  registerEntryAdapters(registry);
  registerDbAdapters(registry);
  registerBrokerAdapters(registry);
  registerFrontendAdapters(registry);
  return registry;
};

/**
 * Names of the adapters that would be used for a repository, sorted.
 *
 * Recorded in the build cache because an adapter appearing or disappearing
 * changes what the same sources produce, without any file having changed.
 */
export const adapterNames = (
  registry: AdapterRegistry,
  pkg: PackageJson,
  config: FlowatlasConfig,
): string[] => {
  const detected = registry.detect(pkg, config.adapters.auto ? config.adapters.force : {});
  const names = ADAPTER_SLOTS.flatMap((slot) => detected[slot].map((adapter) => adapter.name));
  return [...names, ...config.adapters.broker.custom.map((broker) => broker.name)].sort();
};
