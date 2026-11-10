import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { writtenKey } from './built-query.js';

/**
 * The headers a caller reads off the answer to its request (P265), read
 * where the answer is used: `res.headers.get('x-total')` on the platform's
 * response, `response.headers['x-total']` on a client's, `res.headers.get(...)`
 * on a framework's answer observed whole.
 *
 * A name read through `get` or `has` is looked up whatever its case, so it is
 * recorded lower-cased, as every client hands a response's names on; a name
 * read as a key of the headers is recorded as written, since only the
 * lower-cased one is there. A name written as code, the headers handed on or
 * walked, is `unread`: the caller may read names nothing here sees. An
 * answer handed back from the function the request is made in - `return
 * this.http.get(...)`, through `pipe` operators that hand it on as it is - is
 * read where each caller of that function holds it, two functions out at most
 * (P276).
 *
 * How the answer reaches the caller is the reader's to say: a promise
 * (`await`, `.then`) or an observable (`subscribe`, the first operator of
 * `pipe`, `firstValueFrom`).
 */
export type AnswerHanded = 'promise' | 'observable';

export interface ResponseHeadersRead {
  /** The names read: lower-cased where looked up, as written where read as a key. */
  readonly keys: readonly string[];
  /** Whether a name is read that is not known, or the headers are handed on. */
  readonly unread: boolean;
}

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isNonNullExpression(current) || Node.isSatisfiesExpression(current)) {
    current = current.getExpression();
  }
  return current;
};

/** The expression a value is used as, past the wrappings that change nothing. */
const usedAs = (node: TsNode): TsNode => {
  let at = node;
  for (let parent = at.getParent(); parent !== undefined; parent = at.getParent()) {
    if (!(Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isNonNullExpression(parent) || Node.isSatisfiesExpression(parent))) break;
    at = parent;
  }
  return at;
};

/** The operators of `pipe` whose function is handed the answer itself. */
const OPERATORS = new Set(['map', 'tap', 'switchMap', 'mergeMap', 'concatMap', 'exhaustMap']);

/** What the answer is held as: a name declared for it, or the headers read off it in place. */
type Holding = { readonly binding: TsNode } | { readonly headers: TsNode } | { readonly headersBinding: TsNode };

/** What a function handed the answer holds it as, by its first parameter. */
const handedTo = (fn: TsNode | undefined): Holding[] => {
  if (fn === undefined || !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return [];
  const parameter = fn.getParameters()[0];
  if (parameter === undefined) return [];
  return heldBy(parameter, parameter.getNameNode());
};

const heldBy = (declaration: TsNode, name: TsNode): Holding[] => {
  if (Node.isIdentifier(name)) return [{ binding: declaration }];
  if (!Node.isObjectBindingPattern(name)) return [];
  return name.getElements().flatMap((element): Holding[] => {
    const key = element.getPropertyNameNode()?.getText() ?? element.getName();
    return key === 'headers' ? (Node.isIdentifier(element.getNameNode()) ? [{ headersBinding: element }] : [{ headers: element.getNameNode() }]) : [];
  });
};

/** The operators of `pipe` that hand the answer on as it is, so the piped observable answers with it still. */
const PASSING = new Set(['tap', 'catchError', 'retry', 'retryWhen', 'take', 'first', 'shareReplay', 'share', 'finalize', 'timeout', 'delay', 'takeUntil', 'takeUntilDestroyed']);

/** How many functions an answer handed back is followed out through to its callers. */
const RETURN_DEPTH = 2;

/** How many callers of one function an answer handed back is followed to. */
const CALLERS = 20;

const isFunctionLike = (node: TsNode): boolean =>
  Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node);

/**
 * The calls of the function an answer is handed back from, when it is: the
 * value of its `return`, or its concise body (P276). A service's
 * `getOrders() { return this.http.get(url, { observe: 'response' }) }` is read
 * where the component subscribes to `this.orders.getOrders()`, as a request
 * made where it is read is read there.
 */
const callersOfReturned = (at: TsNode): TsNode[] => {
  const parent = at.getParent();
  const fn = parent !== undefined && Node.isReturnStatement(parent) ? parent.getFirstAncestor(isFunctionLike) : parent !== undefined && Node.isArrowFunction(parent) && parent.getBody() === at ? parent : undefined;
  if (fn === undefined) return [];
  const holder = Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) ? fn.getParent() : fn;
  const name =
    holder !== undefined && (Node.isMethodDeclaration(holder) || Node.isFunctionDeclaration(holder) || Node.isVariableDeclaration(holder) || Node.isPropertyDeclaration(holder) || Node.isPropertyAssignment(holder))
      ? holder.getNameNode()
      : undefined;
  if (name === undefined || !Node.isIdentifier(name)) return [];
  let references: TsNode[];
  try {
    references = name.findReferencesAsNodes();
  } catch {
    return [];
  }
  return references.slice(0, CALLERS).flatMap((reference) => {
    const access = reference.getParent();
    const callee = access !== undefined && Node.isPropertyAccessExpression(access) && access.getNameNode() === reference ? access : reference;
    const call = callee.getParent();
    return call !== undefined && Node.isCallExpression(call) && call.getExpression() === callee ? [call] : [];
  });
};

/** Where the answer to a call is held, however it reaches the caller. */
const holdingsOf = (call: TsNode, handed: AnswerHanded, depth = 0): Holding[] => {
  let at = usedAs(call);
  let parent = at.getParent();
  // Handed back to the function's callers: read where each of them holds it (P276).
  if (depth < RETURN_DEPTH) {
    const callers = callersOfReturned(at);
    if (callers.length > 0) return callers.flatMap((caller) => holdingsOf(caller, handed, depth + 1));
  }
  if (handed === 'observable') {
    // `.pipe(tap(...), catchError(...))`: the piped observable still answers with the response.
    if (parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getName() === 'pipe' && parent.getExpression() === at) {
      const invoked = parent.getParent();
      const operators = invoked !== undefined && Node.isCallExpression(invoked) ? invoked.getArguments() : [];
      if (invoked !== undefined && operators.length > 0 && operators.every((operator) => Node.isCallExpression(operator) && PASSING.has(operator.getExpression().getText()))) {
        return holdingsOf(invoked, handed, depth);
      }
    }
    if (parent !== undefined && Node.isCallExpression(parent) && parent.getArguments()[0] === at && /^(?:firstValueFrom|lastValueFrom)$/.test(parent.getExpression().getText())) {
      return holdingsOf(parent, 'promise');
    }
    if (parent === undefined || !Node.isPropertyAccessExpression(parent) || parent.getExpression() !== at) return [];
    const invoked = parent.getParent();
    if (invoked === undefined || !Node.isCallExpression(invoked)) return [];
    const [first] = invoked.getArguments();
    if (parent.getName() === 'subscribe') {
      if (first !== undefined && Node.isObjectLiteralExpression(first)) {
        const next = first.getProperty('next');
        return handedTo(next !== undefined && Node.isPropertyAssignment(next) ? next.getInitializer() : next);
      }
      return handedTo(first);
    }
    if (parent.getName() === 'pipe' && first !== undefined && Node.isCallExpression(first) && OPERATORS.has(first.getExpression().getText())) {
      return handedTo(first.getArguments()[0]);
    }
    return [];
  }
  if (parent !== undefined && Node.isAwaitExpression(parent)) {
    at = usedAs(parent);
    parent = at.getParent();
    // `return await fetch(...)`: handed back as well.
    if (depth < RETURN_DEPTH) {
      const callers = callersOfReturned(at);
      if (callers.length > 0) return callers.flatMap((caller) => holdingsOf(caller, handed, depth + 1));
    }
  } else if (parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getName() === 'then' && parent.getExpression() === at) {
    const invoked = parent.getParent();
    return invoked !== undefined && Node.isCallExpression(invoked) ? handedTo(invoked.getArguments()[0]) : [];
  }
  if (parent === undefined) return [];
  if (Node.isVariableDeclaration(parent) && parent.getInitializer() === at) return heldBy(parent, parent.getNameNode());
  if ((Node.isPropertyAccessExpression(parent) && parent.getName() === 'headers') || (Node.isElementAccessExpression(parent) && writtenKey(parent.getArgumentExpression()) === 'headers')) {
    return parent.getExpression() === at ? [{ headers: parent }] : [];
  }
  return [];
};

/** The names a declaration is used by, in the scope it is declared in. */
const usesOf = (declaration: TsNode): TsNode[] => {
  const symbol = (Node.isVariableDeclaration(declaration) || Node.isParameterDeclaration(declaration) || Node.isBindingElement(declaration) ? declaration.getNameNode() : declaration).getSymbol();
  if (symbol === undefined) return [];
  const scope = declaration.getFirstAncestor((each) => Node.isBlock(each) || Node.isSourceFile(each) || Node.isArrowFunction(each) || Node.isFunctionExpression(each) || Node.isFunctionDeclaration(each) || Node.isMethodDeclaration(each)) ?? declaration.getSourceFile();
  return scope.getDescendants().filter((each) => Node.isIdentifier(each) && each.getSymbol() === symbol && each.getParent() !== declaration);
};

/** The headers a caller reads off the answer to `call`; `undefined` where it reads none it can be seen to. */
export const responseHeadersRead = (call: TsNode, handed: AnswerHanded): ResponseHeadersRead | undefined => {
  const keys = new Set<string>();
  let unread = false;
  let read = false;

  /** One use of the headers: a name looked up, a name read as a key, or the headers handed on. */
  const fromHeaders = (headers: TsNode, depth: number): void => {
    read = true;
    const at = usedAs(headers);
    const parent = at.getParent();
    if (parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getExpression() === at) {
      const invoked = parent.getParent();
      if (invoked !== undefined && Node.isCallExpression(invoked) && invoked.getExpression() === parent) {
        if (parent.getName() === 'get' || parent.getName() === 'has' || parent.getName() === 'getAll') {
          const key = writtenKey(invoked.getArguments()[0]);
          if (key === undefined) unread = true;
          else keys.add(key.toLowerCase());
        } else unread = true;
        return;
      }
      keys.add(parent.getName());
      return;
    }
    if (parent !== undefined && Node.isElementAccessExpression(parent) && parent.getExpression() === at) {
      const key = writtenKey(parent.getArgumentExpression());
      if (key === undefined) unread = true;
      else keys.add(key);
      return;
    }
    if (parent !== undefined && Node.isVariableDeclaration(parent) && parent.getInitializer() === at && depth < 3) {
      const name = parent.getNameNode();
      if (Node.isIdentifier(name)) {
        for (const use of usesOf(parent)) fromHeaders(use, depth + 1);
        return;
      }
      if (Node.isObjectBindingPattern(name)) {
        for (const element of name.getElements()) {
          if (element.getDotDotDotToken() !== undefined) unread = true;
          else keys.add(element.getPropertyNameNode()?.getText().replace(/^['"]|['"]$/g, '') ?? element.getName());
        }
        return;
      }
    }
    unread = true;
  };

  for (const holding of holdingsOf(call, handed)) {
    if ('headers' in holding) {
      // `const { headers: { 'x-total': total } } = res`: the keys destructured.
      if (Node.isObjectBindingPattern(holding.headers)) {
        read = true;
        for (const element of holding.headers.getElements()) {
          if (element.getDotDotDotToken() !== undefined) unread = true;
          else keys.add(element.getPropertyNameNode()?.getText().replace(/^['"]|['"]$/g, '') ?? element.getName());
        }
      } else fromHeaders(holding.headers, 0);
      continue;
    }
    if ('headersBinding' in holding) {
      for (const use of usesOf(holding.headersBinding)) fromHeaders(use, 0);
      continue;
    }
    for (const use of usesOf(holding.binding)) {
      const parent = use.getParent();
      if (parent === undefined) continue;
      if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === use && parent.getName() === 'headers') fromHeaders(parent, 0);
      else if (Node.isElementAccessExpression(parent) && parent.getExpression() === use && writtenKey(parent.getArgumentExpression()) === 'headers') fromHeaders(parent, 0);
    }
  }
  return read ? { keys: [...keys].sort(), unread } : undefined;
};

