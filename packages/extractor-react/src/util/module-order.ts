import { Node, SyntaxKind, type Node as TsNode, type Project, type SourceFile } from 'ts-morph';

/**
 * The order the modules of a project are evaluated in (P355). ES modules run
 * in a static order: from the entry point, each module's static imports
 * first, in the order they are written - depth first, each module once - and
 * then the module's own statements. So where every module that matters is
 * reached by static imports from one entry point, that order is known; where
 * one is reached only through a dynamic `import()`, or from more than one
 * entry point, it is not, and the reason is said.
 *
 * An entry point is a module of the repository no other imports statically,
 * that no `import()` loads, and that is no test, spec or story.
 */
export type ModuleOrder = { readonly order: ReadonlyMap<SourceFile, number> } | { readonly why: string };

/** What the repository's modules import, read once per project. */
interface ImportGraph {
  /** Each module's static imports, in the order they are written. */
  readonly imports: ReadonlyMap<SourceFile, readonly SourceFile[]>;
  /** The modules importing each statically. */
  readonly importers: ReadonlyMap<SourceFile, readonly SourceFile[]>;
  /** The modules some `import()` loads. */
  readonly loaded: ReadonlySet<SourceFile>;
}

const GRAPHS = new WeakMap<Project, ImportGraph>();

/** A file of the repository's own code a bundle starts from or reaches: not a library's, nor a test's, a spec's or a story's. */
const isOwnModule = (file: SourceFile): boolean => {
  const path = file.getFilePath();
  return !file.isDeclarationFile() && !path.includes('/node_modules/') && !/(?:\.(?:test|spec|stories)\.[cm]?[jt]sx?$)|\/__(?:tests|mocks)__\//.test(path);
};

/** The module an import names, where it is one of the repository's own. */
const ownModule = (file: SourceFile | undefined): SourceFile | undefined => (file !== undefined && isOwnModule(file) ? file : undefined);

/** The module `import('./x')` loads: the module the checker resolves the specifier to. */
const loadedBy = (call: TsNode): SourceFile | undefined => {
  if (!Node.isCallExpression(call) || call.getExpression().getKind() !== SyntaxKind.ImportKeyword) return undefined;
  const [specifier] = call.getArguments();
  const declaration = specifier?.getSymbol()?.getDeclarations()[0];
  return declaration !== undefined && Node.isSourceFile(declaration) ? ownModule(declaration) : undefined;
};

const graphOf = (project: Project): ImportGraph => {
  const known = GRAPHS.get(project);
  if (known !== undefined) return known;
  const imports = new Map<SourceFile, SourceFile[]>();
  const importers = new Map<SourceFile, SourceFile[]>();
  const loaded = new Set<SourceFile>();
  for (const file of project.getSourceFiles()) {
    if (!isOwnModule(file)) continue;
    const own: SourceFile[] = [];
    for (const statement of file.getStatements()) {
      // `import type` and `export type ... from` are erased: they load nothing.
      if (Node.isImportDeclaration(statement)) {
        const named = statement.getNamedImports();
        const typesOnly = statement.isTypeOnly() || (named.length > 0 && named.every((each) => each.isTypeOnly()) && statement.getDefaultImport() === undefined && statement.getNamespaceImport() === undefined);
        const target = typesOnly ? undefined : ownModule(statement.getModuleSpecifierSourceFile());
        if (target !== undefined) own.push(target);
      } else if (Node.isExportDeclaration(statement) && !statement.isTypeOnly()) {
        const target = ownModule(statement.getModuleSpecifierSourceFile());
        if (target !== undefined) own.push(target);
      }
    }
    imports.set(file, own);
    for (const target of own) importers.set(target, [...(importers.get(target) ?? []), file]);
    file.forEachDescendant((node) => {
      const target = Node.isCallExpression(node) ? loadedBy(node) : undefined;
      if (target !== undefined) loaded.add(target);
    });
  }
  const graph = { imports, importers, loaded };
  GRAPHS.set(project, graph);
  return graph;
};

/** A module as a reason names it: its file's name. */
const named = (file: SourceFile): string => file.getBaseName();

/**
 * The order the modules given are evaluated in, as places in the walk from
 * the one entry point reaching them all; or why it is not known.
 */
export const evaluationOrder = (modules: readonly SourceFile[]): ModuleOrder => {
  const [first] = modules;
  if (first === undefined) return { order: new Map() };
  const graph = graphOf(first.getProject());
  const entries = new Set<SourceFile>();
  for (const module of modules) {
    // The modules from which this one is reached by static imports and that nothing imports statically: entry points, or modules loaded by `import()`.
    const tops = new Set<SourceFile>();
    const seen = new Set<SourceFile>([module]);
    const queue = [module];
    while (queue.length > 0) {
      const at = queue.shift() as SourceFile;
      const above = graph.importers.get(at) ?? [];
      if (above.length === 0) tops.add(at);
      for (const each of above) {
        if (seen.has(each)) continue;
        seen.add(each);
        queue.push(each);
      }
    }
    const reaching = [...tops].filter((each) => !graph.loaded.has(each));
    if (reaching.length === 0) {
      const through = [...tops].find((each) => graph.loaded.has(each));
      if (through === module) return { why: `${named(module)} is loaded only by a dynamic import(), at a time not known` };
      if (through !== undefined) return { why: `${named(module)} is reached only through ${named(through)}, which a dynamic import() loads at a time not known` };
      return { why: `${named(module)} is imported by no entry point` };
    }
    for (const each of reaching) entries.add(each);
  }
  if (entries.size > 1) {
    const listed = [...entries].map(named).sort();
    return { why: `the modules adding to it are reached from ${entries.size} entry points (${listed.join(', ')}), whose order depends on which one is loaded` };
  }
  const [entry] = [...entries] as [SourceFile];
  // Depth first from the entry: each module's imports, in the order written, then the module itself.
  const order = new Map<SourceFile, number>();
  const visited = new Set<SourceFile>();
  const visit = (module: SourceFile): void => {
    const stack: Array<{ readonly module: SourceFile; next: number }> = [{ module, next: 0 }];
    visited.add(module);
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { readonly module: SourceFile; next: number };
      const imports = graph.imports.get(top.module) ?? [];
      const following = imports[top.next];
      top.next += 1;
      if (following === undefined) {
        stack.pop();
        order.set(top.module, order.size);
        continue;
      }
      if (visited.has(following)) continue;
      visited.add(following);
      stack.push({ module: following, next: 0 });
    }
  };
  visit(entry);
  return { order };
};
