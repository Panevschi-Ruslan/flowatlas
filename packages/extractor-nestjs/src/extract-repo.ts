import { join } from 'node:path';
import {
  AdapterRegistry,
  createProject,
  GraphBuilder,
  normalizeFilePath,
  parseConfig,
  readPackageJson,
  silentLogger,
  type ExtractContext,
  type FlowatlasConfig,
  type Logger,
  type PackageJson,
  type RepoGraph,
  type ServiceConfig,
} from '@flowatlas/core';
import type { Project } from 'ts-morph';
import { findBootstrapFile, readBootstrap } from './bootstrap.js';
import { createNestContext } from './context.js';
import { buildClassIndex } from './index-classes.js';
import { callsPass } from './passes/calls.js';
import { diPass } from './passes/di.js';
import { entriesPass } from './passes/entries.js';
import { modulesPass } from './passes/modules.js';
import { providersPass } from './passes/providers.js';
import { typesPass } from './passes/types-pass.js';
import type { NestExtractorPass } from './passes/types.js';
import { wrappingCollectPass, wrappingEdgesPass } from './passes/wrapping.js';

export interface ExtractRepoOptions {
  /** Absolute path to the repository root. */
  rootDir: string;
  /** Service name, which every id in the graph is prefixed with. */
  repo: string;
  service?: ServiceConfig;
  config?: FlowatlasConfig;
  /** Adapters to use. Without one, no entry points are found. */
  registry?: AdapterRegistry;
  tsconfig?: string;
  /**
   * A project already parsed, reused instead of parsing the repository again.
   *
   * What a watch keeps warm between rebuilds: parsing is the expensive part and
   * the files that did not change do not need it done twice.
   */
  project?: Project;
  bootstrap?: string;
  logger?: Logger;
  /** Fixed timestamp, for reproducible output. */
  generatedAt?: string;
  /** Extra steps, run after the built-in ones. */
  extraPasses?: readonly NestExtractorPass[];
  /** Skip type collection entirely, leaving the registry empty. */
  noTypes?: boolean;
  /** How deep anonymous shapes are written out, overriding the configuration. */
  typesDepth?: number;
}

/**
 * The built-in steps, in the order they run.
 *
 * The order is not arbitrary: roles are settled before any node is created,
 * injection is resolved before calls are followed, and the wrapping chain is
 * drawn last because matching middleware to routes needs the routes.
 */
export const BUILT_IN_PASSES: readonly NestExtractorPass[] = [
  modulesPass,
  wrappingCollectPass,
  providersPass,
  entriesPass,
  diPass,
  callsPass,
  typesPass,
  wrappingEdgesPass,
];

/** Parses a repository, honouring the tsconfig the caller or the service names. */
export const createRepoProject = (options: ExtractRepoOptions): Project => {
  const tsconfig = options.tsconfig ?? options.service?.tsconfig;
  return createProject({
    rootDir: options.rootDir,
    ...(tsconfig === undefined ? {} : { tsconfig }),
  });
};

const defaultService = (repo: string, rootDir: string): ServiceConfig => ({
  name: repo,
  repo: rootDir,
  type: 'nestjs',
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

  const project = options.project ?? createRepoProject(options);
  const pkg: PackageJson = readPackageJson(rootDir) ?? {};

  const registry = options.registry ?? new AdapterRegistry();
  const adapters = registry.detect(pkg, config.adapters.auto ? config.adapters.force : {});

  const classes = buildClassIndex({ project, repo, repoDir: rootDir });

  const bootstrapPath = findBootstrapFile(rootDir, options.bootstrap ?? service.bootstrap);
  const bootstrap = readBootstrap(
    project,
    bootstrapPath,
    bootstrapPath === undefined ? undefined : normalizeFilePath(bootstrapPath, rootDir),
  );

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
    meta: {
      ...(bootstrap.globalPrefix === undefined ? {} : { globalPrefix: bootstrap.globalPrefix }),
    },
  };

  const ctx = createNestContext({
    base,
    classes,
    bootstrap,
    ...(options.typesDepth === undefined ? {} : { maxDepth: options.typesDepth }),
  });
  ctx.stats.files = project.getSourceFiles().length;

  const passes = [...BUILT_IN_PASSES, ...(options.extraPasses ?? [])].filter(
    (pass) => options.noTypes !== true || pass.name !== 'types',
  );
  for (const pass of passes) {
    logger.debug(`pass ${pass.name}`);
    pass.run(ctx);
  }

  // Hashes reach through references, so nothing can be written until every type
  // that any pass collected is known.
  if (options.noTypes !== true) ctx.types.finalize();

  builder.addNode({
    id: `repo:${repo}`,
    type: 'repo',
    label: repo,
    repo,
    meta: {
      stats: ctx.stats,
      ...(bootstrap.file === undefined ? {} : { bootstrap: bootstrap.file }),
      ...(bootstrap.globalPrefix === undefined ? {} : { globalPrefix: bootstrap.globalPrefix }),
      adapters: {
        entry: adapters.entry.map((adapter) => adapter.name),
      },
    },
  });

  return builder.build();
};

export const defaultOutputPath = (rootDir: string, output = '.flowatlas'): string =>
  join(rootDir, output, 'graph.json');
