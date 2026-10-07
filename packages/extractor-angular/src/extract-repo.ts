import { join } from 'node:path';
import {
  AdapterRegistry,
  countSources,
  createProject,
  GraphBuilder,
  parseConfig,
  readResolvedPackageJson,
  recordApplications,
  reportSkippedTestDirectories,
  reportUnreadableSources,
  silentLogger,
  suppliedWith,
  type ExtractContext,
  type FlowatlasConfig,
  type FrontendExtractOptions,
  type Logger,
  type PackageJson,
  type RepoGraph,
  type ServiceConfig,
} from '@flowatlas/core';
import { createAngularContext } from './context.js';
import { declaresAngular } from './framework.js';
import { buildAngularClassIndex } from './index-classes.js';
import { callsPass } from './passes/calls.js';
import { classesPass } from './passes/classes.js';
import { httpPass } from './passes/http.js';
import { markersPass } from './passes/markers.js';
import { modulesPass } from './passes/modules.js';
import { signaturesPass } from './passes/signatures.js';
import { socketsPass } from './passes/sockets.js';
import { ssePass } from './passes/sse.js';
import { templatesPass } from './passes/templates.js';
import type { AngularExtractorPass } from './passes/types.js';

export interface ExtractRepoOptions {
  /** Absolute path to the repository root. */
  rootDir: string;
  /** Service name, which every id in the graph is prefixed with. */
  repo: string;
  service?: ServiceConfig;
  config?: FlowatlasConfig;
  /** Adapters to use. Without a frontend adapter nothing is read. */
  registry?: AdapterRegistry;
  tsconfig?: string;
  logger?: Logger;
  /** Fixed timestamp, for reproducible output. */
  generatedAt?: string;
  /** Skip type collection entirely, leaving the registry empty. */
  noTypes?: boolean;
  /** How deep anonymous shapes are written out, overriding the configuration. */
  typesDepth?: number;
}

/**
 * The built-in steps, in the order they run.
 *
 * The order is not arbitrary: modules settle which components are standalone and
 * where the routes lead, injection is resolved before a template handler on an
 * injected service can be followed, and the annotations run last so that a
 * request already read from the source wins over one merely asserted.
 *
 * `sse` and `sockets` sit next to each other on purpose: they read the two ways
 * a browser is handed something it did not ask for one message at a time, and
 * they answer the question of what that is differently — a stream is a request
 * to an address, a socket is one end of a named channel (R08).
 *
 * What a method takes is written after all of them, once every edge into it is
 * drawn.
 */
export const BUILT_IN_PASSES: readonly AngularExtractorPass[] = [
  modulesPass,
  classesPass,
  templatesPass,
  callsPass,
  httpPass,
  ssePass,
  socketsPass,
  markersPass,
  signaturesPass,
];

/**
 * Reads one repository into the shared builder.
 *
 * This is what the frontend adapter does when the registry picks it, so the
 * whole extractor is reachable through the context alone and nothing here needs
 * a privileged path into the tool.
 */
export const extractAngular = (
  base: ExtractContext,
  options: FrontendExtractOptions = {},
): void => {
  // Which files are Angular's to read. Detection said the framework is
  // somewhere in what this service can import, which switches the reader on and
  // says nothing about which files are written for it: a server one of whose
  // members installs Angular runs Angular in that member alone. So a file is
  // read only when the framework is supplied to the package holding it - by the
  // service, to everything it reaches; by a member that installs it, to itself;
  // or, for a peer, by a dependent that is supplied. The rule and its argument
  // are `suppliedWith` in the core, asked with this adapter's own description
  // of the framework, exactly as the sibling reader asks it (R145, R159).
  //
  // Everything the passes read comes through the class index, and the route
  // configurations through the same predicate on the context, so a file left
  // out here is left out of the whole reading and not of one pass.
  const reads = suppliedWith(base.repoDir, declaresAngular);
  const classes = buildAngularClassIndex({
    project: base.project,
    repo: base.repo,
    repoDir: base.repoDir,
    reads,
  });
  const ctx = createAngularContext({
    base,
    classes,
    reads,
    sources: countSources(base.project),
    ...(options.typesDepth === undefined ? {} : { maxDepth: options.typesDepth }),
  });

  // Which applications this service holds, asked of the entry adapters before
  // any pass runs, exactly as the sibling reader asks (R132).
  recordApplications(base);

  for (const pass of BUILT_IN_PASSES) {
    if (options.noTypes === true && pass.name === 'types') continue;
    base.logger.debug(`pass ${pass.name}`);
    pass.run(ctx);
  }

  // Hashes reach through references, so nothing can be written until every type
  // that any pass collected is known.
  if (options.noTypes !== true) ctx.types.finalize();

  base.builder.addNode({
    id: `repo:${base.repo}`,
    type: 'repo',
    label: base.repo,
    repo: base.repo,
    meta: {
      stats: ctx.stats,
      adapters: { frontend: base.adapters.frontend.map((adapter) => adapter.name) },
    },
  });
};

const defaultService = (repo: string, rootDir: string): ServiceConfig => ({
  name: repo,
  repo: rootDir,
  type: 'angular',
});

/**
 * Builds the graph of one repository.
 *
 * Reads and computes only; writing the result is the caller's job, which keeps
 * this usable from a watch loop and from tests without touching the disk.
 */
export const extractRepo = async (options: ExtractRepoOptions): Promise<RepoGraph> => {
  const { rootDir, repo } = options;
  const logger = options.logger ?? silentLogger;
  const config = options.config ?? parseConfig({});
  const service = options.service ?? defaultService(repo, rootDir);

  const tsconfig = options.tsconfig ?? service.tsconfig;
  const project = createProject({
    rootDir,
    ...(tsconfig === undefined ? {} : { tsconfig }),
    ...(service.readTestDirectories === undefined
      ? {}
      : { readTestDirectories: service.readTestDirectories }),
  });
  // The manifest that answers what this repository can import, which on a
  // package inside a workspace is not the leaf manifest alone. Everything below
  // gates on it, so widening it here is what lets an adapter stay a statement
  // about one package name.
  const pkg: PackageJson = readResolvedPackageJson(rootDir) ?? {};

  const registry = options.registry ?? new AdapterRegistry();
  const adapters = registry.detect(pkg, config.adapters.auto ? config.adapters.force : {});

  const builder = new GraphBuilder({
    repo,
    ...(options.generatedAt === undefined ? {} : { generatedAt: options.generatedAt }),
  });

  const base: ExtractContext = {
    repo,
    repoDir: rootDir,
    service,
    config,
    pkg,
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters,
    logger,
    // Where an adapter leaves what the rest of the reading needs from it. Empty
    // here because nothing is known before the adapters are asked; the
    // applications go in before the passes run.
    meta: {},
  };

  // Before any adapter runs, because a file the parser could not read is a hole
  // in everything that follows and nothing downstream can notice it: a source
  // with a syntax error is still a source file the project opened, and simply
  // holds nothing any pass can find. The wording lives in the core, so this
  // reader and its siblings say the same thing about the same event, and so
  // does the count of them the repository node carries.
  reportUnreadableSources(base);
  reportSkippedTestDirectories(base);

  // Every adapter goes through the registry, this one included: a repository no
  // frontend adapter recognises is read by none of them.
  if (adapters.frontend.length === 0) {
    logger.warn(`no frontend adapter recognises ${rootDir}; nothing was read`);
  }
  for (const adapter of adapters.frontend) {
    adapter.extract(base, {
      ...(options.noTypes === undefined ? {} : { noTypes: options.noTypes }),
      ...(options.typesDepth === undefined ? {} : { typesDepth: options.typesDepth }),
    });
  }

  return builder.build();
};

export const defaultOutputPath = (rootDir: string, output = '.flowatlas'): string =>
  join(rootDir, output, 'graph.json');
