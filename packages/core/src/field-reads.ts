import { Node, SyntaxKind, type ArrayBindingPattern, type CallExpression, type Node as TsNode, type ObjectBindingPattern } from 'ts-morph';
import { isDiscriminatorField } from './message-types.js';
import { presenceChecked } from './presence-guards.js';
import { switchedOver, type SwitchedOver } from './switch-cases.js';
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
 * A key the code holds in a local or an option is read where the reading
 * settles it to a string (P374): a `const`, a default parameter, or a member
 * of an object literal written as the default behind `??` or `||`
 * (`const source = options.at ?? { name: 'userRef' }; bag[source.name]`). One
 * settled from a default is marked `sureness: 'default'`, since the options
 * may name another. A local assigned the value in one branch and something
 * else in another (`bag = req.params` / `bag = req.body`) holds the value for
 * every read of it.
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
  /** `default`: read through a key settled from a default the code holds, which options may replace (P374). */
  sureness?: FieldSureness;
  /** The file the read is written in, where it is not the function's: a component's template (P391). */
  file?: string;
  /** The code checks the field is there before it counts on it (`?.`, `??`, `if (x)`, `== null`, `'k' in o`): it handles its absence (P395). */
  guarded?: true;
  /**
   * The code switches over the field's value (P402): whether a `default`
   * handles a value no case names, and the values the cases name, so a type
   * that gains a value is judged by whether the switch handles it.
   */
  switched?: SwitchedOver;
}

/** How a read was settled where it is not plainly written: through a key held as a default (P374). */
export type FieldSureness = 'default';

/** A use of the value the reading could not follow, and why. */
export interface FieldUnread {
  in?: string;
  line: number;
  why: string;
  when?: string[];
  /** The file the use is written in, where it is not the function's: a component's template (P391). */
  file?: string;
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
  | { kind: 'payload'; prefix: readonly string[]; sureness?: FieldSureness }
  | { kind: 'request' }
  | { kind: 'context' }
  | ResponseState
  | HolderState;

/**
 * An object that holds a value under one key (P391): the props a component
 * is handed, `order` being the value bound to `<Row order={o} />`.
 */
export interface HolderState {
  kind: 'holder';
  key: string;
  inner: ValueState;
}

/**
 * A response a client is handed (P391), whose body is reached by a key
 * (`res.data`, `res.body`) or a call (`await res.json()`); anything else read
 * off it (`status`, `ok`, `headers`) is not the body.
 */
export interface ResponseState {
  kind: 'response';
  bodyKeys: readonly string[];
  bodyCalls: readonly string[];
}

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
  /**
   * Follow a list into what is done with each element (P391): the callback of
   * `map`, `filter`, `find`, `forEach` and the like, a `for…of` over a part,
   * what `filter` or `find` hands back, `.length` not a field, and a promise's
   * `then`. Off for what a handler is handed, whose reads are written already.
   */
  followLists?: boolean;
  /**
   * Asked first where the value leaves what this walk follows (P391): handed
   * back, stored in a member, handed to a function not of the repository, or
   * bound to an element's attribute. True where the caller followed it on; the
   * walk otherwise says it as it always has.
   */
  escape?: (use: FieldEscape, walk: FieldWalk) => boolean;
  /**
   * Mark a read the code checks for presence first `guarded` (P395): a
   * client that handles a field's absence. Off for what a handler is handed.
   */
  guards?: boolean;
}

/** Where a value leaves what the walk follows on its own (P391). */
export interface FieldEscape {
  /** `returned` by its function, `stored` in something not a local, `handed` to a call, `bound` to a JSX attribute. */
  kind: 'returned' | 'stored' | 'handed' | 'bound';
  /** The value, as the outermost expression that holds it. */
  node: TsNode;
  /** The return, the assignment, the call or the attribute. */
  at: TsNode;
  fn: FunctionLike;
  state: ValueState;
  when: readonly string[] | undefined;
  depth: number;
  /** The argument it is, where it is handed to a call. */
  index?: number;
}

/** What an escape may do to carry the walk on (P391). */
export interface FieldWalk {
  /** Follows a value held at `node`, in `fn`. */
  followValue(fn: FunctionLike, node: TsNode, state: ValueState, depth: number, when?: readonly string[]): void;
  /** Follows a parameter of `fn` that holds a state. */
  readParameter(fn: FunctionLike, index: number, state: ValueState, depth: number, when?: readonly string[]): void;
  /** Records a read made where no code of the walk stands: a component's template. */
  addRead(read: FieldRead): void;
  addUnread(row: FieldUnread): void;
  /** Whether one more function may be read, counting it; false (and the walk said cut) past the bound. */
  enter(fn: FunctionLike): boolean;
  /** The id of the node the rows are written on. */
  readonly rootId: string | undefined;
  /** The id of the function a node is in, as rows name it. */
  inOf(node: TsNode): string | undefined;
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

/**
 * Records a read at `node`; `value` is the expression holding the field's
 * value, where `node` is a use one step past it (`evt.label.trim()`).
 */
const addRead = (walk: Walk, path: readonly string[], node: TsNode, when: readonly string[] | undefined, sureness?: FieldSureness, value: TsNode = node): void => {
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
  walk.reads.set(key, {
    field,
    ...(at === undefined ? {} : { in: at }),
    line,
    ...(when === undefined || when.length === 0 ? {} : { when: [...when] }),
    ...(sureness === undefined ? {} : { sureness }),
    ...(walk.options.guards === true && presenceChecked(value, path.length) ? { guarded: true as const } : {}),
    ...switchedAt(value),
  });
};

/** The switch over a field's value, where the code switches over it (P402). */
const switchedAt = (value: TsNode): { switched?: SwitchedOver } => {
  const found = switchedOver(value);
  return found === undefined ? {} : { switched: found };
};

/** A string a key settles to, and how: plainly written, or a default the options may replace. */
interface SettledKey {
  key: string;
  sureness?: FieldSureness;
}

/** How deep `settledKey` follows names to the value they hold. */
const MOST_KEY_HOPS = 4;

/** The object literal a value is written as, or the one written as its default behind `??` or `||`. */
const objectOf = (node: TsNode | undefined, hops: number): { object: TsNode; sureness?: FieldSureness } | undefined => {
  if (node === undefined || hops > MOST_KEY_HOPS) return undefined;
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isSatisfiesExpression(at) || Node.isNonNullExpression(at)) at = at.getExpression();
  if (Node.isObjectLiteralExpression(at)) return { object: at };
  if (Node.isBinaryExpression(at)) {
    const operator = at.getOperatorToken().getKind();
    if (operator !== SyntaxKind.QuestionQuestionToken && operator !== SyntaxKind.BarBarToken) return undefined;
    const fallback = objectOf(at.getRight(), hops + 1);
    return fallback === undefined ? undefined : { object: fallback.object, sureness: 'default' };
  }
  if (Node.isIdentifier(at)) {
    const declaration = at.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined) return undefined;
    if (Node.isVariableDeclaration(declaration) && declaration.getVariableStatement()?.getDeclarationKind() === 'const') {
      return objectOf(declaration.getInitializer(), hops + 1);
    }
    if (Node.isParameterDeclaration(declaration)) {
      const fallback = objectOf(declaration.getInitializer(), hops + 1);
      return fallback === undefined ? undefined : { object: fallback.object, sureness: 'default' };
    }
  }
  return undefined;
};

/**
 * The string a key is, where the reading can settle it (P374): written out,
 * a name whose type is one string, a `const` holding one, a parameter's
 * default, or a member of an object literal the code holds - itself, or as
 * the default behind `??` or `||`.
 */
const settledKey = (node: TsNode | undefined, hops = 0): SettledKey | undefined => {
  if (node === undefined || hops > MOST_KEY_HOPS) return undefined;
  const plain = stringOf(node);
  if (plain !== undefined) return { key: plain };
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isNonNullExpression(at)) at = at.getExpression();
  if (Node.isIdentifier(at)) {
    const declaration = at.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isVariableDeclaration(declaration) && declaration.getVariableStatement()?.getDeclarationKind() === 'const') {
      return settledKey(declaration.getInitializer(), hops + 1);
    }
    if (declaration !== undefined && Node.isParameterDeclaration(declaration)) {
      const fallback = settledKey(declaration.getInitializer(), hops + 1);
      return fallback === undefined ? undefined : { key: fallback.key, sureness: 'default' };
    }
    return undefined;
  }
  if (Node.isPropertyAccessExpression(at) || Node.isElementAccessExpression(at)) {
    const name = Node.isPropertyAccessExpression(at) ? at.getName() : stringOf(at.getArgumentExpression());
    if (name === undefined) return undefined;
    const holder = objectOf(at.getExpression(), hops + 1);
    if (holder === undefined || !Node.isObjectLiteralExpression(holder.object)) return undefined;
    const property = holder.object.getProperty(name);
    if (property === undefined || !Node.isPropertyAssignment(property)) return undefined;
    const value = settledKey(property.getInitializer(), hops + 1);
    if (value === undefined) return undefined;
    const sureness = holder.sureness ?? value.sureness;
    return { key: value.key, ...(sureness === undefined ? {} : { sureness }) };
  }
  return undefined;
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
  /** The locals followed because the value is assigned to them (P374), each once. */
  assigned: Set<TsNode>;
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
const through = (state: ValueState, key: string, isCall: boolean, sureness?: FieldSureness): ValueState | undefined => {
  if (state.kind === 'payload') {
    if (isCall) return undefined;
    const settled = sureness ?? state.sureness;
    return { kind: 'payload', prefix: [...state.prefix, key], ...(settled === undefined ? {} : { sureness: settled }) };
  }
  if (state.kind === 'holder') return !isCall && key === state.key ? state.inner : undefined;
  if (state.kind === 'response') {
    return (isCall ? state.bodyCalls : state.bodyKeys).includes(key) ? { kind: 'payload', prefix: [] } : undefined;
  }
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

/** Whether a value goes on through its parent as it was: either side of `??` or `||`, a branch of `?:` (P391). */
const isPassedOn = (parent: TsNode, node: TsNode): boolean => {
  if (Node.isBinaryExpression(parent)) {
    const operator = parent.getOperatorToken().getKind();
    return operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken;
  }
  return Node.isConditionalExpression(parent) && parent.getCondition() !== node;
};

/** List methods whose callback is handed each element, by the parameter it is handed at. */
const ELEMENT_CALLBACKS: ReadonlyMap<string, number> = new Map([
  ['map', 0],
  ['flatMap', 0],
  ['forEach', 0],
  ['filter', 0],
  ['find', 0],
  ['findLast', 0],
  ['findIndex', 0],
  ['findLastIndex', 0],
  ['some', 0],
  ['every', 0],
  ['reduce', 1],
  ['reduceRight', 1],
]);

/** List methods that hand back elements of the same list, so what is read off the result is read off the list. */
const KEEPS_ELEMENTS: ReadonlySet<string> = new Set(['filter', 'find', 'findLast', 'slice', 'sort', 'reverse', 'at', 'toSorted', 'toReversed', 'concat']);

/** Whether a value is a list, or a list or nothing. */
const isList = (node: TsNode): boolean => {
  const type = node.getType();
  if (type.isArray() || type.isTuple()) return true;
  const kept = type.getNonNullableType();
  return kept.isArray() || kept.isTuple();
};

/** Whether a value is a promise, whose `then` is handed it. */
const isPromise = (node: TsNode): boolean => {
  const name = node.getType().getNonNullableType().getSymbol()?.getName();
  return name === 'Promise' || name === 'PromiseLike';
};

/** The function a callback argument is: written in place, or the repository's own named one. */
const callbackOf = (walk: Walk, argument: TsNode | undefined): FunctionLike | undefined => {
  if (argument === undefined) return undefined;
  if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) return argument;
  const name = Node.isPropertyAccessExpression(argument) ? argument.getNameNode() : argument;
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    if (!walk.options.isOwn(declaration)) continue;
    const fn = functionLikeOf(declaration);
    if (fn !== undefined && fn.getBody() !== undefined) return fn;
  }
  return undefined;
};

/** Counts one more function into the walk; false, and the walk said cut, where the bound is reached. */
const enter = (walk: Walk, fn: FunctionLike): boolean => {
  if (walk.functions.has(fn)) return true;
  if (walk.functions.size >= (walk.options.maxFunctions ?? MAX_FUNCTIONS)) {
    walk.cut = `more than ${walk.options.maxFunctions ?? MAX_FUNCTIONS} functions`;
    return false;
  }
  walk.functions.add(fn);
  return true;
};

/** Follows a callback's parameter, within the bounds. */
const intoCallback = (walk: Walk, callback: FunctionLike | undefined, index: number, state: ValueState, depth: number, when: readonly string[] | undefined): void => {
  if (callback === undefined || !enter(walk, callback)) return;
  readParameter(walk, callback, index, state, depth, when);
};

/**
 * A member read off a list or a promise, where lists are followed (P391):
 * `.length` is no field, a callback of `map` or `filter` is handed each
 * element at the list's own path, what `filter` or `find` hands back goes on
 * as the list, and a promise's `then` hands its callback the value. Undefined
 * where the read is an ordinary one; else the node to go on from, or `stop`.
 */
const listUse = (
  walk: Walk,
  node: TsNode,
  access: TsNode & { getName(): string },
  state: { kind: 'payload'; prefix: readonly string[]; sureness?: FieldSureness },
  depth: number,
  when: readonly string[] | undefined,
  fresh: boolean,
  field: TsNode = node,
): TsNode | 'stop' | undefined => {
  const name = access.getName();
  const call = access.getParent();
  const isCall = call !== undefined && Node.isCallExpression(call) && call.getExpression() === (access as TsNode);
  if (isCall && name === 'then' && isPromise(node)) {
    intoCallback(walk, callbackOf(walk, call.getArguments()[0]), 0, state, depth, when);
    return 'stop';
  }
  // `name.length`, `name.trim()`: what is read off a string or a number is no field of it.
  const kept = node.getType().getNonNullableType();
  if (kept.isString() || kept.isNumber() || kept.isBoolean() || kept.isStringLiteral() || kept.isNumberLiteral()) {
    if (fresh) addRead(walk, state.prefix, access, when, state.sureness, field);
    return 'stop';
  }
  if (!isList(node)) return undefined;
  if (fresh) addRead(walk, state.prefix, access, when, state.sureness, field);
  if (!isCall) return 'stop';
  const at = ELEMENT_CALLBACKS.get(name);
  if (at !== undefined) intoCallback(walk, callbackOf(walk, call.getArguments()[0]), at, state, depth, when);
  return KEEPS_ELEMENTS.has(name) ? call : 'stop';
};

/** The hands an escape is given to carry the walk on (P391). */
const handleOf = (walk: Walk): FieldWalk => ({
  followValue: (fn, node, state, depth, when) => followValue(walk, fn, { states: new Map(), assigned: new Set() }, node, state, depth, when),
  readParameter: (fn, index, state, depth, when) => readParameter(walk, fn, index, state, depth, when),
  addRead: (read) => {
    const key = `${read.field}|${read.in ?? ''}|${read.file ?? ''}|${read.line}`;
    if (walk.reads.has(key)) return;
    if (walk.reads.size >= (walk.options.maxReads ?? MAX_READS)) {
      walk.cut = `more than ${walk.options.maxReads ?? MAX_READS} reads`;
      return;
    }
    walk.reads.set(key, read);
  },
  addUnread: (row) => {
    const key = `${row.why}|${row.in ?? ''}|${row.file ?? ''}|${row.line}`;
    if (walk.unread.has(key) || walk.unread.size >= MAX_UNREAD) return;
    walk.unread.set(key, row);
  },
  enter: (fn) => enter(walk, fn),
  rootId: walk.rootId,
  inOf: (node) => inOf(walk, node),
});

/**
 * Where a value leaves the function, asked of the escape first (P391): handed
 * back, stored in what is not a local, or bound to a JSX attribute. True where
 * it was taken up, or said.
 */
const settleEscaped = (
  walk: Walk,
  fn: FunctionLike,
  node: TsNode,
  parent: TsNode,
  state: ValueState,
  depth: number,
  when: readonly string[] | undefined,
  whole: boolean,
): boolean => {
  const attribute = Node.isJsxExpression(parent) ? parent.getParent() : undefined;
  const kind: FieldEscape['kind'] | undefined =
    Node.isReturnStatement(parent) || (Node.isArrowFunction(parent) && parent.getBody() === node)
      ? 'returned'
      : Node.isBinaryExpression(parent) && parent.getRight() === node && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken && localAssigned(parent.getLeft(), fn) === undefined
        ? 'stored'
        : attribute !== undefined && Node.isJsxAttribute(attribute)
          ? 'bound'
          : undefined;
  if (kind === undefined) return false;
  const at = kind === 'bound' ? (attribute as TsNode) : parent;
  if (walk.options.escape?.({ kind, node, at, fn, state, when, depth }, handleOf(walk)) === true) return true;
  if (kind === 'bound') {
    if (whole) addUnread(walk, at, `bound to ${at.getText().split('=')[0]?.slice(0, 40) ?? 'an attribute'}`, when);
    return true;
  }
  return false;
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
  // The expression the field's value is, before a fallback or a branch hands it on: where its presence checks are judged (P402).
  let field = value;
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
    // `res.items ?? []`, `ok ? res.items : []`: the value goes on as it was (P391).
    if (walk.options.followLists === true && isPassedOn(parent, node)) {
      node = parent;
      continue;
    }
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === node) {
      const call = parent.getParent();
      const isCall = call !== undefined && Node.isCallExpression(call) && call.getExpression() === parent;
      if (walk.options.followLists === true && current.kind === 'payload') {
        const listed = listUse(walk, node, parent, current, depth, whenOf(parent, fn, bindings) ?? inherited, fresh(current), field);
        if (listed === 'stop') return;
        if (listed !== undefined) {
          node = listed;
          field = listed;
          continue;
        }
      }
      const next =
        through(current, parent.getName(), isCall) ??
        (current.kind === 'request' && isCall && bodyByArgument(call) ? ({ kind: 'payload', prefix: [] } as const) : undefined);
      if (next === undefined) {
        // A method called on a part of the payload reads that part: `evt.label.trim()`.
        if (fresh(current)) addRead(walk, current.prefix, parent, whenOf(parent, fn, bindings) ?? inherited, current.sureness, field);
        return;
      }
      current = next;
      node = isCall ? (call as TsNode) : parent;
      field = node;
      continue;
    }
    if (Node.isCallExpression(parent) && parent.getExpression() === node) {
      // `c.req.valid('json')` reached through the access above it.
      return;
    }
    if (Node.isElementAccessExpression(parent) && parent.getExpression() === node) {
      const argument = parent.getArgumentExpression();
      // A key written out, or one the code holds in a local or an option the reading settles (P374).
      const settled = settledKey(argument);
      const key = settled?.key;
      if (key !== undefined) {
        const next = through(current, key, false, settled?.sureness);
        if (next === undefined) return;
        current = next;
        node = parent;
        field = node;
        continue;
      }
      // An element of a gathered tuple, `results[0]` of `Promise.all([...])` (P402): the one at this request's index.
      if (current.kind === 'holder' && argument !== undefined && Node.isNumericLiteral(argument)) {
        const next = through(current, String(argument.getLiteralValue()), false);
        if (next === undefined) return;
        current = next;
        node = parent;
        field = node;
        continue;
      }
      // An element of a list keeps the path; any other key is a field the reading cannot name.
      // A number written out (`items[0]`) is a number literal's type, taken as an element where lists are followed (P391).
      if (argument !== undefined && (argument.getType().isNumber() || (walk.options.followLists === true && argument.getType().isNumberLiteral()))) {
        node = parent;
        field = node;
        continue;
      }
      if (current.kind === 'payload') {
        if (fresh(current)) addRead(walk, current.prefix, parent, whenOf(parent, fn, bindings) ?? inherited, current.sureness, field);
        addUnread(walk, parent, `indexed by ${argument?.getText().slice(0, 40) ?? 'a value'}`, whenOf(parent, fn, bindings) ?? inherited);
      }
      return;
    }
    break;
  }
  const when = whenOf(node, fn, bindings) ?? inherited;
  if (fresh(current)) addRead(walk, current.prefix, node, when, current.sureness, field);
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
  if (walk.options.escape !== undefined && settleEscaped(walk, fn, node, parent, state, depth, when, whole)) return;
  if (Node.isVariableDeclaration(parent) && parent.getInitializer() === node) {
    const name = parent.getNameNode();
    if (Node.isIdentifier(name)) {
      bindings.states.set(parent, state);
      followName(walk, fn, bindings, parent, state, depth, when);
    } else if (Node.isObjectBindingPattern(name)) {
      destructure(walk, fn, bindings, name, state, depth, when);
    } else if (Node.isArrayBindingPattern(name)) {
      destructureTuple(walk, fn, bindings, name, state, depth, when);
    }
    return;
  }
  if (Node.isCallExpression(parent) && parent.getArguments().includes(node as never)) {
    handOff(walk, parent, parent.getArguments().indexOf(node as never), state, depth, when, fn, node);
    return;
  }
  // A part of an answer walked element by element (P391).
  if (walk.options.followLists === true && !whole && Node.isForOfStatement(parent) && parent.getExpression() === node) {
    const declared = parent.getInitializer();
    const first = Node.isVariableDeclarationList(declared) ? declared.getDeclarations()[0] : undefined;
    const name = first?.getNameNode();
    if (first !== undefined && name !== undefined && Node.isIdentifier(name)) {
      bindings.states.set(first, state);
      followName(walk, fn, bindings, first, state, depth, when);
    } else if (name !== undefined && Node.isObjectBindingPattern(name)) {
      destructure(walk, fn, bindings, name, state, depth, when);
    }
    return;
  }
  if (!whole) return;
  if (Node.isSpreadAssignment(parent) || Node.isSpreadElement(parent)) {
    addUnread(walk, parent, 'spread into another value', when);
  } else if (Node.isShorthandPropertyAssignment(parent) || (Node.isPropertyAssignment(parent) && parent.getInitializer() === node)) {
    addUnread(walk, parent, 'put inside another value', when);
  } else if (Node.isBinaryExpression(parent) && parent.getRight() === node && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    // Assigned to a local of the function (in one branch of several, say): the local holds it for every read (P374).
    const local = localAssigned(parent.getLeft(), fn);
    if (local !== undefined) {
      if (!bindings.assigned.has(local)) {
        bindings.assigned.add(local);
        bindings.states.set(local, state);
        followName(walk, fn, bindings, local, state, depth, when);
      }
      return;
    }
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

/** The local a value is assigned to, where the left of an `=` names one declared in the function itself. */
const localAssigned = (left: TsNode, fn: FunctionLike): (TsNode & { getNameNode(): TsNode }) | undefined => {
  if (!Node.isIdentifier(left)) return undefined;
  const declaration = left.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration) || !Node.isIdentifier(declaration.getNameNode())) return undefined;
  return enclosingFunction(declaration) === fn ? declaration : undefined;
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
    // The name assigned to, `bag = …`, is not a use of what it holds.
    if (parent !== undefined && Node.isBinaryExpression(parent) && parent.getLeft() === identifier && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) continue;
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
    if (next.kind === 'payload') addRead(walk, next.prefix, element, at, next.sureness);
    const name = element.getNameNode();
    if (Node.isIdentifier(name)) {
      bindings.states.set(element, next);
      followName(walk, fn, bindings, element, next, depth, at);
    } else if (Node.isObjectBindingPattern(name)) {
      destructure(walk, fn, bindings, name, next, depth, at);
    } else if (Node.isArrayBindingPattern(name)) {
      destructureTuple(walk, fn, bindings, name, next, depth, at);
    }
  }
};

/**
 * `const [orders, user] = await Promise.all([...])` (P402): each element of a
 * gathered tuple at its index. Only a tuple of gathered answers is read so;
 * an element of a list destructured is not followed here.
 */
const destructureTuple = (
  walk: Walk,
  fn: FunctionLike,
  bindings: Bindings,
  pattern: ArrayBindingPattern,
  state: ValueState,
  depth: number,
  when: readonly string[] | undefined,
): void => {
  if (state.kind !== 'holder') return;
  pattern.getElements().forEach((element, index) => {
    if (!Node.isBindingElement(element) || element.getDotDotDotToken() !== undefined) return;
    const next = through(state, String(index), false);
    if (next === undefined) return;
    const at = whenOf(element, fn, bindings) ?? when;
    const name = element.getNameNode();
    if (Node.isIdentifier(name)) {
      bindings.states.set(element, next);
      followName(walk, fn, bindings, element, next, depth, at);
    } else if (Node.isObjectBindingPattern(name)) {
      destructure(walk, fn, bindings, name, next, depth, at);
    } else if (Node.isArrayBindingPattern(name)) {
      destructureTuple(walk, fn, bindings, name, next, depth, at);
    }
  });
};

/** A value handed to a call: followed into the repository's own function, said where it cannot be. */
const handOff = (
  walk: Walk,
  call: CallExpression,
  index: number,
  state: ValueState,
  depth: number,
  when: readonly string[] | undefined,
  fn?: FunctionLike,
  node?: TsNode,
): void => {
  const whole = state.kind !== 'payload' || state.prefix.length === 0;
  const target = calledFunction(call, walk);
  if (target === undefined && fn !== undefined && node !== undefined && walk.options.escape?.({ kind: 'handed', node, at: call, fn, state, when, depth, index }, handleOf(walk)) === true) {
    return;
  }
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
  const bindings: Bindings = { states: new Map(), assigned: new Set() };
  const name = parameter.getNameNode();
  if (Node.isIdentifier(name)) {
    bindings.states.set(parameter, state);
    followName(walk, fn, bindings, parameter, state, depth, when);
  } else if (Node.isObjectBindingPattern(name)) {
    destructure(walk, fn, bindings, name, state, depth, when);
  } else if (Node.isArrayBindingPattern(name)) {
    destructureTuple(walk, fn, bindings, name, state, depth, when);
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
  return rowsOf(walk);
};

/**
 * A walk whose starts the caller makes (P391): `run` is handed what an
 * escape is, to follow values and parameters and record reads, and the rows
 * come back as `readFields` hands them.
 */
export const walkFields = (options: FieldReadOptions, run: (walk: FieldWalk) => void): FieldsRead => {
  const walk: Walk = { options, reads: new Map(), unread: new Map(), functions: new Set(), rootId: options.rootId };
  run(handleOf(walk));
  return rowsOf(walk);
};

/** The rows a walk recorded, by the function, the file and the line. */
const rowsOf = (walk: Walk): FieldsRead => {
  const byLine = (a: { line: number; in?: string; file?: string }, b: { line: number; in?: string; file?: string }): number =>
    (a.in ?? '') < (b.in ?? '') ? -1 : (a.in ?? '') > (b.in ?? '') ? 1 : (a.file ?? '') < (b.file ?? '') ? -1 : (a.file ?? '') > (b.file ?? '') ? 1 : a.line - b.line;
  return {
    reads: [...walk.reads.values()].sort((a, b) => byLine(a, b) || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0)),
    unread: [...walk.unread.values()].sort(byLine),
    ...(walk.cut === undefined ? {} : { cut: walk.cut }),
  };
};
