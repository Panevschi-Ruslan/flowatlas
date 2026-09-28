import { builtExportFunctions } from '@flowatlas/adapters-entry';
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

export interface ReactFunctionIndexOptions {
  /** Service name, which every id in the graph is prefixed with. */
  repo: string;
  /** Absolute path of the repository root, which the paths in ids are relative to. */
  repoDir: string;
}

/**
 * What this repository's functions are, however a pass wants to ask.
 *
 * Filled from the top level of every module, for the same reason the core's own
 * reader gives: a function declared inside another one is reachable only
 * through the one around it, and nothing in another file can name it. The one
 * exception is a function a pass hands back afterwards, which `adopt` takes,
 * because a registration is the other way a function is reachable.
 *
 * Three questions are asked of it and each has its own map: a declaration, when
 * a walk is standing on one; an id, when an adapter named a function; and a
 * position, when what is in hand is a way in rather than a name.
 */
export class ReactFunctionIndex {
  readonly #byDeclaration = new Map<NamedFunction['declaration'], IndexedFunction>();
  readonly #byId = new Map<string, IndexedFunction>();
  readonly #byPosition = new Map<string, IndexedFunction>();
  readonly #repo: string;
  readonly #repoDir: string;

  constructor(options: ReactFunctionIndexOptions) {
    this.#repo = options.repo;
    this.#repoDir = options.repoDir;
  }

  add(indexed: IndexedFunction): void {
    this.#byDeclaration.set(indexed.fn.declaration, indexed);
    this.#byId.set(indexed.id, indexed);
    // Where a declaration starts is the one thing an adapter and this index
    // compute the same way from the same node, which is what `at` leans on.
    // Two declarations can share a line — `export const a = f(), b = g()` — and
    // the first is kept, because nothing distinguishes them afterwards and
    // overwriting would make which one is found depend on the walk order.
    const position = `${indexed.file}:${indexed.line}`;
    if (!this.#byPosition.has(position)) this.#byPosition.set(position, indexed);
  }

  /**
   * The function declared at a position, when this repository declares one.
   *
   * Asked by a pass that has an entry point in its hand rather than a name. An
   * adapter records where the declaration it read starts, and that is the line
   * this index recorded for the same declaration, so the position joins the two
   * without either side having to agree on a vocabulary of names.
   */
  at(file: string, line: number | undefined): IndexedFunction | undefined {
    return line === undefined ? undefined : this.#byPosition.get(`${file}:${line}`);
  }

  /**
   * Indexes a function a pass found that the module walk could not see.
   *
   * A function written inside a registration is reachable only through the
   * registration, so the walk over module declarations is right to leave it
   * out; but once a pass holds one, everything downstream — the node, the id,
   * the edges — asks this index for it. Adopting it here rather than letting
   * the pass build an id keeps one answer to what a function's id is.
   */
  adopt(fn: NamedFunction): IndexedFunction {
    const existing = this.#byDeclaration.get(fn.declaration);
    if (existing !== undefined) return existing;
    const file = normalizeFilePath(fn.declaration.getSourceFile().getFilePath(), this.#repoDir);
    const indexed: IndexedFunction = {
      id: makeSymbolId(this.#repo, file, fn.name),
      name: fn.name,
      role: roleOf(fn),
      file,
      line: fn.line,
      fn,
    };
    this.add(indexed);
    return indexed;
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
  /**
   * Which of the project's files are this framework's code, by absolute path.
   * Every file when absent; see `extractReact` for the rule that fills it.
   */
  reads?: (file: string) => boolean;
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

/**
 * The exports of a module whose values a call built, as functions of their own.
 *
 * `moduleFunctions` answers what a module *declares*, and by that reading
 * `export const archiveOrder = client.schema(…).action(fn)` declares a value
 * and no function at all. That is the right answer for the other readers, who
 * would be guessing about a value whose type nobody checked, and it is the
 * wrong answer here: this is how most of the React ecosystem writes a server
 * action, a route guard or a wrapped screen, and every caller of one writes the
 * exported name. A name that is called and has nothing behind it is a hole in
 * the middle of the graph, so the guess is worth making in the reader that
 * pays for it (R61).
 *
 * What counts as such an export, and what its declaration and its body are, is
 * `builtExportFunctions`, which lives beside the adapters rather than here. The
 * reason is R72: the adapter that reads a route file has to name the code
 * behind a verb export, and the node it names is the one this index makes, so
 * a second rule written here would be a rule that could disagree with it. The
 * decision that the body is the whole initializer — which is why the export
 * reaches whatever the function written inside the call reaches — is recorded
 * there with the rest of the reading, as is the decision to ask the module's
 * export table what it exports rather than to look for an `export` keyword on
 * a declaration. That second decision is why a value bound to a local name and
 * re-exported under another — `const handler = NextAuth(opts); export { handler
 * as GET, handler as POST }` — now has a node here, and it is what lets the
 * adapter reading that route point at one: both sides ask the same table, so
 * neither can claim a function the other does not have (R74).
 */

export const buildReactFunctionIndex = (
  options: BuildFunctionIndexOptions,
): ReactFunctionIndex => {
  const { project, repo, repoDir, reads = () => true } = options;
  const index = new ReactFunctionIndex({ repo, repoDir });

  for (const sourceFile of project.getSourceFiles()) {
    if (!isRepoFile(sourceFile) || !reads(sourceFile.getFilePath())) continue;
    const file = normalizeFilePath(sourceFile.getFilePath(), repoDir);
    const found = [...moduleFunctions(sourceFile), ...builtExportFunctions(sourceFile)];
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
