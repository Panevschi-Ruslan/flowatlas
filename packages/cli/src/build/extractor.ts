import {
  ADAPTER_SLOTS,
  AdapterRegistry,
  type AdapterSlot,
  type FlowatlasConfig,
  type PackageJson,
  type ServiceConfig,
  type SourceRootOptions,
} from '@flowatlas/core';
import { brokersPass, registerBrokerAdapters } from '@flowatlas/adapters-broker';
import { leavesPass, registerDbAdapters } from '@flowatlas/adapters-db';
import { deployedSourceDirectories, registerEntryAdapters } from '@flowatlas/adapters-entry';
import { registerFrontendAdapters as registerAngularFrontend } from '@flowatlas/extractor-angular';
import {
  REACT_SOURCE_ROOTS,
  registerFrontendAdapters as registerReactFrontend,
} from '@flowatlas/extractor-react';
import type { NestExtractorPass } from '@flowatlas/extractor-nestjs';
import { workflowsPass } from '@flowatlas/stepfunctions';
import { halfOf, READERS, REACT_EXTRACTOR } from '../readers.js';

/**
 * Package that reads each kind of repository.
 *
 * One reader, several frameworks: `@flowatlas/extractor-nestjs` opens a
 * TypeScript project and walks it, and which ways in it finds is decided by the
 * entry adapters that detect the repository's dependencies, not by the reader. So
 * a repository whose routes are registered by calling an application is read by
 * exactly the same passes as a NestJS one, and which reader reads which framework
 * is a row of `readers.ts` rather than a list here (R118).
 *
 * A `Map`, because the key is the `type` out of somebody's configuration file
 * and a plain object hands `constructor` back a function: a misspelled type
 * would be planned, cached and reported as a repository with a reader rather
 * than as one with none (R134).
 */
export const EXTRACTORS: ReadonlyMap<string, string> = new Map(
  READERS.map(([type, , reader]) => [type, reader]),
);

/**
 * Whether a kind of repository runs in a browser.
 *
 * Browsers are the slowest to read and the least likely to have changed while
 * someone works on a service, which is the whole reason for leaving them out of
 * a build on request. Which half a type's reader reads is not restated here: it
 * is asked of the reader's own row, so a framework that moves from one reader to
 * the other is skipped, or not skipped, correctly on the same edit.
 */
export const isFrontend = (type: string): boolean => halfOf(type) === 'browser';

/**
 * Steps the adapter packages contribute, run after the built-in ones.
 *
 * `workflowsPass` reads the state machine definitions a repository keeps beside
 * its code, so any service a server reader reads has its workflows drawn too.
 */
export const EXTRA_PASSES: readonly NestExtractorPass[] = [leavesPass, brokersPass, workflowsPass];

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
  repoDir?: string,
): Record<AdapterSlot, string[]> => {
  const detected = registry.detect(
    pkg,
    config.adapters.auto ? config.adapters.force : {},
    config,
    repoDir,
  );
  return Object.fromEntries(
    ADAPTER_SLOTS.map((slot) => [slot, detected[slot].map((adapter) => adapter.name)]),
  ) as Record<AdapterSlot, string[]>;
};

export const adapterNames = (
  registry: AdapterRegistry,
  pkg: PackageJson,
  config: FlowatlasConfig,
  repoDir?: string,
): string[] => {
  const bySlot = adaptersBySlot(registry, pkg, config, repoDir);
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
const SLOT_OF_HALF: Readonly<Record<string, AdapterSlot>> = Object.freeze({
  server: 'entry',
  browser: 'frontend',
});

const decidingSlot = (type: string): AdapterSlot | undefined => {
  const half = halfOf(type);
  return half === undefined ? undefined : SLOT_OF_HALF[half];
};

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
  repoDir?: string,
): string | undefined => {
  const slot = decidingSlot(type);
  if (slot === undefined) return undefined;
  const claimed = adaptersBySlot(createRegistry(), pkg, config, repoDir)[slot];
  if (claimed.length > 0) return undefined;
  return (
    `no ${slot} adapter recognises it, so its reader walked the repository and had nowhere to put anything;` +
    ` the configuration says "${type}" and its package.json declares no framework this reads`
  );
};

/**
 * Where each reader looks when a repository's tsconfig names no source root, for
 * the readers that do not look in `src` (R170).
 *
 * Taken from the reader's own package rather than restated here, so the build's
 * file listing and the reading have one statement of it between them.
 */
const ROOTS_OF_READER: ReadonlyMap<string, SourceRootOptions> = new Map([
  [REACT_EXTRACTOR, REACT_SOURCE_ROOTS],
]);

/**
 * The directories a server's deployment packages its functions from, which are
 * roots of its code whatever its tsconfig says. A browser is never deployed as
 * a function, and its reader is told of none.
 */
export const deployedRootsOf = (
  service: ServiceConfig,
  repoDir: string,
  config: FlowatlasConfig,
): readonly string[] =>
  halfOf(service.type) === 'server' ? deployedSourceDirectories(repoDir, config, service) : [];

/**
 * Where a service's own code is, as the build's file listing is told it.
 *
 * The reading is told the same three things — the service's tsconfig, its
 * reader's fallback and its deployment's directories — and both hand them to
 * the core's `sourceRootsOf`, so a file one of them opens is a file the other
 * stamps (R170).
 */
export const sourceRootOptionsOf = (
  service: ServiceConfig,
  repoDir: string,
  config: FlowatlasConfig,
): SourceRootOptions => ({
  ...(service.tsconfig === undefined ? {} : { tsconfig: service.tsconfig }),
  ...ROOTS_OF_READER.get(EXTRACTORS.get(service.type) ?? ''),
  deployed: deployedRootsOf(service, repoDir, config),
});
