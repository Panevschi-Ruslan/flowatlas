import { Node, SyntaxKind, type CallExpression, type Node as TsNode, type ObjectBindingPattern } from 'ts-morph';
import { isDiscriminatorField } from './message-types.js';
import { functionLikeOf, type FunctionLike } from './types/signatures.js';

/**
 * Which fields of a message or a request body the code handed it reads (P368).
 *
 * A consumer's handler is handed a message, a route's handler and the guards,
 * interceptors, pipes and middleware in front of it a request; what crosses is
 * a shape both ends declare, and what the receiving end needs of it is the
 * fields it reads. This reading follows the value the code is handed through
 * the function: a member read off it (`evt.label`, `evt?.label`,
 * `evt['label']`), a destructuring (in the parameter list or of a local), a
 * local that is the value again (`const e = raw as Evt`), the value handed to
 * a function of the repository (followed, bounded), and a request's body
 * however the code reaches it (`req.body.x`, `ctx.request.body.x`,
 * `await c.req.json()`, `context.switchToHttp().getRequest().body`). A read
 * under a `switch`, an `if` or an early return on the message's discriminator
 * is written under the type it chooses (`when`).
 *
 * A use it cannot follow is said, never dropped: the whole value spread, put
 * inside another, handed to a function outside the repository, indexed by a
 * variable, or its keys walked. A value that is only compared, tested or
 * returned is not read here: what a function hands back is its caller's to
 * read.
 */

/** The node meta key the fields a function reads are written under. */
export const FIELDS_READ_META = 'fieldsRead';

/** The node meta key the uses that could not be followed are written under. */
export const FIELDS_UNREAD_META = 'fieldsUnread';

/** One field read: the path under the payload, the function it is read in, and the line. */
export interface FieldRead {
  /** Dotted, outermost first: `label`, `address.city`. */
  field: string;
  /** The function it is read in, where that is not the one the row is written on. */
  in?: string;
  line: number;
  /** The message types the read is made under, where a choice on the discriminator encloses it. */
  when?: string[];
}

/** A use of the value the reading could not follow, and why. */
export interface FieldUnread {
  in?: string;
  line: number;
  why: string;
  when?: string[];
}

/** What a function reads of what it is handed. */
export interface FieldsRead {
  reads: FieldRead[];
  unread: FieldUnread[];
  /** Set when a bound stopped the walk. */
  cut?: string;
}

/**
 * What a value is, as the walk carries it.
 *
 * `payload` is the message or the body itself, or a part of it at `prefix`.
 * `request` is a request object, whose body is its `body`, reached through
 * `request`, `req` or `raw` as often as a framework nests it, or handed back
 * by `json()`. `context` is a framework's context, which hands back the
 * request through `switchToHttp()` and `getRequest()`.
 */
export type ValueState =
  | { kind: 'payload'; prefix: readonly string[] }
  | { kind: 'request' }
  | { kind: 'context' };

/** Where the walk starts: a parameter of the function, as a state. */
export interface FieldStart {
  param: number;
  state: ValueState;
}

export interface FieldReadOptions {
  /** The id of a function as the graph names it; undefined for one the graph does not. */
  idOf(fn: FunctionLike): string | undefined;
  /** Whether a declaration is the repository's own code, which the walk may follow into. */
  isOwn(declaration: TsNode): boolean;
  /** The id of the node the rows are written on, when it is not the function's own (a guard's class). */
  rootId?: string;
  /** How many calls deep the walk follows the value. */
  maxDepth?: number;
  /** How many functions one walk reads. */
  maxFunctions?: number;
  /** How many reads one walk records. */
  maxReads?: number;
}

/** What hops a request object takes to another one: `ctx.request`, `c.req`, `request.raw`. */
const REQUEST_HOPS: ReadonlySet<string> = new Set(['request', 'req', 'raw']);

/** Calls on a request that hand back its body: `await c.req.json()`, `c.req.valid('json')`. */
const BODY_CALLS: ReadonlySet<string> = new Set(['json', 'getBody']);

/** Calls on a context that stay a context, and the one that hands back the request. */
const CONTEXT_HOPS: ReadonlySet<string> = new Set(['switchToHttp', 'switchToRpc', 'switchToWs']);
const CONTEXT_REQUEST: ReadonlySet<string> = new Set(['getRequest', 'getData']);

const MAX_DEPTH = 4;
const MAX_FUNCTIONS = 30;
const MAX_READS = 80;
const MAX_UNREAD = 20;

/** Wrappers that leave a value as it was. */
const isTransparent = (parent: TsNode, node: TsNode): boolean =>
  (Node.isParenthesizedExpression(parent) ||
    Node.isNonNullExpression(parent) ||
    Node.isAsExpression(parent) ||
    Node.isTypeAssertion(parent) ||
    Node.isSatisfiesExpression(parent) ||
    Node.isAwaitExpression(parent)) &&
  parent.getExpression() === node;

/** A string a key or a case is written as: a literal, or a name whose type is one string. */
const stringOf = (node: TsNode | undefined): string | undefined => {
  if (node === undefined) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  const type = node.getType();
  if (type.isStringLiteral()) {
    const value = type.getLiteralValue();
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
};

/** The text a row names a call by, short. */
const calleeText = (call: CallExpression): string => call.getExpression().getText().replace(/\s+/g, ' ').slice(0, 60);

interface Walk {
  options: FieldReadOptions;
  reads: Map<string, FieldRead>;
  unread: Map<string, FieldUnread>;
  functions: Set<FunctionLike>;
  rootId: string | undefined;
  cut?: string;
}

/** The function a node is written in. */
const enclosingFunction = (node: TsNode): FunctionLike | undefined => {
  for (let at = node.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isMethodDeclaration(at) || Node.isFunctionDeclaration(at) || Node.isArrowFunction(at) || Node.isFunctionExpression(at)) return at;
  }
  return undefined;
};

/** The graph's id of the function a node is in: its own, or the nearest named one enclosing it. */
const inOf = (walk: Walk, node: TsNode): string | undefined => {
  for (let fn = enclosingFunction(node); fn !== undefined; fn = enclosingFunction(fn)) {
    const id = walk.options.idOf(fn);
    if (id !== undefined) return id === walk.rootId ? undefined : id;
  }
  return undefined;
};

const addRead = (walk: Walk, path: readonly string[], node: TsNode, when: readonly string[] | undefined): void => {
  if (path.length === 0) return;
  const field = path.slice(0, 3).join('.');
  const at = inOf(walk, node);
  const line = node.getStartLineNumber();
  const key = `${field}|${at ?? ''}|${line}`;
  if (walk.reads.has(key)) return;
  if (walk.reads.size >= (walk.options.maxReads ?? MAX_READS)) {
    walk.cut = `more than ${walk.options.maxReads ?? MAX_READS} reads`;
    return;
  }
  walk.reads.set(key, { field, ...(at === undefined ? {} : { in: at }), line, ...(when === undefined || when.length === 0 ? {} : { when: [...when] }) });
};

const addUnread = (walk: Walk, node: TsNode, why: string, when: readonly string[] | undefined): void => {
  const at = inOf(walk, node);
  const line = node.getStartLineNumber();
  const key = `${why}|${at ?? ''}|${line}`;
  if (walk.unread.has(key) || walk.unread.size >= MAX_UNREAD) return;
  walk.unread.set(key, { ...(at === undefined ? {} : { in: at }), line, why, ...(when === undefined || when.length === 0 ? {} : { when: [...when] }) });
};

/** The values a choice on the discriminator encloses a node under, in one function. */
interface Bindings {
  /** Every name in the function known to hold a state, by its declaration. */
  states: Map<TsNode, ValueState>;
}

/**
 * The field a discriminator test reads, when it is one: `evt.type`, `req.body.kind`.
 * Its object must be a name the function holds a state for.
 */
const isDiscriminatorRead = (expression: TsNode, bindings: Bindings): boolean => {
  let node = expression;
  while (Node.isParenthesizedExpression(node) || Node.isNonNullExpression(node) || Node.isAsExpression(node)) node = node.getExpression();
  const path: string[] = [];
  while (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const key = Node.isPropertyAccessExpression(node) ? node.getName() : stringOf(node.getArgumentExpression());
    if (key === undefined) return false;
    path.unshift(key);
    node = node.getExpression();
    while (Node.isParenthesizedExpression(node) || Node.isNonNullExpression(node) || Node.isAsExpression(node)) node = node.getExpression();
  }
  if (!Node.isIdentifier(node) || path.length === 0) return false;
  const declaration = node.getSymbol()?.getDeclarations()[0];
  const state = declaration === undefined ? undefined : bindings.states.get(declaration);
  if (state === undefined) return false;
  const last = path[path.length - 1] ?? '';
  if (!isDiscriminatorField(last)) return false;
  if (state.kind === 'payload') return path.length === 1;
  if (state.kind === 'request') return path.length === 2 && path[0] === 'body';
  return false;
};

/** `X.type === 'A'` (either side), as the value tested for; with `negated` for `!==`. */
const equalityOf = (condition: TsNode, bindings: Bindings): { value: string; negated: boolean } | undefined => {
  let node = condition;
  while (Node.isParenthesizedExpression(node)) node = node.getExpression();
  if (!Node.isBinaryExpression(node)) return undefined;
  const operator = node.getOperatorToken().getKind();
  const equal = operator === SyntaxKind.EqualsEqualsEqualsToken || operator === SyntaxKind.EqualsEqualsToken;
  const unequal = operator === SyntaxKind.ExclamationEqualsEqualsToken || operator === SyntaxKind.ExclamationEqualsToken;
  if (!equal && !unequal) return undefined;
  const [read, other] = isDiscriminatorRead(node.getLeft(), bindings) ? [node.getLeft(), node.getRight()] : [node.getRight(), node.getLeft()];
  if (!isDiscriminatorRead(read, bindings)) return undefined;
  const value = stringOf(other);
  return value === undefined ? undefined : { value, negated: unequal };
};

/** Whether a statement always leaves the block it is in. */
const exits = (statement: TsNode): boolean => {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement) || Node.isContinueStatement(statement) || Node.isBreakStatement(statement)) return true;
  if (Node.isBlock(statement)) {
    const last = statement.getStatements().at(-1);
    return last !== undefined && exits(last);
  }
  return false;
};

/** The message types a choice on the discriminator encloses a node under, nearest first. */
const whenOf = (node: TsNode, fn: FunctionLike, bindings: Bindings): string[] | undefined => {
  let child: TsNode = node;
  for (let at = node.getParent(); at !== undefined && at !== fn; child = at, at = at.getParent()) {
    if (Node.isCaseClause(at) && child !== at.getExpression()) {
      const block = at.getParent();
      const switched = block?.getParent();
      if (switched === undefined || !Node.isSwitchStatement(switched) || !isDiscriminatorRead(switched.getExpression(), bindings)) continue;
      // A clause with no statements falls through into the next: its value is this one's too.
      const clauses = switched.getCaseBlock().getClauses();
      const index = clauses.indexOf(at);
      const values: string[] = [];
      for (let i = index; i >= 0; i -= 1) {
        const clause = clauses[i];
        if (clause === undefined || !Node.isCaseClause(clause)) break;
        if (i < index && clause.getStatements().length > 0) break;
        const value = stringOf(clause.getExpression());
        if (value !== undefined) values.unshift(value);
      }
      if (values.length > 0) return values;
    }
    if (Node.isIfStatement(at) && child !== at.getExpression()) {
      const tested = equalityOf(at.getExpression(), bindings);
      if (tested !== undefined && (child === at.getThenStatement()) !== tested.negated) return [tested.value];
    }
    if (Node.isBlock(at)) {
      // An early return before the node: `if (evt.type !== 'A') return;`.
      for (const statement of at.getStatements()) {
        if (statement === child) break;
        if (!Node.isIfStatement(statement) || statement.getElseStatement() !== undefined) continue;
        const tested = equalityOf(statement.getExpression(), bindings);
        if (tested !== undefined && tested.negated && exits(statement.getThenStatement())) return [tested.value];
      }
    }
  }
  return undefined;
};

/** A state seen through one more key, or undefined where the key leaves what is followed. */
const through = (state: ValueState, key: string, isCall: boolean): ValueState | undefined => {
  if (state.kind === 'payload') return isCall ? undefined : { kind: 'payload', prefix: [...state.prefix, key] };
  if (state.kind === 'request') {
    if (isCall) return BODY_CALLS.has(key) ? { kind: 'payload', prefix: [] } : undefined;
    if (key === 'body') return { kind: 'payload', prefix: [] };
    return REQUEST_HOPS.has(key) ? state : undefined;
  }
  if (!isCall) return undefined;
  if (CONTEXT_HOPS.has(key)) return state;
  return CONTEXT_REQUEST.has(key) ? { kind: 'request' } : undefined;
};

/** The function a call runs, when it is the repository's own. */
const calledFunction = (call: CallExpression, walk: Walk): FunctionLike | undefined => {
  const callee = call.getExpression();
  const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    if (!walk.options.isOwn(declaration)) continue;
    const fn = functionLikeOf(declaration);
    if (fn !== undefined && fn.getBody() !== undefined) return fn;
  }
  return undefined;
};

/** `valid('json')` on a request hands back its body; any other argument another part. */
const bodyByArgument = (call: CallExpression): boolean => {
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) && callee.getName() === 'valid' && stringOf(call.getArguments()[0]) === 'json';
};

/**
 * Follows one expression that holds a state: up through the reads made of it,
 * and on into whatever it is bound to or handed to.
 */
const followValue = (
  walk: Walk,
  fn: FunctionLike,
  bindings: Bindings,
  value: TsNode,
  state: ValueState,
  depth: number,
  inherited: readonly string[] | undefined,
): void => {
  let node = value;
  let current = state;
  // A name that holds a field already read is not a new read of it: only a key past it is.
  const known = state.kind === 'payload' ? state.prefix.length : -1;
  const fresh = (now: ValueState): now is { kind: 'payload'; prefix: readonly string[] } => now.kind === 'payload' && now.prefix.length > known;
  for (;;) {
    const parent = node.getParent();
    if (parent === undefined) return;
    if (isTransparent(parent, node)) {
      node = parent;
      continue;
    }
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === node) {
      const call = parent.getParent();
      const isCall = call !== undefined && Node.isCallExpression(call) && call.getExpression() === parent;
      const next =
        through(current, parent.getName(), isCall) ??
        (current.kind === 'request' && isCall && bodyByArgument(call) ? ({ kind: 'payload', prefix: [] } as const) : undefined);
      if (next === undefined) {
        // A method called on a part of the payload reads that part: `evt.label.trim()`.
        if (fresh(current)) addRead(walk, current.prefix, parent, whenOf(parent, fn, bindings) ?? inherited);
        return;
      }
      current = next;
      node = isCall ? (call as TsNode) : parent;
      continue;
    }
    if (Node.isCallExpression(parent) && parent.getExpression() === node) {
      // `c.req.valid('json')` reached through the access above it.
      return;
    }
    if (Node.isElementAccessExpression(parent) && parent.getExpression() === node) {
      const argument = parent.getArgumentExpression();
      const key = stringOf(argument);
      if (key !== undefined) {
        const next = through(current, key, false);
        if (next === undefined) return;
        current = next;
        node = parent;
        continue;
      }
      // An element of a list keeps the path; any other key is a field the reading cannot name.
      if (argument !== undefined && argument.getType().isNumber()) {
        node = parent;
        continue;
      }
      if (current.kind === 'payload') {
        if (fresh(current)) addRead(walk, current.prefix, parent, whenOf(parent, fn, bindings) ?? inherited);
        addUnread(walk, parent, `indexed by ${argument?.getText().slice(0, 40) ?? 'a value'}`, whenOf(parent, fn, bindings) ?? inherited);
      }
      return;
    }
    break;
  }
  const when = whenOf(node, fn, bindings) ?? inherited;
  if (fresh(current)) addRead(walk, current.prefix, node, when);
  settle(walk, fn, bindings, node, current, depth, when);
};

/** What becomes of a value once nothing more is read off it. */
const settle = (
  walk: Walk,
  fn: FunctionLike,
  bindings: Bindings,
  node: TsNode,
  state: ValueState,
  depth: number,
  when: readonly string[] | undefined,
): void => {
  const parent = node.getParent();
  if (parent === undefined) return;
  const whole = state.kind !== 'payload' || state.prefix.length === 0;
  if (Node.isVariableDeclaration(parent) && parent.getInitializer() === node) {
    const name = parent.getNameNode();
    if (Node.isIdentifier(name)) {
      bindings.states.set(parent, state);
      followName(walk, fn, bindings, parent, state, depth, when);
    } else if (Node.isObjectBindingPattern(name)) {
      destructure(walk, fn, bindings, name, state, depth, when);
    }
    return;
  }
  if (Node.isCallExpression(parent) && parent.getArguments().includes(node as never)) {
    handOff(walk, parent, parent.getArguments().indexOf(node as never), state, depth, when);
    return;
  }
  if (!whole) return;
  if (Node.isSpreadAssignment(parent) || Node.isSpreadElement(parent)) {
    addUnread(walk, parent, 'spread into another value', when);
  } else if (Node.isShorthandPropertyAssignment(parent) || (Node.isPropertyAssignment(parent) && parent.getInitializer() === node)) {
    addUnread(walk, parent, 'put inside another value', when);
  } else if (Node.isBinaryExpression(parent) && parent.getRight() === node && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    addUnread(walk, parent, `stored in ${parent.getLeft().getText().slice(0, 40)}`, when);
  } else if (Node.isForInStatement(parent)) {
    addUnread(walk, parent, 'its keys walked', when);
  } else if (Node.isForOfStatement(parent) && parent.getExpression() === node) {
    const declared = parent.getInitializer();
    const first = Node.isVariableDeclarationList(declared) ? declared.getDeclarations()[0] : undefined;
    if (first !== undefined && Node.isIdentifier(first.getNameNode())) {
      bindings.states.set(first, state);
      followName(walk, fn, bindings, first, state, depth, when);
    }
  }
};

/** Every place a name bound to a state is used, in the function it is declared in. */
const followName = (
  walk: Walk,
  fn: FunctionLike,
  bindings: Bindings,
  declaration: TsNode & { getNameNode(): TsNode },
  state: ValueState,
  depth: number,
  inherited: readonly string[] | undefined,
): void => {
  const name = declaration.getNameNode();
  if (!Node.isIdentifier(name)) return;
  const text = name.getText();
  const body = fn.getBody();
  if (body === undefined) return;
  for (const identifier of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (identifier === name || identifier.getText() !== text) continue;
    const parent = identifier.getParent();
    // The name a member is read by, `x.text`, is not this name.
    if (parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) continue;
    if (parent !== undefined && (Node.isPropertyAssignment(parent) || Node.isBindingElement(parent)) && parent.getNameNode() === identifier) continue;
    if (parent !== undefined && Node.isVariableDeclaration(parent) && parent.getNameNode() === identifier) continue;
    const declared = identifier.getSymbol()?.getDeclarations() ?? [];
    if (declared.length > 0 && !declared.includes(declaration as never)) {
      // A shorthand `{ evt }` names the property's symbol; its value is still this name.
      if (!(parent !== undefined && Node.isShorthandPropertyAssignment(parent))) continue;
    }
    followValue(walk, fn, bindings, identifier, state, depth, inherited);
  }
};

/** `const { label, ...rest } = evt`, and the same in a parameter list. */
const destructure = (
  walk: Walk,
  fn: FunctionLike,
  bindings: Bindings,
  pattern: ObjectBindingPattern,
  state: ValueState,
  depth: number,
  when: readonly string[] | undefined,
): void => {
  for (const element of pattern.getElements()) {
    if (element.getDotDotDotToken() !== undefined) {
      if (state.kind === 'payload') addUnread(walk, element, 'the rest of it gathered into another value', whenOf(element, fn, bindings) ?? when);
      continue;
    }
    const property = element.getPropertyNameNode();
    const key = property === undefined ? element.getName() : Node.isIdentifier(property) || Node.isStringLiteral(property) ? (Node.isStringLiteral(property) ? property.getLiteralValue() : property.getText()) : undefined;
    if (key === undefined) {
      if (state.kind === 'payload') addUnread(walk, element, 'destructured by a computed key', when);
      continue;
    }
    const next = through(state, key, false);
    if (next === undefined) continue;
    const at = whenOf(element, fn, bindings) ?? when;
    if (next.kind === 'payload') addRead(walk, next.prefix, element, at);
    const name = element.getNameNode();
    if (Node.isIdentifier(name)) {
      bindings.states.set(element, next);
      followName(walk, fn, bindings, element, next, depth, at);
    } else if (Node.isObjectBindingPattern(name)) {
      destructure(walk, fn, bindings, name, next, depth, at);
    }
  }
};

/** A value handed to a call: followed into the repository's own function, said where it cannot be. */
const handOff = (
  walk: Walk,
  call: CallExpression,
  index: number,
  state: ValueState,
  depth: number,
  when: readonly string[] | undefined,
): void => {
  const whole = state.kind !== 'payload' || state.prefix.length === 0;
  const target = calledFunction(call, walk);
  if (target === undefined) {
    // A part of the payload handed on has been read already; only the whole of it is lost here.
    if (whole) addUnread(walk, call, `handed to ${calleeText(call)}`, when);
    return;
  }
  const parameter = target.getParameters()[index];
  if (parameter === undefined || parameter.isRestParameter()) {
    if (whole) addUnread(walk, call, `handed to ${calleeText(call)} past its parameters`, when);
    return;
  }
  if (depth >= (walk.options.maxDepth ?? MAX_DEPTH)) {
    if (whole) addUnread(walk, call, `handed to ${calleeText(call)}, deeper than the walk follows`, when);
    walk.cut = `deeper than ${walk.options.maxDepth ?? MAX_DEPTH} calls`;
    return;
  }
  if (!walk.functions.has(target) && walk.functions.size >= (walk.options.maxFunctions ?? MAX_FUNCTIONS)) {
    walk.cut = `more than ${walk.options.maxFunctions ?? MAX_FUNCTIONS} functions`;
    return;
  }
  walk.functions.add(target);
  readParameter(walk, target, index, state, depth + 1, when);
};

/** Follows one parameter of a function holding a state. */
const readParameter = (
  walk: Walk,
  fn: FunctionLike,
  index: number,
  state: ValueState,
  depth: number,
  when: readonly string[] | undefined,
): void => {
  const parameter = fn.getParameters()[index];
  if (parameter === undefined) return;
  const bindings: Bindings = { states: new Map() };
  const name = parameter.getNameNode();
  if (Node.isIdentifier(name)) {
    bindings.states.set(parameter, state);
    followName(walk, fn, bindings, parameter, state, depth, when);
  } else if (Node.isObjectBindingPattern(name)) {
    destructure(walk, fn, bindings, name, state, depth, when);
  }
};

/**
 * What a function reads of the values its parameters are handed, as `starts`
 * says each one is. A row read in `rootId` (the node the rows are written on,
 * the function's own by default) names no function; any other names the one
 * it is read in.
 */
export const readFields = (fn: FunctionLike, starts: readonly FieldStart[], options: FieldReadOptions): FieldsRead => {
  const walk: Walk = {
    options,
    reads: new Map(),
    unread: new Map(),
    functions: new Set([fn]),
    rootId: options.rootId ?? options.idOf(fn),
  };
  for (const start of starts) readParameter(walk, fn, start.param, start.state, 0, undefined);
  const byLine = (a: { line: number; in?: string }, b: { line: number; in?: string }): number =>
    (a.in ?? '') < (b.in ?? '') ? -1 : (a.in ?? '') > (b.in ?? '') ? 1 : a.line - b.line;
  return {
    reads: [...walk.reads.values()].sort((a, b) => byLine(a, b) || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0)),
    unread: [...walk.unread.values()].sort(byLine),
    ...(walk.cut === undefined ? {} : { cut: walk.cut }),
  };
};
