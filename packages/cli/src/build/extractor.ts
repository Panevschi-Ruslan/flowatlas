import {
  ADAPTER_SLOTS,
  AdapterRegistry,
  type AdapterSlot,
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
export const SERVER_TYPES: readonly string[] = [
  'nestjs',
  'express',
  'fastify',
  'koa',
  'nextjs',
  'medusa',
];

/**
 * Repository types the React reader handles on its own.
 *
 * A repository built on the file-system router used to be here, because it is a
 * browser and a server in one directory and the server reader opened no `.tsx`
 * file, so reading it there would have lost every screen. That is no longer
 * true: the project opens every kind of TypeScript source, and the server
 * reader asks the frontend adapters to read the browser half through the same
 * context. So such a repository is a server type now, and what it gained by
 * moving is everything that lives on the server side — dependency injection,
 * the wrapping chain, the data-layer and broker passes, the contract types and
 * an incremental session — without losing a component, an action or the route
 * handlers that are written in markup.
 *
 * What stays here is a repository that is only a browser. It has no ways in for
 * the server reader to find, so running it there would add passes with nothing
 * to read and a slower run to show for it.
 */
export const BROWSER_TYPES: readonly string[] = ['react'];

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
 *
 * Detection is handed the configuration here for the same reason the readers
 * hand it over: an adapter that runs descriptions the project wrote recognises
 * a repository from those descriptions and from nothing else, so asking without
 * them records a list the reading will not agree with. Nothing downstream was
 * wrong while this was missing — the cache hashes the whole configuration
 * beside this list, so a changed description throws the entry away whatever the
 * list says — but a list that answers a different question than detection does
 * is a wrong answer to anybody who reads it, which is reason enough.
 */
export const adaptersBySlot = (
  registry: AdapterRegistry,
  pkg: PackageJson,
  config: FlowatlasConfig,
): Record<AdapterSlot, string[]> => {
  const detected = registry.detect(
    pkg,
    config.adapters.auto ? config.adapters.force : {},
    config,
  );
  return Object.fromEntries(
    ADAPTER_SLOTS.map((slot) => [slot, detected[slot].map((adapter) => adapter.name)]),
  ) as Record<AdapterSlot, string[]>;
};

export const adapterNames = (
  registry: AdapterRegistry,
  pkg: PackageJson,
  config: FlowatlasConfig,
): string[] => {
  const bySlot = adaptersBySlot(registry, pkg, config);
  const names = ADAPTER_SLOTS.flatMap((slot) => bySlot[slot]);
  return [...names, ...config.adapters.broker.custom.map((broker) => broker.name)].sort();
};

/**
 * The slot that decides whether a repository is read at all, by its type.
 *
 * A reader opens the project either way; what it finds in it is found by the
 * adapters in one slot, and where that slot is empty the reader walks a whole
 * repository and has nowhere to put anything. For a browser that slot is the
 * frontend one, for a server it is the way in.
 */
const DECIDING_SLOT: Readonly<Record<string, AdapterSlot>> = Object.freeze({
  ...Object.fromEntries(SERVER_TYPES.map((type) => [type, 'entry' as AdapterSlot])),
  angular: 'frontend' as AdapterSlot,
  ...Object.fromEntries(BROWSER_TYPES.map((type) => [type, 'frontend' as AdapterSlot])),
});

/**
 * Why a repository that has a reader contributed nothing, when that can be said.
 *
 * `stacks.ts` already argues, above `UNREAD_SIGNATURES`, that knowing the name
 * of a stack this cannot read is worth as much as knowing one it can. That
 * argument was applied to a repository with no reader at all and not to this
 * case, which is the one that looks like success: a type the configuration names,
 * a reader that opens the repository, an adapter registry that recognises none
 * of it, and a graph with nothing in it. The reader says so on its own log at
 * `-v` and `build` threw the sentence away, so `build` printed `0 nodes` and
 * `doctor` exited 0 over it (R106).
 *
 * `undefined` where the slot is not empty: the repository was read, something
 * claimed it, and whatever made the graph empty is not a question this can
 * answer from a manifest.
 */
export const declinedNote = (
  type: string,
  pkg: PackageJson,
  config: FlowatlasConfig,
): string | undefined => {
  const slot = DECIDING_SLOT[type];
  if (slot === undefined) return undefined;
  const claimed = adaptersBySlot(createRegistry(), pkg, config)[slot];
  if (claimed.length > 0) return undefined;
  return (
    `no ${slot} adapter recognises it, so its reader walked the repository and had nowhere to put anything;` +
    ` the configuration says "${type}" and its package.json declares no framework this reads`
  );
};
