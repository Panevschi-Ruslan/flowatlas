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

/**
 * Repository types the TypeScript server reader handles.
 *
 * One reader, several frameworks. `@flowatlas/extractor-nestjs` opens a
 * TypeScript project and walks it; which ways in it finds is decided by the
 * entry adapters that detect the repository's dependencies, not by the reader.
 * A repository whose routes are registered by calling an application is read by
 * exactly the same passes as a NestJS one, so its type belongs here rather than
 * in a reader of its own.
 */
export const SERVER_TYPES: readonly string[] = ['nestjs', 'express', 'fastify', 'koa'];

/** Package that reads each kind of repository. */
export const EXTRACTORS: Record<string, string> = {
  ...Object.fromEntries(SERVER_TYPES.map((type) => [type, NESTJS_EXTRACTOR])),
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
