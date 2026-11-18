import { originOfValue, packageOfSpecifier } from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
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
      : Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)
        ? appDeclaration(node)
        : undefined;
  if (declaration === undefined) return undefined;
  const written = STATED_TYPE[declaration.getKind()]?.(declaration);
  // An annotation is the author's own statement of what the value is, and it is
  // the answer whichever way it goes: `app: Express` is an application, and
  // `settings: AppSettings = express()` is a sign the reading has gone wrong.
  if (written !== undefined) return ofWrittenType(written, dialect, depth);
  const value = valueOf(declaration);
  return value === undefined ? undefined : ofValue(value, dialect, depth + 1);
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
 * destructured member, a class of the repository extending one, a function of
 * the repository returning one and a value arriving as a parameter all rest on
 * somebody's account of the value rather than on the value.
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
 * - **The name.** A variable holding that value and only it: a `const`, or a
 *   `let` or `var` nothing in its file assigns again; a field of the instance
 *   (`readonly app = express()`) nothing but its own class's constructor
 *   writes, every value it is given made directly; a parameter whose default
 *   is made directly and that every caller of its function hands nothing
 *   (P350). A static field, a parameter a caller may hand something, or a
 *   destructured name is somebody's account of where the value went.
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
  // `this.app`, a field of the instance (P350).
  if (Node.isPropertyAccessExpression(node) && Node.isThisExpression(node.getExpression())) {
    const declaration = appDeclaration(node);
    if (declaration !== undefined && Node.isPropertyDeclaration(declaration)) return fieldMadeDirectly(declaration, dialect, depth);
    if (declaration !== undefined && Node.isParameterDeclaration(declaration) && declaration.isParameterProperty()) {
      return parameterMadeDirectly(declaration, dialect, depth) && !writtenOutside(declaration);
    }
    return false;
  }
  if (!Node.isIdentifier(node)) return false;
  const declaration = appDeclaration(node);
  if (declaration !== undefined && Node.isParameterDeclaration(declaration)) return parameterMadeDirectly(declaration, dialect, depth);
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return false;
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

/** Whether an identifier is the target of an assignment, plain or destructuring. */
const isWritten = (identifier: TsNode): boolean => {
  const parent = identifier.getParent();
  if (parent === undefined) return false;
  if (Node.isBinaryExpression(parent)) {
    return parent.getLeft() === identifier && ASSIGNMENTS.has(parent.getOperatorToken().getKind());
  }
  // `[app] = others` and `({ app } = others)`.
  if (!Node.isArrayLiteralExpression(parent) && !Node.isShorthandPropertyAssignment(parent)) return false;
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

/** The member a write to a field is in: the constructor, another member, or none of the class. */
const memberOf = (node: TsNode): TsNode | undefined =>
  node.getFirstAncestor(
    (each) =>
      Node.isConstructorDeclaration(each) ||
      Node.isMethodDeclaration(each) ||
      Node.isGetAccessorDeclaration(each) ||
      Node.isSetAccessorDeclaration(each) ||
      Node.isPropertyDeclaration(each) ||
      Node.isClassStaticBlockDeclaration(each),
  );

/** A field or a parameter property: what has a name. */
type Named = TsNode & { getName(): string };

/** The writes to a field anywhere in the project, `<x>.app = …` and `<x>['app'] = …`, by its name. */
const fieldWrites = (field: Named): TsNode[] => {
  const name = field.getName();
  const found: TsNode[] = [];
  for (const file of field.getSourceFile().getProject().getSourceFiles()) {
    if (!file.getFullText().includes(name)) continue;
    for (const access of file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (access.getName() === name && isWritten(access)) found.push(access);
    }
    for (const access of file.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
      const key = access.getArgumentExpression();
      if (key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) && key.getLiteralValue() === name && isWritten(access)) found.push(access);
    }
  }
  return found;
};

const fieldWritesOf = new WeakMap<TsNode, readonly TsNode[]>();

/** The writes to a field, remembered per field. */
const writesOf = (field: Named): readonly TsNode[] => {
  const known = fieldWritesOf.get(field);
  if (known !== undefined) return known;
  const found = fieldWrites(field);
  fieldWritesOf.set(field, found);
  return found;
};

/** The class a field or a parameter property belongs to. */
const classOf = (field: TsNode): TsNode | undefined => field.getFirstAncestor((each) => Node.isClassDeclaration(each) || Node.isClassExpression(each));

/** Whether a write is `this.<field> = …` in the constructor of the field's own class. */
const inOwnConstructor = (write: TsNode, owner: TsNode | undefined): boolean => {
  const member = memberOf(write);
  if (member === undefined || !Node.isConstructorDeclaration(member) || member.getParent() !== owner) return false;
  const receiver = Node.isPropertyAccessExpression(write) || Node.isElementAccessExpression(write) ? write.getExpression() : undefined;
  return receiver !== undefined && Node.isThisExpression(receiver);
};

/**
 * Whether a field, or a parameter property, is written anywhere but in its
 * own class's constructor (P350): another member of the class, a subclass,
 * code holding an instance. Found by the name, wherever it is written - with
 * nothing installed a receiver's type is nobody's - so a write to a field of
 * the same name elsewhere counts too, the safe way.
 */
const writtenOutside = (field: Named): boolean => {
  const owner = classOf(field);
  return writesOf(field).some((write) => !inOwnConstructor(write, owner));
};

/**
 * Whether a field holds what a maker made, as surely as a `const` (P350):
 * `readonly app = express()`, `private router = Router()`, or a field the
 * constructor gives one - every value it is given, by its initialiser and by
 * its own class's constructor, made directly, and it is written nowhere else.
 * A static field is the class's, written wherever the class is reachable, and
 * stays an account of the value.
 */
const fieldMadeDirectly = (field: TsNode, dialect: RouteDialect, depth: number): boolean => {
  if (!Node.isPropertyDeclaration(field) || field.isStatic() || writtenOutside(field)) return false;
  const values: TsNode[] = [];
  const initializer = field.getInitializer();
  if (initializer !== undefined) values.push(initializer);
  for (const write of writesOf(field)) {
    const assignment = write.getParent();
    if (assignment === undefined || !Node.isBinaryExpression(assignment) || assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return false;
    values.push(assignment.getRight());
  }
  return values.length > 0 && values.every((value) => directly(value, dialect, depth + 1));
};

/** The name a function is called by: its own, the variable holding it, its class's for a constructor. */
const calledAs = (fn: TsNode): TsNode | undefined => {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getNameNode();
  if (Node.isConstructorDeclaration(fn)) {
    const owner = fn.getParent();
    return Node.isClassDeclaration(owner) ? owner.getNameNode() : undefined;
  }
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const holder = fn.getParent();
    return holder !== undefined && Node.isVariableDeclaration(holder) && holder.getInitializer() === fn && Node.isIdentifier(holder.getNameNode()) ? holder.getNameNode() : undefined;
  }
  return undefined;
};

/** Whether the arguments of a call hand the parameter at `index` nothing: none written, `undefined`, `void 0`. */
const handsNothing = (args: readonly TsNode[], index: number): boolean => {
  if (args.slice(0, index + 1).some((arg) => Node.isSpreadElement(arg))) return false;
  const arg = args[index];
  if (arg === undefined) return true;
  const value = unwrap(arg);
  return (Node.isIdentifier(value) && value.getText() === 'undefined') || (Node.isVoidExpression(value) && Node.isNumericLiteral(value.getExpression()));
};

const callersHandNothing = new WeakMap<TsNode, Map<number, boolean>>();

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

/**
 * Whether every place a function is used calls it handing the parameter at
 * `index` nothing (P350), and there is at least one: a call by its name, a
 * method's call on anything by its name, a `new` of a constructor's class. An
 * import or an export hands it on and is not a use; a type naming the class
 * is none either. Anything else - passed as a value, called through
 * `super(…)`, a spread - may hand it anything, and is no.
 */
const everyCallerHandsNothing = (fn: TsNode, index: number): boolean => {
  const known = callersHandNothing.get(fn)?.get(index);
  if (known !== undefined) return known;
  const name = calledAs(fn);
  let calls = 0;
  let ok = name !== undefined && Node.isIdentifier(name);
  if (name !== undefined && Node.isIdentifier(name)) {
    for (const ref of name.findReferencesAsNodes()) {
      if (ref === name) continue;
      const parent = ref.getParent();
      if (parent === undefined || notAUse(parent)) continue;
      const callee = Node.isPropertyAccessExpression(parent) && parent.getNameNode() === ref ? parent : ref;
      const call = callee.getParent();
      const isCall = call !== undefined && (Node.isCallExpression(call) || (Node.isNewExpression(call) && Node.isConstructorDeclaration(fn))) && call.getExpression() === callee;
      if (!isCall || !handsNothing(call.getArguments(), index)) {
        ok = false;
        break;
      }
      calls += 1;
    }
  }
  const answer = ok && calls > 0;
  callersHandNothing.set(fn, (callersHandNothing.get(fn) ?? new Map<number, boolean>()).set(index, answer));
  return answer;
};

/**
 * Whether a parameter holds what a maker made, as surely as a `const`
 * (P350): its default is a maker's call, nothing in its function gives it
 * another value, and every caller of the function hands it nothing, so the
 * default is the value every time. A caller that may hand it something
 * leaves it an account of the value.
 */
const parameterMadeDirectly = (parameter: TsNode, dialect: RouteDialect, depth: number): boolean => {
  if (!Node.isParameterDeclaration(parameter) || parameter.isRestParameter() || !Node.isIdentifier(parameter.getNameNode())) return false;
  const value = parameter.getInitializer();
  if (value === undefined || !directly(value, dialect, depth + 1)) return false;
  const fn = parameter.getParent();
  const symbol = parameter.getNameNode().getSymbol();
  const written = fn
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((identifier) => identifier.getText() === parameter.getName() && isWritten(identifier) && identifier.getSymbol() === symbol);
  if (written) return false;
  const index = Node.isIndexSignatureDeclaration(fn) ? -1 : fn.getParameters().indexOf(parameter);
  return index >= 0 && everyCallerHandsNothing(fn, index);
};
