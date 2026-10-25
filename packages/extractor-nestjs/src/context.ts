import { join } from 'node:path';
import {
  className,
  DiMap,
  externalFilePath,
  fileOf,
  jsDocCallsMarkers,
  lineOf,
  makeSymbolId,
  moduleFunctions,
  TypeCollector,
  type BoundedBy,
  type ClassMethod,
  type ExtractContext,
  type GraphNode,
  type NamedFunction,
  type NodeType,
  type RepoStats,
  type SourceCounts,
  type Unresolved,
} from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';
import { ClassIndex, type ClassRole, type IndexedClass, type NestClassIndex } from './index-classes.js';
import { ModuleIndex } from './modules-index.js';
import type { BootstrapInfo } from './bootstrap.js';
import { emptyCollection, type EntryRecord, type WrappingCollection } from './wrapping/types.js';
import { createNestFieldMetaReader } from './types/field-meta-reader.js';

/**
 * What this reader counted, on top of what every reader counts.
 *
 * The shared part is {@link RepoStats}: the files opened, the files read and
 * the difference, plus the tally of calls into installed packages. Only the
 * classes are this reader's own, and the calls the data reader left to an edge.
 */
export interface NestStats extends RepoStats {
  classes: number;
  /**
   * Calls that only looked like data access by the receiver's name and that
   * the graph already draws as a `static` call into a method of this
   * repository, where the queries are read (P88). Not rows: the edge explains
   * them. Written only when there were any.
   */
  receiversExplainedByEdge?: number;
  /**
   * Loops that run a query per item and are bounded on purpose, by why (P89):
   * chunks, pages, cursors, retries, literal lists, batch calls, migrations.
   * Not rows: counted so the loops set aside are seen. Written only when there
   * were any, each reason only when it has a loop.
   */
  loopsBounded?: Partial<Record<BoundedBy, number>>;
}

/** Node type and `kind` implied by a class's role. */
const NODE_SHAPE: Record<ClassRole, { type: NodeType; kind?: string }> = {
  module: { type: 'module', kind: 'static' },
  controller: { type: 'provider', kind: 'controller' },
  injectable: { type: 'provider', kind: 'injectable' },
  guard: { type: 'guard' },
  interceptor: { type: 'interceptor' },
  pipe: { type: 'pipe' },
  middleware: { type: 'middleware', kind: 'class' },
  plain: { type: 'provider', kind: 'injectable' },
};

/**
 * Everything a pass is given.
 *
 * Extends the shared extraction context with the indexes this extractor builds,
 * so a pass reads what earlier passes discovered without any pass having to know
 * which other passes exist.
 */
export interface NestExtractContext extends ExtractContext {
  readonly classes: NestClassIndex;
  readonly modules: ModuleIndex;
  readonly di: DiMap;
  readonly stats: NestStats;
  /** What the application entry file said, when there was one. */
  readonly bootstrap: BootstrapInfo;
  /** Wrappers found anywhere, filled by the collection pass. */
  readonly wrapping: WrappingCollection;
  /** Entry points found, filled by the entries pass. */
  readonly entries: EntryRecord[];
  /**
   * Functions an entry point names, filled by the entries pass.
   *
   * The call walk starts from these and follows what they reach. Every other
   * module-level function in a repository is not a hop in any flow this tool was
   * asked about, and making them all nodes would be a much larger change.
   */
  readonly handlerFunctions: NamedFunction[];
  /**
   * Every function this reader made a node of, by that node's id, so that what
   * it takes can be read off its declaration once the walk is done.
   */
  readonly drawnFunctions: ReadonlyMap<string, NamedFunction>;
  /** The type registry being built. */
  readonly types: TypeCollector;

  /** Repo-relative POSIX path of whatever declared this node. */
  fileOf(node: { getSourceFile(): { getFilePath(): string } }): string;

  classIdOf(declaration: ClassDeclaration): string | undefined;
  methodIdOf(declaration: ClassMethod): string | undefined;
  functionIdOf(fn: NamedFunction): string;

  /**
   * The module-level function of that name, in the file at that repo-relative
   * path. Undefined when the file is not part of this repository, or declares no
   * such function.
   */
  functionAt(file: string, name: string): NamedFunction | undefined;

  /** Creates the node for a class of this repository, with the type its role implies. */
  ensureClassNode(declaration: ClassDeclaration): GraphNode | undefined;
  ensureMethodNode(declaration: ClassMethod): GraphNode | undefined;
  ensureFunctionNode(fn: NamedFunction): GraphNode;
  /** Creates the node for a class from an installed package. */
  ensureExternalClassNode(options: {
    typeName: string;
    package: string;
    role?: ClassRole;
    meta?: Record<string, unknown>;
  }): GraphNode;

  report(row: Unresolved): void;
  countExternalCall(pkg: string): void;
  /** Counts a call the data reader did not list because an edge explains it (P88). */
  countExplainedByEdge(): void;
}

export interface CreateContextOptions {
  base: ExtractContext;
  classes: NestClassIndex;
  bootstrap: BootstrapInfo;
  /** What the parser made of the repository's sources, counted before any pass ran. */
  sources: SourceCounts;
  /** How deep anonymous shapes are written out. Defaults to the configured value. */
  maxDepth?: number;
}

export const createNestContext = (options: CreateContextOptions): NestExtractContext => {
  const { base, classes, bootstrap, sources } = options;
  const { builder, repo, repoDir } = base;
  const modules = new ModuleIndex();
  const di = new DiMap();
  const stats: NestStats = {
    ...sources,
    classes: classes.size,
    skippedExternalCalls: {},
  };

  // The reader needs the collector to turn a class named in an annotation into
  // a reference, and the collector needs the reader. The closure ties the knot.
  let collector: TypeCollector;
  const fieldMetaReader = createNestFieldMetaReader({
    resolveTypeRef: (node) => collector?.collectType(node.getType(), node),
  });
  collector = new TypeCollector({
    builder,
    repo,
    repoDir,
    sharedPackages: base.config.sharedPackages,
    maxDepth: options.maxDepth ?? base.config.types.maxDepth,
    fieldMetaReaders: [fieldMetaReader],
    report: (row) => builder.addUnresolved(row),
  });

  const nodeOf = (indexed: IndexedClass): GraphNode => {
    const shape = NODE_SHAPE[indexed.role];
    const moduleName = modules.moduleOf(indexed.declaration);
    return builder.addNode({
      id: indexed.id,
      type: shape.type,
      label: indexed.name,
      repo,
      file: indexed.file,
      line: indexed.line,
      ...(shape.kind === undefined ? {} : { kind: shape.kind }),
      ...(moduleName === undefined ? {} : { meta: { module: moduleName } }),
    });
  };

  // Built the first time a file is asked about, because most repositories are
  // read without any entry point naming a free function at all.
  const functionsByFile = new Map<string, Map<string, NamedFunction>>();
  const functionsOf = (file: string): Map<string, NamedFunction> | undefined => {
    const cached = functionsByFile.get(file);
    if (cached !== undefined) return cached;
    const sourceFile = base.project.getSourceFile(join(repoDir, file));
    if (sourceFile === undefined) return undefined;
    const found = new Map(moduleFunctions(sourceFile).map((fn) => [fn.name, fn]));
    functionsByFile.set(file, found);
    return found;
  };

  const drawnFunctions = new Map<string, NamedFunction>();

  const fileOfFunction = (fn: NamedFunction): string =>
    fileOf(fn.declaration as never, repoDir);

  return {
    ...base,
    classes,
    modules,
    di,
    stats,
    bootstrap,
    wrapping: emptyCollection(),
    entries: [],
    handlerFunctions: [],
    drawnFunctions,
    types: collector,

    fileOf: (node) => fileOf(node as never, repoDir),

    classIdOf: (declaration) => classes.get(declaration)?.id,

    functionIdOf: (fn) => makeSymbolId(repo, fileOfFunction(fn), fn.name),

    functionAt: (file, name) => functionsOf(file)?.get(name),

    methodIdOf: (declaration) => {
      const owner = declaration.getParent();
      const indexed = classes.get(owner as ClassDeclaration);
      if (indexed === undefined) return undefined;
      return makeSymbolId(repo, indexed.file, indexed.name, declaration.getName());
    },

    ensureClassNode: (declaration) => {
      const indexed = classes.get(declaration);
      return indexed === undefined ? undefined : nodeOf(indexed);
    },

    ensureMethodNode: (declaration) => {
      const owner = declaration.getParent() as ClassDeclaration;
      const indexed = classes.get(owner);
      if (indexed === undefined) return undefined;
      nodeOf(indexed);
      const name = declaration.getName();
      return builder.addNode({
        id: makeSymbolId(repo, indexed.file, indexed.name, name),
        type: 'method',
        label: `${indexed.name}.${name}`,
        repo,
        file: indexed.file,
        line: lineOf(declaration),
      });
    },

    ensureFunctionNode: (fn) => {
      const file = fileOfFunction(fn);
      const id = makeSymbolId(repo, file, fn.name);
      // A function takes no decorator, so the one annotation it can carry is
      // the JSDoc one, read once, the first time the function is drawn (P91).
      const markers = drawnFunctions.has(id) ? [] : jsDocCallsMarkers(fn.declaration);
      if (!drawnFunctions.has(id)) drawnFunctions.set(id, fn);
      return builder.addNode({
        id,
        type: 'function',
        label: fn.name,
        repo,
        file,
        line: fn.line,
        ...(markers.length === 0 ? {} : { meta: { markers } }),
      });
    },

    ensureExternalClassNode: ({ typeName, package: pkg, role = 'injectable', meta }) => {
      const shape = NODE_SHAPE[role];
      const file = externalFilePath(pkg);
      return builder.addNode({
        id: makeSymbolId(repo, file, typeName),
        type: shape.type,
        label: typeName,
        repo,
        file,
        kind: 'external',
        meta: { package: pkg, external: true, ...meta },
      });
    },

    report: (row) => {
      builder.addUnresolved(row);
    },

    countExternalCall: (pkg) => {
      stats.skippedExternalCalls[pkg] = (Object.hasOwn(stats.skippedExternalCalls, pkg) ? (stats.skippedExternalCalls[pkg] ?? 0) : 0) + 1;
    },

    countExplainedByEdge: () => {
      stats.receiversExplainedByEdge = (stats.receiversExplainedByEdge ?? 0) + 1;
    },
  };
};

export { className, ClassIndex, DiMap, ModuleIndex };
export type { ClassRole, IndexedClass };
