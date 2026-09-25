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
import { createNestContext, type NestStats } from './context.js';
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

/**
 * The counts of two halves of one reading, as one record.
 *
 * Every key either half filled is kept; where both filled one it is either the
 * same number by construction — both count the source files of the same
 * project — or the tally of calls into installed packages, which is summed
 * because each half skipped its own. Nothing is read out of the shape beyond
 * that tally, so a half that grows a counter needs no change here.
 */
const foldStats = (existing: unknown, mine: NestStats): Record<string, unknown> => {
  if (typeof existing !== 'object' || existing === null) return { ...mine };
  const prior = existing as Record<string, unknown>;
  const skippedExternalCalls = { ...((prior['skippedExternalCalls'] ?? {}) as Record<string, number>) };
  for (const [pkg, count] of Object.entries(mine.skippedExternalCalls)) {
    skippedExternalCalls[pkg] = (skippedExternalCalls[pkg] ?? 0) + count;
  }
  return { ...mine, ...prior, skippedExternalCalls };
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

  // The other half of the same directory. A repository built on a file-system
  // router is a browser and a server at once: its route handlers sit beside the
  // screens that call them, and both are in the project because the project
  // opens every kind of TypeScript source. Every frontend adapter the registry
  // detected is asked to read what it knows, through the same context and into
  // the same builder, so the two halves are one reading of one repository
  // rather than two graphs to reconcile afterwards.
  //
  // For a repository that is only a server the loop is empty, because no
  // frontend adapter detects it. That is the whole of the condition, and it is
  // why this reader still names no framework: which halves run is the
  // registry's answer, not this file's.
  //
  // The browser half goes first because it is the half that can say what a
  // function is *for*. A screen is a function like any other to the walk below,
  // and the builder keeps what the first writer said a node was; read the other
  // way round, every component would be recorded as a plain function and the
  // screens — the thing a front-end reading exists to reach — would be gone
  // while the node count stayed the same. Nothing is lost by this order: the
  // server half's own counts are folded into the repository node that the
  // browser half wrote, rather than replacing it.
  for (const adapter of adapters.frontend) {
    logger.debug(`frontend ${adapter.name}`);
    adapter.extract(base, {
      ...(options.noTypes === undefined ? {} : { noTypes: options.noTypes }),
      ...(options.typesDepth === undefined ? {} : { typesDepth: options.typesDepth }),
    });
  }

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

  // One repository is one repository node, whether this reading is the whole of
  // it or the server half of a directory a frontend adapter has already read.
  // `addNode` keeps what the first writer put there, so the counts and the
  // adapter names are written back as the union of both halves: what either
  // half filled is kept, and the two tallies of calls into installed packages
  // are summed. Those tallies are the only place a half says what it chose not
  // to follow, so dropping one would be dropping a reason.
  const repoId = `repo:${repo}`;
  // Read before writing: after the write the stored counts are this half's own
  // when no other half ran, and folding those into themselves would count every
  // skipped call twice.
  const priorStats = builder.getNode(repoId)?.meta?.['stats'];
  const node = builder.addNode({
    id: repoId,
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
  node.meta = {
    ...node.meta,
    stats: foldStats(priorStats, ctx.stats),
    adapters: {
      ...(node.meta?.['adapters'] as Record<string, unknown> | undefined),
      entry: adapters.entry.map((adapter) => adapter.name),
    },
  };

  return builder.build();
};

export const defaultOutputPath = (rootDir: string, output = '.flowatlas'): string =>
  join(rootDir, output, 'graph.json');
