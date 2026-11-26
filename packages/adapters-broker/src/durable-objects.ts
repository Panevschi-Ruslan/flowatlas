import { findMethod, isServiceSource, readWorkerConfig, type ObjectBinding, type WorkerConfig } from '@flowatlas/core';
import type { CallExpression, ClassDeclaration, Node as TsNode, Type } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * Per-scope objects of a worker (Cloudflare's Durable Objects), followed from
 * the code that reaches them to the class they are made of (P361).
 *
 * A worker reaches an object through a namespace the platform hands it:
 * `env.ROOMS.get(env.ROOMS.idFromName(room))`, `env.ROOMS.getByName(room)`,
 * or a stub a function of the project's own hands back. The stub's `fetch`
 * runs the class's `fetch`, and any other method called on it runs the
 * class's method of that name. Which class the namespace is made of is said by
 * the namespace's type (`DurableObjectNamespace<Rooms>`), and by the worker's
 * configuration (`durable_objects.bindings: [{ name, class_name }]`), the class
 * being the one the worker's entry exports, or the one of that name declared
 * in the repository.
 *
 * A request forwarded to an object's `fetch` takes the branch of it its path
 * selects: a `fetch` that tells its paths apart (`url.pathname === '/publish'`,
 * `.endsWith('/stream')`, a `switch` on the path) is read for the branch the
 * request takes, so a route that streams and a route that publishes, both
 * handed to the same object, are each read for their own half.
 */

/** How many functions of the project's own a stub is followed back through. */
const STUB_DEPTH = 3;

/** The methods of a namespace that make an object's id. */
const ID_MAKERS: ReadonlySet<string> = new Set(['idFromName', 'idFromString', 'newUniqueId']);

/** The methods of a namespace that hand back a stub: by id, and by name. */
const STUB_BY_ID = 'get';
const STUB_BY_NAME = 'getByName';

/** The method of a namespace that narrows it to a jurisdiction, and hands back a namespace. */
const JURISDICTION = 'jurisdiction';

/** The platform's types for a namespace and a stub. */
const NAMESPACE_TYPE = 'DurableObjectNamespace';
const STUB_TYPE = 'DurableObjectStub';

/** Methods an object answers that are the platform's, not calls of the project's own. */
const PLATFORM_METHODS: ReadonlySet<string> = new Set(['id', 'name', 'connect']);

/** Where a stub comes from: the namespace it was asked of, and the call that asked. */
export interface StubOrigin {
  /** The call that handed the stub back: `ns.get(id)`, `ns.getByName(name)`. */
  readonly call: CallExpression;
  /** The namespace, as written. */
  readonly namespace: TsNode;
  /** The name the code reaches the namespace by, `env.<binding>`, where it is read. */
  readonly binding?: string;
}

/** Which class a namespace is made of, or why that is not known. */
export type ObjectClass =
  | { readonly kind: 'class'; readonly declaration: ClassDeclaration; readonly className: string; readonly binding?: string; readonly via: 'type' | 'config' }
  | { readonly kind: 'elsewhere'; readonly binding: string; readonly className: string; readonly scriptName: string; readonly file: string }
  | { readonly kind: 'missing'; readonly binding: string; readonly className: string; readonly file: string }
  | { readonly kind: 'undeclared'; readonly binding: string; readonly configFile?: string }
  | { readonly kind: 'unread' };

/** One call on a stub: the method called, the class it lands in, and the stub's origin. */
export interface StubCall {
  readonly call: CallExpression;
  readonly method: string;
  readonly origin: StubOrigin;
  readonly target: ObjectClass;
}

/** The path a request handed to an object's `fetch` asks for. */
export type RequestPath =
  | { readonly kind: 'path'; readonly path: string }
  /** The request the route was handed, passed on: its path is the route's. */
  | { readonly kind: 'forwarded' }
  | { readonly kind: 'unread' };

/** The parts of an object's method a request does not reach, and whether its paths were told apart at all. */
export interface BranchView {
  readonly leaveOut: ReadonlySet<TsNode>;
  /** The method tells paths apart. */
  readonly branched: boolean;
  /** A branch the path names was found. */
  readonly matched: boolean;
}

const unwrap = (value: TsNode): TsNode => {
  let at = value;
  while (
    Node.isParenthesizedExpression(at) ||
    Node.isAsExpression(at) ||
    Node.isNonNullExpression(at) ||
    Node.isAwaitExpression(at) ||
    Node.isSatisfiesExpression(at) ||
    Node.isTypeAssertion(at)
  ) {
    at = at.getExpression();
  }
  return at;
};

/** Whether a node opens a function or class of its own, whose body a walk of the enclosing one passes over. */
const opensBody = (node: TsNode): boolean =>
  Node.isArrowFunction(node) ||
  Node.isFunctionExpression(node) ||
  Node.isFunctionDeclaration(node) ||
  Node.isMethodDeclaration(node) ||
  Node.isClassDeclaration(node) ||
  Node.isClassExpression(node);

/** What a `const` (or `let` with an initializer) holds, where a name is one. */
const initializerOf = (value: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(value)) return undefined;
  const declaration = value.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  return declaration.getInitializer();
};

/** The names a type is written with, its alias's and its symbol's. */
const typeNames = (type: Type): string[] =>
  [type.getAliasSymbol()?.getName(), type.getSymbol()?.getName(), ...type.getIntersectionTypes().flatMap((part) => [part.getAliasSymbol()?.getName(), part.getSymbol()?.getName()])].filter(
    (name): name is string => name !== undefined,
  );

const isTyped = (node: TsNode, name: string): boolean => {
  const type = node.getType();
  // By the names the type is declared under, never its text, which for a client of a library can run to pages.
  return typeNames(type).includes(name);
};

/** The class a namespace's or a stub's type names as its argument: `DurableObjectNamespace<Rooms>`. */
const classArgumentOf = (node: TsNode): ClassDeclaration | undefined => {
  const type = node.getType();
  const argumentsOf = [...type.getAliasTypeArguments(), ...type.getTypeArguments()];
  for (const argument of argumentsOf) {
    for (const declaration of argument.getSymbol()?.getDeclarations() ?? []) {
      if (Node.isClassDeclaration(declaration)) return declaration;
    }
  }
  return undefined;
};

/** Whether a name is held to be the environment the platform hands a worker. */
const ENV_NAMES: ReadonlySet<string> = new Set(['env', 'bindings']);

/** A function of the project's own that hands back the environment it kept: `getWorkerEnv()`, `getEnv()`, `useEnv()`. */
const ENV_GETTER = /env(?:ironment)?$|bindings$/i;

/** The name a holder of the environment is written with: `env`, `c.env`, `this.env`, and `env` for `getWorkerEnv()`. */
const holderNameOf = (holder: TsNode): string | undefined => {
  if (Node.isIdentifier(holder)) return holder.getText();
  if (Node.isPropertyAccessExpression(holder)) return holder.getName();
  if (Node.isCallExpression(holder) && holder.getArguments().length === 0) {
    const callee = unwrap(holder.getExpression());
    const name = Node.isIdentifier(callee) ? callee.getText() : Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
    return name !== undefined && ENV_GETTER.test(name) ? 'env' : undefined;
  }
  return undefined;
};

/**
 * The binding a namespace is reached by: `env.ROOMS`, `c.env.ROOMS`,
 * `this.env.ROOMS`, `(env as Record<string, unknown>).ROOMS`,
 * `getWorkerEnv().ROOMS` (P362), `const { ROOMS } = env`; and a member named
 * as the worker's configuration binds a namespace (`bound`), whatever holds it.
 */
const bindingOf = (namespace: TsNode, bound?: ReadonlySet<string>, depth = 0): string | undefined => {
  const at = unwrap(namespace);
  if (Node.isPropertyAccessExpression(at)) {
    const holderName = holderNameOf(unwrap(at.getExpression()));
    return (holderName !== undefined && ENV_NAMES.has(holderName)) || bound?.has(at.getName()) === true ? at.getName() : undefined;
  }
  if (Node.isElementAccessExpression(at)) {
    const key = at.getArgumentExpression();
    return key !== undefined && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)) ? key.getLiteralText() : undefined;
  }
  if (!Node.isIdentifier(at) || depth >= STUB_DEPTH) return undefined;
  const declaration = at.getSymbol()?.getDeclarations()[0];
  if (declaration !== undefined && Node.isBindingElement(declaration)) {
    const holder = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getInitializer();
    const holderName = holder === undefined ? undefined : holderNameOf(unwrap(holder));
    const property = declaration.getPropertyNameNode()?.getText() ?? declaration.getName();
    return (holderName !== undefined && ENV_NAMES.has(holderName)) || bound?.has(property) === true ? property : undefined;
  }
  const initializer = initializerOf(at);
  return initializer === undefined ? undefined : bindingOf(initializer, bound, depth + 1);
};

/** Whether a value is an object's id: made by the namespace, held in a name, or typed as one. */
const isObjectId = (value: TsNode, depth = 0): boolean => {
  const at = unwrap(value);
  if (Node.isCallExpression(at)) {
    const callee = at.getExpression();
    if (Node.isPropertyAccessExpression(callee) && ID_MAKERS.has(callee.getName())) return true;
  }
  if (isTyped(at, 'DurableObjectId')) return true;
  const initializer = depth < STUB_DEPTH ? initializerOf(at) : undefined;
  return initializer !== undefined && isObjectId(initializer, depth + 1);
};

/** The namespace a call asks of, past a narrowing to a jurisdiction. */
const namespaceOf = (receiver: TsNode): TsNode => {
  const at = unwrap(receiver);
  if (Node.isCallExpression(at)) {
    const callee = at.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === JURISDICTION) return callee.getExpression();
  }
  return at;
};

/** The returned values of a function body: the expression of an arrow, or each `return`. */
const returnedBy = (body: TsNode): TsNode[] => {
  if (!Node.isBlock(body)) return [body];
  const out: TsNode[] = [];
  body.forEachDescendant((node, traversal) => {
    if (opensBody(node)) {
      traversal.skip();
      return;
    }
    if (Node.isReturnStatement(node)) {
      const value = node.getExpression();
      if (value !== undefined) out.push(value);
    }
  });
  return out;
};

/** A path written in an address: what follows the host of a full one, the address itself otherwise. */
const pathOfAddress = (address: string): string => {
  const withoutHost = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(address) === null ? address : address.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const path = withoutHost.split(/[?#]/)[0] ?? '';
  return path === '' ? '/' : path.startsWith('/') ? path : `/${path}`;
};

/** The segments of a path, with no empty ones. */
const segmentsOf = (path: string): string[] => path.split('/').filter((segment) => segment !== '');

/** Whether one segment of a request's path is one a test names: a parameter, on either side, fits any. */
const fitsSegment = (requested: string, named: string): boolean =>
  requested.startsWith(':') || requested === '*' || named.startsWith(':') || named === '*' || requested === named;

/** One test of the request's path: the path it names, and how it compares. */
export type PathTest = { readonly literal: string; readonly op: 'equals' | 'endsWith' | 'startsWith' | 'includes' };

/** A group of a pattern that takes one segment: `([^/]+)`, `(\w+)`, `([a-z0-9-]+)`, `(\d+)`. */
const SEGMENT_GROUP = /\((?:\?<\w+>)?(?:\[\^\\?\/\]\+|\\w\+|\\d\+|\[[\w\\-]+\]\+)\)/g;

/**
 * The path a regular expression tested against the request's path names,
 * where it is a plain one: anchored, its groups each one segment, nothing
 * else of a pattern in it. `^\/teams\/([^/]+)\/feed$` is `/teams/:param/feed`.
 */
export const pathOfPattern = (source: string): PathTest | undefined => {
  let text = source;
  const anchored = text.startsWith('^');
  if (anchored) text = text.slice(1);
  const ends = text.endsWith('$') && !text.endsWith('\\$');
  if (ends) text = text.slice(0, -1);
  text = text.replace(/\/\?$/, '').replace(/\\\/\?$/, '');
  text = text.replace(SEGMENT_GROUP, ':param').replace(/\(\.[*+]\)$/, '*').replace(/\\([/.-])/g, '$1');
  if (/[\\[\](){}|?+^$]/.test(text) || /\*(?!$)/.test(text) || (text.includes('*') && !text.endsWith('/*') && text !== '*')) return undefined;
  if (!text.startsWith('/')) return undefined;
  const literal = text.endsWith('/*') ? text.slice(0, -2) || '/' : text;
  if (text.endsWith('/*') || !ends) return anchored ? { literal, op: 'startsWith' } : { literal, op: 'includes' };
  return { literal, op: anchored ? 'equals' : 'endsWith' };
};

/** Whether a request's path passes one test written in an object's `fetch`. */
const passes = (path: string, test: PathTest): boolean => {
  const requested = segmentsOf(path);
  const named = segmentsOf(test.literal);
  const fit = (offset: number): boolean => named.every((segment, index) => fitsSegment(requested[offset + index] ?? '', segment));
  switch (test.op) {
    case 'equals':
      return requested.length === named.length && fit(0);
    case 'startsWith':
      return requested.length >= named.length && fit(0);
    case 'endsWith':
      return requested.length >= named.length && fit(requested.length - named.length);
    case 'includes': {
      for (let offset = 0; offset + named.length <= requested.length; offset += 1) if (fit(offset)) return true;
      return named.length === 0;
    }
  }
};

/** Whether a value written in a test is the path of the request: its text names the path or the address. */
const namesPath = (node: TsNode): boolean => /pathname|\burl\b|\bpath\b|\broute\b/i.test(node.getText());

const stringOf = (node: TsNode | undefined): string | undefined =>
  node !== undefined && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralText() : undefined;

/** The tests of the request's path a condition makes; `undefined` where one is negated, which says nothing about a branch. */
const pathTestsIn = (condition: TsNode): PathTest[] | undefined => {
  const tests: PathTest[] = [];
  let negated = false;
  const visit = (node: TsNode): void => {
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getKind();
      const equal = op === SyntaxKind.EqualsEqualsEqualsToken || op === SyntaxKind.EqualsEqualsToken;
      const unequal = op === SyntaxKind.ExclamationEqualsEqualsToken || op === SyntaxKind.ExclamationEqualsToken;
      if (equal || unequal) {
        const [left, right] = [unwrap(node.getLeft()), unwrap(node.getRight())];
        const literal = stringOf(left) ?? stringOf(right);
        const other = stringOf(left) === undefined ? left : right;
        if (literal !== undefined && namesPath(other)) {
          if (unequal) negated = true;
          else tests.push({ literal, op: 'equals' });
        }
      }
    } else if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      const pattern = patternTestOf(node);
      if (pattern !== undefined) {
        const parent = node.getParent();
        if (parent !== undefined && Node.isPrefixUnaryExpression(parent) && parent.getOperatorToken() === SyntaxKind.ExclamationToken) negated = true;
        else if (pattern !== null) tests.push(pattern);
        return;
      }
      const literal = stringOf(node.getArguments()[0]);
      if (Node.isPropertyAccessExpression(callee) && literal !== undefined && namesPath(callee.getExpression())) {
        const name = callee.getName();
        if (name === 'endsWith' || name === 'startsWith' || name === 'includes') {
          const parent = node.getParent();
          if (parent !== undefined && Node.isPrefixUnaryExpression(parent) && parent.getOperatorToken() === SyntaxKind.ExclamationToken) negated = true;
          else tests.push({ literal, op: name });
        }
      }
    }
  };
  visit(condition);
  condition.forEachDescendant((node) => visit(node));
  // `const match = url.pathname.match(/…/); if (match)`: the test held in a name.
  const held = Node.isIdentifier(unwrap(condition)) ? initializerOf(unwrap(condition)) : undefined;
  if (held !== undefined && Node.isCallExpression(unwrap(held))) {
    const pattern = patternTestOf(unwrap(held) as CallExpression);
    if (pattern !== undefined && pattern !== null) tests.push(pattern);
  }
  return negated ? undefined : tests;
};

/**
 * The test a regular expression makes of the request's path, in a call:
 * `/…/.test(url.pathname)`, `url.pathname.match(/…/)`, `.exec(…)`. `null`
 * where the call is one and its pattern is not a plain path.
 */
const patternTestOf = (call: CallExpression): PathTest | null | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const name = callee.getName();
  const receiver = unwrap(callee.getExpression());
  const [first] = call.getArguments();
  if ((name === 'test' || name === 'exec') && Node.isRegularExpressionLiteral(receiver) && first !== undefined && namesPath(first)) {
    return pathOfPattern(regexSource(receiver.getText())) ?? null;
  }
  if (name === 'match' && first !== undefined && Node.isRegularExpressionLiteral(unwrap(first)) && namesPath(receiver)) {
    return pathOfPattern(regexSource(unwrap(first).getText())) ?? null;
  }
  return undefined;
};

/** The pattern of a regular expression literal, without its slashes and flags. */
const regexSource = (written: string): string => written.slice(1, written.lastIndexOf('/'));

/**
 * The tests of the request's path a call is written under, from the body it
 * is in: the conditions of each `if` whose branch holds it, and the `case` of
 * a `switch` on the path. A call in an `else` is under a test it failed, which
 * names no path, and contributes nothing.
 */
export const enclosingTests = (call: TsNode, body: TsNode): PathTest[] => {
  const tests: PathTest[] = [];
  let child: TsNode = call;
  for (let at = call.getParent(); at !== undefined && child !== body; child = at, at = at.getParent()) {
    if (opensBody(at) && at !== body.getParent()) break;
    if (Node.isIfStatement(at) && at.getThenStatement() === child) tests.push(...(pathTestsIn(at.getExpression()) ?? []));
    if (Node.isCaseClause(at)) {
      const literal = stringOf(unwrap(at.getExpression()));
      const owner = at.getParent()?.getParent();
      if (literal !== undefined && owner !== undefined && Node.isSwitchStatement(owner) && namesPath(owner.getExpression())) tests.push({ literal, op: 'equals' });
    }
  }
  return tests;
};

/**
 * The route the tests of a request's path declare: a path it equals, or the
 * paths under a prefix it starts with (`/feeds/*`). A path it only ends with or
 * contains is not a route.
 */
export const routePathOf = (tests: readonly PathTest[]): string | undefined => {
  const equal = tests.find((test) => test.op === 'equals');
  if (equal !== undefined) return equal.literal.startsWith('/') ? equal.literal : `/${equal.literal}`;
  const prefix = tests.find((test) => test.op === 'startsWith');
  if (prefix === undefined) return undefined;
  const trimmed = prefix.literal.replace(/\/+$/, '');
  return `${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}/*`;
};

/** Whether a statement leaves the function on every way through it. */
const alwaysLeaves = (statement: TsNode): boolean => {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) return true;
  if (Node.isBlock(statement)) {
    const last = statement.getStatements().at(-1);
    return last !== undefined && alwaysLeaves(last);
  }
  if (Node.isIfStatement(statement)) {
    const otherwise = statement.getElseStatement();
    return otherwise !== undefined && alwaysLeaves(statement.getThenStatement()) && alwaysLeaves(otherwise);
  }
  return false;
};

/** The statements after one, in the block it is written in. */
const followingStatements = (statement: TsNode): TsNode[] => {
  const parent = statement.getParent();
  if (parent === undefined || !(Node.isBlock(parent) || Node.isSourceFile(parent) || Node.isCaseClause(parent) || Node.isDefaultClause(parent))) return [];
  const statements = parent.getStatements() as TsNode[];
  return statements.slice(statements.indexOf(statement) + 1);
};

/**
 * The parts of an object's method a request for `path` does not reach: the
 * branches whose test of the path it fails, the other branches of one it
 * passes, and what follows a branch it passes that always returns. No path
 * read, nothing left out.
 */
export const branchView = (body: TsNode, path: string | undefined): BranchView => {
  const leaveOut = new Set<TsNode>();
  let branched = false;
  let matched = false;
  if (path === undefined) return { leaveOut, branched, matched };
  const visit = (node: TsNode): void => {
    if (Node.isIfStatement(node)) {
      const tests = pathTestsIn(node.getExpression());
      if (tests === undefined || tests.length === 0) return;
      branched = true;
      const takes = tests.some((test) => passes(path, test));
      if (takes) {
        matched = true;
        const otherwise = node.getElseStatement();
        if (otherwise !== undefined) leaveOut.add(otherwise);
        if (alwaysLeaves(node.getThenStatement())) for (const after of followingStatements(node)) leaveOut.add(after);
      } else leaveOut.add(node.getThenStatement());
      return;
    }
    if (Node.isSwitchStatement(node) && namesPath(node.getExpression())) {
      const clauses = node.getClauses();
      const taken = clauses.filter((clause) => {
        if (!Node.isCaseClause(clause)) return false;
        const literal = stringOf(unwrap(clause.getExpression()));
        return literal !== undefined && passes(path, { literal, op: 'equals' });
      });
      const tested = clauses.some((clause) => Node.isCaseClause(clause) && stringOf(unwrap(clause.getExpression())) !== undefined);
      if (!tested) return;
      branched = true;
      if (taken.length > 0) matched = true;
      for (const clause of clauses) {
        const isTaken = taken.includes(clause);
        const isDefault = Node.isDefaultClause(clause);
        if (taken.length > 0 ? !isTaken : !isDefault) leaveOut.add(clause);
      }
      if (taken.some((clause) => clause.getStatements().some((statement) => alwaysLeaves(statement)))) for (const after of followingStatements(node)) leaveOut.add(after);
    }
  };
  body.forEachDescendant((node, traversal) => {
    if (opensBody(node) || leaveOut.has(node)) {
      traversal.skip();
      return;
    }
    visit(node);
  });
  return { leaveOut, branched, matched };
};

/** The path a request handed to an object's `fetch` asks for. */
export const requestPathOf = (request: TsNode | undefined, depth = 0): RequestPath => {
  if (request === undefined) return { kind: 'unread' };
  const at = unwrap(request);
  const text = stringOf(at);
  if (text !== undefined) return { kind: 'path', path: pathOfAddress(text) };
  if (Node.isTemplateExpression(at)) {
    // Each value written into the address stands for one segment of it.
    const written = [at.getHead().getLiteralText(), ...at.getTemplateSpans().map((span) => `:param${span.getLiteral().getLiteralText()}`)].join('');
    return /^[a-z][a-z0-9+.-]*:\/\/:param/i.test(written) || written.startsWith(':param') ? { kind: 'unread' } : { kind: 'path', path: pathOfAddress(written) };
  }
  if (Node.isNewExpression(at) && at.getExpression().getText() === 'Request') return requestPathOf(at.getArguments()[0], depth + 1);
  if (Node.isPropertyAccessExpression(at) && (at.getName() === 'url' || at.getName() === 'raw')) return { kind: 'forwarded' };
  const initializer = depth < STUB_DEPTH ? initializerOf(at) : undefined;
  if (initializer !== undefined) return requestPathOf(initializer, depth + 1);
  return isTyped(at, 'Request') ? { kind: 'forwarded' } : { kind: 'unread' };
};

/** The fields of the object a body adds to: `this.writers.add(writer)`, `this.clients.push(…)`, `this.streams = …`. */
export const heldFieldsIn = (body: TsNode, leaveOut?: ReadonlySet<TsNode>): Set<string> => {
  const fields = new Set<string>();
  const fieldOf = (node: TsNode): string | undefined => {
    const at = unwrap(node);
    return Node.isPropertyAccessExpression(at) && at.getExpression().getKind() === SyntaxKind.ThisKeyword ? at.getName() : undefined;
  };
  body.forEachDescendant((node, traversal) => {
    if (leaveOut?.has(node) === true || Node.isClassDeclaration(node)) {
      traversal.skip();
      return;
    }
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee) && ['add', 'push', 'set', 'unshift'].includes(callee.getName())) {
        const field = fieldOf(callee.getExpression());
        if (field !== undefined) fields.add(field);
      }
    } else if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
      const field = fieldOf(node.getLeft());
      if (field !== undefined && /\.\.\.|\.concat\(|\[/.test(node.getRight().getText())) fields.add(field);
    }
  });
  return fields;
};

/** The methods that write one frame onto a stream held open. */
const FRAME_WRITES: ReadonlySet<string> = new Set(['write', 'enqueue', 'writeSSE']);

/** Whether a body writes to the streams held in one of the fields given: names the field, and writes a frame. */
export const writesHeld = (body: TsNode, fields: ReadonlySet<string>, leaveOut?: ReadonlySet<TsNode>): boolean => {
  let names = false;
  let writes = false;
  body.forEachDescendant((node, traversal) => {
    if (leaveOut?.has(node) === true || Node.isClassDeclaration(node)) {
      traversal.skip();
      return;
    }
    if (Node.isPropertyAccessExpression(node) && node.getExpression().getKind() === SyntaxKind.ThisKeyword && fields.has(node.getName())) names = true;
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee) && FRAME_WRITES.has(callee.getName())) writes = true;
    }
  });
  return names && writes;
};

/**
 * The test a body writes frames to the streams it holds under, where it picks
 * among them (P362): `for (const [writer, sub] of this.subscribers) if
 * (inScope(sub, channel)) writer.write(…)`. The name of the function the test
 * calls, or the test as written; undefined where every frame written is
 * written to every stream.
 */
export const writeFilterOf = (body: TsNode, leaveOut?: ReadonlySet<TsNode>): string | undefined => {
  let filter: string | undefined;
  body.forEachDescendant((node, traversal) => {
    if (filter !== undefined) {
      traversal.stop();
      return;
    }
    if (leaveOut?.has(node) === true || Node.isClassDeclaration(node)) {
      traversal.skip();
      return;
    }
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !FRAME_WRITES.has(callee.getName())) return;
    let child: TsNode = node;
    for (let at = node.getParent(); at !== undefined && at !== body; child = at, at = at.getParent()) {
      const condition =
        Node.isIfStatement(at) && at.getThenStatement() === child
          ? at.getExpression()
          : Node.isConditionalExpression(at) && at.getWhenTrue() === child
            ? at.getCondition()
            : Node.isBinaryExpression(at) && at.getRight() === child && at.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
              ? at.getLeft()
              : undefined;
      if (condition === undefined) continue;
      const test = unwrap(condition);
      const called = Node.isCallExpression(test) ? unwrap(test.getExpression()) : undefined;
      filter =
        called !== undefined && (Node.isIdentifier(called) || Node.isPropertyAccessExpression(called))
          ? Node.isIdentifier(called)
            ? called.getText()
            : called.getName()
          : test.getText().replace(/\s+/g, ' ').slice(0, 40);
      return;
    }
  });
  return filter;
};

/** A body of a class's method, where the repository declares it. */
export const methodBodyOf = (declaration: ClassDeclaration, name: string): { method: TsNode; body: TsNode } | undefined => {
  const { method } = findMethod(declaration, name);
  if (method === undefined) return undefined;
  const fn = Node.isPropertyDeclaration(method) ? method.getInitializer() : method;
  const body = fn !== undefined && (Node.isBodyable(fn) || Node.isBodied(fn)) ? fn.getBody() : undefined;
  return body === undefined ? undefined : { method, body };
};

/** The body of a class's constructor, where it has one. */
export const constructorBodyOf = (declaration: ClassDeclaration): TsNode | undefined => declaration.getConstructors()[0]?.getBody();

export interface ObjectReader {
  /** The worker configuration read, where there is one. */
  readonly config: WorkerConfig | undefined;
  /** The call on a stub a call is, where it is one. */
  stubCallOf(call: CallExpression): StubCall | undefined;
  /** Where a value's stub comes from, followed back through the project's own functions. */
  stubOriginOf(value: TsNode): StubOrigin | undefined;
}

/**
 * A reader of one repository's per-scope objects. `bodyOf` answers the body
 * of the function a call lands in, where the repository declares it, so a stub
 * handed back by a helper is followed into the helper.
 */
export const objectReader = (repoDir: string, sources: () => Iterable<{ getFilePath(): string; getClass(name: string): ClassDeclaration | undefined }>, bodyOf: (call: CallExpression) => TsNode | undefined): ObjectReader => {
  const config = readWorkerConfig(repoDir);
  const declared = new Map<string, ObjectBinding>();
  // The worker's own bindings first; one an environment alone declares is still one.
  for (const binding of [...(config?.objects ?? [])].sort((a, b) => Number(a.environment !== undefined) - Number(b.environment !== undefined))) {
    if (!declared.has(binding.binding)) declared.set(binding.binding, binding);
  }
  const boundNames: ReadonlySet<string> = new Set(declared.keys());
  const classes = new Map<string, ClassDeclaration | undefined>();

  /** The class of a name the worker declares: the one its entry exports, or the one of that name in the repository. */
  const classNamed = (name: string): ClassDeclaration | undefined => {
    if (classes.has(name)) return classes.get(name);
    let found: ClassDeclaration | undefined;
    const all = [...sources()].filter((source) => isServiceSource(source.getFilePath(), repoDir));
    const main = config?.main === undefined ? undefined : all.find((source) => source.getFilePath().replace(/\\/g, '/').endsWith(`/${config.main}`));
    if (main !== undefined) {
      const exported = (main as unknown as { getExportedDeclarations(): ReadonlyMap<string, TsNode[]> }).getExportedDeclarations().get(name) ?? [];
      found = exported.find((declaration): declaration is ClassDeclaration => Node.isClassDeclaration(declaration));
    }
    if (found === undefined) {
      const candidates = all.map((source) => source.getClass(name)).filter((each): each is ClassDeclaration => each !== undefined);
      found = candidates.find((each) => each.isExported()) ?? candidates[0];
    }
    classes.set(name, found);
    return found;
  };

  const originOfCall = (call: CallExpression): StubOrigin | undefined => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    const name = callee.getName();
    if (name !== STUB_BY_ID && name !== STUB_BY_NAME) return undefined;
    const namespace = namespaceOf(callee.getExpression());
    const binding = bindingOf(namespace, boundNames);
    const typed = isTyped(namespace, NAMESPACE_TYPE);
    const [first] = call.getArguments();
    if (first === undefined) return undefined;
    const known = binding !== undefined && declared.has(binding);
    // A map's `get` is not a stub: the namespace is typed as one, the
    // configuration binds it, or what it is handed is an object's id.
    if (name === STUB_BY_ID && !typed && !known && !isObjectId(first)) return undefined;
    if (name === STUB_BY_NAME && !typed && !known && (binding === undefined || !/^[A-Z][A-Z0-9_]*$/.test(binding))) return undefined;
    return { call, namespace, ...(binding === undefined ? {} : { binding }) };
  };

  const stubOriginOf = (value: TsNode, depth = 0): StubOrigin | undefined => {
    const at = unwrap(value);
    if (Node.isCallExpression(at)) {
      const direct = originOfCall(at);
      if (direct !== undefined) return direct;
      if (depth >= STUB_DEPTH) return undefined;
      const body = bodyOf(at);
      if (body === undefined) return undefined;
      for (const returned of returnedBy(body)) {
        const origin = stubOriginOf(returned, depth + 1);
        if (origin !== undefined) return origin;
      }
      return undefined;
    }
    if (depth >= STUB_DEPTH) return undefined;
    const initializer = initializerOf(at);
    return initializer === undefined ? undefined : stubOriginOf(initializer, depth + 1);
  };

  const classOf = (origin: StubOrigin): ObjectClass => {
    const typed = classArgumentOf(origin.call) ?? classArgumentOf(origin.namespace);
    if (typed !== undefined && isServiceSource(typed.getSourceFile().getFilePath(), repoDir)) {
      return { kind: 'class', declaration: typed, className: typed.getName() ?? '', ...(origin.binding === undefined ? {} : { binding: origin.binding }), via: 'type' };
    }
    if (origin.binding === undefined) return { kind: 'unread' };
    const binding = declared.get(origin.binding);
    if (binding === undefined) return { kind: 'undeclared', binding: origin.binding, ...(config === undefined ? {} : { configFile: config.file }) };
    if (binding.scriptName !== undefined) return { kind: 'elsewhere', binding: binding.binding, className: binding.className, scriptName: binding.scriptName, file: binding.file };
    const declaration = classNamed(binding.className);
    if (declaration === undefined) return { kind: 'missing', binding: binding.binding, className: binding.className, file: binding.file };
    return { kind: 'class', declaration, className: binding.className, binding: binding.binding, via: 'config' };
  };

  const stubCallOf = (call: CallExpression): StubCall | undefined => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    const method = callee.getName();
    if (PLATFORM_METHODS.has(method) || ID_MAKERS.has(method) || method === STUB_BY_ID || method === STUB_BY_NAME || method === JURISDICTION) return undefined;
    const receiver = callee.getExpression();
    // A stub typed as one, or one whose origin is read; nothing else is asked.
    const origin = stubOriginOf(receiver);
    if (origin === undefined) {
      if (!isTyped(receiver, STUB_TYPE)) return undefined;
      const declaration = classArgumentOf(receiver);
      if (declaration === undefined || !isServiceSource(declaration.getSourceFile().getFilePath(), repoDir)) return undefined;
      return { call, method, origin: { call, namespace: receiver }, target: { kind: 'class', declaration, className: declaration.getName() ?? '', via: 'type' } };
    }
    return { call, method, origin, target: classOf(origin) };
  };

  return { config, stubCallOf, stubOriginOf };
};
