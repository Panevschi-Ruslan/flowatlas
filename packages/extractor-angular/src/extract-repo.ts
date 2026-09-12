import { join } from 'node:path';
import {
  AdapterRegistry,
  createProject,
  GraphBuilder,
  parseConfig,
  readPackageJson,
  silentLogger,
  type ExtractContext,
  type FlowatlasConfig,
  type FrontendExtractOptions,
  type Logger,
  type PackageJson,
  type RepoGraph,
  type ServiceConfig,
} from '@flowatlas/core';
import { createAngularContext } from './context.js';
import { buildAngularClassIndex } from './index-classes.js';
import { callsPass } from './passes/calls.js';
import { classesPass } from './passes/classes.js';
import { httpPass } from './passes/http.js';
import { markersPass } from './passes/markers.js';
import { modulesPass } from './passes/modules.js';
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
 */
export const BUILT_IN_PASSES: readonly AngularExtractorPass[] = [
  modulesPass,
  classesPass,
  templatesPass,
  callsPass,
  httpPass,
  ssePass,
  markersPass,
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
  const classes = buildAngularClassIndex({
    project: base.project,
    repo: base.repo,
    repoDir: base.repoDir,
  });
  const ctx = createAngularContext({
    base,
    classes,
    ...(options.typesDepth === undefined ? {} : { maxDepth: options.typesDepth }),
  });
  ctx.stats.files = base.project.getSourceFiles().length;

  for (const pass of BUILT_IN_PASSES) {
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
  });
  const pkg: PackageJson = readPackageJson(rootDir) ?? {};

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
  };

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
