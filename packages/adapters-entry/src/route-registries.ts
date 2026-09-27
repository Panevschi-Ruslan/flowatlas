import { originOfValue } from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { arrayElements, unwrapValue } from './shared.js';

/**
 * A way in whose registration is written once, over a collection.
 *
 * ```ts
 * PluginManager.getHooks(Hook.API).forEach((hook) => router.use('/', hook.value.routes()));
 * ```
 *
 * One mount, and it installs as many applications as anything anywhere in the
 * repository put into that collection. The reader beside this one places a route
 * by following the mount that moved the application it is declared on, and there
 * is no mount here to follow: the argument of `use` is not an application but a
 * property of a binding the framework — or a loop — will hand one member of a
 * list. So the plugin routers were mounted nowhere, kept the addresses they are
 * written at, and outline recorded `POST /passkeys.list` for what it serves at
 * `POST /api/passkeys.list`, with nothing anywhere saying so.
 *
 * What is described here is the *collection*, in two halves, because they are
 * two different questions and a repository may make either of them unreadable:
 *
 * - **where the member came from** — `registryOf` walks back from the mount's
 *   argument to the expression being iterated, and records which keys were read
 *   off a member on the way. The keys matter as much as the collection: outline
 *   holds routers at `hook.value` and `{ router, id }` pairs at
 *   `hook.value.router`, in the same registry under different kinds, and the path
 *   the mount itself reads is what tells the two apart. Nothing here reads the
 *   registry's own discriminant key, because it does not have to.
 * - **what is in it** — `Registries.membersOf` follows the collection to the
 *   values contributed to it, wherever in the repository those are written.
 *
 * Nothing in this file names a framework, a package or a class. The iteration
 * methods are the language's and the rest is shape, which is what makes the same
 * reading answer a hand-written plugin manager, a const array of routers, and a
 * static getter that hands one of them back. Where the shape runs out the caller
 * is told nothing was found, and a row saying which collection and which mount is
 * a better answer than an address nothing serves.
 */

/**
 * Methods that call a function once with each member of what they are on.
 *
 * `filter` and `find` are deliberately absent: they answer with members rather
 * than doing something with each of them, so a mount written inside one is not a
 * mount at all. A `for…of` statement is the fourth spelling and is read as a
 * shape rather than as a name, since it has none.
 */
const ITERATIONS: ReadonlySet<string> = new Set(['forEach', 'map', 'flatMap']);

/** How far a member is followed back through names, and a list through lists. */
const DEPTH = 8;

/** Where an application came out of a collection, and how it was taken out. */
export interface Registry {
  /** The expression the members came out of, as written. */
  readonly source: TsNode;
  /** The keys read off one member on the way to the application. */
  readonly at: readonly string[];
}

/** The declaration an identifier is the value of, when it is written here. */
const declaredHere = (expr: TsNode): TsNode | undefined => {
  const origin = originOfValue(unwrapValue(expr));
  return origin.kind === 'local' ? origin.declaration : undefined;
};

/**
 * The collection a binding is handed one member of, or nothing when it is not.
 *
 * Two spellings, and the second has no name to look up: a parameter of a
 * function handed to one of the iteration methods, or the binding of a `for…of`.
 */
const iteratedOver = (declaration: TsNode): TsNode | undefined => {
  if (Node.isParameterDeclaration(declaration)) {
    const fn = declaration.getParent();
    const call = fn?.getParent();
    if (fn === undefined || call === undefined || !Node.isCallExpression(call)) return undefined;
    if (!call.getArguments().some((argument) => unwrapValue(argument) === fn)) return undefined;
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !ITERATIONS.has(callee.getName())) {
      return undefined;
    }
    return callee.getExpression();
  }
  if (Node.isVariableDeclaration(declaration)) {
    const list = declaration.getParent();
    const statement = list === undefined ? undefined : list.getParent();
    if (statement !== undefined && Node.isForOfStatement(statement)) return statement.getExpression();
  }
  return undefined;
};

/**
 * The collection an expression is one member of, with the keys read off it.
 *
 * `hook.value.routes()` arrives here as `hook.value` — the caller has already
 * taken off whatever turns a router into the middleware it is mounted as — and
 * leaves as the collection `PluginManager.getHooks(Hook.API)` with `['value']`
 * beside it.
 *
 * A member given a name of its own first is followed one step further, because
 * that is how a router awaited out of a registry has to be written:
 * `const resolved = await provider.value.router` and then a mount of
 * `resolved.routes()`. The keys of the two halves are joined in the order they
 * are read, which is what keeps `provider.value.router` and `provider.value`
 * apart.
 */
export const registryOf = (expr: TsNode, depth = 0): Registry | undefined => {
  if (depth >= DEPTH) return undefined;
  const at: string[] = [];
  let node = unwrapValue(expr);
  for (let step = 0; step < DEPTH && Node.isPropertyAccessExpression(node); step += 1) {
    at.unshift(node.getName());
    node = unwrapValue(node.getExpression());
  }
  if (!Node.isIdentifier(node)) return undefined;
  const declaration = declaredHere(node);
  if (declaration === undefined) return undefined;
  const source = iteratedOver(declaration);
  if (source !== undefined) return { source, at };
  const written = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  if (written === undefined) return undefined;
  const inner = registryOf(written, depth + 1);
  return inner === undefined ? undefined : { source: inner.source, at: [...inner.at, ...at] };
};

/**
 * The name a declaration binds, as an expression something can be read off.
 *
 * `{ router, id }` gives a caller the property and not the value — the name node
 * is both, and its symbol is the property's — so the value is asked for by name
 * and the *name of what holds it* is handed back: an identifier whose type says
 * what it is and whose symbol leads where it came from. The two spellings that
 * matter are a `const` in the same file and an import of another file's default,
 * which is how a plugin's router reaches the object that registers it.
 */
const namedBy = (declaration: TsNode): TsNode | undefined => {
  if (Node.isImportClause(declaration)) return declaration.getDefaultImport();
  const named =
    Node.isVariableDeclaration(declaration) ||
    Node.isImportSpecifier(declaration) ||
    Node.isNamespaceImport(declaration) ||
    Node.isBindingElement(declaration)
      ? declaration.getNameNode()
      : undefined;
  return named !== undefined && Node.isIdentifier(named) ? named : undefined;
};

/** The value one key of an object literal was given, however it is written. */
const keyOf = (literal: TsNode, key: string): TsNode | undefined => {
  if (!Node.isObjectLiteralExpression(literal)) return undefined;
  const property = literal.getProperty(key);
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) {
    const written = property.getInitializer();
    return written === undefined ? undefined : unwrapValue(written);
  }
  // `{ router, id }`, which is how a pair is written when the names already fit.
  //
  // The name node is the property *and* the value, and its symbol is the
  // property's: a caller following it lands on the object literal rather than on
  // the router, which is a mount recorded against something nothing else in the
  // repository mentions. So the value is asked for by name, and the name of what
  // holds it is handed back, because that is an expression the caller can read a
  // type off and follow.
  if (Node.isShorthandPropertyAssignment(property)) {
    const held = property.getValueSymbol()?.getDeclarations()[0];
    return (held === undefined ? undefined : namedBy(held)) ?? property.getNameNode();
  }
  return undefined;
};

/**
 * The one expression a declaration answers with, when it answers with one.
 *
 * A getter is how a registry is usually published — `static get providers() {
 * return PluginManager.getHooks(Hook.AuthProvider); }` — and from the mount's
 * side it is indistinguishable from a field. Several answers is a choice between
 * them and neither is *the* collection, so nothing is followed.
 */
const answeredBy = (declaration: TsNode): TsNode | undefined => {
  if (Node.isPropertyDeclaration(declaration) || Node.isVariableDeclaration(declaration)) {
    return declaration.getInitializer();
  }
  const bodied =
    Node.isGetAccessorDeclaration(declaration) ||
    Node.isMethodDeclaration(declaration) ||
    Node.isFunctionDeclaration(declaration);
  if (!bodied) return undefined;
  const answers = declaration
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter(
      (statement) =>
        statement.getFirstAncestor(
          (at) =>
            Node.isGetAccessorDeclaration(at) ||
            Node.isMethodDeclaration(at) ||
            Node.isFunctionDeclaration(at) ||
            Node.isArrowFunction(at) ||
            Node.isFunctionExpression(at),
        ) === declaration,
    );
  return answers.length === 1 ? answers[0]?.getExpression() : undefined;
};

/**
 * Every collection in one repository, and what was put into each.
 *
 * Held rather than computed, and computed only when a mount has turned out to be
 * over a collection: finding what a registry holds costs a walk of every call in
 * the repository, and the repositories that have no such mount are most of them.
 */
export class Registries {
  readonly #sources: readonly SourceFile[];
  /** Keyed by the declaration the registry is published on, walked once. */
  readonly #contributed = new Map<TsNode, TsNode[]>();

  /**
   * The shapes a collection can be written as, by the kind of expression it is.
   *
   * A lookup rather than a chain of conditions because that is the question:
   * four shapes, one answer each, and a fifth is a row here rather than a branch
   * in the middle of a walk.
   */
  readonly #readings: ReadonlyMap<SyntaxKind, (node: TsNode, depth: number) => TsNode[]>;

  constructor(sources: readonly SourceFile[]) {
    this.#sources = sources;
    this.#readings = new Map([
      // A list written where it is iterated, spreads and all (R91).
      [
        SyntaxKind.ArrayLiteralExpression,
        (node: TsNode): TsNode[] =>
          Node.isArrayLiteralExpression(node) ? arrayElements(node.getElements()) : [],
      ],
      // A list with a name: `const routers = [...]`, iterated somewhere else.
      [
        SyntaxKind.Identifier,
        (node: TsNode, depth: number): TsNode[] => {
          const declaration = declaredHere(node);
          const written = declaration === undefined ? undefined : answeredBy(declaration);
          return written === undefined ? [] : this.#itemsOf(written, depth + 1);
        },
      ],
      // A collection published as a field or a getter of something.
      [
        SyntaxKind.PropertyAccessExpression,
        (node: TsNode, depth: number): TsNode[] => {
          const declaration = node.getSymbol()?.getDeclarations()[0];
          const written = declaration === undefined ? undefined : answeredBy(declaration);
          return written === undefined ? [] : this.#itemsOf(written, depth + 1);
        },
      ],
      // A collection asked for: whatever was handed to the thing that holds it.
      [
        SyntaxKind.CallExpression,
        (node: TsNode): TsNode[] => {
          if (!Node.isCallExpression(node)) return [];
          const callee = node.getExpression();
          return Node.isPropertyAccessExpression(callee)
            ? this.#contributions(callee.getExpression())
            : [];
        },
      ],
    ]);
  }

  /**
   * Every value contributed to the collection a mount took an application from.
   *
   * The values, not the applications: whether one of them is an application of
   * the framework being read is the caller's question, and it is the only one
   * that needs a dialect. An empty answer means a collection whose members
   * cannot be followed, which is a row and not silence.
   */
  membersOf(registry: Registry): TsNode[] {
    const out: TsNode[] = [];
    for (const item of this.#itemsOf(registry.source, 0)) {
      let at: TsNode | undefined = item;
      for (const key of registry.at) {
        at = at === undefined ? undefined : keyOf(at, key);
      }
      if (at !== undefined) out.push(at);
    }
    return out;
  }

  #itemsOf(expr: TsNode, depth: number): TsNode[] {
    if (depth >= DEPTH) return [];
    const node = unwrapValue(expr);
    return this.#readings.get(node.getKind())?.(node, depth) ?? [];
  }

  /**
   * Everything handed to anything called on the same receiver, flattened.
   *
   * Every call and not one named method, because the name of the method that
   * contributes is a fact about one repository's own class and this reading has
   * no row to keep it in. It costs nothing to be wide here: a contribution is
   * only ever used when the keys the mount read lead off it to an application of
   * the framework, and `getHooks(Hook.API)` — the call that asks for the
   * collection — carries no such object at all.
   *
   * The receiver's text is a prefilter and the declaration is the answer, so a
   * registry imported under two names in two files is read in both and something
   * else of the same name in a third is not.
   */
  #contributions(receiver: TsNode): TsNode[] {
    const owner = declaredHere(receiver);
    if (owner === undefined) return [];
    const found = this.#contributed.get(owner);
    if (found !== undefined) return found;
    const text = receiver.getText();
    const out: TsNode[] = [];
    for (const sourceFile of this.#sources) {
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) continue;
        const on = callee.getExpression();
        if (!Node.isIdentifier(on) || on.getText() !== text) continue;
        if (declaredHere(on) !== owner) continue;
        for (const argument of call.getArguments()) {
          // One at a time and a list opened out, because both spellings are
          // ordinary side by side: `add({ … })` contributes one and
          // `add([{ … }, { … }])` contributes a list, and a list of lists is
          // what R91's reading of a list is for.
          const value = unwrapValue(argument);
          if (Node.isArrayLiteralExpression(value)) out.push(...arrayElements(value.getElements()));
          else out.push(value);
        }
      }
    }
    this.#contributed.set(owner, out);
    return out;
  }
}
