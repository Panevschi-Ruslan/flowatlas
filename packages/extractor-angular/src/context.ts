import {
  DiMap,
  externalFilePath,
  fileOf,
  lineOf,
  makeSymbolId,
  TypeCollector,
  type ClassMethod,
  type ExtractContext,
  type GraphNode,
  type NodeType,
  type Unresolved,
} from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';
import type { AngularClassIndex, AngularRole, IndexedClass } from './index-classes.js';

export interface AngularStats {
  files: number;
  classes: number;
  /** Templates read, whether written inline or in a file of their own. */
  templates: number;
  /**
   * Calls whose receiver is declared in an installed package, counted per
   * package. They are not edges and not unresolved rows: most of them are the
   * framework doing its own work, and counting them keeps that visible.
   */
  skippedExternalCalls: Record<string, number>;
}

/** Node type and `kind` implied by a class's role. */
const NODE_SHAPE: Record<AngularRole, { type: NodeType; kind?: string }> = {
  component: { type: 'ui_component', kind: 'standalone' },
  module: { type: 'module', kind: 'ngmodule' },
  injectable: { type: 'provider', kind: 'injectable' },
  plain: { type: 'provider', kind: 'injectable' },
};

/** Which module declares each component, filled by the modules pass. */
export interface ModuleMembership {
  /** Name of the module a class is declared in, when one declares it. */
  moduleOf(declaration: ClassDeclaration): string | undefined;
  set(declaration: ClassDeclaration, moduleName: string): void;
}

/** One route the router is configured with, filled by the modules pass. */
export interface RouteEntry {
  /** Normalised path, absolute from the root of the configuration it was read in. */
  path: string;
  /** Component the route shows, when it names a class of this repository. */
  component?: ClassDeclaration;
}

/**
 * Everything a pass is given.
 *
 * Extends the shared extraction context with the indexes this extractor builds,
 * so a pass reads what earlier passes discovered without any pass having to know
 * which other passes exist.
 */
export interface AngularExtractContext extends ExtractContext {
  readonly classes: AngularClassIndex;
  readonly di: DiMap;
  readonly stats: AngularStats;
  readonly modules: ModuleMembership;
  /** Routes found anywhere in the repository, filled by the modules pass. */
  readonly routes: RouteEntry[];
  /** The type registry being built. */
  readonly types: TypeCollector;

  /** Repo-relative POSIX path of whatever declared this node. */
  fileOf(node: { getSourceFile(): { getFilePath(): string } }): string;

  classIdOf(declaration: ClassDeclaration): string | undefined;
  methodIdOf(declaration: ClassMethod): string | undefined;

  /** Creates the node for a class of this repository, with the type its role implies. */
  ensureClassNode(declaration: ClassDeclaration, meta?: Record<string, unknown>): GraphNode | undefined;
  ensureMethodNode(declaration: ClassMethod): GraphNode | undefined;
  /** Creates the node for a class from an installed package. */
  ensureExternalClassNode(options: {
    typeName: string;
    package: string;
    meta?: Record<string, unknown>;
  }): GraphNode;

  report(row: Unresolved): void;
  countExternalCall(pkg: string): void;
}

export interface CreateContextOptions {
  base: ExtractContext;
  classes: AngularClassIndex;
  /** How deep anonymous shapes are written out. Defaults to the configured value. */
  maxDepth?: number;
}

export const createAngularContext = (options: CreateContextOptions): AngularExtractContext => {
  const { base, classes } = options;
  const { builder, repo, repoDir } = base;
  const di = new DiMap();
  const membership = new Map<ClassDeclaration, string>();
  const stats: AngularStats = {
    files: 0,
    classes: classes.size,
    templates: 0,
    skippedExternalCalls: {},
  };

  const collector = new TypeCollector({
    builder,
    repo,
    repoDir,
    sharedPackages: base.config.sharedPackages,
    maxDepth: options.maxDepth ?? base.config.types.maxDepth,
    report: (row) => builder.addUnresolved(row),
  });

  /**
   * The node a class becomes.
   *
   * Whether a component is standalone is read from the module that declares it
   * rather than from its own `standalone` flag: the framework refuses to declare
   * a standalone component, so a module listing it settles the question, and the
   * flag has meant different things by default across versions. That is why no
   * component node can be written before the modules are read.
   */
  const nodeOf = (indexed: IndexedClass, extra?: Record<string, unknown>): GraphNode => {
    const shape = NODE_SHAPE[indexed.role];
    const moduleName = membership.get(indexed.declaration);
    const standalone = moduleName === undefined;
    const meta: Record<string, unknown> = {
      ...(indexed.role === 'component' ? { standalone } : {}),
      ...(moduleName === undefined ? {} : { module: moduleName }),
      ...extra,
    };
    return builder.addNode({
      id: indexed.id,
      type: shape.type,
      label: indexed.name,
      repo,
      file: indexed.file,
      line: indexed.line,
      ...(indexed.role === 'component'
        ? { kind: standalone ? 'standalone' : 'declared' }
        : shape.kind === undefined
          ? {}
          : { kind: shape.kind }),
      ...(Object.keys(meta).length === 0 ? {} : { meta }),
    });
  };

  return {
    ...base,
    classes,
    di,
    stats,
    routes: [],
    types: collector,

    modules: {
      moduleOf: (declaration) => membership.get(declaration),
      set: (declaration, moduleName) => {
        membership.set(declaration, moduleName);
      },
    },

    fileOf: (node) => fileOf(node as never, repoDir),

    classIdOf: (declaration) => classes.get(declaration)?.id,

    methodIdOf: (declaration) => {
      const owner = declaration.getParent();
      const indexed = classes.get(owner as ClassDeclaration);
      if (indexed === undefined) return undefined;
      return makeSymbolId(repo, indexed.file, indexed.name, declaration.getName());
    },

    ensureClassNode: (declaration, meta) => {
      const indexed = classes.get(declaration);
      return indexed === undefined ? undefined : nodeOf(indexed, meta);
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

    ensureExternalClassNode: ({ typeName, package: pkg, meta }) => {
      const file = externalFilePath(pkg);
      return builder.addNode({
        id: makeSymbolId(repo, file, typeName),
        type: 'provider',
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
