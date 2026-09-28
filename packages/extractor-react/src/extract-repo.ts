import { join } from 'node:path';
import {
  AdapterRegistry,
  countSources,
  GraphBuilder,
  parseConfig,
  readResolvedPackageJson,
  recordApplications,
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
import { createReactContext } from './context.js';
import { declaresReact } from './framework.js';
import { buildReactFunctionIndex } from './index-functions.js';
import { actionsPass } from './passes/actions.js';
import { callsPass } from './passes/calls.js';
import { entriesPass } from './passes/entries.js';
import { functionsPass } from './passes/functions.js';
import { httpPass } from './passes/http.js';
import { proceduresPass } from './passes/procedures.js';
import { routesPass } from './passes/routes.js';
import type { ReactExtractorPass } from './passes/types.js';
import { createReactProject } from './project.js';

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
 * The order is not arbitrary. The screens get their nodes first, so that the
 * routes have something to write their address on; the routes settle which
 * components are screens before any other pass reads that fact; the calls are
 * drawn before the requests, so that a request attributed to a caller lands on
 * a node the walk has already created; a procedure asked for by its path is a
 * request of the same standing and goes beside them; and the ways in are read
 * last, because the edge from a component to a server action needs the
 * component to exist.
 */
export const BUILT_IN_PASSES: readonly ReactExtractorPass[] = [
  functionsPass,
  routesPass,
  callsPass,
  actionsPass,
  httpPass,
  proceduresPass,
  entriesPass,
];

/**
 * Reads one repository into the shared builder.
 *
 * This is what the frontend adapter does when the registry picks it, so the
 * whole extractor is reachable through the context alone and nothing here needs
 * a privileged path into the tool.
 */
export const extractReact = (base: ExtractContext, options: FrontendExtractOptions = {}): void => {
  // Which files are React's to read. Detection said the framework is somewhere
  // in what this service can import; that switches the reader on and says
  // nothing about which files are written for it. A server whose mail library
  // renders with React runs React in that library alone, and its own handlers,
  // the transports they call and a provider shipped for other people's
  // applications are not pages whatever they contain. So the reader walks a file
  // only when the framework is supplied to the package holding it: by the
  // service, which supplies it to everything it reaches; by a member that
  // installs it, to itself; or, for a peer, by a dependent that is supplied.
  // The rule and its argument are `suppliedWith` in the core, asked with this
  // adapter's own description of the framework (R145).
  //
  // Everything the passes read comes through this index - components, hooks,
  // requests, the calls between them, the screens a route names - so a file left
  // out here is left out of the whole reading and not of one pass.
  const functions = buildReactFunctionIndex({
    project: base.project,
    repo: base.repo,
    repoDir: base.repoDir,
    reads: suppliedWith(base.repoDir, declaresReact),
  });
  const ctx = createReactContext({
    base,
    functions,
    sources: countSources(base.project),
    ...(options.typesDepth === undefined ? {} : { maxDepth: options.typesDepth }),
  });

  // Which applications this service holds, asked of the entry adapters before
  // any pass runs. The request pass records which application a call site is
  // in, and the answer has to be the one the ids carry rather than a second
  // reading of the same directories (R132).
  recordApplications(base);

  for (const pass of BUILT_IN_PASSES) {
    base.logger.debug(`pass ${pass.name}`);
    pass.run(ctx);
  }

  // Hashes reach through references, so nothing can be written until every type
  // that any pass collected is known.
  if (options.noTypes !== true) ctx.types.finalize();

  // This half may be one of two readings of the same directory, and a
  // repository is one node however many halves wrote it. Writing it first and
  // letting the other half fold its counts in is what keeps it one node; see
  // the server reader, which does the folding because it is the half that goes
  // second.
  base.builder.addNode({
    id: `repo:${base.repo}`,
    type: 'repo',
    label: base.repo,
    repo: base.repo,
    meta: {
      stats: ctx.stats,
      adapters: {
        frontend: base.adapters.frontend.map((adapter) => adapter.name),
        entry: base.adapters.entry.map((adapter) => adapter.name),
      },
    },
  });
};

const defaultService = (repo: string, rootDir: string): ServiceConfig => ({
  name: repo,
  repo: rootDir,
  type: 'react',
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
  const project = createReactProject({
    rootDir,
    ...(tsconfig === undefined ? {} : { tsconfig }),
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
