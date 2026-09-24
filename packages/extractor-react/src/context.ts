import {
  fileOf,
  TypeCollector,
  type ExtractContext,
  type GraphNode,
  type NamedFunction,
  type NodeType,
  type Unresolved,
} from '@flowatlas/core';
import type { IndexedFunction, ReactFunctionIndex, ReactRole } from './index-functions.js';

export interface ReactStats {
  files: number;
  /** Functions declared at the top of a module, whatever their role. */
  functions: number;
  components: number;
  hooks: number;
  /**
   * Calls whose receiver is declared in an installed package, counted per
   * package. They are not edges and not unresolved rows: most of them are the
   * framework doing its own work, and counting them keeps that visible.
   */
  skippedExternalCalls: Record<string, number>;
}

/**
 * Node type and `kind` implied by a function's role.
 *
 * A table rather than branches, so that a role added here is a row and not an
 * edit in three passes. A component is the screen the whole front-end reading
 * aims at, and so is the one role with a node type of its own; a hook and a
 * plain module function are both `function`, because the difference between
 * them is a convention about where they may be called and not a difference in
 * what they are.
 */
const NODE_SHAPE: Record<ReactRole, { type: NodeType; kind?: string }> = {
  component: { type: 'ui_component', kind: 'function' },
  hook: { type: 'function', kind: 'hook' },
  plain: { type: 'function' },
};

/**
 * Everything a pass is given.
 *
 * Extends the shared extraction context with the one index this extractor
 * builds, so a pass reads what earlier passes discovered without any pass
 * having to know which other passes exist.
 */
export interface ReactExtractContext extends ExtractContext {
  readonly functions: ReactFunctionIndex;
  readonly stats: ReactStats;
  /** The type registry being built. */
  readonly types: TypeCollector;

  /** Repo-relative POSIX path of whatever declared this node. */
  fileOf(node: { getSourceFile(): { getFilePath(): string } }): string;

  /** The indexed function a declaration stands for, when this repository declares it. */
  indexedOf(fn: NamedFunction): IndexedFunction | undefined;
  functionIdOf(fn: NamedFunction): string | undefined;
  /** Creates the node for a function of this repository, with the type its role implies. */
  ensureFunctionNode(fn: NamedFunction, meta?: Record<string, unknown>): GraphNode | undefined;

  report(row: Unresolved): void;
  countExternalCall(pkg: string): void;
}

export interface CreateContextOptions {
  base: ExtractContext;
  functions: ReactFunctionIndex;
  /** How deep anonymous shapes are written out. Defaults to the configured value. */
  maxDepth?: number;
}

export const createReactContext = (options: CreateContextOptions): ReactExtractContext => {
  const { base, functions } = options;
  const { builder, repo, repoDir } = base;

  const stats: ReactStats = {
    files: 0,
    functions: functions.size,
    components: 0,
    hooks: 0,
    skippedExternalCalls: {},
  };
  for (const indexed of functions.all()) {
    if (indexed.role === 'component') stats.components += 1;
    if (indexed.role === 'hook') stats.hooks += 1;
  }

  const collector = new TypeCollector({
    builder,
    repo,
    repoDir,
    sharedPackages: base.config.sharedPackages,
    maxDepth: options.maxDepth ?? base.config.types.maxDepth,
    report: (row) => builder.addUnresolved(row),
  });

  const nodeOf = (indexed: IndexedFunction, extra?: Record<string, unknown>): GraphNode => {
    const shape = NODE_SHAPE[indexed.role];
    return builder.addNode({
      id: indexed.id,
      type: shape.type,
      label: indexed.name,
      repo,
      file: indexed.file,
      line: indexed.line,
      ...(shape.kind === undefined ? {} : { kind: shape.kind }),
      ...(extra === undefined || Object.keys(extra).length === 0 ? {} : { meta: extra }),
    });
  };

  return {
    ...base,
    functions,
    stats,
    types: collector,

    fileOf: (node) => fileOf(node as never, repoDir),

    indexedOf: (fn) => functions.get(fn.declaration),
    functionIdOf: (fn) => functions.get(fn.declaration)?.id,

    ensureFunctionNode: (fn, meta) => {
      const indexed = functions.get(fn.declaration);
      return indexed === undefined ? undefined : nodeOf(indexed, meta);
    },

    report: (row) => {
      builder.addUnresolved(row);
    },

    countExternalCall: (pkg) => {
      stats.skippedExternalCalls[pkg] = (stats.skippedExternalCalls[pkg] ?? 0) + 1;
    },
  };
};
