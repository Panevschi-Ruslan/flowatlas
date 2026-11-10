import type { Project } from 'ts-morph';
import { join } from 'node:path';
import {
  AdapterRegistry,
  LISTEN_META,
  listeningOf,
  OWN_ORIGIN_META,
  PROXY_META,
  proxiesOf,
  countSources,
  GraphBuilder,
  parseConfig,
  readResolvedPackageJson,
  recordApplications,
  closeStandIns,
  reportSkippedTestDirectories,
  reportPatterns,
  readPatterns,
  reportStandIns,
  reportConventions,
  conventionsFor,
  reportUnreadableSources,
  silentLogger,
  standInsFor,
  type StandInsOfBuild,
  suppliedWith,
  type ExtractContext,
  type FlowatlasConfig,
  type FrontendExtractOptions,
  type Logger,
  type PackageJson,
  type RepoGraph,
  type ServiceConfig,
  projectText,
  addEmbeddedScripts,
  listRepoSources,
  toPosixPath,
  type EmbeddedFile,
  type EmbeddedFormat,
} from '@flowatlas/core';
import { createReactContext } from './context.js';
import { declaresReact } from './framework.js';
import { COMPONENT_TAIL_NAME } from './sfc/formats.js';
import { sfcPass } from './sfc/pass.js';
import { buildReactFunctionIndex } from './index-functions.js';
import { actionsPass } from './passes/actions.js';
import { callsPass } from './passes/calls.js';
import { childrenPass } from './passes/children.js';
import { entriesPass } from './passes/entries.js';
import { functionsPass } from './passes/functions.js';
import { graphqlPass } from './passes/graphql.js';
import { httpPass } from './passes/http.js';
import { markersPass } from './passes/markers.js';
import { navigationsPass } from './passes/navigations.js';
import { proceduresPass } from './passes/procedures.js';
import { routesPass } from './passes/routes.js';
import { signaturesPass } from './passes/signatures.js';
import type { ReactExtractorPass } from './passes/types.js';
import { createReactProject, REACT_SOURCE_ROOTS } from './project.js';

export interface ExtractRepoOptions {
  /** Absolute path to the repository root. */
  rootDir: string;
  /** Service name, which every id in the graph is prefixed with. */
  repo: string;
  service?: ServiceConfig;
  config?: FlowatlasConfig;
  /**
   * The directory of the configuration the service is read under, which the
   * stand-ins of P78 resolve against: the shape files it lists and the
   * repositories whose source may stand in for a package. Without it neither
   * is read.
   */
  configDir?: string;
  /**
   * The stand-ins the build worked out once for every repository (P82), read
   * instead of indexing the package sources and parsing the shape files again.
   * Without it, or when it does not answer for this service, they are worked
   * out here.
   */
  standInsOfBuild?: StandInsOfBuild;
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
  /**
   * The repository already parsed by {@link openProject}, when the caller opened
   * it to ask what the reading used as well as what it read.
   */
  project?: Project;
}

/** Parses a repository the way this reader needs it. */
export const openProject = (options: ExtractRepoOptions): Project => {
  const service = options.service ?? defaultService(options.repo, options.rootDir);
  const tsconfig = options.tsconfig ?? service.tsconfig;
  const standIns = standInsFor({
    config: options.config,
    service,
    configDir: options.configDir,
    ...(options.standInsOfBuild === undefined ? {} : { given: options.standInsOfBuild }),
  });
  // What the frameworks detected here would have written for the compiler (P240).
  const conventions = conventionsFor(options.registry, options.rootDir, options.config);
  return createReactProject({
    rootDir: options.rootDir,
    ...(conventions.length === 0 ? {} : { conventions }),
    ...(tsconfig === undefined ? {} : { tsconfig }),
    ...(service.readTestDirectories === undefined
      ? {}
      : { readTestDirectories: service.readTestDirectories }),
    ...(standIns === undefined ? {} : { standIns }),
  });
};

/**
 * The built-in steps, in the order they run.
 *
 * The order is not arbitrary. The screens get their nodes first, so that the
 * routes have something to write their address on; the routes settle which
 * components are screens before any other pass reads that fact; the calls are
 * drawn before the requests, so that a request attributed to a caller lands on
 * a node the walk has already created; a procedure asked for by its path is a
 * request of the same standing and goes beside them; an annotation's request
 * comes after both, so one the source already says is not said twice; and the ways in are read
 * last, because the edge from a component to a server action needs the
 * component to exist. What a function takes is written after all of them, once
 * every edge into it is drawn.
 */
export const BUILT_IN_PASSES: readonly ReactExtractorPass[] = [
  functionsPass,
  // Component files (P233) right after the functions, so a component is a
  // screen, with its routes, before anything else writes its node.
  sfcPass,
  routesPass,
  callsPass,
  // After the routes, so a screen's node has its address before a parent's
  // edge to it writes the node (P255).
  childrenPass,
  // After the routes and the children, so a navigation is matched against every screen's address (P276).
  navigationsPass,
  actionsPass,
  httpPass,
  // After the requests, so a `fetch` that sends an operation is one node (P232).
  graphqlPass,
  proceduresPass,
  markersPass,
  entriesPass,
  signaturesPass,
];

/**
 * What one framework of the browser is, to this reader (P233): the package
 * that gives it away, the formats its components are written in when they
 * are not TypeScript, and the directories of a repository that are another
 * half's - a full-stack framework's server code, which the server reader
 * reads.
 */
export interface BrowserReading {
  readonly declares: (pkg: PackageJson) => boolean;
  readonly formats?: readonly EmbeddedFormat[];
  /** Repo-relative directories that are not this framework's code. */
  readonly elsewhere?: (base: ExtractContext) => readonly string[];
}

export const REACT_READING: BrowserReading = { declares: declaresReact };

/** The component files of a repository, as the build lists them, made up for the checker. */
const componentFiles = (base: ExtractContext, formats: readonly EmbeddedFormat[]): EmbeddedFile[] => {
  const listed = listRepoSources(base.repoDir, base.service.readTestDirectories, {
    ...REACT_SOURCE_ROOTS,
    ...(base.service.tsconfig === undefined ? {} : { tsconfig: base.service.tsconfig }),
    companions: formats.map((format) => format.extension),
  });
  return addEmbeddedScripts(base.project, base.repoDir, listed, formats);
};

/**
 * Reads one repository into the shared builder.
 *
 * This is what the frontend adapter does when the registry picks it, so the
 * whole extractor is reachable through the context alone and nothing here needs
 * a privileged path into the tool.
 */
export const extractReact = (base: ExtractContext, options: FrontendExtractOptions = {}): void => extractBrowser(base, options, REACT_READING);

/** {@link extractReact} for any framework this reader reads, by its {@link BrowserReading}. */
export const extractBrowser = (base: ExtractContext, options: FrontendExtractOptions, reading: BrowserReading): void => {
  const embedded = reading.formats === undefined ? [] : componentFiles(base, reading.formats);
  const elsewhere = (reading.elsewhere?.(base) ?? []).map((dir) => `${toPosixPath(join(base.repoDir, dir))}/`);
  const supplied = suppliedWith(base.repoDir, reading.declares);
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
    reads: (file) => supplied(file) && !elsewhere.some((dir) => toPosixPath(file).startsWith(dir)),
    skip: (fn) => fn.name === COMPONENT_TAIL_NAME,
  });
  const ctx = createReactContext({
    base,
    functions,
    embedded,
    sources: countSources(base.project),
    ...(options.typesDepth === undefined ? {} : { maxDepth: options.typesDepth }),
  });

  // Which applications this service holds, asked of the entry adapters before
  // any pass runs. The request pass records which application a call site is
  // in, and the answer has to be the one the ids carry rather than a second
  // reading of the same directories (R132).
  recordApplications(base);

  for (const pass of BUILT_IN_PASSES) {
    if (options.noTypes === true && pass.name === 'types') continue;
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
  // Where the service's own server listens, where it has one (P250).
  const listen = listeningOf(base);
  // What its servers forward to another server, and the rules not read (P257).
  const proxy = proxiesOf(base);
  for (const row of proxy.rows) base.builder.addUnresolved(row);
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
      ...(listen.length === 0 ? {} : { [LISTEN_META]: listen }),
      ...(proxy.rules.length === 0 ? {} : { [PROXY_META]: proxy.rules }),
      ...(proxy.ownOrigin === true ? { [OWN_ORIGIN_META]: true } : {}),
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
  const service = options.service ?? defaultService(repo, rootDir);
  // The project's own extraction patterns, compiled into the descriptions
  // every reader below already reads (P121).
  const patterns = readPatterns({ config: options.config ?? parseConfig({}), service, configDir: options.configDir });
  const config = patterns.config;

  const project = options.project ?? openProject(options);
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
    // The tagged comments above declarations (P234), from the files this reading parsed.
    notesFrom: {
      text: projectText(project, rootDir),
      ...(config?.docs?.commentTags === undefined ? {} : { tags: config.docs.commentTags }),
    },
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
  reportStandIns(base);
  reportPatterns(base, patterns);

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

  // After the adapters, which make up the component files and the imports a
  // framework adds to them (P240), so the rows count those as well.
  reportConventions(base);
  closeStandIns(base);
  return builder.build();
};

export const defaultOutputPath = (rootDir: string, output = '.flowatlas'): string =>
  join(rootDir, output, 'graph.json');
