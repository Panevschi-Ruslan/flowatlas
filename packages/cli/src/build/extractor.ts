import {
  ADAPTER_SLOTS,
  AdapterRegistry,
  type FlowatlasConfig,
  type PackageJson,
} from '@flowatlas/core';
import { brokersPass, registerBrokerAdapters } from '@flowatlas/adapters-broker';
import { leavesPass, registerDbAdapters } from '@flowatlas/adapters-db';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { registerFrontendAdapters as registerAngularFrontend } from '@flowatlas/extractor-angular';
import { registerFrontendAdapters as registerReactFrontend } from '@flowatlas/extractor-react';
import type { NestExtractorPass } from '@flowatlas/extractor-nestjs';

export const NESTJS_EXTRACTOR = '@flowatlas/extractor-nestjs';
export const ANGULAR_EXTRACTOR = '@flowatlas/extractor-angular';
export const REACT_EXTRACTOR = '@flowatlas/extractor-react';

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

/**
 * Repository types the React reader handles.
 *
 * The file-system router is here rather than beside the server types on
 * purpose, and it is the one place in this tool where that decision is visible.
 * A repository built on it is a browser and a server at once: the same
 * directory holds the screens, the route handlers that answer them and the
 * actions the screens call, and most of it is written in files the server
 * reader does not open, because that reader globs `.ts` and a component lives
 * in `.tsx`. Reading it with the reader that opens both, and letting the ways
 * in come from an entry adapter through the registry, keeps one repository one
 * reading. What it costs is named in the README: no dependency injection, no
 * data-layer pass and no incremental session for those repositories yet.
 */
export const BROWSER_TYPES: readonly string[] = ['react', 'nextjs'];

/** Package that reads each kind of repository. */
export const EXTRACTORS: Record<string, string> = {
  ...Object.fromEntries(SERVER_TYPES.map((type) => [type, NESTJS_EXTRACTOR])),
  angular: ANGULAR_EXTRACTOR,
  ...Object.fromEntries(BROWSER_TYPES.map((type) => [type, REACT_EXTRACTOR])),
};

/**
 * Kinds of repository that run in a browser.
 *
 * They are the slowest to read and the least likely to have changed while
 * someone works on a service, which is the whole reason for leaving them out of
 * a build on request.
 */
const FRONTEND_TYPES = new Set(['angular', 'react']);

export const isFrontend = (type: string): boolean => FRONTEND_TYPES.has(type);

/** Steps the adapter packages contribute, run after the built-in ones. */
export const EXTRA_PASSES: readonly NestExtractorPass[] = [leavesPass, brokersPass];

/** Every adapter the command line knows how to offer an extractor. */
export const createRegistry = (): AdapterRegistry => {
  const registry = new AdapterRegistry();
  registerEntryAdapters(registry);
  registerDbAdapters(registry);
  registerBrokerAdapters(registry);
  registerAngularFrontend(registry);
  registerReactFrontend(registry);
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
