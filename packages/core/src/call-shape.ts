import { Node, SyntaxKind, type CallExpression, type NewExpression, type SourceFile } from 'ts-morph';
import { boundedLoopOf, type BoundedBy, type BoundedLoopOptions } from './bounded-loop.js';
import { startLineOf } from './line-numbers.js';

/**
 * Where a call sits in the code around it: inside a loop, inside the
 * arguments of a call that runs its promises side by side, both or neither
 * (P69).
 *
 * Read by climbing from the call to the function that holds it. A function
 * passed to an array method that runs it once per item - `ids.map(id => ...)`
 * - is climbed through, because its body is the loop's body; any other
 * function stops the climb, because what it does runs when it is called and
 * this place cannot say when that is.
 */
export interface CallShape {
  /** The innermost loop around the call, when there is one. */
  loop?: LoopShape;
  /** The call that runs the promises beside each other, when there is one. */
  concurrent?: ConcurrentShape;
}

export interface LoopShape {
  /** `for`, `for-of`, `for-in`, `while`, `do`, or the array method: `map`, `forEach`, ... */
  kind: string;
  line: number;
  /** Why the loop runs a bounded number of times on purpose, when it does (P89). */
  bounded?: BoundedBy;
}

export interface ConcurrentShape {
  /** `Promise.all`, `Promise.allSettled`, `Promise.race` or `Promise.any`. */
  by: string;
  line: number;
}

/** Array methods that call the function they are given once per item. */
const PER_ITEM: ReadonlySet<string> = new Set([
  'forEach',
  'map',
  'flatMap',
  'filter',
  'reduce',
  'reduceRight',
  'some',
  'every',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
]);

/** The promise combinators that start every promise they are given at once. */
const SIDE_BY_SIDE: ReadonlySet<string> = new Set(['all', 'allSettled', 'race', 'any']);

/** The method name a call is made through, when it is a call on a property. */
const methodOf = (call: CallExpression): { receiver: string; name: string } | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  return { receiver: callee.getExpression().getText(), name: callee.getName() };
};

const isArgumentOf = (call: Node, child: Node): boolean =>
  Node.isCallExpression(call) && call.getArguments().includes(child);

/**
 * The loop a child of a statement runs again and again, when the statement is
 * one and the child is a part it repeats: a `for` repeats everything but its
 * initializer, a `for-of` or `for-in` its body and not the list it walks.
 */
const STATEMENT_LOOPS: ReadonlyArray<{ kind: string; is: (node: Node, child: Node) => boolean }> = [
  {
    kind: 'for',
    is: (node, child) => Node.isForStatement(node) && node.getInitializer() !== child,
  },
  { kind: 'for-of', is: (node, child) => Node.isForOfStatement(node) && node.getStatement() === child },
  { kind: 'for-in', is: (node, child) => Node.isForInStatement(node) && node.getStatement() === child },
  { kind: 'while', is: (node) => Node.isWhileStatement(node) },
  { kind: 'do', is: (node) => Node.isDoStatement(node) },
];

const statementLoop = (node: Node, child: Node): string | undefined =>
  STATEMENT_LOOPS.find((loop) => loop.is(node, child))?.kind;

/** The array method a function is handed to, when it is handed to one that runs it per item. */
const perItemMethod = (fn: Node): { kind: string; call: CallExpression } | undefined => {
  const parent = fn.getParent();
  if (parent === undefined || !Node.isCallExpression(parent) || !isArgumentOf(parent, fn)) return undefined;
  const method = methodOf(parent);
  if (method === undefined || !PER_ITEM.has(method.name)) return undefined;
  return { kind: method.name, call: parent };
};

const combinatorOf = (node: Node, child: Node): string | undefined => {
  if (!Node.isCallExpression(node) || !isArgumentOf(node, child)) return undefined;
  const method = methodOf(node);
  if (method === undefined || method.receiver !== 'Promise' || !SIDE_BY_SIDE.has(method.name)) return undefined;
  return `Promise.${method.name}`;
};

/**
 * A loop found around a call, with why it is bounded when it is. Asked once
 * per loop: every call in one loop climbs to the same node.
 */
const BOUNDED = new WeakMap<object, Map<string, BoundedBy | null>>();

const loopAt = (kind: string, loop: Node, options: BoundedLoopOptions): LoopShape => {
  const key = (options.boundedCalls ?? []).join('\u0000');
  let known = BOUNDED.get(loop.compilerNode);
  if (known === undefined) {
    known = new Map();
    BOUNDED.set(loop.compilerNode, known);
  }
  if (!known.has(key)) known.set(key, boundedLoopOf(loop, options)?.by ?? null);
  const bounded = known.get(key);
  return { kind, line: startLineOf(loop), ...(bounded === null || bounded === undefined ? {} : { bounded }) };
};

export const callShapeOf = (call: Node, options: BoundedLoopOptions = {}): CallShape => {
  const shape: CallShape = {};
  let child: Node = call;
  let node = call.getParent();
  while (node !== undefined) {
    if (Node.isFunctionLikeDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const per = perItemMethod(node);
      if (per === undefined) break;
      shape.loop ??= loopAt(per.kind, per.call, options);
      child = per.call;
      node = per.call.getParent();
      continue;
    }
    if (shape.loop === undefined) {
      const kind = statementLoop(node, child);
      if (kind !== undefined) shape.loop = loopAt(kind, node, options);
    }
    if (shape.concurrent === undefined) {
      const by = combinatorOf(node, child);
      if (by !== undefined) shape.concurrent = { by, line: startLineOf(node) };
    }
    child = node;
    node = node.getParent();
  }
  return shape;
};

/**
 * What stands at a 1-based line and column, as a leaf id names its site: the
 * innermost call that starts there, or else the token there, which climbs to
 * the same loops all the same.
 */
export const siteNodeAt = (source: SourceFile, line: number, column: number): Node | undefined => {
  const pos = source.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
  const at = source.getDescendantAtPos(pos);
  for (let node = at; node !== undefined && !Node.isSourceFile(node); node = node.getParent()) {
    if (Node.isCallExpression(node) && node.getStart() === pos) return node;
  }
  return at;
};

/**
 * The calls and `new` expressions of a file, by the line each starts on (P79).
 *
 * Asked once per edge by the passes that look up what an edge stands for, so
 * a file is walked for each kind at most once, the first time it is asked
 * for, and every later question is a lookup. Each line lists its nodes in
 * source order, the order a walk of the file meets them in.
 */
export interface CallIndex {
  calls(line: number): readonly CallExpression[];
  news(line: number): readonly NewExpression[];
}

type ByLine<T> = ReadonlyMap<number, readonly T[]>;

const byLine = <T extends Node>(nodes: readonly T[]): ByLine<T> => {
  const out = new Map<number, T[]>();
  for (const node of nodes) {
    const line = startLineOf(node);
    const list = out.get(line);
    if (list === undefined) out.set(line, [node]);
    else list.push(node);
  }
  return out;
};

const NONE: readonly never[] = [];

/**
 * One index per parsed file, keyed by the compiler's node for the file rather
 * than by ts-morph's wrapper: a watch refreshes a changed file in place, which
 * keeps the wrapper and replaces the compiler node, so a wrapper key would
 * answer with the old text's calls. A file removed or refreshed leaves its old
 * node unreachable, and the entry goes with it.
 */
const INDEXES = new WeakMap<object, CallIndex>();

/**
 * Each kind is walked the first time it is asked for: the call-shape pass
 * asks only for calls. An index kept past a refresh of its file hands the
 * question on to the index of the text the file holds now, so it never mixes
 * one text's calls with another's `new` expressions.
 */
const indexFor = (source: SourceFile, key: object): CallIndex => {
  let calls: ByLine<CallExpression> | undefined;
  let news: ByLine<NewExpression> | undefined;
  const current = (): CallIndex | undefined => (source.compilerNode === key ? undefined : callIndexOf(source));
  return {
    calls: (line) =>
      current()?.calls(line) ??
      (calls ??= byLine(source.getDescendantsOfKind(SyntaxKind.CallExpression))).get(line) ??
      NONE,
    news: (line) =>
      current()?.news(line) ??
      (news ??= byLine(source.getDescendantsOfKind(SyntaxKind.NewExpression))).get(line) ??
      NONE,
  };
};

export const callIndexOf = (source: SourceFile): CallIndex => {
  const key = source.compilerNode;
  let index = INDEXES.get(key);
  if (index === undefined) {
    index = indexFor(source, key);
    INDEXES.set(key, index);
  }
  return index;
};

/** Every call that starts on a line and is made by the name given, in source order. */
export const callsOnLine = (source: SourceFile, line: number, name: string): CallExpression[] =>
  callIndexOf(source)
    .calls(line)
    .filter((call) => calledName(call) === name);

const calledName = (call: CallExpression): string | undefined => {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};
