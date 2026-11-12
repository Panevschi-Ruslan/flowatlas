/**
 * The ways in a service reads in another configured service's package (P282).
 *
 * A service is its own directory and the workspace packages it declares
 * (`serviceSourceDirs`), and every reader walks every file of that extent. That
 * is right for a library: a handler in `packages/features` is the service's
 * handler. It is wrong for a package that is itself a configured service. An
 * admin front end that declares the API's package to import its types read the
 * API's resolvers, controllers and consumers as ways in of its own, and then two
 * services answered every one of them: each request to them was ambiguous
 * between the service that serves it and a front end that never does.
 *
 * So what a dependent service reads in another service's directory is still
 * read - its types, its functions, the code the dependent calls - and the ways
 * in written there are left to the service they belong to, which reads them as
 * its own. A way in is an `entry` node or a `consumer` node; the edges at either
 * end of one go with it, and nothing else in the graph changes.
 *
 * Which services are "other" is the configuration's answer: every service with
 * a repository of its own, other than this one, whose directory is not this
 * service's directory nor one this service is inside of. A service declared by a
 * document has no code here to be read twice. A package of the extent that no
 * service is configured on is a library and keeps contributing what it did,
 * unless it is in the extent only because another service declares it: then
 * it came with that service and its ways in are that service's too.
 */
import { resolve } from 'node:path';
import type { FlowatlasConfig, ServiceConfig } from './config.js';
import { isWithinDir } from './ids.js';
import type { GraphNode } from './model/nodes.js';
import type { RepoGraph } from './model/graph.js';
import { serviceDirOf } from './package-index.js';
import { serviceExtent } from './workspace.js';

/** Node types that are a way into the service whose code they are written in. */
const WAY_IN_TYPES: ReadonlySet<string> = new Set(['entry', 'consumer']);

export interface OtherServicesOptions {
  /** The directory of the service being read; every node's file is relative to it. */
  readonly rootDir: string;
  readonly config?: FlowatlasConfig;
  /** The configuration's directory, which a service's `repo` is relative to. */
  readonly configDir?: string;
  /** The service being read, by whose name the others are told from it. */
  readonly service?: ServiceConfig;
}

/**
 * The directories whose ways in belong to another configured service: absolute,
 * and never this service's own nor one that contains it.
 *
 * Each other service's directory, and the packages of this service's extent it
 * reaches only through one of them. A library the other service declares comes
 * along when its package is declared, because the other service's files import
 * it; what is written in it is the other service's as much as its own files
 * are. A package this service also declares itself, or reaches through a
 * library of its own, stays its own.
 */
export const otherServiceDirs = (options: OtherServicesOptions): string[] => {
  const { config, configDir, service, rootDir } = options;
  if (config === undefined || configDir === undefined || service === undefined) return [];
  const own = resolve(rootDir);
  const services = config.services
    .filter((other) => other.name !== service.name && other.document === undefined && other.repo !== undefined)
    .map((other) => serviceDirOf(configDir, other.repo as string))
    .filter((dir) => !isWithinDir(own, dir));
  if (services.length === 0) return [];
  const isService = (dir: string): boolean => services.some((at) => isWithinDir(dir, at));
  const extent = serviceExtent(own);
  const declares = new Map(extent.map((pkg) => [resolve(pkg.dir), pkg.declares.map((dir) => resolve(dir))]));
  // Everything reached from a start over the manifests' declarations, never
  // walking on from a directory `stop` says to stop at.
  const reach = (starts: readonly string[], stop: (dir: string) => boolean): Set<string> => {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      if (seen.has(at)) continue;
      seen.add(at);
      if (stop(at)) continue;
      queue.push(...(declares.get(at) ?? []));
    }
    return seen;
  };
  const ownReach = reach([own], (dir) => dir !== own && isService(dir));
  const throughServices = reach(
    [...declares.keys()].filter((dir) => dir !== own && isService(dir)),
    () => false,
  );
  const libraries = [...throughServices].filter(
    (dir) => !isService(dir) && !ownReach.has(dir) && !isWithinDir(dir, own),
  );
  return [...services, ...libraries];
};

/**
 * The graph without the ways in written in another configured service's
 * directory, and without the edges at either end of them.
 */
export const withoutOtherServicesWaysIn = (graph: RepoGraph, options: OtherServicesOptions): RepoGraph => {
  const others = otherServiceDirs(options);
  if (others.length === 0) return graph;
  const theirs = (node: GraphNode): boolean =>
    WAY_IN_TYPES.has(node.type) &&
    node.file !== undefined &&
    others.some((dir) => isWithinDir(resolve(options.rootDir, node.file as string), dir));
  const dropped = new Set(graph.nodes.filter(theirs).map((node) => node.id));
  if (dropped.size === 0) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !dropped.has(node.id)),
    edges: graph.edges.filter((edge) => !dropped.has(edge.from) && !dropped.has(edge.to)),
  };
};
