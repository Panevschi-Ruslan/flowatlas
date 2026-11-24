import { Node, SyntaxKind, type CallExpression, type ClassDeclaration, type Node as TsNode } from 'ts-morph';
import { walkFields, type FieldEscape, type FieldReadOptions, type FieldsRead, type FieldWalk, type ValueState } from './field-reads.js';
import { functionLikeOf, type FunctionLike } from './types/signatures.js';

/**
 * Which fields of an answer the client that asked for it reads (P391): the
 * other half of P368, which reads what a route's code reads of a request.
 *
 * The answer is followed from the call that makes the request to where it is
 * used: through the promise or the observable it comes back in (`await`,
 * `then`, `subscribe`, `pipe` and its operators, `firstValueFrom`,
 * `toSignal`), handed back from a client method to each caller (the next call
 * of the wrappers the request was followed out through, else every caller),
 * into a component's member (`this.orders = orders`, a signal's `set`, a
 * subject's `next`, an observable held as `orders$`), and from the member into
 * the component's template (`{{ order.total }}`, `@for`, `*ngFor`, `| async`,
 * `@if (...; as x)`) and its code, into a child component it is bound to, a
 * component state's setter, the props of a component it is handed to, and what a
 * data hook hands back (`useQuery`'s and `useSWR`'s `data`). Inside code the
 * reading is P368's walk, which here also follows a list element by element.
 *
 * A use it cannot follow is said, never dropped: an operator it does not know,
 * the answer gathered with others (`forkJoin`, `Promise.all`), handed to a
 * function outside the repository, bound to a child it cannot name.
 */

/** The node meta key the fields of the answer a request's client reads are written under. */
export const ANSWER_READ_META = 'answerRead';

/** The node meta key the uses of the answer that could not be followed are written under. */
export const ANSWER_UNREAD_META = 'answerUnread';

/** How the answer to a request comes back to the code that makes it. */
export type AnswerComes = 'promise' | 'observable';

/**
 * What a component's template, and a child it binds the value to, does with
 * one member of the component (P391): read by a reader that parses templates.
 */
export interface AnswerMemberUse {
  /** The id rows name the template by: the component's. */
  in: string;
  /** Reads of the member's value, by the path under it, an async pipe and a signal's call taken off. */
  reads: ReadonlyArray<{ path: readonly string[]; line: number; file: string }>;
  /** The value, or a part, handed to a method of the component: `(click)="open(order)"`. */
  handed: ReadonlyArray<{ method: string; index: number; path: readonly string[] }>;
  /** The value, or a part, bound to a member of a child component: `<app-row [order]="o">`. */
  bound: ReadonlyArray<{ owner: ClassDeclaration; member: string; holds: 'value' | 'signal'; path: readonly string[] }>;
  unread: ReadonlyArray<{ line: number; file: string; why: string }>;
}

export interface AnswerReadOptions extends Omit<FieldReadOptions, 'escape' | 'followLists'> {
  /** What a component's template does with one of its members; undefined for a class with no template. */
  memberUse?(owner: ClassDeclaration, member: string): AnswerMemberUse | undefined;
}

/** Where a request's answer is followed from. */
export interface AnswerStart {
  /** The call that makes the request, whose value is the answer. */
  call: CallExpression;
  comes: AnswerComes;
  /** The answer as it comes: the body, or a response whose body is reached by a key or a call. */
  state: ValueState;
  /**
   * The calls the request was followed out through, innermost first: an
   * answer handed back from a function one of them calls goes on there alone.
   */
  through?: readonly CallExpression[];
}

/** How the value at hand is held: itself, or in a promise, an observable or a signal. */
type Held = 'value' | AnswerComes | 'signal';

/** The operators of `pipe` that hand the value on as it is. */
const PASSING: ReadonlySet<string> = new Set([
  'catchError',
  'retry',
  'retryWhen',
  'take',
  'takeLast',
  'first',
  'last',
  'shareReplay',
  'share',
  'finalize',
  'timeout',
  'delay',
  'debounceTime',
  'throttleTime',
  'distinctUntilChanged',
  'takeUntil',
  'takeUntilDestroyed',
  'startWith',
  'defaultIfEmpty',
  'observeOn',
  'subscribeOn',
]);

/** The operators whose function is handed the value and whose value goes on as it was. */
const LOOKING: ReadonlySet<string> = new Set(['tap', 'filter', 'skipWhile', 'takeWhile']);

/** The operators whose function is handed the value and whose value is what the function hands back. */
const MAPPING: ReadonlySet<string> = new Set(['map', 'switchMap', 'mergeMap', 'concatMap', 'exhaustMap', 'flatMap']);

/** Hooks of a data library whose `data` is what the function they are handed hands back, and where that function is. */
const DATA_HOOKS: ReadonlyMap<string, { argument: number; property?: string }> = new Map([
  ['useQuery', { argument: 0, property: 'queryFn' }],
  ['useSuspenseQuery', { argument: 0, property: 'queryFn' }],
  ['useInfiniteQuery', { argument: 0, property: 'queryFn' }],
  ['useSWR', { argument: 1 }],
  ['useSWRImmutable', { argument: 1 }],
]);

/** How many functions out an answer handed back is followed to its callers. */
const RETURN_DEPTH = 4;

/** How many callers of one function an answer handed back is followed to. */
const CALLERS = 20;

const usedAs = (node: TsNode): TsNode => {
  let at = node;
  for (let parent = at.getParent(); parent !== undefined; parent = at.getParent()) {
    if (!(Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isNonNullExpression(parent) || Node.isSatisfiesExpression(parent) || Node.isTypeAssertion(parent))) break;
    at = parent;
  }
  return at;
};

const isFunction = (node: TsNode): node is FunctionLike =>
  Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node);

const enclosingFunction = (node: TsNode): FunctionLike | undefined => node.getFirstAncestor(isFunction) as FunctionLike | undefined;

/** The name a call is made by: `map` of `map(...)` and of `rx.map(...)`. */
const calleeName = (call: CallExpression): string => {
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
};

const short = (node: TsNode): string => node.getText().replace(/\s+/g, ' ').slice(0, 50);

/** Whether a function hands back a promise of whatever it returns. */
const isAsync = (fn: FunctionLike): boolean => fn.getModifiers().some((modifier) => modifier.getKind() === SyntaxKind.AsyncKeyword);

/** A key that tells two visits apart, so a cycle of members and callers is walked once. */
const stateKey = (state: ValueState): string =>
  state.kind === 'payload' ? `p:${state.prefix.join('.')}` : state.kind === 'holder' ? `h:${state.key}:${stateKey(state.inner)}` : state.kind;

/**
 * The fields of its answer the code that makes a request reads, wherever the
 * answer is handed: what `start` says it comes in, followed as far as the
 * bounds of P368's walk and of the callers it is handed back to.
 */
export const answerFieldsRead = (start: AnswerStart, options: AnswerReadOptions): FieldsRead => {
  const through = start.through ?? [];
  const seen = new Set<string>();
  let walk: FieldWalk;

  const once = (node: TsNode, how: string, state: ValueState): boolean => {
    const key = `${node.getSourceFile().getFilePath()}:${node.getStart()}:${how}:${stateKey(state)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  const unread = (node: TsNode, why: string): void => {
    const at = walk.inOf(node);
    walk.addUnread({ ...(at === undefined ? {} : { in: at }), line: node.getStartLineNumber(), why });
  };

  /** A value at `node`, handed to P368's walk in the function it is written in. */
  const value = (node: TsNode, state: ValueState, depth: number): void => {
    const fn = enclosingFunction(node);
    if (fn === undefined) {
      unread(node, 'the answer is held outside a function');
      return;
    }
    if (!walk.enter(fn)) return;
    walk.followValue(fn, node, state, depth);
  };

  /** A function value is handed: a callback written in place or named, or a component state's setter. */
  const handedTo = (argument: TsNode | undefined, state: ValueState, depth: number): void => {
    if (argument === undefined) return;
    const fn = callbackOf(argument);
    if (fn !== undefined) {
      if (walk.enter(fn)) walk.readParameter(fn, 0, state, depth + 1);
      return;
    }
    if (setterState(argument, state, depth)) return;
    unread(argument, `handed to ${short(argument)}`);
  };

  const callbackOf = (argument: TsNode): FunctionLike | undefined => {
    if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) return argument;
    const name = Node.isPropertyAccessExpression(argument) ? argument.getNameNode() : argument;
    for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
      if (!options.isOwn(declaration)) continue;
      const fn = functionLikeOf(declaration);
      if (fn !== undefined && fn.getBody() !== undefined) return fn;
    }
    return undefined;
  };

  /**
   * A component state's setter, `setOrders` of `const [orders, setOrders] =
   * useState(...)`: the value is what `orders` holds wherever the component
   * reads it. True where `callee` is one.
   */
  const setterState = (callee: TsNode, state: ValueState, depth: number): boolean => {
    if (!Node.isIdentifier(callee)) return false;
    const declaration = callee.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined || !Node.isBindingElement(declaration)) return false;
    const pattern = declaration.getParent();
    if (!Node.isArrayBindingPattern(pattern) || pattern.getElements().indexOf(declaration) !== 1) return false;
    const holder = pattern.getParent();
    const initializer = Node.isVariableDeclaration(holder) ? holder.getInitializer() : undefined;
    if (initializer === undefined || !Node.isCallExpression(initializer) || !/^(?:useState|useReducer)$/.test(calleeName(initializer))) return false;
    const held = pattern.getElements()[0];
    if (held === undefined || !Node.isBindingElement(held)) return true;
    if (!once(held, 'state', state)) return true;
    const symbol = held.getNameNode().getSymbol();
    const fn = enclosingFunction(held);
    if (symbol === undefined || fn === undefined) return true;
    for (const use of fn.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (use === held.getNameNode() || use.getSymbol() !== symbol) continue;
      value(use, state, depth + 1);
    }
    return true;
  };

  /**
   * A member of a class holds the value (P391): the component's template and
   * every read of `this.<member>` in its code read it, and a child it is
   * bound to reads it as its own member.
   */
  const member = (owner: ClassDeclaration, name: string, held: 'value' | 'observable' | 'signal', state: ValueState, depth: number): void => {
    if (!once(owner, `member:${name}:${held}`, state)) return;
    const prefix = state.kind === 'payload' ? state.prefix : undefined;
    const use = options.memberUse?.(owner, name);
    if (use !== undefined) {
      if (prefix !== undefined) {
        for (const read of use.reads) {
          const path = [...prefix, ...read.path];
          if (path.length === 0) continue;
          walk.addRead({ field: path.slice(0, 3).join('.'), in: use.in, line: read.line, file: read.file, ...(state.kind === 'payload' && state.sureness !== undefined ? { sureness: state.sureness } : {}) });
        }
        for (const handed of use.handed) {
          const method = owner.getMethod(handed.method);
          if (method === undefined || method.getBody() === undefined) continue;
          if (walk.enter(method)) walk.readParameter(method, handed.index, { kind: 'payload', prefix: [...prefix, ...handed.path] }, depth + 1);
        }
        if (depth < RETURN_DEPTH) {
          for (const bound of use.bound) member(bound.owner, bound.member, bound.holds, { kind: 'payload', prefix: [...prefix, ...bound.path] }, depth + 1);
        }
      }
      for (const row of use.unread) walk.addUnread({ in: use.in, line: row.line, file: row.file, why: row.why });
    }
    for (const access of owner.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (access.getName() !== name || !Node.isThisExpression(access.getExpression())) continue;
      const parent = access.getParent();
      // The member written to is not a read of what it holds.
      if (parent !== undefined && Node.isBinaryExpression(parent) && parent.getLeft() === access && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) continue;
      const call = parent !== undefined && Node.isCallExpression(parent) && parent.getExpression() === access ? parent : undefined;
      if (held === 'value') value(access, state, depth + 1);
      else if (held === 'observable') follow(access, 'observable', state, depth + 1);
      else if (call !== undefined) value(call, state, depth + 1);
    }
  };

  /** The class a `this.<member>` is written in. */
  const ownerOf = (access: TsNode): ClassDeclaration | undefined => {
    const owner = access.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    return owner;
  };

  /** `this.orders` written to: the class and the member, where it is one. */
  const memberWritten = (target: TsNode): { owner: ClassDeclaration; name: string } | undefined => {
    if (!Node.isPropertyAccessExpression(target) || !Node.isThisExpression(target.getExpression())) return undefined;
    const owner = ownerOf(target);
    return owner === undefined ? undefined : { owner, name: target.getName() };
  };

  /**
   * An answer handed back from the function it is written in: at the next
   * call of the wrappers on the request's way out where one calls it, else at
   * every caller; from an operator's or a promise's callback, where that
   * chain goes on; from a data hook's function, as the hook's `data`.
   */
  const returned = (at: TsNode, held: Held, state: ValueState, depth: number): void => {
    const fn = enclosingFunction(at);
    if (fn === undefined) return;
    const holder = fn.getParent();
    // A callback: of an operator in a pipe, of a promise's then, of a data hook.
    if ((Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && holder !== undefined) {
      const call = Node.isCallExpression(holder) && holder.getArguments().includes(fn as never) ? holder : undefined;
      if (call !== undefined) {
        const name = calleeName(call);
        const pipe = call.getParent();
        if (MAPPING.has(name) && pipe !== undefined && Node.isCallExpression(pipe) && calleeName(pipe) === 'pipe') {
          piped(pipe, pipe.getArguments().indexOf(call as never) + 1, state, depth);
          return;
        }
        if (name === 'then') {
          follow(call, 'promise', state, depth);
          return;
        }
        const hook = DATA_HOOKS.get(name);
        if (hook !== undefined && hook.property === undefined && call.getArguments()[hook.argument] === fn) {
          dataHook(call, state, depth);
          return;
        }
        if (/^(?:useEffect|useLayoutEffect|ngOnInit|forEach)$/.test(name)) return;
        unread(at, `handed back from a function handed to ${name}`);
        return;
      }
      if (Node.isPropertyAssignment(holder)) {
        const object = holder.getParent();
        const hookCall = object?.getParent();
        if (hookCall !== undefined && Node.isCallExpression(hookCall)) {
          const hook = DATA_HOOKS.get(calleeName(hookCall));
          if (hook?.property === holder.getName()) {
            dataHook(hookCall, state, depth);
            return;
          }
        }
      }
    }
    if (depth >= RETURN_DEPTH) {
      unread(at, `handed back more than ${RETURN_DEPTH} functions out`);
      return;
    }
    const comes: Held = isAsync(fn) && held === 'value' ? 'promise' : held;
    const name = nameOf(fn);
    if (name === undefined) {
      unread(at, 'handed back from a function with no name to find its callers by');
      return;
    }
    const onPath = through.filter((call) => calls(call, fn));
    const callers = onPath.length > 0 ? onPath : callersOf(name, at, state, depth);
    if (callers === undefined) return;
    for (const caller of callers) follow(caller, comes, state, depth + 1);
  };

  /** Whether a call runs `fn`. */
  const calls = (call: CallExpression, fn: FunctionLike): boolean => {
    const callee = call.getExpression();
    const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
    return (name.getSymbol()?.getDeclarations() ?? []).some((declaration) => functionLikeOf(declaration) === fn || declaration === fn);
  };

  /** The name a function is called by: a method's, a function's, a variable's or property's holding it. */
  const nameOf = (fn: FunctionLike): TsNode | undefined => {
    if (Node.isMethodDeclaration(fn) || Node.isFunctionDeclaration(fn)) return fn.getNameNode();
    const holder = fn.getParent();
    if (holder !== undefined && (Node.isVariableDeclaration(holder) || Node.isPropertyDeclaration(holder) || Node.isPropertyAssignment(holder))) return holder.getNameNode();
    return undefined;
  };

  /** Every call of a named function, a data hook's reference to it included; undefined where none could be listed. */
  const callersOf = (name: TsNode, at: TsNode, state: ValueState, depth: number): CallExpression[] | undefined => {
    if (!Node.isIdentifier(name)) {
      unread(at, 'handed back from a function whose name is not an identifier');
      return undefined;
    }
    let references: TsNode[];
    try {
      references = name.findReferencesAsNodes();
    } catch {
      unread(at, `handed back from ${name.getText()}, whose callers could not be listed`);
      return undefined;
    }
    const found: CallExpression[] = [];
    for (const reference of references) {
      const access = reference.getParent();
      const callee = access !== undefined && Node.isPropertyAccessExpression(access) && access.getNameNode() === reference ? access : reference;
      const call = callee.getParent();
      if (call !== undefined && Node.isCallExpression(call) && call.getExpression() === callee) {
        found.push(call);
        continue;
      }
      // `useQuery({ queryFn: api.listOrders })`: the hook calls it.
      if (call !== undefined && Node.isPropertyAssignment(call) && call.getInitializer() === callee) {
        const hookCall = call.getParent()?.getParent();
        if (hookCall !== undefined && Node.isCallExpression(hookCall) && DATA_HOOKS.get(calleeName(hookCall))?.property === call.getName()) dataHook(hookCall, state, depth + 1);
      }
    }
    if (found.length > CALLERS) unread(at, `handed back from ${name.getText()}, called in ${found.length} places; the first ${CALLERS} are followed`);
    return found.slice(0, CALLERS);
  };

  /** What a data hook hands back: `data` is the value its function hands back. */
  const dataHook = (call: CallExpression, state: ValueState, depth: number): void => {
    if (state.kind !== 'payload' || state.prefix.length > 0) {
      unread(call, `a part of the answer handed back to ${calleeName(call)}`);
      return;
    }
    follow(call, 'value', { kind: 'response', bodyKeys: ['data'], bodyCalls: [] }, depth);
  };

  /**
   * The operators of a pipe from `index` on: each passes the value on, looks
   * at it, or maps it to what its function hands back, where the walk goes on
   * from that function's return.
   */
  const piped = (pipe: CallExpression, index: number, state: ValueState, depth: number): void => {
    const operators = pipe.getArguments();
    for (let at = index; at < operators.length; at += 1) {
      const operator = operators[at];
      if (operator === undefined || !Node.isCallExpression(operator)) {
        if (operator !== undefined) unread(operator, `piped through ${short(operator)}`);
        return;
      }
      const name = calleeName(operator);
      if (PASSING.has(name)) continue;
      if (LOOKING.has(name)) {
        handedTo(operator.getArguments()[0], state, depth);
        continue;
      }
      if (MAPPING.has(name)) {
        // Read in the function; what it hands back goes on from its return.
        handedTo(operator.getArguments()[0], state, depth);
        return;
      }
      if (name === 'pluck') {
        const keys = operator.getArguments().map((argument) => (Node.isStringLiteral(argument) ? argument.getLiteralValue() : undefined));
        if (state.kind !== 'payload' || keys.some((key) => key === undefined)) {
          unread(operator, `piped through ${short(operator)}`);
          return;
        }
        walk.addRead({ field: [...state.prefix, ...(keys as string[])].slice(0, 3).join('.'), ...inAt(operator), line: operator.getStartLineNumber() });
        state = { kind: 'payload', prefix: [...state.prefix, ...(keys as string[])] };
        continue;
      }
      unread(operator, `piped through ${name}, which is not followed`);
      return;
    }
    follow(pipe, 'observable', state, depth);
  };

  const inAt = (node: TsNode): { in?: string } => {
    const at = walk.inOf(node);
    return at === undefined ? {} : { in: at };
  };

  /** Where a value held in a promise, an observable, a signal or itself goes from `node`. */
  const follow = (node: TsNode, held: Held, state: ValueState, depth: number): void => {
    const at = usedAs(node);
    if (!once(at, held, state)) return;
    if (held === 'value') {
      value(at, state, depth);
      return;
    }
    const parent = at.getParent();
    if (parent === undefined) return;
    if (Node.isExpressionStatement(parent)) return;
    if (Node.isReturnStatement(parent) || (Node.isArrowFunction(parent) && parent.getBody() === at)) {
      returned(at, held, state, depth);
      return;
    }
    if (Node.isVariableDeclaration(parent) && parent.getInitializer() === at) {
      const name = parent.getNameNode();
      if (!Node.isIdentifier(name)) {
        unread(parent, `the ${held} destructured`);
        return;
      }
      const symbol = name.getSymbol();
      const scope = enclosingFunction(parent) ?? parent.getSourceFile();
      for (const use of scope.getDescendantsOfKind(SyntaxKind.Identifier)) {
        if (use !== name && use.getSymbol() === symbol) follow(use, held, state, depth);
      }
      return;
    }
    if (Node.isPropertyDeclaration(parent) && parent.getInitializer() === at) {
      const owner = parent.getParent();
      if (Node.isClassDeclaration(owner)) member(owner, parent.getName(), held === 'promise' ? 'observable' : held, state, depth);
      return;
    }
    if (Node.isBinaryExpression(parent) && parent.getRight() === at && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
      const written = memberWritten(parent.getLeft());
      if (written !== undefined) {
        member(written.owner, written.name, held === 'promise' ? 'observable' : held, state, depth);
        return;
      }
      unread(parent, `the ${held} stored in ${short(parent.getLeft())}`);
      return;
    }
    if (held === 'signal') {
      if (Node.isCallExpression(parent) && parent.getExpression() === at) value(parent, state, depth);
      return;
    }
    if (Node.isCallExpression(parent) && parent.getArguments().includes(at as never)) {
      const name = calleeName(parent);
      if (held === 'observable' && /^(?:firstValueFrom|lastValueFrom)$/.test(name)) follow(parent, 'promise', state, depth);
      else if (held === 'observable' && name === 'toSignal') follow(parent, 'signal', state, depth);
      else unread(parent, `the ${held} handed to ${name}`);
      return;
    }
    if (held === 'promise' && Node.isAwaitExpression(parent)) {
      follow(parent, 'value', state, depth);
      return;
    }
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === at) {
      const call = parent.getParent();
      if (call === undefined || !Node.isCallExpression(call) || call.getExpression() !== parent) {
        unread(parent, `${parent.getName()} read off the ${held}`);
        return;
      }
      const name = parent.getName();
      if (held === 'promise') {
        if (name === 'then') handedTo(call.getArguments()[0], state, depth);
        else if (name === 'catch' || name === 'finally') follow(call, 'promise', state, depth);
        else if (state.kind === 'response' && state.bodyCalls.includes(name)) follow(call, 'promise', { kind: 'payload', prefix: [] }, depth);
        else unread(call, `${name} called on the promise`);
        return;
      }
      if (name === 'subscribe') {
        const [first] = call.getArguments();
        if (first !== undefined && Node.isObjectLiteralExpression(first)) {
          const next = first.getProperty('next');
          const handler = next !== undefined && Node.isPropertyAssignment(next) ? next.getInitializer() : next;
          if (handler !== undefined) handedTo(handler, state, depth);
          return;
        }
        handedTo(first, state, depth);
        return;
      }
      if (name === 'pipe') {
        piped(call, 0, state, depth);
        return;
      }
      if (name === 'asObservable') {
        follow(call, 'observable', state, depth);
        return;
      }
      unread(call, `${name} called on the observable`);
      return;
    }
    unread(at, `the ${held} used as ${short(parent)}`);
  };

  /** The value stored where P368's walk leaves it: a member, a signal, a subject, a component's state, a child's props. */
  const escape = (use: FieldEscape, handle: FieldWalk): boolean => {
    walk = handle;
    if (use.kind === 'returned') {
      returned(use.node, 'value', use.state, use.depth);
      return true;
    }
    if (use.kind === 'stored') {
      const written = Node.isBinaryExpression(use.at) ? memberWritten(use.at.getLeft()) : undefined;
      if (written === undefined) return false;
      member(written.owner, written.name, 'value', use.state, use.depth);
      return true;
    }
    if (use.kind === 'handed' && Node.isCallExpression(use.at) && use.index === 0) {
      const callee = use.at.getExpression();
      // `this.orders.set(orders)`, `this.orders$.next(orders)`.
      if (Node.isPropertyAccessExpression(callee) && /^(?:set|next)$/.test(callee.getName())) {
        const written = memberWritten(callee.getExpression());
        if (written !== undefined) {
          member(written.owner, written.name, callee.getName() === 'set' ? 'signal' : 'observable', use.state, use.depth);
          return true;
        }
      }
      return setterState(callee, use.state, use.depth);
    }
    if (use.kind === 'bound') return boundToProps(use, handle);
    return false;
  };

  /** `<OrderRow order={o} />`: the component's props hold the value under the attribute's name. */
  const boundToProps = (use: FieldEscape, handle: FieldWalk): boolean => {
    const attribute = use.at;
    if (!Node.isJsxAttribute(attribute)) return false;
    const element = attribute.getFirstAncestor((node) => Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node));
    if (element === undefined || !(Node.isJsxOpeningElement(element) || Node.isJsxSelfClosingElement(element))) return false;
    const tag = element.getTagNameNode();
    if (!/^[A-Z]/.test(tag.getText().split('.').pop() ?? '')) return false;
    const symbol = tag.getSymbol();
    const target = symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol;
    const declared = target?.getDeclarations() ?? [];
    for (const declaration of declared) {
      if (!options.isOwn(declaration)) continue;
      const fn = functionLikeOf(declaration);
      if (fn === undefined || fn.getBody() === undefined) continue;
      if (fn.getParameters().length === 0) return true;
      if (!handle.enter(fn)) return true;
      handle.readParameter(fn, 0, { kind: 'holder', key: attribute.getNameNode().getText(), inner: use.state }, use.depth + 1);
      return true;
    }
    return false;
  };

  return walkFields({ ...options, followLists: true, guards: true, escape }, (handle) => {
    walk = handle;
    follow(start.call, start.comes, start.state, 0);
  });
};
