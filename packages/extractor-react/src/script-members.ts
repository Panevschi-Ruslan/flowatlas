import { namedFunction, startLineOf, type NamedFunction } from '@flowatlas/core';
import type { Block, Node as TsNode, ObjectLiteralExpression, SourceFile, Statement } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * The functions a plain script writes as members (P310, P311).
 *
 * Plain browser code keeps its functions where no module function is: as the
 * methods of an object written in place (`const api = { load() { ... } }`,
 * `export default { fetchUsers() { ... } }`) and as the members of a
 * constructor's prototype (`Store.prototype.load = function () { ... }`,
 * `Store.prototype = { load() {} }`, `Object.assign(Store.prototype, { load()
 * {} })`). Each is a function another script calls by its member's name -
 * `api.load()`, `store.load()` on a `new Store()` - and a request written in
 * one is the page's as much as one written in a declared function. So each is
 * a function of its own, named by where it is kept: `api.load`,
 * `api.users.list` for an object inside the object, `default.fetchUsers` for a
 * module's default, `Store.load` for a prototype's.
 *
 * Where it is kept is also where an assignment puts it (P311): on the page,
 * `window.shop = { load() {} }` (`shop.load`, which another script calls as
 * `shop.load()` with nothing declared), and on a CommonJS module's exports,
 * `module.exports = { load() {} }`, `exports.load = function`,
 * `module.exports.load = function` (`module.load`, which the compiler joins a
 * `require('./api').load()` to). A getter and a setter are functions as a
 * method is (`api.items`, `api.items=`), run where the property is read or
 * written.
 *
 * Only what the top of a script writes, as for module functions - and the top
 * of a wrapper the script runs at once, `(function () { ... })()`, `!function
 * () { ... }()`, `(() => { ... })()`, which is the top of a plain script kept
 * out of the page's globals (P311): its functions, its objects' and
 * prototypes' members, and what it hands the page or returns to the name it is
 * kept under (`var shop = (function () { return { load: load }; })()`). A
 * member of an object built inside any other function is reachable only
 * through that function.
 */

/** One member function, with what else the checker may hand back for it and whose instances have it. */
export interface ScriptMember {
  readonly fn: NamedFunction;
  /** The declarations of the constructor whose instances have it, for a prototype's member. */
  readonly owners: readonly TsNode[];
  /** Other nodes the checker hands back for it: the `Store.prototype.load` or `exports.load` an assignment writes. */
  readonly also: readonly TsNode[];
  /**
   * The names a script elsewhere calls it by with nothing declared, where the
   * script hands it to the page (P311): `shop.load` for `window.shop = {
   * load() {} }`, `Shop.load` for `window.Shop = api` inside a wrapper.
   */
  readonly globals: readonly string[];
}

/** What a script keeps as functions. */
export interface ScriptReading {
  readonly members: readonly ScriptMember[];
  /**
   * The constructors a script hands the page under a name (P311): `window.Store
   * = Store` inside a wrapper, so another script's `new Store()` is an instance
   * of it though nothing there declares it.
   */
  readonly constructors: ReadonlyMap<string, readonly TsNode[]>;
}

/** How deep objects inside an object are read for members. */
const DEPTH = 3;

/** How deep wrappers inside wrappers are read. */
const WRAPPER_DEPTH = 2;

/** The names a script reaches the page's own object by. */
const PAGE_ROOTS = new Set(['window', 'globalThis', 'self']);

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isSatisfiesExpression(current)) current = current.getExpression();
  return current;
};

/** A member's name as written: an identifier or a string; none for a computed one. */
const memberName = (node: TsNode): string | undefined => {
  if (Node.isIdentifier(node) || Node.isPrivateIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  return undefined;
};

const member = (fn: NamedFunction, owners: readonly TsNode[] = [], also: readonly TsNode[] = []): ScriptMember => ({ fn, owners, also, globals: [] });

/** The functions an object written in place holds, each named under `prefix`, and those of the objects inside it. */
const objectMembers = (object: ObjectLiteralExpression, prefix: string, owners: readonly TsNode[], depth = 0): ScriptMember[] => {
  const found: ScriptMember[] = [];
  for (const property of object.getProperties()) {
    if (Node.isMethodDeclaration(property) || Node.isGetAccessorDeclaration(property) || Node.isSetAccessorDeclaration(property)) {
      const name = memberName(property.getNameNode());
      const body = property.getBody();
      if (name === undefined || body === undefined) continue;
      // A setter runs where the property is written, a getter where it is read (P311).
      const kept = Node.isSetAccessorDeclaration(property) ? `${prefix}.${name}=` : `${prefix}.${name}`;
      found.push(member({ name: kept, declaration: property, body, line: startLineOf(property) }, owners));
      continue;
    }
    if (!Node.isPropertyAssignment(property)) continue;
    const name = memberName(property.getNameNode());
    const written = property.getInitializer();
    if (name === undefined || written === undefined) continue;
    const value = unwrap(written);
    if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) {
      found.push(member({ name: `${prefix}.${name}`, declaration: property, body: value.getBody(), line: startLineOf(property) }, owners));
    } else if (Node.isObjectLiteralExpression(value) && depth < DEPTH) {
      // An object inside a prototype's object is no member of the instances.
      found.push(...objectMembers(value, `${prefix}.${name}`, [], depth + 1));
    }
  }
  return found;
};

/** The declarations a constructor's name stands for. */
const declarationsOf = (name: TsNode): TsNode[] => {
  const symbol = name.getSymbol();
  return symbol === undefined ? [] : [...(symbol.getAliasedSymbol() ?? symbol).getDeclarations()];
};

/** `C` of `C.prototype`, where an expression is one. */
const prototypeOf = (node: TsNode): TsNode | undefined => {
  const target = unwrap(node);
  if (!Node.isPropertyAccessExpression(target) || target.getName() !== 'prototype') return undefined;
  const owner = unwrap(target.getExpression());
  return Node.isIdentifier(owner) ? owner : undefined;
};

/** The members a `C.prototype.m = function`, `C.prototype = { … }` or `Object.assign(C.prototype, { … })` writes. */
const prototypeMembers = (statement: TsNode): ScriptMember[] => {
  if (!Node.isExpressionStatement(statement)) return [];
  const expression = unwrap(statement.getExpression());
  if (Node.isBinaryExpression(expression) && expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    const left = unwrap(expression.getLeft());
    const right = unwrap(expression.getRight());
    const whole = prototypeOf(left);
    if (whole !== undefined && Node.isObjectLiteralExpression(right)) return objectMembers(right, whole.getText(), declarationsOf(whole));
    if (!Node.isPropertyAccessExpression(left) || (!Node.isArrowFunction(right) && !Node.isFunctionExpression(right))) return [];
    const owner = prototypeOf(left.getExpression());
    if (owner === undefined) return [];
    const fn: NamedFunction = { name: `${owner.getText()}.${left.getName()}`, declaration: right, body: right.getBody(), line: startLineOf(statement) };
    return [member(fn, declarationsOf(owner), [left])];
  }
  if (Node.isCallExpression(expression) && expression.getExpression().getText() === 'Object.assign') {
    const [target, ...sources] = expression.getArguments();
    const owner = target === undefined ? undefined : prototypeOf(target);
    if (owner === undefined) return [];
    return sources.flatMap((source) => {
      const object = unwrap(source);
      return Node.isObjectLiteralExpression(object) ? objectMembers(object, owner.getText(), declarationsOf(owner)) : [];
    });
  }
  return [];
};

/**
 * Where an assignment keeps its value, as the names a caller writes (P311):
 * `window.shop.load` is `shop.load` on the page; `module.exports.load` and
 * `exports.load` are `module.load`, `module.exports` itself `module`; any
 * other chain on a name is that chain. Nothing for a chain on anything else
 * (a call, `this`), or through a computed member.
 */
export const keptAt = (node: TsNode): { names: readonly string[]; page: boolean } | undefined => {
  const names: string[] = [];
  let at = unwrap(node);
  for (;;) {
    if (Node.isPropertyAccessExpression(at)) {
      names.unshift(at.getName());
      at = unwrap(at.getExpression());
      continue;
    }
    if (Node.isElementAccessExpression(at)) {
      const argument = at.getArgumentExpression();
      const name = argument === undefined ? undefined : memberName(argument);
      if (name === undefined) return undefined;
      names.unshift(name);
      at = unwrap(at.getExpression());
      continue;
    }
    break;
  }
  if (!Node.isIdentifier(at)) return undefined;
  const root = at.getText();
  if (PAGE_ROOTS.has(root)) return names.length === 0 ? undefined : { names, page: true };
  if (root === 'module' && names[0] === 'exports') return { names: ['module', ...names.slice(1)], page: false };
  if (root === 'exports') return { names: ['module', ...names], page: false };
  return { names: [root, ...names], page: false };
};

/**
 * The body of a function a statement runs at once, where it is one (P311):
 * `(function () { … })()`, `(function () { … }())`, `!function () { … }()`,
 * `void function () { … }()`, `(() => { … })()`, `(function ($) { … })(jQuery)`
 * and `(function () { … }).call(this)`.
 */
export const wrapperBody = (expression: TsNode): Block | undefined => {
  let at = unwrap(expression);
  if (Node.isPrefixUnaryExpression(at)) at = unwrap(at.getOperand());
  else if (Node.isVoidExpression(at)) at = unwrap(at.getExpression());
  if (!Node.isCallExpression(at)) return undefined;
  let callee = unwrap(at.getExpression());
  if (Node.isPropertyAccessExpression(callee) && (callee.getName() === 'call' || callee.getName() === 'apply')) callee = unwrap(callee.getExpression());
  if (!Node.isFunctionExpression(callee) && !Node.isArrowFunction(callee)) return undefined;
  const body = callee.getBody();
  return Node.isBlock(body) ? body : undefined;
};

/** What one scope of a script - its top, or a wrapper's - hands elsewhere by a name. */
interface Handed {
  /** The name it is handed out under: `Shop` for `window.Shop = api`. */
  readonly as: string;
  /** The name it is kept under in the scope. */
  readonly local: TsNode;
}

/**
 * The members one scope keeps: the top of the script (`inner` false), or a
 * wrapper's body (`inner` true), whose own functions are kept as the top's
 * are, and whose `return` hands its object to `returnedAs`.
 */
const scopeMembers = (statements: readonly Statement[], inner: boolean, returnedAs: string | undefined, constructors: Map<string, TsNode[]>, depth: number): ScriptMember[] => {
  const found: ScriptMember[] = [];
  const handed: Handed[] = [];
  for (const statement of statements) {
    if (Node.isFunctionDeclaration(statement)) {
      const fn = inner ? namedFunction(statement) : undefined;
      if (fn !== undefined) found.push(member(fn));
      continue;
    }
    if (Node.isVariableStatement(statement)) {
      for (const declaration of statement.getDeclarations()) {
        const name = declaration.getNameNode();
        const written = declaration.getInitializer();
        if (!Node.isIdentifier(name) || written === undefined) continue;
        const value = unwrap(written);
        if (Node.isObjectLiteralExpression(value)) {
          found.push(...objectMembers(value, name.getText(), []));
          continue;
        }
        const fn = inner ? namedFunction(declaration) : undefined;
        if (fn !== undefined) {
          found.push(member(fn));
          continue;
        }
        // `var shop = (function () { …; return { load: load }; })()`.
        const wrapped = depth < WRAPPER_DEPTH ? wrapperBody(value) : undefined;
        if (wrapped !== undefined) found.push(...scopeMembers(wrapped.getStatements(), true, name.getText(), constructors, depth + 1));
      }
      continue;
    }
    if (Node.isExportAssignment(statement)) {
      if (statement.isExportEquals()) continue;
      const value = unwrap(statement.getExpression());
      if (Node.isObjectLiteralExpression(value)) found.push(...objectMembers(value, 'default', []));
      continue;
    }
    if (Node.isReturnStatement(statement)) {
      const returned = statement.getExpression();
      const value = returned === undefined ? undefined : unwrap(returned);
      if (inner && returnedAs !== undefined && value !== undefined && Node.isObjectLiteralExpression(value)) found.push(...objectMembers(value, returnedAs, []));
      continue;
    }
    if (!Node.isExpressionStatement(statement)) continue;
    const wrapped = depth < WRAPPER_DEPTH ? wrapperBody(statement.getExpression()) : undefined;
    if (wrapped !== undefined) {
      found.push(...scopeMembers(wrapped.getStatements(), true, undefined, constructors, depth + 1));
      continue;
    }
    const ofPrototype = prototypeMembers(statement);
    if (ofPrototype.length > 0) {
      found.push(...ofPrototype);
      continue;
    }
    found.push(...assignedMembers(statement, handed));
  }
  return withHanded(found, handed, constructors);
};

/**
 * The members an assignment keeps where it says (P311): a function, or an
 * object's functions, put on the page, on a module's exports or on any named
 * object - and a name a scope's own value is handed to the page under,
 * collected in `handed`.
 */
const assignedMembers = (statement: Statement & { getExpression(): TsNode }, handed: Handed[]): ScriptMember[] => {
  const expression = unwrap(statement.getExpression());
  if (!Node.isBinaryExpression(expression) || expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return [];
  const left = unwrap(expression.getLeft());
  const kept = keptAt(left);
  // A prototype's own is read by `prototypeMembers`; a bare name is a variable.
  if (kept === undefined || kept.names.includes('prototype') || (!kept.page && kept.names.length < 2 && kept.names[0] !== 'module')) return [];
  const name = kept.names.join('.');
  const right = unwrap(expression.getRight());
  const globals = (each: ScriptMember): ScriptMember => (kept.page ? { ...each, globals: [each.fn.name] } : each);
  if (Node.isArrowFunction(right) || Node.isFunctionExpression(right)) {
    return [globals(member({ name, declaration: right, body: right.getBody(), line: startLineOf(statement) }, [], [left]))];
  }
  if (Node.isObjectLiteralExpression(right)) return objectMembers(right, name, []).map(globals);
  if (kept.page && Node.isIdentifier(right)) handed.push({ as: name, local: right });
  return [];
};

/**
 * What a scope hands the page by a name it keeps it under (`window.Shop =
 * api`, `window.Store = Store`): the members kept under that name are called
 * by the handed one as well, and a constructor is made by it.
 */
const withHanded = (found: ScriptMember[], handed: readonly Handed[], constructors: Map<string, TsNode[]>): ScriptMember[] => {
  if (handed.length === 0) return found;
  for (const { as, local } of handed) {
    const declarations = declarationsOf(local).filter((each) => Node.isFunctionDeclaration(each) || Node.isVariableDeclaration(each));
    if (declarations.length > 0 && !constructors.has(as)) constructors.set(as, declarations);
  }
  return found.map((each) => {
    const names = handed.flatMap(({ as, local }) => {
      const name = local.getText();
      if (each.fn.name === name) return [as];
      return each.fn.name.startsWith(`${name}.`) ? [`${as}${each.fn.name.slice(name.length)}`] : [];
    });
    return names.length === 0 ? each : { ...each, globals: [...each.globals, ...names] };
  });
};

/** Every member function a script keeps, and the constructors it hands the page. */
export const scriptMembers = (sourceFile: SourceFile): ScriptReading => {
  const constructors = new Map<string, TsNode[]>();
  const members = scopeMembers(sourceFile.getStatements(), false, undefined, constructors, 0);
  return { members, constructors };
};
