import { join } from 'node:path';
import {
  className,
  DiMap,
  externalFilePath,
  fileOf,
  lineOf,
  makeSymbolId,
  moduleFunctions,
  TypeCollector,
  type ClassMethod,
  type ExtractContext,
  type GraphNode,
  type NamedFunction,
  type NodeType,
  type Unresolved,
} from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';
import { ClassIndex, type ClassRole, type IndexedClass, type NestClassIndex } from './index-classes.js';
import { ModuleIndex } from './modules-index.js';
import type { BootstrapInfo } from './bootstrap.js';
import { emptyCollection, type EntryRecord, type WrappingCollection } from './wrapping/types.js';
import { createNestFieldMetaReader } from './types/field-meta-reader.js';

export interface NestStats {
  files: number;
  classes: number;
  /**
   * Calls whose receiver is declared in an installed package, counted per
   * package. They are not edges and not unresolved rows: they are the leaves a
   * later phase turns into data, cache and outgoing-call nodes. Counting them
   * keeps that decision visible instead of silent.
   */
  skippedExternalCalls: Record<string, number>;
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
}

export interface CreateContextOptions {
  base: ExtractContext;
  classes: NestClassIndex;
  bootstrap: BootstrapInfo;
  /** How deep anonymous shapes are written out. Defaults to the configured value. */
  maxDepth?: number;
}

export const createNestContext = (options: CreateContextOptions): NestExtractContext => {
  const { base, classes, bootstrap } = options;
  const { builder, repo, repoDir } = base;
  const modules = new ModuleIndex();
  const di = new DiMap();
  const stats: NestStats = {
    files: 0,
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
      return builder.addNode({
        id: makeSymbolId(repo, file, fn.name),
        type: 'function',
        label: fn.name,
        repo,
        file,
        line: fn.line,
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
      stats.skippedExternalCalls[pkg] = (stats.skippedExternalCalls[pkg] ?? 0) + 1;
    },
  };
};

export { className, ClassIndex, DiMap, ModuleIndex };
export type { ClassRole, IndexedClass };
