import { makeSymbolId, moduleFunctions, normalizeFilePath, type NamedFunction } from '@flowatlas/core';
import type { Project, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * What a function is, as far as the graph is concerned.
 *
 * This is the whole of what makes reading React different from reading the
 * other front end. Angular says what a class is with a decorator, so a reader
 * asks the source and is told. React says nothing at all: a component is a
 * function that returns markup, a hook is a function whose name begins with
 * `use`, and both of those are conventions the framework enforces at run time
 * and the compiler never checks. So the role is worked out from two facts that
 * are in the source — the shape of the name and whether markup is returned —
 * and both are needed, because either alone is wrong. `useMemo` imported from
 * the framework is not this repository's hook; `Button` that returns a string
 * is not a screen.
 */
export type ReactRole = 'component' | 'hook' | 'plain';

/** One function of this repository, with everything an id needs. */
export interface IndexedFunction {
  id: string;
  name: string;
  role: ReactRole;
  /** Repo-relative POSIX path. */
  file: string;
  line: number;
  fn: NamedFunction;
}

/** The convention the framework enforces: a hook is called `useSomething`. */
const HOOK_NAME = /^use[A-Z0-9_]/;

/** The other convention: a component's name is capitalised, so JSX can name it. */
const COMPONENT_NAME = /^[A-Z]/;

/**
 * Whether a function body ever hands back markup.
 *
 * Asked of the whole body rather than of the return statements alone, because
 * a component written with an early `if (loading) return <Spinner />` returns
 * markup from a branch, and a component written as
 * `const Row = () => <li />` returns it as its only expression. What is
 * deliberately not asked is whether the markup is the *last* thing: a function
 * that builds markup and passes it on is still a component as far as anything
 * this graph says about it goes.
 */
const returnsMarkup = (fn: NamedFunction): boolean => {
  const body = fn.body;
  if (
    Node.isJsxElement(body) ||
    Node.isJsxSelfClosingElement(body) ||
    Node.isJsxFragment(body)
  ) {
    return true;
  }
  let found = false;
  body.forEachDescendant((node, traversal) => {
    if (
      Node.isJsxElement(node) ||
      Node.isJsxSelfClosingElement(node) ||
      Node.isJsxFragment(node)
    ) {
      found = true;
      traversal.stop();
    }
  });
  return found;
};

const roleOf = (fn: NamedFunction): ReactRole => {
  if (HOOK_NAME.test(fn.name)) return 'hook';
  if (COMPONENT_NAME.test(fn.name) && returnsMarkup(fn)) return 'component';
  return 'plain';
};

/**
 * Every named function declared at the top of a module, with its role.
 *
 * Only the top level, for the same reason the core's own reader gives: a
 * function declared inside another one is reachable only through the one
 * around it, and nothing in another file can name it.
 */
export class ReactFunctionIndex {
  readonly #byDeclaration = new Map<NamedFunction['declaration'], IndexedFunction>();
  readonly #byId = new Map<string, IndexedFunction>();

  add(indexed: IndexedFunction): void {
    this.#byDeclaration.set(indexed.fn.declaration, indexed);
    this.#byId.set(indexed.id, indexed);
  }

  get(declaration: NamedFunction['declaration']): IndexedFunction | undefined {
    return this.#byDeclaration.get(declaration);
  }

  byId(id: string): IndexedFunction | undefined {
    return this.#byId.get(id);
  }

  all(): IterableIterator<IndexedFunction> {
    return this.#byId.values();
  }

  get size(): number {
    return this.#byId.size;
  }
}

export interface BuildFunctionIndexOptions {
  project: Project;
  repo: string;
  repoDir: string;
}

/**
 * Whether a source file belongs to the repository rather than to a package.
 *
 * The same rule every other reader uses, kept here because this index is built
 * from the project's whole file list rather than from a class index the core
 * already filtered.
 */
const isRepoFile = (sourceFile: SourceFile): boolean =>
  !sourceFile.getFilePath().includes('/node_modules/');

/**
 * A function declared with `export default`, which has no name of its own.
 *
 * The file-system routers make this the ordinary way to write a screen: a page
 * is `export default function Page()` or, just as often,
 * `export default function ()`. The second has nothing to point at, so it is
 * named after the file it is in, which is exactly how the framework names it
 * too.
 */
const defaultExportFunction = (sourceFile: SourceFile, file: string): NamedFunction | undefined => {
  for (const statement of sourceFile.getStatements()) {
    if (!Node.isFunctionDeclaration(statement)) continue;
    if (!statement.hasModifier(SyntaxKind.DefaultKeyword)) continue;
    if (statement.getName() !== undefined) continue;
    const body = statement.getBody();
    if (body === undefined) continue;
    const name = file.replace(/\.[jt]sx?$/, '').split('/').slice(-2).join('/');
    return { name, declaration: statement, body, line: statement.getStartLineNumber() };
  }
  return undefined;
};

export const buildReactFunctionIndex = (
  options: BuildFunctionIndexOptions,
): ReactFunctionIndex => {
  const { project, repo, repoDir } = options;
  const index = new ReactFunctionIndex();

  for (const sourceFile of project.getSourceFiles()) {
    if (!isRepoFile(sourceFile)) continue;
    const file = normalizeFilePath(sourceFile.getFilePath(), repoDir);
    const found = [...moduleFunctions(sourceFile)];
    const anonymous = defaultExportFunction(sourceFile, file);
    if (anonymous !== undefined) found.push(anonymous);

    for (const fn of found) {
      index.add({
        id: makeSymbolId(repo, file, fn.name),
        name: fn.name,
        role: roleOf(fn),
        file,
        line: fn.line,
        fn,
      });
    }
  }
  return index;
};
