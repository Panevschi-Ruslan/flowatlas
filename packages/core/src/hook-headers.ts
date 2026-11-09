import type { Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { conditionsAround } from './address-rewrite.js';
import { builtQueryOf, writtenKey, type QueryBuilder } from './built-query.js';

/**
 * The headers a function a client runs before every request adds to it
 * (P265), read where the function is written.
 *
 * An interceptor is where most applications put the headers every request
 * carries: `api.interceptors.request.use((config) => { config.headers['X-Tenant']
 * = tenant; return config })`, an `onRequest({ options })` setting
 * `options.headers`, a `beforeRequest` hook calling `request.headers.set(...)`.
 * The names are as plainly written as the ones a call writes among its
 * options, so they are read the same way: a name written as a literal or a
 * constant of one, set unconditionally, is a header every request through the
 * client carries.
 *
 * Anything else the function does to the headers is said rather than guessed:
 * a name written as code, a header set only under a condition, one removed,
 * the headers or the options handed to another function, the options answered
 * with in a form not read. Then a request may carry, or lack, headers nothing
 * here reads (`unread`). A function that never touches the headers adds none.
 *
 * How the function is handed the request is the reader's to say, as it is
 * for a rewrite of the address: the options themselves (`options`), a context
 * holding them under `options` (`context`), or the request itself, whose
 * `headers` are its own (`request`).
 */
export type HookHanded = 'options' | 'context' | 'request';

export interface HookHeaders {
  /** The names it adds, lower-cased as a server hands them on. */
  readonly keys: readonly string[];
  /** Whether it may add or remove headers nothing here reads. */
  readonly unread: boolean;
  /** Whether it writes a whole set of headers in place of the request's own. */
  readonly replaces?: true;
}

/** What a function that does nothing to the headers adds. */
export const NO_HOOK_HEADERS: HookHeaders = { keys: [], unread: false };

const UNREAD: HookHeaders = { keys: [], unread: true };

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isAwaitExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
};

type Fn = TsNode;

const isFn = (node: TsNode): boolean =>
  Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node);

/** The function a node is written directly in. */
const ownerOf = (node: TsNode): TsNode | undefined => node.getFirstAncestor((each) => isFn(each));

/** The declaration a name refers to. */
const declared = (node: TsNode): TsNode | undefined => {
  const target = unwrap(node);
  return Node.isIdentifier(target) ? target.getSymbol()?.getDeclarations()[0] : undefined;
};

/** A key of an object written in place, with what it holds. */
const keyOf = (property: TsNode): string | undefined => {
  if (Node.isShorthandPropertyAssignment(property)) return property.getName();
  if (!Node.isPropertyAssignment(property)) return undefined;
  const name = property.getNameNode();
  if (Node.isComputedPropertyName(name)) return writtenKey(name.getExpression());
  return Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name) ? name.getLiteralValue() : name.getText();
};

/** Several readings of what is done to one request's headers, put together. */
export const joinHookHeaders = (readings: readonly HookHeaders[]): HookHeaders => {
  const read = readings.filter((each) => each.unread || each.keys.length > 0 || each.replaces === true);
  if (read.length === 0) return NO_HOOK_HEADERS;
  const keys = [...new Set(read.flatMap((each) => each.keys))].sort();
  // Which of two runs last is not read, so a set written in place of another's says nothing for certain.
  const replaced = read.some((each) => each.replaces === true);
  const unread = read.some((each) => each.unread) || (replaced && read.length > 1);
  return { keys, unread, ...(replaced && read.length === 1 ? { replaces: true as const } : {}) };
};

/**
 * What one function a client runs before each request does to its headers.
 * `builders` are the classes headers are built with (`Headers`), read as a
 * request's own headers are.
 */
export const headersAHookAdds = (fn: TsNode, handed: HookHanded, builders: readonly QueryBuilder[]): HookHeaders => {
  if (!isFn(fn)) return UNREAD;
  const parameter = (fn as unknown as { getParameters: () => TsNode[] }).getParameters()[0];
  if (parameter === undefined || !Node.isParameterDeclaration(parameter)) return NO_HOOK_HEADERS;

  // What the function is handed, by name: the options (or the request), and the headers where a key is destructured.
  const holders = new Set<TsNode>();
  const headerNames = new Set<TsNode>();
  const name = parameter.getNameNode();
  if (Node.isIdentifier(name)) {
    if (handed === 'context') {
      // `(ctx) => ctx.options...`: the context is read below through its `options`.
    } else holders.add(parameter);
  } else if (Node.isObjectBindingPattern(name)) {
    for (const element of name.getElements()) {
      const key = element.getPropertyNameNode()?.getText() ?? element.getName();
      if (key === 'headers' && handed !== 'context') headerNames.add(element);
      else if (key === 'options' && handed === 'context') {
        const inner = element.getNameNode();
        if (Node.isIdentifier(inner)) holders.add(element);
        else return UNREAD;
      }
    }
  } else return UNREAD;
  const context = handed === 'context' && Node.isIdentifier(name) ? parameter : undefined;

  /** Whether an expression is what the function is handed the options (or the request) as. */
  const isHolder = (node: TsNode): boolean => {
    const target = unwrap(node);
    if (holders.has(declared(target) as TsNode)) return true;
    return (
      context !== undefined &&
      Node.isPropertyAccessExpression(target) &&
      target.getName() === 'options' &&
      declared(target.getExpression()) === context
    );
  };
  /** Whether an expression is the request's headers: `config.headers`, a key destructured, a `const` holding one. */
  const isHeaders = (node: TsNode, depth = 0): boolean => {
    const target = unwrap(node);
    if (Node.isPropertyAccessExpression(target) && target.getName() === 'headers' && isHolder(target.getExpression())) return true;
    if (Node.isElementAccessExpression(target) && writtenKey(target.getArgumentExpression()) === 'headers' && isHolder(target.getExpression())) return true;
    const declaration = declared(target);
    if (declaration === undefined) return false;
    if (headerNames.has(declaration)) return true;
    if (depth < 4 && Node.isVariableDeclaration(declaration) && ownerOf(declaration) === fn) {
      const value = declaration.getInitializer();
      return value !== undefined && isHeaders(value, depth + 1);
    }
    return false;
  };

  const keys = new Set<string>();
  let unread = false;
  let replaces = false;
  /** A header set where it is written: kept only where nothing decides whether it is set. */
  const add = (key: string | undefined, at: TsNode): void => {
    if (key === undefined || conditionsAround(at, fn).length > 0) unread = true;
    else keys.add(key.toLowerCase());
  };
  /** The headers written as a whole: on top of the request's own where they are spread in, else in their place. */
  const wholeSet = (value: TsNode, at: TsNode): void => {
    const written = unwrap(value);
    if (Node.isObjectLiteralExpression(written)) {
      let based = false;
      for (const property of written.getProperties()) {
        if (Node.isSpreadAssignment(property)) {
          if (isHeaders(property.getExpression())) based = true;
          else unread = true;
          continue;
        }
        add(keyOf(property), at);
      }
      if (!based) replaces = true;
      return;
    }
    // `new Headers(config.headers)`, with sets after it: the request's own and what is added.
    if (Node.isNewExpression(written) && isHeaders(written.getArguments()[0] ?? written)) return;
    const built = builtQueryOf(written, builders);
    if (built === undefined || 'unread' in built) {
      unread = true;
      return;
    }
    for (const key of built.keys) add(key, at);
    replaces = true;
  };
  /** An object written for the options in place of the ones handed in: `{ ...config, headers }`. */
  const answered = (object: TsNode, at: TsNode): void => {
    if (!Node.isObjectLiteralExpression(object)) {
      unread = true;
      return;
    }
    let spreadsOwn = false;
    for (const property of object.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        if (isHolder(property.getExpression())) spreadsOwn = true;
        else unread = true;
        continue;
      }
      if (keyOf(property) !== 'headers') continue;
      const value = Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
      if (value === undefined) unread = true;
      else wholeSet(value, at);
    }
    // Options answered with that keep none of the request's own: what headers they carry is not read.
    if (!spreadsOwn) unread = true;
  };

  for (const node of fn.getDescendants()) {
    // A function written inside runs when something calls it: what it does is not read as this one's.
    const owner = ownerOf(node);
    if (owner !== fn) {
      if (Node.isIdentifier(node) && (isHolder(node) || headerNames.has(declared(node) as TsNode))) unread = true;
      continue;
    }
    // `return config`, `return { ...config, headers }`, an arrow's expression.
    const returned = Node.isReturnStatement(node) ? node.getExpression() : node === (fn as unknown as { getBody: () => TsNode }).getBody() && !Node.isBlock(node) ? node : undefined;
    // What a context's hook answers with is not used; the others answer with the request.
    if (returned !== undefined && handed !== 'context') {
      const value = unwrap(returned);
      const nothing = (Node.isIdentifier(value) && value.getText() === 'undefined') || Node.isVoidExpression(value);
      if (isHolder(value) || nothing) {
        // The request as it is.
      } else if (Node.isObjectLiteralExpression(value) && handed === 'options') answered(value, value);
      else if (handed === 'request' && Node.isNewExpression(value) && value.getExpression().getText() === 'Request') {
        // A new request made from the old one keeps its headers; one made with options of its own may not.
        const [, init] = value.getArguments();
        if (init === undefined || !isHolder(init)) unread = true;
      } else if (!(handed === 'request' && Node.isCallExpression(value))) {
        // Options answered with that are not the ones handed in, read here: what they carry is not known.
        unread = true;
      }
      if (Node.isReturnStatement(node)) continue;
    }
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() !== SyntaxKind.CommaToken) {
      const operator = node.getOperatorToken().getKind();
      const assigns =
        operator === SyntaxKind.EqualsToken || operator === SyntaxKind.QuestionQuestionEqualsToken || operator === SyntaxKind.BarBarEqualsToken;
      if (!assigns) continue;
      const left = unwrap(node.getLeft());
      // `config.headers['X-Tenant'] = t`, `config.headers.Authorization = t`.
      if (Node.isElementAccessExpression(left) && isHeaders(left.getExpression())) add(writtenKey(left.getArgumentExpression()), node);
      else if (Node.isPropertyAccessExpression(left) && isHeaders(left.getExpression())) add(left.getName(), node);
      // `config.headers = { ...config.headers, X: v }`.
      else if (isHeaders(left)) wholeSet(node.getRight(), node);
      // `config = { ... }`: the options replaced by name.
      else if (isHolder(left)) unread = true;
      // `config.headers.common['X'] = v`: written below the headers, in a shape not read.
      else if (left.getDescendants().some((each) => isHeaders(each))) unread = true;
      continue;
    }
    if (Node.isDeleteExpression(node)) {
      const target = unwrap(node.getExpression());
      if ((Node.isElementAccessExpression(target) || Node.isPropertyAccessExpression(target)) && isHeaders(target.getExpression())) unread = true;
      continue;
    }
    if (Node.isCallExpression(node)) {
      const callee = unwrap(node.getExpression());
      const args = node.getArguments();
      if (Node.isPropertyAccessExpression(callee) && isHeaders(callee.getExpression())) {
        const method = callee.getName();
        // `headers.set('X', v)`, `headers.append('X', v)`; reading one changes nothing.
        if (method === 'set' || method === 'append') add(writtenKey(args[0]), node);
        else if (method === 'delete' || method === 'clear') unread = true;
        continue;
      }
      // `Object.assign(config.headers, { X: v })`, `Object.assign(config, { headers })`.
      if (callee.getText() === 'Object.assign' && args[0] !== undefined) {
        const [target, ...sources] = args;
        if (isHeaders(target)) {
          for (const source of sources) {
            const object = unwrap(source);
            if (!Node.isObjectLiteralExpression(object)) unread = true;
            else for (const property of object.getProperties()) add(Node.isSpreadAssignment(property) ? undefined : keyOf(property), node);
          }
          continue;
        }
        if (isHolder(target)) {
          for (const source of sources) {
            const object = unwrap(source);
            if (!Node.isObjectLiteralExpression(object)) unread = true;
            else {
              const written = object.getProperty('headers');
              if (written !== undefined) {
                const value = Node.isPropertyAssignment(written) ? written.getInitializer() : Node.isShorthandPropertyAssignment(written) ? written.getNameNode() : undefined;
                if (value === undefined) unread = true;
                else wholeSet(value, node);
              }
            }
          }
          continue;
        }
      }
      // The options or the headers handed to a function: what it does to them is not read here.
      if (args.some((argument) => isHolder(argument) || isHeaders(argument))) unread = true;
      continue;
    }
    // `const copy = config`, `{ ...config }` anywhere but the answer: a second name the reading does not follow.
    if (Node.isVariableDeclaration(node)) {
      const value = node.getInitializer();
      if (value !== undefined && isHolder(value)) unread = true;
    }
  }
  return { keys: [...keys].sort(), unread, ...(replaces ? { replaces: true as const } : {}) };
};
