import { Node, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';

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

export const callShapeOf = (call: Node): CallShape => {
  const shape: CallShape = {};
  let child: Node = call;
  let node = call.getParent();
  while (node !== undefined) {
    if (Node.isFunctionLikeDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const per = perItemMethod(node);
      if (per === undefined) break;
      shape.loop ??= { kind: per.kind, line: per.call.getStartLineNumber() };
      child = per.call;
      node = per.call.getParent();
      continue;
    }
    if (shape.loop === undefined) {
      const kind = statementLoop(node, child);
      if (kind !== undefined) shape.loop = { kind, line: node.getStartLineNumber() };
    }
    if (shape.concurrent === undefined) {
      const by = combinatorOf(node, child);
      if (by !== undefined) shape.concurrent = { by, line: node.getStartLineNumber() };
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

/** Every call that starts on a line and is made by the name given. */
export const callsOnLine = (source: SourceFile, line: number, name: string): CallExpression[] =>
  source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => call.getStartLineNumber() === line && calledName(call) === name);

const calledName = (call: CallExpression): string | undefined => {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};
