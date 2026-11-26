import { callSitesOf, originOfValue, packageOfSpecifier, type Forwarder } from '@flowatlas/core';
import type { CallExpression, ParameterDeclaration, SourceFile, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind, VariableDeclarationKind } from 'ts-morph';
import type { AppType, RouteDialect } from './route-dialects.js';

/**
 * What the source says an application is, when the checker will not say.
 *
 * A fresh clone has no `node_modules`, so `express` has no types, `const app =
 * express()` is `any`, and a reader that knows an application by its type knows
 * nothing at all: a video platform's fresh clone placed no address, and a commerce monorepo's two
 * Express-served files were excused from the read gate for exactly this (R142).
 * The facts the reading needs were never missing. They are written in the
 * repository being read, in plain sight, whether or not anything is installed:
 *
 *     import express from 'express';
 *     const app = express();
 *
 * The import names the package and the export, and the call says the value is
 * what that export makes. An annotation says the same thing the other way round
 * - `router: Router`, with `Router` imported from `express` - and a class of the
 * repository's own says it through its base, `class ApiRouter extends Router`.
 *
 * This is R122's reading of the data layer (`adapters-db/src/leaves/stated.ts`)
 * moved across to the entries side, and it keeps that reading's two rules. It is
 * the checker's fallback and never its rival: it is asked only where the type
 * could not be resolved at all, so an installed repository reads exactly as it
 * did. And an answer from here is `heuristic`, never `static`, because the
 * source states what the author meant rather than what a compiler checked -
 * with one exception, `madeDirectly` below: a name holding the very value the
 * framework's own maker made on that line is the value, not an account of it,
 * and is as sure as its type would have been (P346).
 *
 * One difference, and it is deliberate. R122 does not read an initialiser, since
 * `const db = makeDb()` states nothing about a type. `express()` does, but only
 * because a description says so: which exports of which package make an
 * application is a fact about four published frameworks, and it is written once,
 * on the dialect (`makers`), rather than as a condition here. An export named
 * after one of the dialect's own application types needs no row at all -
 * `new Hono()`, `Router()` - so the rows are only the renamed ones, which in
 * practice means a default export.
 */

/** How far a value is followed back through bindings, calls and bases. */
const MAX_DEPTH = 12;

const unwrap = (expr: TsNode): TsNode =>
  Node.isParenthesizedExpression(expr) || Node.isAsExpression(expr) || Node.isNonNullExpression(expr)
    ? unwrap(expr.getExpression())
    : expr;

/**
 * What an answer about the whole project is kept under: the program, not the
 * project. A watch refreshes a changed file in place and the checker then
 * answers from a new program, and an answer here - a property's writes, a
 * function's callers - may rest on any file.
 */
const programOf = (node: TsNode): object => node.getProject().getProgram().compilerObject;

/** Answers about nodes, kept per program. */
class PerProgram<V> {
  readonly #byProgram = new WeakMap<object, WeakMap<TsNode, V>>();

  #of(node: TsNode): WeakMap<TsNode, V> {
    const program = programOf(node);
    const known = this.#byProgram.get(program);
    if (known !== undefined) return known;
    const fresh = new WeakMap<TsNode, V>();
    this.#byProgram.set(program, fresh);
    return fresh;
  }

  get(node: TsNode): V | undefined {
    return this.#of(node).get(node);
  }

  set(node: TsNode, value: V): void {
    this.#of(node).set(node, value);
  }
}

/**
 * The declaration an application value stands for.
 *
 * `originOfValue` stops at a default export, and a router is almost always
 * `const router = express.Router()` followed by `export default router` and
 * imported under a name of the importer's choosing. Stopping there would key
 * the mount on the export statement and the routes on the variable, and the
 * two would never meet — thirty-three mounted routers read as thirty-three
 * applications nothing mounts.
 *
 * Here rather than in the reader because both judgements walk it: the checker's
 * to key a mount, and this one to find what a value was written as.
 */
export const appDeclaration = (expr: TsNode | undefined): TsNode | undefined => {
  if (expr === undefined) return undefined;
  const origin = originOfValue(unwrap(expr));
  if (origin.kind !== 'local') return undefined;
  const declaration = origin.declaration;
  if (Node.isExportAssignment(declaration)) return appDeclaration(declaration.getExpression());
  // `export { protectedRouter }` written apart from the declaration: the symbol
  // an importer sees is the specifier, and the routes are declared on what it
  // names. Both spellings of an export have to arrive at the same node or a
  // router and the mount that places it never meet.
  if (Node.isExportSpecifier(declaration)) {
    return declaration.getLocalTargetDeclarations()[0];
  }
  return declaration;
};

/** A package export, as an import statement binds it. */
interface Imported {
  readonly package: string;
  /** The name the package exports it under; `default` for a default import. */
  readonly name: string;
  /**
   * Whether the statement names the package itself, `'express'`, rather than a
   * file inside it, `'express/lib/router'`. Only the package's own entry is
   * what the dialect's description is a description of (P346).
   */
  readonly whole: boolean;
}

/**
 * What an identifier was imported as, read off the import statement.
 *
 * The statement and not the checker, for the reason R84 gave for decorators:
 * with nothing installed the checker's aliased symbol is nobody's, and the
 * statement still says the package and the name. A namespace import stands for
 * the module, so `express.Router` is the export `Router` and `express()` written
 * on a namespace is the call a default import would have made.
 *
 * `require` states the same (P281): `const express = require('express')`,
 * the module a CommonJS package exports whole, is what a default import
 * binds, and `const { Router } = require('express')` the export it names -
 * the spelling of a server made only where it is needed, the package loaded
 * lazily inside a method.
 */
const importOf = (identifier: TsNode): Imported | undefined => {
  if (!Node.isIdentifier(identifier)) return undefined;
  for (const declaration of identifier.getSymbol()?.getDeclarations() ?? []) {
    const required = requiredBy(declaration);
    if (required !== undefined) return required;
    const statement = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (statement === undefined) continue;
    const specifier = statement.getModuleSpecifierValue();
    const pkg = packageOfSpecifier(specifier);
    if (pkg === undefined) return undefined;
    const whole = specifier === pkg;
    if (Node.isImportSpecifier(declaration)) return { package: pkg, name: declaration.getName(), whole };
    if (Node.isImportClause(declaration)) return { package: pkg, name: 'default', whole };
    if (Node.isNamespaceImport(declaration)) return { package: pkg, name: 'namespace', whole };
  }
  return undefined;
};

/** What `const x = require('pkg')`, or a name destructured from it, binds. */
const requiredBy = (declaration: TsNode): Imported | undefined => {
  const holder = Node.isBindingElement(declaration) ? declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration) : declaration;
  if (holder === undefined || !Node.isVariableDeclaration(holder)) return undefined;
  const value = holder.getInitializer();
  const call = value === undefined ? undefined : unwrap(value);
  if (call === undefined || !Node.isCallExpression(call) || call.getExpression().getText() !== 'require') return undefined;
  const [specifier] = call.getArguments();
  if (specifier === undefined || !Node.isStringLiteral(specifier)) return undefined;
  const pkg = packageOfSpecifier(specifier.getLiteralValue());
  if (pkg === undefined) return undefined;
  const whole = specifier.getLiteralValue() === pkg;
  if (Node.isBindingElement(declaration)) {
    return { package: pkg, name: declaration.getPropertyNameNode()?.getText() ?? declaration.getName(), whole };
  }
  return Node.isIdentifier(holder.getNameNode()) ? { package: pkg, name: 'default', whole } : undefined;
};

/**
 * The export a name - called, constructed or written as a type - stands for.
 *
 * `express`, `Router`, `express.Router`, and the same three as types. The member
 * of a default or namespace import is read as the export of that name, because
 * `express.Router` and `import { Router } from 'express'` are one fact spelled
 * two ways.
 */
const exportNamed = (name: TsNode): Imported | undefined => {
  const node = unwrap(name);
  if (Node.isPropertyAccessExpression(node) || Node.isQualifiedName(node)) {
    const head = Node.isPropertyAccessExpression(node) ? node.getExpression() : node.getLeft();
    const bound = importOf(head);
    if (bound === undefined || (bound.name !== 'default' && bound.name !== 'namespace')) {
      return undefined;
    }
    const member = Node.isPropertyAccessExpression(node) ? node.getName() : node.getRight().getText();
    return { package: bound.package, name: member, whole: bound.whole };
  }
  const bound = importOf(node);
  if (bound === undefined) return undefined;
  return bound.name === 'namespace' ? { ...bound, name: 'default' } : bound;
};

/**
 * The application type an export makes, by the dialect's description.
 *
 * A row in `makers` when the export is renamed - `express` itself, `new Koa()` -
 * and the export's own name when it is one of the dialect's application types,
 * which needs no row because the description already says it.
 */
const madeBy = (exported: Imported | undefined, dialect: RouteDialect): AppType | undefined => {
  if (exported === undefined) return undefined;
  const maker = dialect.makers.find(
    (row) => row.package === exported.package && row.export === exported.name,
  );
  if (maker !== undefined) return { package: maker.package, typeName: maker.typeName };
  return dialect.appTypes.find(
    (app) => app.package === exported.package && app.typeName === exported.name,
  );
};

/**
 * Where a declaration writes the type of what it holds.
 *
 * The same three places R122 reads - a parameter, a property, a variable - and
 * a fourth R122 did not need: a name destructured out of an object whose type
 * is written as a literal. A video platform hands a router to a helper as
 * `options: { router: express.Router, … }` and reads it back with `const {
 * router } = options`; the annotation is there, one member down. A lookup
 * rather than a run of conditions, so a fifth is a row. A class is not among
 * them because a class is not an application; its instances are, and `new` is
 * read below.
 */
const STATED_TYPE: Partial<Record<SyntaxKind, (node: TsNode) => TsNode | undefined>> = {
  [SyntaxKind.Parameter]: (node) =>
    Node.isParameterDeclaration(node) ? node.getTypeNode() : undefined,
  [SyntaxKind.PropertyDeclaration]: (node) =>
    Node.isPropertyDeclaration(node) ? node.getTypeNode() : undefined,
  [SyntaxKind.VariableDeclaration]: (node) =>
    Node.isVariableDeclaration(node) ? node.getTypeNode() : undefined,
  [SyntaxKind.BindingElement]: (node) =>
    Node.isBindingElement(node) ? destructuredType(node) : undefined,
};

/**
 * The written type of the object a destructured name was taken from: its own
 * annotation, or - for `const { router } = options` - the annotation of the one
 * name it was taken from. One hop, because that is the shape; a chain of
 * destructurings is somebody else's type system.
 */
const holderType = (holder: TsNode | undefined): TsNode | undefined => {
  if (holder === undefined || Node.isBindingElement(holder)) return undefined;
  const own = STATED_TYPE[holder.getKind()]?.(holder);
  if (own !== undefined) return own;
  const value = valueOf(holder);
  const named = value !== undefined && Node.isIdentifier(value) ? appDeclaration(value) : undefined;
  return named === undefined || Node.isBindingElement(named)
    ? undefined
    : STATED_TYPE[named.getKind()]?.(named);
};

/** The member of a written object type a destructured name reads. */
const destructuredType = (element: TsNode): TsNode | undefined => {
  if (!Node.isBindingElement(element)) return undefined;
  const key = element.getPropertyNameNode()?.getText() ?? element.getName();
  const written = holderType(element.getParent()?.getParent());
  if (written === undefined || !Node.isTypeLiteral(written)) return undefined;
  return written.getProperty(key)?.getTypeNode();
};

/**
 * The value a declaration was written with, wherever one can carry a value.
 *
 * A parameter's default is one of them: `init(app: Koa = new Koa())` is how
 * A wiki app declares the application every one of its routes is served on.
 */
const valueOf = (declaration: TsNode): TsNode | undefined =>
  Node.isVariableDeclaration(declaration) ||
  Node.isPropertyDeclaration(declaration) ||
  Node.isParameterDeclaration(declaration)
    ? declaration.getInitializer()
    : undefined;

/** The written type's name: the head of `Router`, `express.Router` or `Router | undefined`. */
const typeNameNode = (written: TsNode): TsNode | undefined => {
  const reference = Node.isTypeReference(written)
    ? written
    : written.getFirstDescendantByKind(SyntaxKind.TypeReference);
  return reference?.getTypeName();
};

/**
 * What a written type says, following a class of this repository up its bases.
 *
 * `router: ApiRouter` with `class ApiRouter extends Router` is a router, and the
 * base resolves with no `node_modules` because it is a relative import.
 */
const ofWrittenType = (written: TsNode, dialect: RouteDialect, depth: number): AppType | undefined => {
  const name = typeNameNode(written);
  if (name === undefined) return undefined;
  return madeBy(exportNamed(name), dialect) ?? ofLocalClass(name, dialect, depth);
};

/** A class of this repository whose base, somewhere up, is an application type. */
const ofLocalClass = (name: TsNode, dialect: RouteDialect, depth: number): AppType | undefined => {
  if (depth > MAX_DEPTH) return undefined;
  const target = Node.isQualifiedName(name) ? name.getRight() : name;
  const origin = Node.isIdentifier(target) ? originOfValue(target) : undefined;
  if (origin?.kind !== 'local' || !Node.isClassDeclaration(origin.declaration)) return undefined;
  return ofBase(origin.declaration, dialect, depth);
};

const ofBase = (declaration: TsNode, dialect: RouteDialect, depth: number): AppType | undefined => {
  const base = Node.isClassDeclaration(declaration)
    ? declaration.getExtends()?.getExpression()
    : undefined;
  if (base === undefined) return undefined;
  return madeBy(exportNamed(base), dialect) ?? ofLocalClass(base, dialect, depth + 1);
};

/**
 * What the source states a class's base is, where the checker stopped at it.
 *
 * `class ApiRouter extends Router` resolves as a class of the repository with
 * nothing installed - so the checker does commit to a type - and then has no
 * base to offer, because `Router` is in a package nobody installed. The walk up
 * the bases is where the type could not be resolved, so that is where the
 * source is asked.
 */
export const statedBase = (declaration: TsNode, dialect: RouteDialect): AppType | undefined =>
  ofBase(declaration, dialect, 0);

/**
 * The application a function of this repository hands back, when one it hands
 * back is one. `createRouter()` is how a repository writes one router per
 * provider, and the call states only what the function's `return` states.
 */
const ofReturned = (callee: TsNode, dialect: RouteDialect, depth: number): AppType | undefined => {
  const declaration = appDeclaration(callee);
  const fn =
    declaration !== undefined && Node.isVariableDeclaration(declaration)
      ? declaration.getInitializer()
      : declaration;
  if (
    fn === undefined ||
    !(Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))
  ) {
    return undefined;
  }
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody();
    if (!Node.isBlock(body)) return ofValue(body, dialect, depth + 1);
  }
  for (const statement of fn.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const inside = statement.getFirstAncestor(
      (at) =>
        Node.isArrowFunction(at) || Node.isFunctionExpression(at) || Node.isFunctionDeclaration(at),
    );
    const returned = statement.getExpression();
    if (inside !== fn || returned === undefined) continue;
    const found = ofValue(returned, dialect, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * Methods a dialect says hand back the application they were called on.
 *
 * The ones the description already names - a mount, an install, a verb, a prefix - and
 * the ones it names only for this: `express().disable('x-powered-by')` is an
 * application with a setting turned off, and with its type installed the
 * checker says so; with nothing installed, only the description can.
 */
const answersWithSelf = (method: string, dialect: RouteDialect): boolean =>
  method === dialect.mount?.method ||
  method === dialect.middleware?.install ||
  method === dialect.verbArgument ||
  // A prefix method answers with an application too - the same one, or a new
  // one with a base in front - and which is the reader's question, not this.
  method === dialect.prefixMethod ||
  dialect.verbs.has(method) ||
  dialect.chainable.includes(method);

/** The walk itself: what a value was written as, back to a statement of it. */
const ofValue = (expr: TsNode, dialect: RouteDialect, depth: number): AppType | undefined => {
  if (depth > MAX_DEPTH) return undefined;
  const node = unwrap(expr);

  if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    const callee = node.getExpression();
    const made = madeBy(exportNamed(callee), dialect);
    if (made !== undefined) return made;
    if (Node.isNewExpression(node)) return ofLocalClass(callee, dialect, depth + 1);
    if (Node.isPropertyAccessExpression(callee)) {
      return answersWithSelf(callee.getName(), dialect)
        ? ofValue(callee.getExpression(), dialect, depth + 1)
        : undefined;
    }
    return ofReturned(callee, dialect, depth);
  }

  // A declaration is asked about directly as well as through a name for it: a
  // plugin's application is the parameter itself, `async (scope: FastifyInstance)`.
  const declaration =
    STATED_TYPE[node.getKind()] !== undefined
      ? node
      : Node.isIdentifier(node) || Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)
        ? appDeclaration(node)
        : undefined;
  if (declaration === undefined) return undefined;
  const written = STATED_TYPE[declaration.getKind()]?.(declaration);
  // An annotation is the author's own statement of what the value is, and it is
  // the answer whichever way it goes: `app: Express` is an application, and
  // `settings: AppSettings = express()` is a sign the reading has gone wrong.
  if (written !== undefined) return ofWrittenType(written, dialect, depth);
  for (const value of valuesOf(declaration)) {
    const found = ofValue(value, dialect, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * The application type the source states an expression is, or undefined.
 *
 * Shaped like the type the checker would have found - a package and a type name
 * from the dialect's own `appTypes` - so the reader's one question, "is this an
 * application of this framework", is answered the same way from either side.
 */
export const statedApp = (expr: TsNode, dialect: RouteDialect): AppType | undefined =>
  ofValue(expr, dialect, 0);


/**
 * Whether the source states an application as surely as a type would (P346).
 *
 * `import express from 'express'; const app = express();` is not the author's
 * account of what `app` is, the way `app: Express` is: it is the value itself,
 * made on that line by the export the framework publishes for making it, from
 * the framework's own package. A checker with the types installed would read
 * nothing more than that. So a route on it carries what a typed one carries,
 * and every other statement R142 reads stays `heuristic`: an annotation, a
 * destructured member, a class of the repository extending one and a function
 * of the repository returning one all rest on somebody's account of the value
 * rather than on the value.
 *
 * Direct means three things together:
 *
 * - **The maker.** A call or `new` of an export the dialect describes as making
 *   an application (`makers`, or one named after an `appType`), imported or
 *   required straight from the package - not a file inside it, and not a module
 *   of the repository handing it on.
 * - **The value.** The receiver is that call, or a chain of methods the dialect
 *   says answer with the application (`express().disable('x-powered-by')`,
 *   `Router().get(…).post(…)`), or a name holding one of those.
 * - **The name.** Whatever holds the value holds only values made that way:
 *   a `const`, or a `let` or `var` nothing in its file assigns again; a
 *   property - a field of a class, `this.app` or `server.app`, or a member of
 *   an object written in place - every write of which the repository makes is
 *   known, made inside its class or its module, and a direct value (P350,
 *   P354); a parameter every caller of whose function, found by its name or
 *   through any reference to it the reading can follow, hands a direct value or
 *   hands nothing to a default that is one (P354). A write the reading cannot
 *   place, a caller it cannot see, or a destructured name is somebody's account
 *   of where the value went.
 */
export const madeDirectly = (expr: TsNode, dialect: RouteDialect): boolean =>
  directly(expr, dialect, 0);

const directly = (expr: TsNode, dialect: RouteDialect, depth: number): boolean => {
  if (depth > MAX_DEPTH) return false;
  const node = unwrap(expr);
  if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    const callee = node.getExpression();
    const exported = exportNamed(callee);
    if (exported !== undefined && madeBy(exported, dialect) !== undefined) return exported.whole;
    return (
      Node.isCallExpression(node) &&
      Node.isPropertyAccessExpression(callee) &&
      answersWithSelf(callee.getName(), dialect) &&
      directly(callee.getExpression(), dialect, depth + 1)
    );
  }
  // A property: `this.app`, `server.app`, `server['app']` (P350, P354).
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const declaration = appDeclaration(node);
    return declaration !== undefined && heldDirectly(declaration, dialect, depth);
  }
  if (!Node.isIdentifier(node)) return false;
  const declaration = appDeclaration(node);
  return declaration !== undefined && declaredDirectly(declaration, dialect, depth);
};

/** Whether a declaration of a name holds only direct values: a `const`, a `let` written once, a parameter. */
const declaredDirectly = (declaration: TsNode, dialect: RouteDialect, depth: number): boolean => {
  if (Node.isParameterDeclaration(declaration)) return parameterMadeDirectly(declaration, dialect, depth);
  if (!Node.isVariableDeclaration(declaration)) return heldDirectly(declaration, dialect, depth);
  if (!Node.isIdentifier(declaration.getNameNode()) || reassigned(declaration)) return false;
  const value = declaration.getInitializer();
  return value !== undefined && directly(value, dialect, depth + 1);
};

/** The operators that can put an application into a name; `+=` cannot. */
const ASSIGNMENTS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

const writtenAgain = new WeakMap<TsNode, boolean>();

/** The assignment a node is the whole left side of, `app = …` or `app ??= …`. */
const assignmentTo = (target: TsNode): TsNode | undefined => {
  const parent = target.getParent();
  return parent !== undefined &&
    Node.isBinaryExpression(parent) &&
    parent.getLeft() === target &&
    ASSIGNMENTS.has(parent.getOperatorToken().getKind())
    ? parent
    : undefined;
};

/** Whether an identifier or a member is the target of an assignment, plain or destructuring. */
const isWritten = (target: TsNode): boolean => {
  if (assignmentTo(target) !== undefined) return true;
  const parent = target.getParent();
  if (parent === undefined) return false;
  // `[app] = others`, `({ app } = others)` and `({ app: this.app } = others)`.
  const destructured =
    Node.isArrayLiteralExpression(parent) ||
    Node.isShorthandPropertyAssignment(parent) ||
    (Node.isPropertyAssignment(parent) && parent.getInitializer() === target);
  if (!destructured) return false;
  const assignment = parent.getFirstAncestorByKind(SyntaxKind.BinaryExpression);
  return assignment?.getOperatorToken().getKind() === SyntaxKind.EqualsToken;
};

/**
 * Whether a `let` or `var` is given another value anywhere in its file.
 *
 * Its file is enough: a module's binding is read-only to every importer, so
 * only the module itself can write it. A `const` is never asked.
 */
const reassigned = (declaration: TsNode): boolean => {
  if (!Node.isVariableDeclaration(declaration)) return true;
  const list = declaration.getParent();
  if (Node.isVariableDeclarationList(list) && list.getDeclarationKind() === VariableDeclarationKind.Const) {
    return false;
  }
  const known = writtenAgain.get(declaration);
  if (known !== undefined) return known;
  const name = declaration.getName();
  const symbol = declaration.getNameNode().getSymbol();
  const found = declaration
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some(
      (identifier) =>
        identifier.getText() === name && isWritten(identifier) && identifier.getSymbol() === symbol,
    );
  writtenAgain.set(declaration, found);
  return found;
};

/**
 * A property an application may be held by (P354): a field of a class
 * (`app = express()`, `private app: Application;`, a parameter property), a
 * member of an object written in place (`{ app: express() }`), or - in
 * JavaScript - the property `this.app = express()` declares in a class.
 */
interface Holder {
  /** The declaration every write of the property names. */
  readonly declaration: TsNode;
  readonly name: string;
  /** The class, or the object written in place, the property is a member of. */
  readonly owner: TsNode;
  /** What the declaration itself gives it, where it gives anything. */
  readonly initial: TsNode | undefined;
}

/** The class a field or a parameter property belongs to. */
const classOf = (node: TsNode): TsNode | undefined =>
  node.getFirstAncestor((each) => Node.isClassDeclaration(each) || Node.isClassExpression(each));

/** What an object written in place is held by, past parentheses and casts. */
const holderOfLiteral = (literal: TsNode): TsNode | undefined => {
  let parent = literal.getParent();
  while (parent !== undefined && (Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isSatisfiesExpression(parent))) {
    parent = parent.getParent();
  }
  return parent;
};

const holderOf = (declaration: TsNode): Holder | undefined => {
  if (Node.isPropertyDeclaration(declaration) || (Node.isParameterDeclaration(declaration) && declaration.isParameterProperty())) {
    const owner = classOf(declaration);
    const nameNode = declaration.getNameNode();
    if (owner === undefined || !(Node.isIdentifier(nameNode) || Node.isPrivateIdentifier(nameNode) || Node.isStringLiteral(nameNode))) return undefined;
    return { declaration, name: declaration.getName(), owner, initial: Node.isPropertyDeclaration(declaration) ? declaration.getInitializer() : undefined };
  }
  if (Node.isPropertyAssignment(declaration) || Node.isShorthandPropertyAssignment(declaration)) {
    const owner = declaration.getParent();
    const nameNode = declaration.getNameNode();
    if (!Node.isObjectLiteralExpression(owner) || !(Node.isIdentifier(nameNode) || Node.isStringLiteral(nameNode))) return undefined;
    // The object has to be the one the property's readers hold: `const server
    // = { app }` or a module's default, never a `let` given another object.
    const holder = holderOfLiteral(owner);
    const settled =
      holder !== undefined &&
      ((Node.isVariableDeclaration(holder) && Node.isIdentifier(holder.getNameNode()) && !reassigned(holder)) ||
        (Node.isExportAssignment(holder) && !holder.isExportEquals()));
    if (!settled) return undefined;
    return { declaration, name: declaration.getName(), owner, initial: Node.isPropertyAssignment(declaration) ? declaration.getInitializer() : undefined };
  }
  if (Node.isBinaryExpression(declaration)) {
    const left = declaration.getLeft();
    const owner = classOf(declaration);
    if (!Node.isPropertyAccessExpression(left) || !Node.isThisExpression(left.getExpression()) || owner === undefined) return undefined;
    return { declaration, name: left.getName(), owner, initial: undefined };
  }
  return undefined;
};

/** One write to a property: the value it puts there, and whether it is written inside the property's class or module. */
interface Write {
  readonly value: TsNode | undefined;
  readonly inside: boolean;
}

interface Writes {
  readonly writes: readonly Write[];
  /** A write by the property's name whose receiver the checker types as nothing: it may be this property. */
  readonly unplaced: boolean;
}

/** Every write by a name anywhere in the project, `<x>.app = …` and `<x>['app'] = …`. */
const writesIn = new WeakMap<object, ReadonlyMap<string, readonly TsNode[]>>();

/**
 * Every write to a property in the project, by the property's name, found in
 * one pass: a reading of every field a class writes would otherwise walk the
 * whole project once per field.
 */
const propertyWrites = (from: TsNode): ReadonlyMap<string, readonly TsNode[]> => {
  const program = programOf(from);
  const known = writesIn.get(program);
  if (known !== undefined) return known;
  const byName = new Map<string, TsNode[]>();
  const add = (name: string, access: TsNode): void => {
    byName.set(name, [...(byName.get(name) ?? []), access]);
  };
  for (const file of from.getProject().getSourceFiles()) {
    if (file.isDeclarationFile() || file.isInNodeModules()) continue;
    for (const access of file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (isWritten(access)) add(access.getName(), access);
    }
    for (const access of file.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
      const key = access.getArgumentExpression();
      if (key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) && isWritten(access)) add(key.getLiteralValue(), access);
    }
  }
  writesIn.set(program, byName);
  return byName;
};

const writesByName = (from: TsNode, name: string): readonly TsNode[] => propertyWrites(from).get(name) ?? [];

const writesOfHolder = new PerProgram<Writes>();

/**
 * The writes to a property (P354), found by its name wherever they are and
 * kept where the checker says they are this property's. A write the checker
 * places on another property of the same name is that one's; a write on a
 * receiver it types as nothing may be this one, and is `unplaced`. Inside means
 * written in the property's own class - any member of it, never a subclass -
 * or, for a member of an object written in place, in the object's module.
 */
const writesOf = (holder: Holder): Writes => {
  const known = writesOfHolder.get(holder.declaration);
  if (known !== undefined) return known;
  const writes: Write[] = [];
  let unplaced = false;
  for (const write of writesByName(holder.declaration, holder.name)) {
    const named = Node.isPropertyAccessExpression(write) ? write.getNameNode() : Node.isElementAccessExpression(write) ? write.getArgumentExpression() : undefined;
    const declarations = named?.getSymbol()?.getDeclarations() ?? [];
    if (declarations.length === 0) {
      unplaced = true;
      continue;
    }
    if (!declarations.includes(holder.declaration)) continue;
    const inside = Node.isObjectLiteralExpression(holder.owner)
      ? write.getSourceFile() === holder.owner.getSourceFile()
      : write.getFirstAncestor((each) => each === holder.owner) !== undefined;
    const assignment = assignmentTo(write);
    writes.push({ value: assignment !== undefined && Node.isBinaryExpression(assignment) ? assignment.getRight() : undefined, inside });
  }
  const found = { writes, unplaced };
  writesOfHolder.set(holder.declaration, found);
  return found;
};

/** The calls that may write any property of an object at once: `Object.assign(target, …)` and its kin. */
const WHOLE_WRITERS = new Set(['Object.assign', 'Object.defineProperty', 'Object.defineProperties', 'Reflect.set']);

const wholeWritesIn = new WeakMap<object, readonly TsNode[]>();

/** Every such call's target in the project, found once. */
const wholeWriteTargets = (from: TsNode): readonly TsNode[] => {
  const program = programOf(from);
  const known = wholeWritesIn.get(program);
  if (known !== undefined) return known;
  const targets: TsNode[] = [];
  for (const file of from.getProject().getSourceFiles()) {
    if (file.isDeclarationFile()) continue;
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const [target] = call.getArguments();
      if (target !== undefined && WHOLE_WRITERS.has(call.getExpression().getText())) targets.push(unwrap(target));
    }
  }
  wholeWritesIn.set(program, targets);
  return targets;
};

/**
 * Whether something may write the property without naming it (P354):
 * `Object.assign(this, options)` in its class, or `Object.assign(server, …)`
 * on an instance of the class or on the object itself.
 */
const writtenWhole = (holder: Holder): boolean =>
  wholeWriteTargets(holder.declaration).some((target) => {
    if (Node.isThisExpression(target)) return classOf(target) === holder.owner;
    const declarations = target.getType().getSymbol()?.getDeclarations() ?? [];
    return declarations.includes(holder.owner);
  });

/**
 * Whether a property holds only what a maker made, as surely as a `const`
 * (P350, P354): every write the repository makes of it is placed, made inside
 * its class or its object's module, and a direct value, and so is what its
 * declaration gives it; nothing writes the object whole. A parameter property
 * is given what its constructor is called with, so that parameter is asked
 * too. A property neither of a class nor of an object written in place - a
 * name a namespace import reads - is its declaration.
 */
const heldDirectly = (declaration: TsNode, dialect: RouteDialect, depth: number): boolean => {
  const holder = holderOf(declaration);
  if (holder === undefined) return Node.isVariableDeclaration(declaration) && declaredDirectly(declaration, dialect, depth);
  const { writes, unplaced } = writesOf(holder);
  if (unplaced || writes.some((write) => !write.inside || write.value === undefined) || writtenWhole(holder)) return false;
  const values = writes.map((write) => write.value as TsNode);
  const given = (value: TsNode): boolean => directly(value, dialect, depth + 1);
  if (Node.isParameterDeclaration(declaration)) {
    return parameterMadeDirectly(declaration, dialect, depth) && values.every(given);
  }
  if (Node.isShorthandPropertyAssignment(declaration)) {
    const named = declaration.getValueSymbol()?.getDeclarations()[0];
    return named !== undefined && declaredDirectly(named, dialect, depth + 1) && values.every(given);
  }
  if (holder.initial !== undefined) values.unshift(holder.initial);
  return values.length > 0 && values.every(given);
};

/**
 * Every value a property declared with none of its own is given (P354): `app;
 * constructor() { this.app = express(); }`, or the property a JavaScript class
 * declares by writing it - for placing what is declared on it where each value
 * is served. Undefined where a write cannot be placed or read, or where
 * something writes the object whole.
 */
export const valuesWrittenTo = (declaration: TsNode): readonly TsNode[] | undefined => {
  const holder = Node.isPropertyDeclaration(declaration) || Node.isBinaryExpression(declaration) ? holderOf(declaration) : undefined;
  if (holder === undefined || holder.initial !== undefined) return undefined;
  const { writes, unplaced } = writesOf(holder);
  if (unplaced || writes.length === 0 || writtenWhole(holder)) return undefined;
  const values: TsNode[] = [];
  for (const write of writes) {
    if (write.value === undefined) return undefined;
    values.push(write.value);
  }
  return values;
};

/**
 * The values a declaration may hold, for telling what it is (R142, P354): its
 * initialiser, and for a property every value the repository writes to it - a
 * field declared bare and given its application by the constructor, `app;
 * constructor() { this.app = express(); }`, or the property a JavaScript
 * class declares by writing it.
 */
const valuesOf = (declaration: TsNode): TsNode[] => {
  const own = valueOf(declaration);
  if (Node.isPropertyAssignment(declaration)) return declaration.getInitializer() === undefined ? [] : [declaration.getInitializer() as TsNode];
  if (Node.isShorthandPropertyAssignment(declaration)) {
    const named = declaration.getValueSymbol()?.getDeclarations()[0];
    return named === undefined ? [] : [named];
  }
  const holder = Node.isPropertyDeclaration(declaration) || Node.isBinaryExpression(declaration) ? holderOf(declaration) : undefined;
  const written = holder === undefined ? [] : writesOf(holder).writes.flatMap((write) => (write.value === undefined ? [] : [write.value]));
  return own === undefined ? written : [own, ...written];
};

/** The arguments of one call of a function. */
type Arguments = readonly TsNode[];

/** How many names a function is handed through on the way to its calls. */
const ALIAS_DEPTH = 6;

/**
 * The node a function's references are searched from: its name, the
 * variable or the member holding it, its class's name for a constructor, or
 * the `default` of a module exporting it with no name of its own.
 */
const searchedFrom = (fn: TsNode): TsNode | undefined => {
  if (Node.isFunctionDeclaration(fn)) {
    return fn.getNameNode() ?? fn.getModifiers().find((each) => each.getKind() === SyntaxKind.DefaultKeyword);
  }
  if (Node.isMethodDeclaration(fn)) {
    const name = fn.getNameNode();
    return Node.isIdentifier(name) || Node.isPrivateIdentifier(name) || Node.isStringLiteral(name) ? name : undefined;
  }
  if (Node.isConstructorDeclaration(fn)) {
    const owner = fn.getParent();
    return Node.isClassDeclaration(owner)
      ? owner.getNameNode() ?? owner.getModifiers().find((each) => each.getKind() === SyntaxKind.DefaultKeyword)
      : undefined;
  }
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return undefined;
  let outer: TsNode = fn;
  let holder = fn.getParent();
  while (holder !== undefined && (Node.isParenthesizedExpression(holder) || Node.isAsExpression(holder) || Node.isSatisfiesExpression(holder))) {
    outer = holder;
    holder = holder.getParent();
  }
  if (holder === undefined) return undefined;
  if (Node.isExportAssignment(holder) && !holder.isExportEquals()) return holder.getFirstChildByKind(SyntaxKind.DefaultKeyword);
  if (Node.isVariableDeclaration(holder) || Node.isPropertyAssignment(holder) || Node.isPropertyDeclaration(holder)) {
    if (holder.getInitializer() !== outer) return undefined;
    const name = holder.getNameNode();
    return Node.isIdentifier(name) || Node.isStringLiteral(name) ? name : undefined;
  }
  return undefined;
};

/** The kinds of a use of a name that hand it on or name a type, and so call nothing. */
const notAUse = (parent: TsNode): boolean =>
  Node.isImportSpecifier(parent) ||
  Node.isExportSpecifier(parent) ||
  Node.isImportClause(parent) ||
  Node.isNamespaceImport(parent) ||
  Node.isExportAssignment(parent) ||
  Node.isTypeReference(parent) ||
  Node.isTypeQuery(parent) ||
  Node.isQualifiedName(parent);

/** Whether a reference is the name of a declaration rather than a use of one. */
const declares = (parent: TsNode, reference: TsNode): boolean =>
  (Node.isFunctionDeclaration(parent) ||
    Node.isClassDeclaration(parent) ||
    Node.isMethodDeclaration(parent) ||
    Node.isPropertyDeclaration(parent) ||
    Node.isVariableDeclaration(parent) ||
    Node.isParameterDeclaration(parent) ||
    Node.isPropertyAssignment(parent)) &&
  parent.getNameNode() === reference;

/**
 * The name a use hands a function on to, whose own uses are then its calls:
 * `const { default: init } = await import('./web')`, `const { init } = api`,
 * `const later = init`, `{ init: init }` and `{ init }`.
 */
const handedTo = (reference: TsNode, value: TsNode): TsNode | undefined => {
  const parent = reference.getParent();
  if (parent === undefined) return undefined;
  if (Node.isBindingElement(parent)) {
    const name = parent.getNameNode();
    return Node.isIdentifier(name) ? name : undefined;
  }
  if (Node.isShorthandPropertyAssignment(parent)) return reference;
  const holder = value.getParent();
  if (holder !== undefined && (Node.isVariableDeclaration(holder) || Node.isPropertyAssignment(holder)) && holder.getInitializer() === value) {
    const name = holder.getNameNode();
    return Node.isIdentifier(name) || Node.isStringLiteral(name) ? name : undefined;
  }
  return undefined;
};

/** Where a reference is in the project, to visit each once. */
const placeOf = (node: TsNode): string => `${node.getSourceFile().getFilePath()}:${node.getStart()}`;

/**
 * Collects the calls of a function through every use of a name for it, and
 * answers whether every use was one it could follow: a call, an import or
 * export handing it on, a type, or a name it is handed to whose uses are
 * followed in turn. Anything else - passed as a value, written into a list -
 * may call it with anything.
 */
const callsThrough = (from: TsNode, fn: TsNode, calls: Set<TsNode>, seen: Set<string>, depth: number): boolean => {
  const references = from.getProject().getLanguageService().findReferencesAsNodes(from as never) as TsNode[];
  for (const reference of references) {
    if (reference === from) continue;
    const place = placeOf(reference);
    if (seen.has(place)) continue;
    seen.add(place);
    const parent = reference.getParent();
    if (parent === undefined) return false;
    if (declares(parent, reference) || notAUse(parent)) continue;
    const callee = Node.isPropertyAccessExpression(parent) && parent.getNameNode() === reference ? parent : reference;
    const call = callee.getParent();
    if (
      call !== undefined &&
      (Node.isCallExpression(call) || (Node.isNewExpression(call) && Node.isConstructorDeclaration(fn))) &&
      call.getExpression() === callee
    ) {
      calls.add(call);
      continue;
    }
    const onward = depth < ALIAS_DEPTH ? handedTo(reference, callee) : undefined;
    if (onward === undefined || !callsThrough(onward, fn, calls, seen, depth + 1)) return false;
  }
  return true;
};

/** What core's search for a function's calls is asked with: the function, or what holds it. */
const forwarderOf = (fn: TsNode): Forwarder | undefined => {
  // Core's search starts from a name; a module's unnamed default has none.
  if (Node.isFunctionDeclaration(fn)) return fn.getName() === undefined ? undefined : fn;
  if (Node.isMethodDeclaration(fn)) return fn;
  const holder = fn.getParent();
  return holder !== undefined && (Node.isVariableDeclaration(holder) || Node.isPropertyDeclaration(holder)) ? holder : undefined;
};

/** A function's module and the names it exports it under, where it exports it. */
interface Exported {
  readonly module: SourceFile;
  readonly names: ReadonlySet<string>;
}

const exportedAs = (fn: TsNode): Exported | undefined => {
  // A method is called through what holds it, never as an export of its own.
  if (Node.isMethodDeclaration(fn)) return undefined;
  const holder = fn.getParent();
  const module = fn.getSourceFile();
  const names = new Set<string>();
  for (const [name, declarations] of module.getExportedDeclarations()) {
    if (declarations.some((declaration) => declaration === fn || declaration === holder)) names.add(name);
  }
  return names.size > 0 ? { module, names } : undefined;
};

const loadsIn = new WeakMap<object, ReadonlyMap<SourceFile, readonly TsNode[]>>();

/** Every `import('./x')` and `require('./x')` in the project, by the module it loads, found once. */
const moduleLoads = (from: TsNode): ReadonlyMap<SourceFile, readonly TsNode[]> => {
  const program = programOf(from);
  const known = loadsIn.get(program);
  if (known !== undefined) return known;
  const byModule = new Map<SourceFile, TsNode[]>();
  for (const file of from.getProject().getSourceFiles()) {
    if (file.isDeclarationFile() || file.isInNodeModules()) continue;
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (callee.getKind() !== SyntaxKind.ImportKeyword && !(Node.isIdentifier(callee) && callee.getText() === 'require')) continue;
      const loaded = call.getArguments()[0]?.getSymbol()?.getDeclarations()[0];
      if (loaded === undefined || !Node.isSourceFile(loaded)) continue;
      byModule.set(loaded, [...(byModule.get(loaded) ?? []), call]);
    }
  }
  loadsIn.set(program, byModule);
  return byModule;
};

/** Past parentheses and casts, to what an expression's value is handed to. */
const outermost = (node: TsNode): TsNode => {
  let current = node;
  let parent = current.getParent();
  while (parent !== undefined && (Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isNonNullExpression(parent) || Node.isSatisfiesExpression(parent))) {
    current = parent;
    parent = current.getParent();
  }
  return current;
};

/** What a search through a module loaded at run time carries along. */
interface Search {
  readonly fn: TsNode;
  readonly names: ReadonlySet<string>;
  readonly calls: Set<TsNode>;
  readonly seen: Set<string>;
}

/**
 * Follows a module's value - what `require('./web')` is, or what `await
 * import('./web')` gives - to the calls of the function it exports (P354):
 * `const { default: init } = …` then `init(app)`, `const web = …` then
 * `web.default(app)`, `(…).default(app)`. Another export read off it is not
 * this function. Anything else done with the module may call it unseen.
 */
const followModule = (value: TsNode, search: Search, depth: number): boolean => {
  const node = outermost(value);
  const parent = node.getParent();
  if (parent === undefined || depth > ALIAS_DEPTH) return false;
  if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === node) {
    if (!search.names.has(parent.getName())) return true;
    const call = outermost(parent).getParent();
    if (call !== undefined && Node.isCallExpression(call) && unwrap(call.getExpression()) === parent) {
      search.calls.add(call);
      return true;
    }
    const onward = handedTo(parent.getNameNode(), parent);
    return onward !== undefined && callsThrough(onward, search.fn, search.calls, search.seen, depth + 1);
  }
  if (!Node.isVariableDeclaration(parent) || parent.getInitializer() !== node) return false;
  const name = parent.getNameNode();
  if (Node.isObjectBindingPattern(name)) {
    for (const element of name.getElements()) {
      if (element.getDotDotDotToken() !== undefined) return false;
      const key = element.getPropertyNameNode()?.getText() ?? element.getName();
      if (!search.names.has(key)) continue;
      const bound = element.getNameNode();
      if (!Node.isIdentifier(bound) || !callsThrough(bound, search.fn, search.calls, search.seen, depth + 1)) return false;
    }
    return true;
  }
  if (!Node.isIdentifier(name)) return false;
  for (const reference of name.findReferencesAsNodes()) {
    const at = reference.getParent();
    if (at === undefined) return false;
    if (notAUse(at)) continue;
    if (!followModule(reference, search, depth + 1)) return false;
  }
  return true;
};

/** Follows a promise of a module - `import('./web')`, a loader's call - to where it is awaited. */
const followPromise = (value: TsNode, search: Search, depth: number): boolean => {
  const awaited = outermost(value).getParent();
  return awaited !== undefined && Node.isAwaitExpression(awaited) && followModule(awaited, search, depth);
};

/** Whether a use of an object of loaders only reads its keys: `Object.keys(services)`. */
const readsKeys = (reference: TsNode): boolean => {
  const call = outermost(reference).getParent();
  return call !== undefined && Node.isCallExpression(call) && call.getExpression().getText() === 'Object.keys';
};

/**
 * Follows a function that loads a module, `() => import('./web')`, to its
 * calls (P354): held by a name, `load()`; or a member of an object of
 * loaders, `services.web()`, or `services[name]()` with a key that may be
 * this one - the shape a service started by name is written in.
 */
const followLoader = (loader: TsNode, search: Search, depth: number): boolean => {
  const holder = outermost(loader).getParent();
  if (holder === undefined || depth > ALIAS_DEPTH) return false;
  const callOf = (callee: TsNode): TsNode | undefined => {
    const call = outermost(callee).getParent();
    return call !== undefined && Node.isCallExpression(call) && unwrap(call.getExpression()) === callee ? call : undefined;
  };
  const named = Node.isVariableDeclaration(holder) ? holder.getNameNode() : undefined;
  if (named !== undefined && Node.isIdentifier(named) && !reassigned(holder)) {
    for (const reference of named.findReferencesAsNodes()) {
      const at = reference.getParent();
      if (at !== undefined && notAUse(at)) continue;
      const call = callOf(reference);
      if (call === undefined || !followPromise(call, search, depth + 1)) return false;
    }
    return true;
  }
  if (!Node.isPropertyAssignment(holder)) return false;
  const key = holder.getName();
  const object = holderOfLiteral(holder.getParent());
  const objectName = object !== undefined && Node.isVariableDeclaration(object) ? object.getNameNode() : undefined;
  if (object === undefined || objectName === undefined || !Node.isIdentifier(objectName) || reassigned(object)) return false;
  for (const reference of objectName.findReferencesAsNodes()) {
    const at = reference.getParent();
    if (at === undefined) return false;
    if (notAUse(at) || readsKeys(reference)) continue;
    const member =
      Node.isPropertyAccessExpression(at) && at.getExpression() === reference
        ? at.getName() === key
          ? at
          : undefined
        : Node.isElementAccessExpression(at) && at.getExpression() === reference
          ? at
          : null;
    if (member === null) return false;
    if (member === undefined) continue;
    if (Node.isElementAccessExpression(member)) {
      const written = member.getArgumentExpression();
      if (written !== undefined && (Node.isStringLiteral(written) || Node.isNoSubstitutionTemplateLiteral(written)) && written.getLiteralValue() !== key) continue;
    }
    const call = callOf(member);
    if (call === undefined || !followPromise(call, search, depth + 1)) return false;
  }
  return true;
};

/**
 * Follows every load of the module a function is exported from, written
 * anywhere in the project (P354). The checker's own search for a function's
 * uses looks only in the modules that import its module, so a module loaded
 * through a map of lazy imports - a service started by its name - is found
 * here instead, or the search says it cannot be.
 */
const followLoads = (exported: Exported, search: Search): boolean =>
  (moduleLoads(exported.module).get(exported.module) ?? []).every((load) => {
    const callee = (load as CallExpression).getExpression();
    if (callee.getKind() !== SyntaxKind.ImportKeyword) return followModule(load, search, 0);
    const parent = outermost(load).getParent();
    if (parent !== undefined && Node.isAwaitExpression(parent)) return followModule(parent, search, 0);
    return parent !== undefined && Node.isArrowFunction(parent) && parent.getBody() === outermost(load) && followLoader(parent, search, 0);
  });

const callersFound = new PerProgram<readonly Arguments[] | null>();

/**
 * The arguments of every call of a function, or undefined when some use of it
 * may call it unseen (P354). Found by its name, through what it is imported
 * and destructured as, through every load of its module at run time - a
 * service's default reached by `import()` from a map of loaders included -
 * and through receivers the checker types as nothing (core's `callSitesOf`).
 */
const callersOf = (fn: TsNode): readonly Arguments[] | undefined => {
  const known = callersFound.get(fn);
  if (known !== undefined) return known ?? undefined;
  const from = searchedFrom(fn);
  const calls = new Set<TsNode>();
  const seen = new Set<string>();
  const exported = exportedAs(fn);
  let found: readonly Arguments[] | undefined;
  if (
    from !== undefined &&
    callsThrough(from, fn, calls, seen, 0) &&
    (exported === undefined || followLoads(exported, { fn, names: exported.names, calls, seen }))
  ) {
    const forwarder = forwarderOf(fn);
    for (const call of forwarder === undefined ? [] : callSitesOf(forwarder)) calls.add(call);
    found = [...calls].map((call) => (Node.isCallExpression(call) || Node.isNewExpression(call) ? call.getArguments() : []));
  }
  callersFound.set(fn, found ?? null);
  return found;
};

/** Whether the arguments of a call hand the parameter at `index` nothing: none written, `undefined`, `void 0`. */
const handsNothing = (args: Arguments, index: number): boolean => {
  const arg = args[index];
  if (arg === undefined) return true;
  const value = unwrap(arg);
  return (Node.isIdentifier(value) && value.getText() === 'undefined') || (Node.isVoidExpression(value) && Node.isNumericLiteral(value.getExpression()));
};


const handedValues = new PerProgram<readonly TsNode[] | null>();

/**
 * What a parameter is given, call by call (P354): each caller's argument for
 * it, or its default where a caller hands nothing - or undefined where that
 * cannot all be told: a caller the reading cannot see, a spread in front of
 * it, nothing handed and no default, or a function that gives the parameter
 * another value itself. A call by which the function hands the parameter on
 * to itself, `walk(app, rest)`, gives it what its other callers did and adds
 * nothing.
 *
 * Whether a parameter holds what a maker made is asked of these, and so is
 * where an application arriving as one is served: at every place each value
 * handed to it is.
 */
export const valuesHandedTo = (parameter: TsNode): readonly TsNode[] | undefined => {
  if (!Node.isParameterDeclaration(parameter) || parameter.isRestParameter() || !Node.isIdentifier(parameter.getNameNode())) return undefined;
  const known = handedValues.get(parameter);
  if (known !== undefined) return known ?? undefined;
  const found = valuesFromCallers(parameter);
  handedValues.set(parameter, found ?? null);
  return found;
};

const valuesFromCallers = (parameter: ParameterDeclaration): readonly TsNode[] | undefined => {
  const fn = parameter.getParent();
  if (!Node.isParametered(fn)) return undefined;
  const symbol = parameter.getNameNode().getSymbol();
  const written = fn
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((identifier) => identifier.getText() === parameter.getName() && isWritten(identifier) && identifier.getSymbol() === symbol);
  if (written) return undefined;
  // A `this` parameter is a type, and no caller writes an argument for it.
  const index = fn.getParameters().filter((each) => each.getName() !== 'this').indexOf(parameter);
  const callers = index < 0 ? undefined : callersOf(fn);
  if (callers === undefined) return undefined;
  const fallback = parameter.getInitializer();
  const values: TsNode[] = [];
  for (const args of callers) {
    if (args.slice(0, index + 1).some((arg) => Node.isSpreadElement(arg))) return undefined;
    if (handsNothing(args, index)) {
      if (fallback === undefined) return undefined;
      values.push(fallback);
      continue;
    }
    const handed = unwrap(args[index] as TsNode);
    if (Node.isIdentifier(handed) && appDeclaration(handed) === parameter) continue;
    values.push(handed);
  }
  return values.length > 0 ? values : undefined;
};

/** The parameters being asked about, so two functions handing a parameter to each other are not asked forever. */
const parametersAsked = new Set<TsNode>();

const parameterAnswers = new PerProgram<boolean>();

/**
 * Whether a parameter holds only what a maker made, as surely as a `const`
 * (P350, P354): every value it is given - by every caller of its function,
 * at least one, or by its default where a caller hands nothing - is direct.
 * A caller the reading cannot see, or one handing it anything else, leaves it
 * an account of the value.
 */
const parameterMadeDirectly = (parameter: TsNode, dialect: RouteDialect, depth: number): boolean => {
  const known = parameterAnswers.get(parameter);
  if (known !== undefined) return known;
  if (parametersAsked.has(parameter)) return false;
  const values = valuesHandedTo(parameter);
  if (values === undefined) return false;
  // Only an answer reached with no other parameter in question is kept: one
  // reached inside a cycle was cut short by it.
  const outermost = parametersAsked.size === 0;
  parametersAsked.add(parameter);
  let answer = false;
  try {
    answer = values.every((value) => directly(value, dialect, depth + 1));
  } finally {
    parametersAsked.delete(parameter);
  }
  if (outermost) parameterAnswers.set(parameter, answer);
  return answer;
};
