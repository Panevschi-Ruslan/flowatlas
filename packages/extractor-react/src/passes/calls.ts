import { forEachCall, isLibFile, lineOf, namedByProperty, packageOfPath, startLineOf } from '@flowatlas/core';
import type { NewExpression, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { keptAt } from '../script-members.js';
import { methodIndexed } from '../util/forward.js';
import { receiverValues } from '../util/receiver-values.js';
import { definePass } from './types.js';

/**
 * Every declaration a name could stand for, with imports followed.
 *
 * A React repository reaches another module's function by importing it, and an
 * import is an alias rather than the thing itself. Without following the alias
 * every call across a file boundary — which is all of the interesting ones —
 * resolves to the import statement and nothing else.
 */
const declarationsOf = (node: TsNode): TsNode[] => {
  const symbol = node.getSymbol();
  if (symbol === undefined) return [];
  const aliased = symbol.getAliasedSymbol();
  return (aliased ?? symbol).getDeclarations();
};

/**
 * The constructors whose instance a call's receiver is, where the compiler
 * does not say (P310): `this` in a prototype's member is an instance of its
 * constructor, and any other receiver is what it is given - `new Store()`,
 * handed in by each caller, kept in a field - as a request's receiver is read
 * (P301).
 */
const constructorsOf = (ctx: ReactExtractContext, receiver: TsNode, heldBy: (receiver: TsNode) => TsNode[]): TsNode[] => {
  if (receiver.getKind() === SyntaxKind.ThisKeyword) {
    for (let at = receiver.getParent(); at !== undefined; at = at.getParent()) {
      // A constructor's own body: `this` is the instance it makes.
      if (Node.isFunctionDeclaration(at)) return [at];
      if (Node.isFunctionExpression(at) || Node.isMethodDeclaration(at) || Node.isGetAccessorDeclaration(at) || Node.isSetAccessorDeclaration(at)) {
        const holder = at.getParent();
        const member = ctx.functions.scriptMember(at) ?? (holder === undefined ? undefined : ctx.functions.scriptMember(holder));
        return member === undefined ? [] : [...ctx.functions.ownersOf(member.id)];
      }
    }
    return [];
  }
  return heldBy(receiver).flatMap((value) => {
    if (!Node.isNewExpression(value)) return [];
    const made = value.getExpression();
    const declared = Node.isIdentifier(made) ? declarationsOf(made) : [];
    if (declared.length > 0) return declared;
    // A constructor nothing declares: the one a script hands the page by its name (P311).
    const name = pageName(made);
    return name === undefined ? [] : [...ctx.functions.globalConstructor(name)];
  });
};

/**
 * The name a script calls something the page holds by (P311): `window.shop.load`
 * and `shop.load` alike are `shop.load`, where nothing declares `shop`.
 */
const pageName = (node: TsNode): string | undefined => {
  const kept = keptAt(node);
  if (kept === undefined) return undefined;
  if (kept.page) return kept.names.join('.');
  let root = node;
  while (Node.isPropertyAccessExpression(root) || Node.isElementAccessExpression(root) || Node.isParenthesizedExpression(root)) root = root.getExpression();
  return Node.isIdentifier(root) && root.getSymbol() === undefined ? kept.names.join('.') : undefined;
};

/**
 * The function a declaration the checker hands back names by a name of its
 * own (P311): `{ list }` and `{ list: list }` in what a module exports or a
 * wrapper returns are the function `list` - in every reading, wherever the
 * importer is read (P317).
 */
const namedBy = (ctx: ReactExtractContext, declaration: TsNode): IndexedFunction | undefined => {
  for (const each of namedByProperty(declaration)) {
    const indexed = ctx.functions.get(each);
    if (indexed !== undefined) return indexed;
  }
  return undefined;
};

/** The functions of this repository a call names, when it names any: the one its name is declared by, or a prototype's member of each instance it is called on (P310). */
const calledFunctions = (
  ctx: ReactExtractContext,
  callee: TsNode,
  heldBy: (receiver: TsNode) => TsNode[],
): IndexedFunction[] => {
  const named = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  if (!Node.isIdentifier(named)) return [];
  const declarations = declarationsOf(named);
  for (const declaration of declarations) {
    const indexed = ctx.functions.get(declaration as never);
    if (indexed !== undefined) return [indexed];
  }
  for (const declaration of declarations) {
    const indexed = namedBy(ctx, declaration);
    if (indexed !== undefined) return [indexed];
  }
  // A function a script hands the page, called by its name there (P311).
  const onPage = declarations.length === 0 && ctx.functions.hasGlobals ? pageName(callee) : undefined;
  const global = onPage === undefined ? undefined : ctx.functions.global(onPage);
  if (global !== undefined) return [global];
  if (!Node.isPropertyAccessExpression(callee) || !ctx.functions.hasPrototypeMembers) return [];
  const found = new Set<IndexedFunction>();
  for (const owner of constructorsOf(ctx, callee.getExpression(), heldBy)) {
    const member = ctx.functions.member(owner, callee.getName());
    if (member !== undefined) found.add(member);
  }
  return [...found];
};

/**
 * Every `new` inside a body (P349), as {@link forEachCall} walks the calls:
 * not inside a class written there, nor a part `leaveOut` names.
 */
const forEachNew = (body: TsNode, visit: (made: NewExpression) => void, leaveOut?: ReadonlySet<TsNode>): void => {
  if (Node.isNewExpression(body)) visit(body);
  body.forEachDescendant((node, traversal) => {
    if (Node.isClassDeclaration(node) || Node.isClassExpression(node) || leaveOut?.has(node) === true) {
      traversal.skip();
      return;
    }
    if (Node.isNewExpression(node)) visit(node);
  });
};

/**
 * The function a `new` runs in a plain script (P349): a constructor function
 * the script declares (`function Router(routes) { … }`), or the constructor
 * a class writes (`class Router { constructor(routes) { … } }`, read as
 * `Router.constructor`) - by the name it is declared under, past an import,
 * or the one a script hands the page by that name (P311). Nothing for a
 * class with no constructor of its own, or one this repository does not
 * declare.
 */
const constructedBy = (ctx: ReactExtractContext, made: NewExpression): IndexedFunction | undefined => {
  const callee = made.getExpression();
  const named = Node.isIdentifier(callee) ? declarationsOf(callee) : [];
  const onPage = named.length === 0 && ctx.functions.hasGlobals ? pageName(callee) : undefined;
  const declarations = onPage === undefined ? named : [...ctx.functions.globalConstructor(onPage)];
  for (const declaration of declarations) {
    if (declaration.getSourceFile().isInNodeModules() || declaration.getSourceFile().isDeclarationFile()) continue;
    const indexed = ctx.functions.get(declaration as never);
    if (indexed !== undefined) return indexed;
    const held = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
    const cls = Node.isClassDeclaration(declaration) ? declaration : held !== undefined && Node.isClassExpression(held) ? held : undefined;
    const constructor = cls?.getConstructors().find((each) => each.getBody() !== undefined);
    const body = constructor?.getBody();
    const name = cls === undefined ? undefined : (cls.getName() ?? (Node.isVariableDeclaration(declaration) ? declaration.getName() : undefined));
    if (constructor === undefined || body === undefined || name === undefined) continue;
    return ctx.functions.get(constructor) ?? ctx.functions.adopt({ name: `${name}.constructor`, declaration: constructor, body, line: startLineOf(constructor) });
  }
  return undefined;
};

const NO_NAMES: ReadonlySet<string> = new Set();

/** A script that may declare an accessor, told by its text before it is walked. */
const MAY_DECLARE_ACCESSOR = /\b(?:get|set)\s+[\w$#]+\s*\(/;

/**
 * The names the repository's getters and setters are declared under (P311),
 * so a property read is asked of the checker only where one of them may run.
 */
const accessorNames = (ctx: ReactExtractContext): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const file of ctx.project.getSourceFiles()) {
    if (file.isInNodeModules() || file.isDeclarationFile() || !MAY_DECLARE_ACCESSOR.test(file.getFullText())) continue;
    for (const kind of [SyntaxKind.GetAccessor, SyntaxKind.SetAccessor] as const) {
      for (const accessor of file.getDescendantsOfKind(kind)) names.add(accessor.getName());
    }
  }
  return names;
};

/**
 * Every property a body reads or writes outside a call of it (P311), with
 * whether it is written: `api.items` and `api.items = v`. A class written
 * inside is its own, as for calls.
 */
const forEachAccess = (
  body: TsNode,
  visit: (access: TsNode & { getName(): string; getExpression(): TsNode }, written: boolean) => void,
  leaveOut?: ReadonlySet<TsNode>,
): void => {
  body.forEachDescendant((node, traversal) => {
    if (Node.isClassDeclaration(node) || Node.isClassExpression(node) || leaveOut?.has(node) === true) {
      traversal.skip();
      return;
    }
    if (!Node.isPropertyAccessExpression(node)) return;
    const parent = node.getParent();
    if (Node.isCallExpression(parent) && parent.getExpression() === node) return;
    const written =
      Node.isBinaryExpression(parent) && parent.getLeft() === node && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken;
    visit(node, written);
  });
};

const isAccessor = (node: TsNode, written: boolean): boolean => (written ? Node.isSetAccessorDeclaration(node) : Node.isGetAccessorDeclaration(node));

/**
 * The getters a property read runs, or the setters a write runs (P311): the
 * accessor the compiler resolves it to - an object's, or a class's, indexed
 * where it is met - the one a script hands the page under the name read, or a
 * prototype's of each instance the receiver holds.
 */
const accessorsRun = (
  ctx: ReactExtractContext,
  access: TsNode & { getName(): string; getExpression(): TsNode },
  written: boolean,
  names: ReadonlySet<string>,
  heldBy: (receiver: TsNode) => TsNode[],
): IndexedFunction[] => {
  const name = access.getName();
  if (names.has(name)) {
    const declarations = Node.isPropertyAccessExpression(access) ? declarationsOf(access.getNameNode()) : [];
    for (const declaration of declarations) {
      if (!isAccessor(declaration, written)) continue;
      const indexed = ctx.functions.get(declaration) ?? methodIndexed(ctx, declaration);
      if (indexed !== undefined) return [indexed];
    }
    if (declarations.length > 0) return [];
  }
  if (ctx.functions.hasGlobals) {
    const onPage = pageName(access);
    const global = onPage === undefined ? undefined : ctx.functions.global(written ? `${onPage}=` : onPage);
    if (global !== undefined && isAccessor(global.fn.declaration, written)) return [global];
  }
  if (!names.has(name) || !ctx.functions.hasPrototypeMembers) return [];
  const found = new Set<IndexedFunction>();
  for (const owner of constructorsOf(ctx, access.getExpression(), heldBy)) {
    const member = ctx.functions.member(owner, written ? `${name}=` : name);
    if (member !== undefined && isAccessor(member.fn.declaration, written)) found.add(member);
  }
  return [...found];
};

/**
 * The package a name came from, when it came from one.
 *
 * The language's own library is not one, although it is installed like one:
 * `JSON.stringify` and `Response.json` are declared in a file under the
 * compiler's own package, and counting those as calls into a dependency would
 * put the compiler at the top of every repository's list of what it talks to.
 */
const externalPackage = (callee: TsNode): string | null => {
  const named = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  if (!Node.isIdentifier(named)) return null;
  for (const declaration of declarationsOf(named)) {
    const path = declaration.getSourceFile().getFilePath();
    if (isLibFile(path)) return null;
    const pkg = packageOfPath(path);
    if (pkg !== null) return pkg;
  }
  return null;
};

/**
 * Turns call sites into edges between functions.
 *
 * This is the middle of the chain the whole reader exists for, and it is where
 * React differs most from the other front end. There, a component reaches a
 * request through a service it injects, so the walk back to a screen is a walk
 * over a class graph the container describes. Here a custom hook is an ordinary
 * function that other hooks and components call, so the same walk is a walk
 * over plain calls and nothing else — which is at once simpler and less
 * certain, since nothing declares that a function is meant to be reached this
 * way.
 *
 * Unlike the server reader, the walk starts from every function rather than
 * from the ones an entry point named. There is no entry point in a browser: the
 * screen is the way in, and a screen is reached by the router or by other
 * markup, never by a call. Starting only from what is called would leave every
 * screen out of the graph.
 */
export const callsPass = definePass('calls', (ctx: ReactExtractContext) => {
  // An instance a call is made on, read once per receiver (P310).
  const heldBy = receiverValues((value) => Node.isNewExpression(value));
  // A property read or written where a getter or a setter runs (P311).
  const accessors = ctx.functions.readsMembers ? accessorNames(ctx) : NO_NAMES;
  const readsAccessors = accessors.size > 0 || ctx.functions.hasGlobals;
  for (const indexed of ctx.functions.all()) {
    // A function kept inside it is walked as its own (P317).
    const nested = ctx.functions.nestedIn(indexed);
    let created = false;
    const draw = (each: IndexedFunction, at: TsNode): void => {
      // A function that calls itself says nothing about the shape of the
      // system, and a self-edge is read as a cycle by everything downstream.
      if (each.id === indexed.id) return;
      if (!created) {
        ctx.ensureFunctionNode(indexed.fn);
        created = true;
      }
      ctx.ensureFunctionNode(each.fn);
      ctx.builder.addEdge({
        from: indexed.id,
        to: each.id,
        type: 'calls',
        confidence: 'static',
        file: indexed.file,
        line: lineOf(at),
      });
    };

    forEachCall(indexed.fn.body, (call) => {
      const callee = call.getExpression();
      const called = calledFunctions(ctx, callee, heldBy);
      if (called.length === 0) {
        const pkg = externalPackage(callee);
        if (pkg !== null) ctx.countExternalCall(pkg);
        return;
      }
      for (const each of called) draw(each, call);
    }, nested);
    // A `new` in a plain script runs the constructor it names (P349): the
    // top of a script that only makes an instance draws it.
    if (ctx.functions.readsMembers) {
      forEachNew(indexed.fn.body, (made) => {
        const each = constructedBy(ctx, made);
        if (each !== undefined) draw(each, made);
      }, nested);
    }
    if (readsAccessors) {
      forEachAccess(
        indexed.fn.body,
        (access, written) => {
          for (const each of accessorsRun(ctx, access, written, accessors, heldBy)) draw(each, access);
        },
        nested,
      );
    }
  }
});
