import { mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  CONFIG_FILENAME,
  createLogger,
  DEFAULT_OUTPUT,
  findConfig,
  loadConfig,
  parseConfig,
  readPackageJson,
  SCHEMA_VERSION,
  type FlowatlasConfig,
  type RepoGraph,
  type ServiceConfig,
} from '@flowatlas/core';
import { angularFrontendAdapter, extractRepo as extractAngularRepo } from '@flowatlas/extractor-angular';
import {
  extractRepo,
  findTsconfig,
  globalFiles,
  importsOf,
  openRepo,
  repoFiles,
  type ExtractRepoOptions,
} from '@flowatlas/extractor-nestjs';
import type { Command } from 'commander';
import {
  emptyCache,
  hashConfig,
  hashFile,
  hashText,
  saveBuildCache,
  temporaryFor,
  stampFiles,
  type BuildCache,
} from '../build/cache.js';
import { adapterNames, createRegistry, EXTRA_PASSES, NESTJS_EXTRACTOR } from '../build/extractor.js';
import { BUILD_STAMP } from '../version.js';

export interface ExtractOptions {
  out?: string;
  /** Commander sets this to false for --no-types. */
  types?: boolean;
  typesDepth?: string | number;
  config?: string;
  tsconfig?: string;
  bootstrap?: string;
  json?: boolean;
  verbose?: boolean;
  /** Commander sets this to false for `--no-cache`. */
  cache?: boolean;
}

/** Name a repository is known by: the configured service if there is one. */
const resolveService = (
  rootDir: string,
  configPath: string | undefined,
): { repo: string; service?: ServiceConfig; config?: FlowatlasConfig } => {
  if (configPath !== undefined) {
    try {
      const loaded = loadConfig(configPath, { checkRepos: false });
      for (const service of loaded.config.services) {
        const candidate = isAbsolute(service.repo)
          ? service.repo
          : resolve(loaded.rootDir, service.repo);
        if (candidate === rootDir) {
          return { repo: service.name, service, config: loaded.config };
        }
      }
      const pkgName = readPackageJson(rootDir)?.name;
      return { repo: nameFrom(pkgName, rootDir), config: loaded.config };
    } catch {
      // A configuration that cannot be read is not a reason to refuse to
      // extract a single repository; fall through to naming it ourselves.
    }
  }
  return { repo: nameFrom(readPackageJson(rootDir)?.name, rootDir) };
};

const nameFrom = (packageName: string | undefined, rootDir: string): string => {
  const declared = typeof packageName === 'string' ? packageName.trim() : '';
  const withoutScope = declared.startsWith('@') ? (declared.split('/')[1] ?? '') : declared;
  return withoutScope !== '' ? withoutScope : basename(rootDir);
};

const countBy = <T>(items: readonly T[], key: (item: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

const asLines = (title: string, counts: Record<string, number>): string[] => {
  const entries = Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return [`${title}: none`];
  return [`${title}: ${entries.map(([name, n]) => `${name} ${n}`).join(', ')}`];
};

/** What was found, so a run is readable without opening the file. */
export const summarise = (graph: RepoGraph, outPath: string): string[] => {
  const count = (type: string): number => graph.nodes.filter((node) => node.type === type).length;
  return [
  `repo ${graph.repo}`,
  ...asLines('nodes', countBy(graph.nodes, (node) => node.type)),
  ...asLines(
    'entries',
    countBy(
      graph.nodes.filter((node) => node.type === 'entry'),
      (node) => node.kind ?? 'unknown',
    ),
  ),
  ...asLines('edges', countBy(graph.edges, (edge) => edge.type)),
  `leaves: db=${count('db_query')} cache=${count('cache_op')} http=${count('http_out')} config=${count('config_key')} tables=${count('table')}`,
  `brokers: channels=${count('channel')} producers=${count('producer')} consumers=${count('consumer')} markers=${graph.edges.filter((edge) => edge.confidence === 'marker').length}`,
  `types: ${Object.keys(graph.types).length} (external ${Object.values(graph.types).filter((entry) => entry.kind === 'external').length})`,
  `unresolved: ${graph.unresolved.length}${graph.unresolved.length > 0 ? ` (see ${outPath}#unresolved)` : ''}`,
  ];
};

export const runExtract = async (
  repoPath: string,
  options: ExtractOptions = {},
): Promise<{ graph: RepoGraph; outPath: string }> => {
  const rootDir = resolve(repoPath);
  // A repository that carries its own configuration is described by it. Only
  // when it does not do we fall back to the one covering the whole project.
  const ownConfig = join(rootDir, CONFIG_FILENAME);
  const configPath =
    options.config ?? (existsSync(ownConfig) ? ownConfig : findConfig(process.cwd()));
  const { repo, service, config } = resolveService(rootDir, configPath);

  const registry = createRegistry();
  const extractOptions: ExtractRepoOptions = {
    rootDir,
    repo,
    ...(service === undefined ? {} : { service }),
    ...(config === undefined ? {} : { config }),
    registry,
    extraPasses: EXTRA_PASSES,
    ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig }),
    ...(options.types === false ? { noTypes: true } : {}),
    ...(options.typesDepth === undefined ? {} : { typesDepth: Number(options.typesDepth) }),
    logger: createLogger(options.verbose === true ? 'debug' : 'warn'),
  };

  // The configured type says which extractor reads a repository. Without a
  // configuration there is only the manifest, and a frontend adapter that
  // recognises it is as good an answer as the server-side default.
  const frontend =
    service === undefined
      ? angularFrontendAdapter.detect(readPackageJson(rootDir) ?? {})
      : service.type === 'angular';

  // A server repository is opened here rather than inside the extractor, so the
  // parsed project can also answer what the build cache needs to know: which
  // files there are, what each imports, and which of them are global. The
  // frontend reader has no such session yet, so it caches nothing.
  const warm = frontend ? undefined : openRepo(extractOptions);
  const graph =
    warm === undefined
      ? await extractAngularRepo(extractOptions)
      : await extractRepo({ ...extractOptions, project: warm.project });

  const outDir = options.out ?? config?.output ?? DEFAULT_OUTPUT;
  const outPath = isAbsolute(outDir)
    ? join(outDir, 'graph.json')
    : join(rootDir, outDir, 'graph.json');
  // Written through a temporary file and renamed, so a reader watching this
  // path never sees half a graph. The temporary is named after the process
  // writing it, so two runs on one repository do not take each other's.
  await mkdir(dirname(outPath), { recursive: true });
  const temporary = temporaryFor(outPath);
  await writeFile(temporary, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  await rename(temporary, outPath);

  if (options.cache !== false && warm !== undefined) {
    saveBuildCache(
      join(dirname(outPath), 'cache.json'),
      repoCacheOf({ warm, graph, outPath, repo, rootDir, registry, ...(service === undefined ? {} : { service }), ...(config === undefined ? {} : { config }), ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig }) }),
    );
  }

  return { graph, outPath };
};

interface RepoCacheOptions {
  warm: ReturnType<typeof openRepo>;
  graph: RepoGraph;
  outPath: string;
  repo: string;
  rootDir: string;
  registry: ReturnType<typeof createRegistry>;
  service?: ServiceConfig;
  config?: FlowatlasConfig;
  tsconfig?: string;
}

/**
 * What this repository looked like, for the next build to compare against.
 *
 * The same shape a whole-project build writes, with one entry, so that a
 * repository read on its own and a repository read as part of a project leave
 * the build with the same thing to compare against.
 */
const repoCacheOf = (options: RepoCacheOptions): BuildCache => {
  const { warm, graph, outPath, repo, rootDir, registry } = options;
  const config = options.config ?? parseConfig({});
  const cache = emptyCache(
    {
      schemaVersion: SCHEMA_VERSION,
      flowatlasVersion: BUILD_STAMP,
      extractors: { [NESTJS_EXTRACTOR]: BUILD_STAMP },
      configHash: hashConfig(config),
    },
    graph.generatedAt,
  );

  const imports = importsOf(warm);
  const files = stampFiles(rootDir, repoFiles(warm), undefined, {});
  for (const [file, stamp] of Object.entries(files)) stamp.deps = imports[file] ?? [];

  const tsconfig = findTsconfig(rootDir, options.tsconfig ?? options.service?.tsconfig);
  cache.repos[repo] = {
    repo: options.service?.repo ?? rootDir,
    extractor: NESTJS_EXTRACTOR,
    adapters: adapterNames(registry, readPackageJson(rootDir) ?? {}, config),
    tsconfigHash: tsconfig === undefined ? hashText('') : hashFile(tsconfig),
    packageJsonHash: hashFile(join(rootDir, 'package.json')),
    globalFiles: globalFiles(warm),
    files,
    graphPath: outPath,
    graphHash: hashFile(outPath),
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      types: Object.keys(graph.types).length,
      unresolved: graph.unresolved.length,
    },
  };
  return cache;
};

export const registerExtract = (program: Command): void => {
  program
    .command('extract')
    .argument('<repo>', 'path to the repository to analyse')
    .description('build the graph of one repository')
    .option('--out <dir>', `output directory (default: ${DEFAULT_OUTPUT})`)
    .option('--config <file>', 'configuration file to take the service name from')
    .option('--tsconfig <file>', 'tsconfig to use instead of the one found')
    .option('--bootstrap <file>', 'application entry file, when it is not src/main.ts')
    .option('--no-types', 'skip type collection, leaving the registry empty')
    .option('--no-cache', 'do not record file hashes beside the graph')
    .option('--types-depth <n>', 'how deep anonymous shapes are written out')
    .option('--json', 'print the summary as JSON')
    .option('-v, --verbose', 'log each pass')
    .action(async (repoPath: string, options: ExtractOptions) => {
      const { graph, outPath } = await runExtract(repoPath, options);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify({ out: outPath, ...counts(graph) }, null, 2)}\n`);
        return;
      }
      process.stderr.write(`${summarise(graph, outPath).join('\n')}\n`);
      process.stdout.write(`${outPath}\n`);
    });
};

const counts = (graph: RepoGraph) => ({
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  types: Object.keys(graph.types).length,
  unresolved: graph.unresolved.length,
});
