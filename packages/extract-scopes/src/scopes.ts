/**
 * Every body of this repository a reader can hang something off.
 *
 * This walk started life inside the data-layer reader, which used to visit
 * class methods and nothing else, so a query written in a module-level function
 * produced no leaf (R52). The broker reader had the identical limit, and a
 * publish written in a module-level function produced no producer and no
 * channel (R54). Two readers with the same sentence to say is one sentence, so
 * it was written once, in the Nest extractor — the package both adapter
 * packages already depended on for the context, the class index and
 * `methodBodies`.
 *
 * That was the right move and the wrong address, and R46 is what the wrong
 * address cost: the Angular reader needs a channel name resolved the same way
 * the Nest one resolves it, so it depends on the broker adapter, so it could
 * not be built without the Nest extractor. Siblings that cannot name each other
 * had ended up naming each other through a shared sentence, and every later
 * extractor that wanted a channel name would have inherited the chain.
 *
 * So the walk lives here instead, in a package neither extractor owns, and is
 * written against `ScopeContext` — the questions an extractor can answer about
 * the repository it indexed — rather than against any one extractor's context.
 * `@flowatlas/core` is still where the pieces come from; what this package adds
 * is the altitude, which is above the core and below every framework.
 */
import {
  memberFunction,
  methodBodies,
  moduleFunctions,
  type ClassMethod,
  type NamedFunction,
} from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ScopeContext } from './context.js';

/**
 * The node a leaf hangs off, and how to put it in the graph.
 *
 * A method and a module-level function hold a call the same way; the only
 * difference between them is which node has to exist before an edge can point
 * at it. Keeping that difference behind `ensure` is what lets an emitter be
 * written once and read both.
 *
 * `ensure` runs when something is actually recorded rather than when the body
 * is opened, because a repository is mostly functions that touch nothing and a
 * node for each of them is not what anybody asked the graph for.
 */
export interface Holder {
  id: string;
  /** Repo-relative path the calls are written in. */
  file: string;
  ensure(): void;
}

/** A holder together with the body to read and the class it belongs to, if any. */
export interface Scope extends Holder {
  body: TsNode;
  /** The class the body belongs to, absent when it belongs to none. */
  owner?: ClassDeclaration;
  /**
   * The method the body is, when it is one.
   *
   * Carried because a reader that also has something class-shaped to say about
   * the same body — a decorator registering a handler, say — needs the
   * declaration to read it off, and recovering it from the body would be a
   * guess about which node a block hangs under.
   */
  method?: ClassMethod;
}

/**
 * The class roles whose methods are read.
 *
 * Every role a repository's own code can carry; what is left out is the
 * scaffolding — a module, a DTO — whose methods are not where anybody writes a
 * query or a publish.
 */
export const WALKED_ROLES: ReadonlySet<string> = new Set([
  'controller',
  'injectable',
  'guard',
  'interceptor',
  'pipe',
  'middleware',
  'plain',
]);

/** The files of this repository, which is what the module-level sources read. */
export const repoSourceFiles = function* (ctx: ScopeContext): Generator<SourceFile> {
  for (const source of ctx.project.getSourceFiles()) {
    const path = source.getFilePath();
    // A file of an installed package, or of another repository read into the
    // same project, is not this repository's to answer for.
    if (path.includes('/node_modules/') || !path.startsWith(`${ctx.repoDir}/`)) continue;
    yield source;
  }
};

/**
 * Two ways in may name the same function, and it is still one body to read.
 *
 * Carried across the whole walk rather than per source, because an object of
 * functions and the entries pass can both arrive at the same arrow.
 */
type Seen = Set<unknown>;

const scopeOf = (ctx: ScopeContext, fn: NamedFunction): Scope => ({
  id: ctx.functionIdOf(fn),
  file: ctx.fileOf(fn.declaration),
  body: fn.body,
  ensure: () => {
    ctx.ensureFunctionNode(fn);
  },
});

/** Methods of the classes this repository declares. */
const classMethods = function* (ctx: ScopeContext, seen: Seen): Generator<Scope> {
  for (const indexed of ctx.classes.all()) {
    if (!WALKED_ROLES.has(indexed.role)) continue;
    for (const { declaration: method, body } of methodBodies(indexed.declaration)) {
      const id = ctx.methodIdOf(method);
      if (id === undefined || seen.has(method)) continue;
      seen.add(method);
      yield {
        id,
        file: indexed.file,
        body,
        owner: indexed.declaration,
        method,
        ensure: () => {
          ctx.ensureMethodNode(method);
        },
      };
    }
  }
};

/** `export function listOrders() {…}`, and every other module-level spelling. */
const moduleLevelFunctions = function* (
  ctx: ScopeContext,
  seen: Seen,
  source: SourceFile,
): Generator<Scope> {
  for (const fn of moduleFunctions(source)) {
    if (seen.has(fn.declaration)) continue;
    seen.add(fn.declaration);
    yield scopeOf(ctx, fn);
  }
};

/**
 * A module of functions spelled as an object: `export const orders = { list:
 * async () => … }`. A call through one of those is already followed by name
 * elsewhere, so the function it names is something the graph can point at and
 * what is written inside it belongs to that function.
 */
const objectMemberFunctions = function* (
  ctx: ScopeContext,
  seen: Seen,
  source: SourceFile,
): Generator<Scope> {
  for (const declaration of source.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (initializer === undefined || !Node.isObjectLiteralExpression(initializer)) continue;
    for (const property of initializer.getProperties()) {
      if (!Node.isPropertyAssignment(property) && !Node.isMethodDeclaration(property)) continue;
      const fn = memberFunction(declaration.getNameNode(), property.getName());
      if (fn === undefined || seen.has(fn.declaration)) continue;
      seen.add(fn.declaration);
      yield scopeOf(ctx, fn);
    }
  }
};

/** The module-level readers, applied to each file in the order the file declares. */
const FILE_SOURCES = [moduleLevelFunctions, objectMemberFunctions];

/**
 * A handler written in the registration itself — `router.get('/x', async (req)
 * => …)` — is nobody's module-level function and is where a great deal of
 * Express and Hono code keeps its work. The entries pass has already given it a
 * name and a node.
 */
const registeredHandlers = function* (ctx: ScopeContext, seen: Seen): Generator<Scope> {
  for (const fn of ctx.handlerFunctions) {
    if (seen.has(fn.declaration)) continue;
    seen.add(fn.declaration);
    yield scopeOf(ctx, fn);
  }
};

/**
 * Every scope of this repository, once each.
 *
 * The order is the one the readers were written against: classes, then each
 * file's module-level functions and objects of functions together, then the
 * handlers the entries pass named. A file is read once for both of its
 * module-level spellings rather than twice, so two functions declared next to
 * each other come out next to each other, which is what a snapshot of the
 * result reads like.
 */
export const scopesOf = function* (ctx: ScopeContext): Generator<Scope> {
  const seen: Seen = new Set();
  yield* classMethods(ctx, seen);
  for (const source of repoSourceFiles(ctx)) {
    for (const read of FILE_SOURCES) yield* read(ctx, seen, source);
  }
  yield* registeredHandlers(ctx, seen);
};
