import { Node, SyntaxKind, VariableDeclarationKind, type CallExpression, type SourceFile } from 'ts-morph';
import { declarationOf, evaluateExpression } from './static-value.js';

/**
 * Loops that are bounded on purpose (P89).
 *
 * A loop that runs a query per item is the likely N+1, and a good share of
 * the loops that do are the fix rather than the problem: walking a list in
 * pages, sending in batches of ten, trying three times, going through a fixed
 * list of settings. What sets them apart is how the loop steps, read here from
 * the code alone; a list that happens to be short is not read (D2).
 *
 * `batch-call` and `migration` are the two reasons that are not about the
 * loop's own shape: every leaf the loop reaches takes many items at once (a
 * fact of the operation, which a descriptor states), or the loop is in a
 * migration that runs once. Whoever knows the leaves sets them; this module
 * answers the others.
 */
export type BoundedBy = 'chunk' | 'page' | 'cursor' | 'retry' | 'literal' | 'batch-call' | 'migration';

/** Every reason a loop is set aside, in the order a count of them is written. */
export const BOUNDED_BY: readonly BoundedBy[] = ['chunk', 'page', 'cursor', 'retry', 'literal', 'batch-call', 'migration'];

export interface BoundedLoop {
  by: BoundedBy;
}

export interface BoundedLoopOptions {
  /** Helpers of the project's own that split a list into chunks, beside the built-in names. */
  boundedCalls?: readonly string[];
}

/** Calls that hand back a list split into chunks, by the names libraries and projects give them. */
const CHUNK_CALLS: ReadonlySet<string> = new Set(['chunk', 'chunks', 'batches', 'inChunks', 'splitEvery']);

/** A page's size, beside a key that moves to the next page. */
const PAGE_SIZE_KEYS: ReadonlySet<string> = new Set(['take', 'limit', 'first', 'pageSize', 'perPage']);
const PAGE_MOVE_KEYS: ReadonlySet<string> = new Set(['skip', 'offset', 'page', 'pageNumber']);

/** Keys that hand a query the place the last page stopped at. */
const CURSOR_KEYS: ReadonlySet<string> = new Set([
  'cursor',
  'after',
  'startAfter',
  'nextToken',
  'NextToken',
  'ContinuationToken',
  'ExclusiveStartKey',
  'LastEvaluatedKey',
  'nextPageToken',
  'pageToken',
]);

/** A condition that says another page is there: `while (hasMore)`. */
const PAGE_FLAG = /^(?:has(?:More|Next|NextPage|Pages?)|more)$/i;

/** A condition that holds the place to go on from: `while (cursor)`, `do { … } while (token)`. */
const CURSOR_FLAG = /(?:cursor|token|^next$|^after$|startAfter|lastEvaluatedKey|exclusiveStartKey|continuation|^marker$)/i;

const unwrap = (node: Node): Node => {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isAwaitExpression(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
};

/** A number known before the program runs: a literal, a `const`, an enum member. */
const constantNumber = (node: Node | undefined): number | undefined => {
  if (node === undefined) return undefined;
  const value = evaluateExpression(node);
  return value.resolved && typeof value.value === 'number' ? value.value : undefined;
};

const isFunction = (node: Node): boolean =>
  Node.isFunctionLikeDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node);

const isLoopStatement = (node: Node): boolean =>
  Node.isForStatement(node) ||
  Node.isForOfStatement(node) ||
  Node.isForInStatement(node) ||
  Node.isWhileStatement(node) ||
  Node.isDoStatement(node);

/** What a loop repeats: a statement's body, or the function an array method is handed. */
const bodyOf = (loop: Node): Node | undefined => {
  if (Node.isForStatement(loop) || Node.isForOfStatement(loop) || Node.isForInStatement(loop)) return loop.getStatement();
  if (Node.isWhileStatement(loop) || Node.isDoStatement(loop)) return loop.getStatement();
  if (Node.isCallExpression(loop)) return loop.getArguments().find(isFunction);
  return undefined;
};

/** The name a call is made by: `chunk(…)`, `_.chunk(…)`, `this.batches(…)`. */
const calledName = (call: CallExpression): string | undefined => {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
};

/** The expression a name is bound to, when it is a `const` or a `readonly` field. */
const boundTo = (node: Node): Node | undefined => {
  if (!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node)) return undefined;
  const declaration = declarationOf(node);
  if (declaration === undefined) return undefined;
  if (Node.isVariableDeclaration(declaration)) {
    const statement = declaration.getVariableStatement();
    if (statement === undefined || statement.getDeclarationKind() !== VariableDeclarationKind.Const) return undefined;
    return declaration.getInitializer();
  }
  if (Node.isPropertyDeclaration(declaration) && declaration.isReadonly()) return declaration.getInitializer();
  if (Node.isEnumDeclaration(declaration)) return declaration;
  return undefined;
};

/** An array or object written out, or an enum: a list whose length is in the code. */
const isLiteralList = (expression: Node | undefined, depth = 0): boolean => {
  if (expression === undefined || depth > 4) return false;
  const node = unwrap(expression);
  if (Node.isArrayLiteralExpression(node) || Node.isObjectLiteralExpression(node) || Node.isEnumDeclaration(node)) {
    return true;
  }
  // `Object.keys(SETTINGS)`, `Object.entries({ … })`, `Object.values(Region)`.
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (
      Node.isPropertyAccessExpression(callee) &&
      callee.getExpression().getText() === 'Object' &&
      ['keys', 'values', 'entries'].includes(callee.getName())
    ) {
      return isLiteralList(node.getArguments()[0], depth + 1);
    }
    return false;
  }
  const bound = boundTo(node);
  return bound !== undefined && isLiteralList(bound, depth + 1);
};

/** A list handed back by a call that splits one into chunks, or a `const` bound to one. */
const isChunkedList = (expression: Node | undefined, names: ReadonlySet<string>, depth = 0): boolean => {
  if (expression === undefined || depth > 4) return false;
  const node = unwrap(expression);
  if (Node.isCallExpression(node)) {
    const name = calledName(node);
    return name !== undefined && (CHUNK_CALLS.has(name) || names.has(name));
  }
  const bound = boundTo(node);
  return bound !== undefined && isChunkedList(bound, names, depth + 1);
};

/** The list a loop walks: a `for-of`'s or `for-in`'s, or the receiver of the array method. */
const listOf = (loop: Node): Node | undefined => {
  if (Node.isForOfStatement(loop) || Node.isForInStatement(loop)) return loop.getExpression();
  if (Node.isCallExpression(loop)) {
    const callee = loop.getExpression();
    return Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
  }
  return undefined;
};

/**
 * Every node of a loop's body that runs as part of it: not the inside of a
 * function made there, which runs whenever it is called.
 */
const ownDescendants = (body: Node): Node[] => {
  const out: Node[] = [];
  const visit = (node: Node): void => {
    for (const child of node.getChildren()) {
      if (isFunction(child)) continue;
      out.push(child);
      visit(child);
    }
  };
  visit(body);
  return out;
};

/** `i += 25`, `i = i + BATCH_SIZE`: a step known before the program runs, above one. */
const stepsByMany = (loop: Node): boolean => {
  if (!Node.isForStatement(loop)) return false;
  const step = loop.getIncrementor();
  if (step === undefined || !Node.isBinaryExpression(step)) return false;
  const operator = step.getOperatorToken().getKind();
  if (operator === SyntaxKind.PlusEqualsToken) return (constantNumber(step.getRight()) ?? 0) > 1;
  if (operator !== SyntaxKind.EqualsToken) return false;
  const right = unwrap(step.getRight());
  if (!Node.isBinaryExpression(right) || right.getOperatorToken().getKind() !== SyntaxKind.PlusToken) return false;
  const counter = step.getLeft().getText();
  const [other] = [right.getLeft(), right.getRight()].filter((side) => side.getText() !== counter);
  return other !== undefined && (constantNumber(other) ?? 0) > 1;
};

/** `xs.slice(i, i + 25)` or `xs.splice(0, 25)` in the body: a chunk cut off each time round. */
const cutsChunks = (nodes: readonly Node[]): boolean =>
  nodes.some((node) => {
    if (!Node.isCallExpression(node)) return false;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return false;
    const [from, to] = node.getArguments();
    if (callee.getName() === 'splice') return constantNumber(from) === 0 && (constantNumber(to) ?? 0) > 1;
    if (callee.getName() !== 'slice' || from === undefined || to === undefined) return false;
    const end = unwrap(to);
    if (!Node.isBinaryExpression(end) || end.getOperatorToken().getKind() !== SyntaxKind.PlusToken) return false;
    return end.getLeft().getText() === from.getText() && (constantNumber(end.getRight()) ?? 0) > 1;
  });

/** The keys of every object literal the body writes, a query's options among them. */
const keysIn = (nodes: readonly Node[]): Set<string> => {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) {
      keys.add(node.getName().replace(/^['"]|['"]$/g, ''));
    }
  }
  return keys;
};

/** What the keys a body hands its queries say about how the loop steps. */
const pagedByKeys = (keys: ReadonlySet<string>): 'page' | 'cursor' | undefined => {
  if ([...keys].some((key) => CURSOR_KEYS.has(key))) return 'cursor';
  const sized = [...keys].some((key) => PAGE_SIZE_KEYS.has(key));
  const moved = [...keys].some((key) => PAGE_MOVE_KEYS.has(key));
  return sized && moved ? 'page' : undefined;
};

/** The name a condition tests: `hasMore`, `cursor !== undefined`, `this.next`, `page.nextToken`. */
const conditionName = (condition: Node | undefined): string | undefined => {
  if (condition === undefined) return undefined;
  const node = unwrap(condition);
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    const compares =
      operator === SyntaxKind.ExclamationEqualsEqualsToken || operator === SyntaxKind.ExclamationEqualsToken;
    const right = node.getRight().getText();
    if (compares && (right === 'undefined' || right === 'null')) return conditionName(node.getLeft());
  }
  return undefined;
};

const isAlwaysTrue = (condition: Node | undefined): boolean =>
  condition === undefined || unwrap(condition).getKind() === SyntaxKind.TrueKeyword;

/** The loop a `break` or `return` leaves: the nearest one around it, inside the same function. */
const leavesLoop = (exit: Node, loop: Node): boolean => {
  for (let node = exit.getParent(); node !== undefined; node = node.getParent()) {
    if (node === loop) return true;
    if (isFunction(node)) return false;
    // A `break` inside a nested loop or a `switch` leaves that, not this.
    if (Node.isBreakStatement(exit) && (isLoopStatement(node) || Node.isSwitchStatement(node))) return false;
  }
  return false;
};

const exitsOf = (loop: Node, nodes: readonly Node[]): Node[] =>
  nodes.filter((node) => (Node.isBreakStatement(node) || Node.isReturnStatement(node)) && leavesLoop(node, loop));

/** Whether an exit sits where a test decided it: under an `if`, or in a `try` that got that far. */
const isDecided = (exit: Node, loop: Node): boolean => {
  for (let node = exit.getParent(); node !== undefined && node !== loop; node = node.getParent()) {
    if (Node.isIfStatement(node)) return true;
    const parent = node.getParent();
    if (Node.isBlock(node) && parent !== undefined && Node.isTryStatement(parent) && parent.getTryBlock() === node) return true;
  }
  return false;
};

/** `if (rows.length === 0) break`, `if (!page.length) return`, `if (batch.length < SIZE) break`. */
const testsAShortPage = (condition: Node): boolean => {
  const node = unwrap(condition);
  const isLength = (side: Node): boolean => {
    const inner = unwrap(side);
    return Node.isPropertyAccessExpression(inner) && inner.getName() === 'length';
  };
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
    return isLength(node.getOperand());
  }
  if (!Node.isBinaryExpression(node)) return false;
  const operator = node.getOperatorToken().getKind();
  const left = node.getLeft();
  const right = node.getRight();
  if (operator === SyntaxKind.BarBarToken) return testsAShortPage(left) || testsAShortPage(right);
  if (!isLength(left)) return false;
  if (operator === SyntaxKind.EqualsEqualsEqualsToken || operator === SyntaxKind.EqualsEqualsToken) {
    return constantNumber(right) === 0;
  }
  return operator === SyntaxKind.LessThanToken || operator === SyntaxKind.LessThanEqualsToken;
};

/** A loop that runs until a page comes back empty or short. */
const stopsOnAShortPage = (loop: Node, nodes: readonly Node[]): boolean =>
  exitsOf(loop, nodes).some((exit) => {
    for (let node = exit.getParent(); node !== undefined && node !== loop; node = node.getParent()) {
      if (Node.isIfStatement(node)) return testsAShortPage(node.getExpression());
    }
    return false;
  });

/** The counter's bound, when a condition compares one with a constant: `attempt < MAX_ATTEMPTS`. */
const countsToAConstant = (condition: Node | undefined): boolean => {
  if (condition === undefined) return false;
  const node = unwrap(condition);
  if (!Node.isBinaryExpression(node)) return false;
  const operator = node.getOperatorToken().getKind();
  if (operator !== SyntaxKind.LessThanToken && operator !== SyntaxKind.LessThanEqualsToken) return false;
  return Node.isIdentifier(unwrap(node.getLeft())) && constantNumber(node.getRight()) !== undefined;
};

/** A loop that runs at most a constant number of times and leaves once it got what it came for. */
const isRetry = (loop: Node, nodes: readonly Node[]): boolean => {
  if (!Node.isForStatement(loop) && !Node.isWhileStatement(loop)) return false;
  if (!countsToAConstant(conditionOf(loop))) return false;
  return exitsOf(loop, nodes).some((exit) => isDecided(exit, loop));
};

/** Whether a `for` walks a list by its index: `i < xs.length`. */
const walksByIndex = (loop: Node): boolean => {
  if (!Node.isForStatement(loop)) return false;
  const condition = loop.getCondition();
  if (condition === undefined) return false;
  return [condition, ...condition.getDescendants()].some(
    (node) => Node.isPropertyAccessExpression(node) && node.getName() === 'length',
  );
};

/** The condition a statement loop tests each time round. */
const conditionOf = (loop: Node): Node | undefined => {
  if (Node.isWhileStatement(loop) || Node.isDoStatement(loop)) return loop.getExpression();
  if (Node.isForStatement(loop)) return loop.getCondition();
  return undefined;
};

/**
 * Why a loop runs a bounded number of times on purpose, when it does.
 *
 * `loop` is the statement (`for`, `for-of`, `for-in`, `while`, `do`) or the
 * call of the array method that runs a function per item. Read from the AST
 * only; a reason that needs the leaves the loop reaches (`batch-call`) or the
 * file it is in (`migration`) is never answered here.
 */
export const boundedLoopOf = (loop: Node, options: BoundedLoopOptions = {}): BoundedLoop | undefined => {
  const names = new Set(options.boundedCalls ?? []);
  const list = listOf(loop);
  if (list !== undefined) {
    if (isChunkedList(list, names)) return { by: 'chunk' };
    if (isLiteralList(list)) return { by: 'literal' };
    return undefined;
  }
  const body = bodyOf(loop);
  if (body === undefined) return undefined;
  const nodes = ownDescendants(body);
  if (stepsByMany(loop) || cutsChunks(nodes)) return { by: 'chunk' };

  const condition = conditionOf(loop);
  const name = conditionName(condition);
  if (name !== undefined && PAGE_FLAG.test(name)) return { by: 'page' };
  if (name !== undefined && CURSOR_FLAG.test(name)) return { by: 'cursor' };
  if (isRetry(loop, nodes)) return { by: 'retry' };
  if (walksByIndex(loop)) return undefined;
  const paged = pagedByKeys(keysIn(nodes));
  if (paged !== undefined) return { by: paged };
  if (isAlwaysTrue(condition) && stopsOnAShortPage(loop, nodes)) return { by: 'page' };
  return undefined;
};

/** Directory names a migration is kept in. */
const MIGRATION_DIRECTORIES = /^migrations?$/i;

const exportsUpAndDown = (source: SourceFile): boolean => {
  const exported = source.getExportedDeclarations();
  return exported.has('up') && exported.has('down');
};

const implementsOneOf = (source: SourceFile, interfaces: ReadonlySet<string>): boolean =>
  interfaces.size > 0 &&
  source
    .getClasses()
    .some((declaration) =>
      declaration.getImplements().some((heritage) => interfaces.has(heritage.getExpression().getText().split('.').pop() ?? '')),
    );

export interface MigrationMarks {
  /**
   * Interfaces a migration class implements, by name. Which libraries have
   * one is the caller's to say: the core names none (I1).
   */
  interfaces?: readonly string[];
}

/**
 * Whether a file is a migration, which runs once: under a `migration` or
 * `migrations` directory, a class implementing one of the interfaces the
 * caller names, or a module exporting `up` and `down`. `path` is relative to
 * the repository, so a checkout under somebody's `migrations/` is not one.
 */
export const isMigrationFile = (path: string, source?: SourceFile, marks: MigrationMarks = {}): boolean => {
  const directories = path.split('/').slice(0, -1);
  if (directories.some((part) => MIGRATION_DIRECTORIES.test(part))) return true;
  if (source === undefined) return false;
  return implementsOneOf(source, new Set(marks.interfaces ?? [])) || exportsUpAndDown(source);
};
