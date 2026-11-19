import { namedFunction, startLineOf, type NamedFunction } from '@flowatlas/core';
import type { ArrowFunction, FunctionExpression, Node as TsNode, ObjectLiteralExpression, SourceFile, Statement } from 'ts-morph';
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
 * kept under (`var shop = (function () { return { load: load }; })()`). The
 * same for a wrapper the page runs once it has loaded (P317):
 * `document.addEventListener('DOMContentLoaded', function () { … })`,
 * `$(function () { … })`, which is also a function of its own, the way in its
 * requests are made from - and so is a wrapper run at once (P323), whose top
 * writes requests and calls outside any function it keeps. A member of an
 * object built inside any other function is reachable only through that
 * function.
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
 * The function a statement runs at once, where it is one whose body is a
 * block (P311): `(function () { … })()`, `(function () { … }())`, `!function
 * () { … }()`, `void function () { … }()`, `(() => { … })()`, `(function ($)
 * { … })(jQuery)` and `(function () { … }).call(this)`.
 */
const wrapperRun = (expression: TsNode): ArrowFunction | FunctionExpression | undefined => {
  let at = unwrap(expression);
  if (Node.isPrefixUnaryExpression(at)) at = unwrap(at.getOperand());
  else if (Node.isVoidExpression(at)) at = unwrap(at.getExpression());
  if (!Node.isCallExpression(at)) return undefined;
  let callee = unwrap(at.getExpression());
  if (Node.isPropertyAccessExpression(callee) && (callee.getName() === 'call' || callee.getName() === 'apply')) callee = unwrap(callee.getExpression());
  if (!Node.isFunctionExpression(callee) && !Node.isArrowFunction(callee)) return undefined;
  return Node.isBlock(callee.getBody()) ? callee : undefined;
};

/**
 * A wrapper run at once as a function of its own (P323): what its top writes
 * outside any function it keeps - a request, a call, a click handler - is
 * made from it, as from a handler the page runs once it has loaded. Named by
 * its own name (`(function boot() { … })()`), else by the name it is kept
 * under (`var shop = (function () { … })()`), else `wrapper`; a second of one
 * script is told apart by its line.
 */
const wrapperMember = (fn: ArrowFunction | FunctionExpression, keptAs: string | undefined): ScriptMember => {
  const own = Node.isFunctionExpression(fn) ? fn.getName() : undefined;
  return member({ name: own ?? keptAs ?? 'wrapper', declaration: fn, body: fn.getBody(), line: startLineOf(fn) });
};

/** The statements of a wrapper's body. */
const statementsOf = (fn: ArrowFunction | FunctionExpression): Statement[] => {
  const body = fn.getBody();
  return Node.isBlock(body) ? body.getStatements() : [];
};

/** The events a page runs a handler on once it has loaded (P317). */
const LOAD_EVENTS = new Set(['DOMContentLoaded', 'load', 'pageshow', 'readystatechange']);

/**
 * The properties a page runs the function assigned to once it has loaded
 * (P317, P323), by the object they are on: `window.onload`, `onpageshow`
 * (bare or on the page's object) and `document.onreadystatechange`.
 */
const LOAD_PROPERTIES: Readonly<Record<string, ReadonlySet<string>>> = {
  page: new Set(['onload', 'onpageshow']),
  document: new Set(['onreadystatechange']),
};

/**
 * The names jQuery and the libraries written like it are loaded as, whose
 * call with a function runs the function once the page is ready (P317).
 */
const READY_NAMES = new Set(['$', 'jQuery', 'Zepto']);

/** A function written in place, where a node is one. */
const inPlace = (node: TsNode | undefined): ArrowFunction | FunctionExpression | undefined => {
  const value = node === undefined ? undefined : unwrap(node);
  return value !== undefined && (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) ? value : undefined;
};

/** A string written as one, where a node is one. */
const textOf = (node: TsNode | undefined): string | undefined =>
  node !== undefined && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : undefined;

/**
 * Whether a name is one the page holds rather than one the repository
 * declares: nothing declares it, or only an installed package's typings or a
 * wrapper's parameter do (`$` in `(function ($) { … })(jQuery)`). What a
 * script assigns it (`window.onload = …`, which the checker counts among
 * `window`'s declarations in a script) declares nothing.
 */
const isPageHeld = (name: TsNode): boolean =>
  (name.getSymbol()?.getDeclarations() ?? []).every(
    (declaration) =>
      declaration.getSourceFile().isDeclarationFile() ||
      declaration.getSourceFile().isInNodeModules() ||
      Node.isParameterDeclaration(declaration) ||
      Node.isBinaryExpression(declaration) ||
      Node.isPropertyAccessExpression(declaration) ||
      Node.isElementAccessExpression(declaration) ||
      Node.isIdentifier(declaration),
  );

/**
 * The load property an assignment writes, where it writes one (P317, P323):
 * `onload` and `onpageshow` bare or on the page's object, `onreadystatechange`
 * on its document (`document.…`, `window.document.…`).
 */
const loadProperty = (left: TsNode): string | undefined => {
  if (Node.isIdentifier(left)) return LOAD_PROPERTIES['page']?.has(left.getText()) === true && isPageHeld(left) ? left.getText() : undefined;
  if (!Node.isPropertyAccessExpression(left)) return undefined;
  const name = left.getName();
  const owner = unwrap(left.getExpression());
  const on = isPageObject(owner) ? 'page' : isPageDocument(owner) ? 'document' : undefined;
  return on !== undefined && LOAD_PROPERTIES[on]?.has(name) === true ? name : undefined;
};

/** The page's own object, by a name nothing in the repository declares: `window`, `self`, `globalThis`. */
const isPageObject = (node: TsNode): boolean => Node.isIdentifier(node) && PAGE_ROOTS.has(node.getText()) && isPageHeld(node);

/** The page's document: `document`, `window.document`. */
const isPageDocument = (node: TsNode): boolean => {
  if (Node.isIdentifier(node)) return node.getText() === 'document' && isPageHeld(node);
  return Node.isPropertyAccessExpression(node) && node.getName() === 'document' && isPageObject(unwrap(node.getExpression()));
};

/** What jQuery selects being the page's own object: `$(window)`. */
const selectsPage = (node: TsNode): boolean => {
  const at = unwrap(node);
  const [selected] = Node.isCallExpression(at) ? at.getArguments() : [];
  return selected !== undefined && isPageObject(unwrap(selected));
};

/** jQuery itself, or what a call of it selects: `$`, `jQuery(document)`, `$(window)`. */
const isReadyRoot = (node: TsNode): boolean => {
  const at = unwrap(node);
  const callee = Node.isCallExpression(at) ? unwrap(at.getExpression()) : at;
  return Node.isIdentifier(callee) && READY_NAMES.has(callee.getText()) && isPageHeld(callee);
};

/**
 * A function a statement hands the page to run later, once it has loaded,
 * and the name it is kept under (P317): `document.addEventListener(
 * 'DOMContentLoaded', function () { … })` and `window.addEventListener('load',
 * …)` (`onDOMContentLoaded`, `onload`), `window.onload = function () { … }`
 * (`onload`), and jQuery's `$(function () { … })`, `jQuery(function ($) { …
 * })`, `$(document).ready(…)` and `$(window).on('load', …)` (`onready`,
 * `onload`). The page's other load events as well (P323): `pageshow` and
 * `readystatechange` listened for (`onpageshow`, `onreadystatechange`),
 * `window.onpageshow = …` and `document.onreadystatechange = …`, and jQuery
 * 1's `$(window).load(function () { … })` and `.bind('load', …)`. Its body is
 * the top of a script as a wrapper run at once is, and it is a function of
 * its own, the way in its requests are made from.
 */
export const laterWrapper = (expression: TsNode): { fn: ArrowFunction | FunctionExpression; name: string } | undefined => {
  const at = unwrap(expression);
  if (Node.isBinaryExpression(at) && at.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    const fn = inPlace(at.getRight());
    const property = loadProperty(unwrap(at.getLeft()));
    return fn === undefined || property === undefined ? undefined : { fn, name: property };
  }
  if (!Node.isCallExpression(at)) return undefined;
  const callee = unwrap(at.getExpression());
  const [first, second] = at.getArguments();
  let receiver: TsNode | undefined;
  let method: string;
  if (Node.isIdentifier(callee)) {
    // `$(function () { … })`, `jQuery(function ($) { … })`.
    const fn = inPlace(first);
    if (fn !== undefined && at.getArguments().length === 1 && isReadyRoot(callee)) return { fn, name: 'onready' };
    if (callee.getText() !== 'addEventListener' || !isPageHeld(callee)) return undefined;
    method = 'addEventListener';
  } else if (Node.isPropertyAccessExpression(callee)) {
    method = callee.getName();
    receiver = unwrap(callee.getExpression());
  } else return undefined;
  if (method === 'addEventListener') {
    const event = textOf(first);
    const fn = inPlace(second);
    const target = receiver === undefined || isPageObject(receiver) || isPageDocument(receiver);
    return fn !== undefined && target && event !== undefined && LOAD_EVENTS.has(event) ? { fn, name: `on${event}` } : undefined;
  }
  if (receiver === undefined || !isReadyRoot(receiver)) return undefined;
  // `$(document).ready(function () { … })`.
  if (method === 'ready') {
    const fn = inPlace(first);
    return fn === undefined ? undefined : { fn, name: 'onready' };
  }
  // jQuery 1's `$(window).load(function () { … })`; on anything else `.load(url)` is a request.
  if (method === 'load') {
    const fn = inPlace(first);
    return fn !== undefined && at.getArguments().length === 1 && selectsPage(receiver) ? { fn, name: 'onload' } : undefined;
  }
  // `$(window).on('load', function () { … })`, jQuery 1's `.bind('load', …)`.
  if (method === 'on' || method === 'one' || method === 'bind') {
    const event = textOf(first);
    const fn = inPlace(second);
    if (fn === undefined || event === undefined) return undefined;
    if (event === 'ready') return { fn, name: 'onready' };
    return LOAD_EVENTS.has(event) ? { fn, name: `on${event}` } : undefined;
  }
  return undefined;
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
        const run = depth < WRAPPER_DEPTH ? wrapperRun(value) : undefined;
        if (run !== undefined) found.push(wrapperMember(run, name.getText()), ...scopeMembers(statementsOf(run), true, name.getText(), constructors, depth + 1));
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
    const run = depth < WRAPPER_DEPTH ? wrapperRun(statement.getExpression()) : undefined;
    if (run !== undefined) {
      found.push(wrapperMember(run, undefined), ...scopeMembers(statementsOf(run), true, undefined, constructors, depth + 1));
      continue;
    }
    // A wrapper the page runs later is a function of its own, and the top of a script too (P317).
    const later = depth < WRAPPER_DEPTH ? laterWrapper(statement.getExpression()) : undefined;
    if (later !== undefined) {
      const { fn, name } = later;
      const body = fn.getBody();
      found.push(member({ name, declaration: fn, body, line: startLineOf(fn) }));
      if (Node.isBlock(body)) found.push(...scopeMembers(body.getStatements(), true, undefined, constructors, depth + 1));
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

/** Whether a node is a function or a class written in place, whose body runs when it is called rather than where it is written. */
const isDeferred = (node: TsNode): boolean =>
  Node.isFunctionDeclaration(node) ||
  Node.isFunctionExpression(node) ||
  Node.isArrowFunction(node) ||
  Node.isMethodDeclaration(node) ||
  Node.isGetAccessorDeclaration(node) ||
  Node.isSetAccessorDeclaration(node) ||
  Node.isConstructorDeclaration(node) ||
  Node.isClassDeclaration(node) ||
  Node.isClassExpression(node);

/**
 * The first node of a statement that runs where it is written (P334, P341):
 * a call or a `new` outside every function and class it writes, or a
 * function it builds in place that nothing keeps as a function of its own -
 * a handler handed to a constructor (`new Router({ '/items': function () {
 * … } })`) or kept in an object (`window.app = { routes: { … } }`), which the
 * top answers for. A function kept as its own (`kept`) is left to itself.
 */
const runWrittenIn = (statement: Statement, kept: (node: TsNode) => boolean): TsNode | undefined => {
  let found: TsNode | undefined;
  statement.forEachDescendant((node, traversal) => {
    if (found !== undefined) {
      traversal.stop();
      return;
    }
    if (isDeferred(node)) {
      if ((Node.isFunctionExpression(node) || Node.isArrowFunction(node) || Node.isMethodDeclaration(node)) && !kept(node)) found = node;
      traversal.skip();
      return;
    }
    if (Node.isCallExpression(node) || Node.isNewExpression(node)) found = node;
  });
  return found;
};

/**
 * The top of a script as a function of its own (P334), where it writes a
 * call outside every function it keeps: `fetch('/items')`, `init()`,
 * `$('#buy').on('click', function () { … })` written at the top of the
 * script, as a wrapper's top is (P323). Also where it only `new`s a
 * constructor or builds an object holding a handler nothing keeps as a
 * function of its own (P341): `new Router({ '/items': function () { … } })`,
 * whose handler's calls are drawn from the top. Named after the file,
 * `boot.js:top`, the way a wrapper is named after what it is kept under,
 * and starting where the first such node is. A wrapper run at once, a
 * handler the page runs once it has loaded, and a prototype's members are
 * functions of their own already and make no top.
 */
export const scriptTop = (sourceFile: SourceFile, kept: (node: TsNode) => boolean = () => false): NamedFunction | undefined => {
  for (const statement of sourceFile.getStatements()) {
    if (isDeferred(statement)) continue;
    if (Node.isExpressionStatement(statement)) {
      const expression = statement.getExpression();
      if (wrapperRun(expression) !== undefined || laterWrapper(expression) !== undefined || prototypeMembers(statement).length > 0) continue;
    }
    if (Node.isVariableStatement(statement) && statement.getDeclarations().every((declaration) => {
      const written = declaration.getInitializer();
      return written === undefined || wrapperRun(written) !== undefined;
    })) {
      continue;
    }
    const run = runWrittenIn(statement, kept);
    if (run !== undefined) return { name: `${sourceFile.getBaseName()}:top`, declaration: sourceFile, body: sourceFile, line: startLineOf(run) };
  }
  return undefined;
};

/** Every member function a script keeps, and the constructors it hands the page. */
export const scriptMembers = (sourceFile: SourceFile): ScriptReading => {
  const constructors = new Map<string, TsNode[]>();
  const members = scopeMembers(sourceFile.getStatements(), false, undefined, constructors, 0);
  return { members, constructors };
};
