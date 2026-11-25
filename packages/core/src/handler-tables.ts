/**
 * A call through a table of handlers the code writes out (P398).
 *
 * ```ts
 * private readonly buttonRoutes = [
 *   { prefix: 'set_status_', handler: (ctx, d) => this.handleStatus(ctx, d) },
 *   { prefix: 'view_order_', handler: this.showOrder.bind(this) },
 * ];
 * const route = this.buttonRoutes.find((r) => data.startsWith(r.prefix));
 * if (route) await route.handler(ctx, data);
 * ```
 *
 * `route.handler(...)` has no class behind its receiver, so a reading that asks
 * the receiver's type stops there. The table is written in the file, though,
 * and the call is a call of each element's `handler`: this reads which element
 * the receiver is (`find`, `filter(...)[i]`, `for...of`, `forEach`, `map`,
 * `table[i]`, a destructure), which table it is drawn from (a field, a `const`,
 * a static, a method or getter returning one, a record of such objects,
 * `Object.values` of one), and what each element's member holds (a method
 * reference, `.bind`, a function declared or imported, a function written in
 * place). An element whose member is not read - a spread of something else, a
 * value from elsewhere - is counted, never guessed at.
 *
 * Nothing here knows about bots: a command map, a route table and a list of
 * strategies are the same shape.
 */
import type {
  ArrayLiteralExpression,
  ArrowFunction,
  ClassDeclaration,
  FunctionExpression,
  MethodDeclaration,
  ObjectLiteralExpression,
  Node as TsNode,
} from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { findMethod, type ClassMethod } from './di/member-call.js';
import { namedFunction, type NamedFunction } from './functions.js';
import { boundDeclaration, originOfValue } from './origin.js';
import { declarationOf } from './static-value.js';

/** How many names, calls and spreads are followed to the table before it is given up. */
const DEPTH = 6;

/** One element of a table whose dispatched member was found. */
export interface TableRow {
  /** The element as written. */
  readonly element: ObjectLiteralExpression;
  /** What the dispatched member holds, without parentheses or casts. */
  readonly value: TsNode;
  /** How the selection names this element, when it names one: `prefix set_status_`. */
  readonly selectedBy?: string;
}

/** A call through an element of a written table. */
export interface TableDispatch {
  /** The table, as written: an array literal, or an object literal of elements. */
  readonly table: ArrayLiteralExpression | ObjectLiteralExpression;
  /** The member called on the element. */
  readonly member: string;
  readonly rows: readonly TableRow[];
  /** Elements whose member could not be read: a spread of a value from elsewhere, an element that is not written out. */
  readonly unread: number;
  /** Every element the table holds, read or not. */
  readonly total: number;
}

/** What one element's member runs. */
export type TableTarget =
  | { readonly kind: 'method'; readonly method: ClassMethod }
  | { readonly kind: 'function'; readonly fn: NamedFunction }
  /** A function written in the element; `owner` is the class `this` means in it, when it means one. */
  | { readonly kind: 'inline'; readonly fn: ArrowFunction | FunctionExpression | MethodDeclaration; readonly owner?: ClassDeclaration };

const unwrap = (expr: TsNode): TsNode => {
  let at = expr;
  while (
    Node.isParenthesizedExpression(at) ||
    Node.isAsExpression(at) ||
    Node.isSatisfiesExpression(at) ||
    Node.isNonNullExpression(at) ||
    Node.isTypeAssertion(at) ||
    Node.isAwaitExpression(at)
  ) {
    at = at.getExpression();
  }
  return at;
};

/** The one expression a function hands back: an arrow's body, or a block's single `return`. */
const returnedBy = (fn: TsNode): TsNode | undefined => {
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody();
    if (!Node.isBlock(body)) return body;
  }
  const body = (fn as { getBody?: () => TsNode | undefined }).getBody?.();
  if (body === undefined || !Node.isBlock(body)) return undefined;
  const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter((each) => each.getFirstAncestor((node) => Node.isFunctionLikeDeclaration(node)) === fn);
  if (returns.length !== 1) return undefined;
  return returns[0]?.getExpression();
};

/** The value a declaration holds, when it holds one written where it is declared. */
const valueOfDeclaration = (declaration: TsNode): TsNode | undefined => {
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
    return declaration.getInitializer();
  }
  if (Node.isGetAccessorDeclaration(declaration)) return returnedBy(declaration);
  return undefined;
};

/**
 * The array or record literal an expression stands for, through names, fields,
 * getters, calls of methods and functions that return one, `Object.values` and
 * the array methods that keep elements (`filter`, `slice`, `concat` of the
 * table itself).
 */
const tableLiteralOf = (expr: TsNode, depth = 0): ArrayLiteralExpression | ObjectLiteralExpression | undefined => {
  if (depth > DEPTH) return undefined;
  const node = unwrap(expr);
  if (Node.isArrayLiteralExpression(node) || Node.isObjectLiteralExpression(node)) return node;
  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) {
    const declaration = declarationOf(node);
    if (declaration === undefined) return undefined;
    const value = valueOfDeclaration(declaration);
    return value === undefined ? undefined : tableLiteralOf(value, depth + 1);
  }
  if (!Node.isCallExpression(node)) return undefined;
  const callee = unwrap(node.getExpression());
  if (Node.isPropertyAccessExpression(callee)) {
    const name = callee.getName();
    const target = callee.getExpression();
    if (name === 'values' && target.getText() === 'Object') {
      const argument = node.getArguments()[0];
      return argument === undefined ? undefined : tableLiteralOf(argument, depth + 1);
    }
    if (name === 'filter' || name === 'slice' || name === 'toSorted' || name === 'toReversed') {
      return tableLiteralOf(target, depth + 1);
    }
  }
  // `this.routes()`, `routes()`: what the method or function hands back.
  const declaration = declarationOf(callee);
  if (declaration === undefined) return undefined;
  const fn = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
  if (fn === undefined || !Node.isFunctionLikeDeclaration(fn)) return undefined;
  const returned = returnedBy(fn);
  return returned === undefined ? undefined : tableLiteralOf(returned, depth + 1);
};

/** The array a call of one of these on it picks elements out of. */
const PICKS = new Set(['find', 'findLast', 'at']);
/** The array a call of one of these on it hands each element to the function it is given. */
const VISITS = new Set(['forEach', 'map', 'flatMap', 'some', 'every', 'filter', 'find', 'findLast', 'findIndex', 'reduce']);

/** Where an element comes from: the table expression, and the condition that selects it, when one does. */
interface ElementSource {
  readonly table: TsNode;
  /** The element's name in `condition`. */
  readonly param?: string;
  readonly condition?: TsNode;
}

/** The parameter name a function's first (or, for `reduce`, second) parameter binds. */
const paramNameOf = (fn: TsNode, index: number): string | undefined => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return undefined;
  const name = fn.getParameters()[index]?.getNameNode();
  return name !== undefined && Node.isIdentifier(name) ? name.getText() : undefined;
};

/** The body of a predicate, read as the condition that selects an element. */
const predicateOf = (call: TsNode): { param?: string; condition?: TsNode } => {
  if (!Node.isCallExpression(call)) return {};
  const fn = call.getArguments()[0];
  if (fn === undefined) return {};
  const param = paramNameOf(fn, 0);
  const condition = Node.isArrowFunction(fn) ? returnedBy(fn) : Node.isFunctionExpression(fn) ? returnedBy(fn) : undefined;
  return { ...(param === undefined ? {} : { param }), ...(condition === undefined ? {} : { condition }) };
};

/** The `if` around a call inside a loop that tests the element: `if (data.startsWith(route.prefix))`. */
const enclosingTest = (call: TsNode, stop: TsNode): TsNode | undefined => {
  for (let at = call.getParent(); at !== undefined && at !== stop; at = at.getParent()) {
    if (Node.isIfStatement(at)) return at.getExpression();
  }
  return undefined;
};

/**
 * Which table an expression is an element of, when it is one: `table.find(p)`,
 * `table.filter(p)[0]`, `table[i]`, `table.at(i)`, or a name bound to one of
 * those, by `for (const r of table)`, or as the parameter `table.forEach` hands
 * each element to.
 */
const elementSourceOf = (expr: TsNode, call: TsNode, depth = 0): ElementSource | undefined => {
  if (depth > DEPTH) return undefined;
  const node = unwrap(expr);
  if (Node.isElementAccessExpression(node)) {
    const of = unwrap(node.getExpression());
    // `table.filter(p)[0]`: the elements filtered, the condition filtering them.
    if (Node.isCallExpression(of)) {
      const callee = unwrap(of.getExpression());
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'filter') {
        return { table: callee.getExpression(), ...predicateOf(of) };
      }
    }
    return { table: of };
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrap(node.getExpression());
    if (!Node.isPropertyAccessExpression(callee) || !PICKS.has(callee.getName())) return undefined;
    const of = unwrap(callee.getExpression());
    if (Node.isCallExpression(of)) {
      const inner = unwrap(of.getExpression());
      if (Node.isPropertyAccessExpression(inner) && inner.getName() === 'filter') {
        return { table: inner.getExpression(), ...predicateOf(of) };
      }
    }
    return { table: of, ...(callee.getName() === 'at' ? {} : predicateOf(node)) };
  }
  if (!Node.isIdentifier(node)) return undefined;
  const declaration = node.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  if (Node.isVariableDeclaration(declaration)) {
    const list = declaration.getParent();
    const loop = list?.getParent();
    if (loop !== undefined && Node.isForOfStatement(loop)) {
      const condition = enclosingTest(call, loop);
      return { table: loop.getExpression(), param: declaration.getName(), ...(condition === undefined ? {} : { condition }) };
    }
    const initializer = declaration.getInitializer();
    return initializer === undefined || !Node.isIdentifier(declaration.getNameNode()) ? undefined : elementSourceOf(initializer, call, depth + 1);
  }
  if (Node.isParameterDeclaration(declaration)) {
    const fn = declaration.getParent();
    const visit = fn?.getParent();
    if (fn === undefined || visit === undefined || !Node.isCallExpression(visit)) return undefined;
    const callee = unwrap(visit.getExpression());
    if (!Node.isPropertyAccessExpression(callee) || !VISITS.has(callee.getName())) return undefined;
    const index = callee.getName() === 'reduce' ? 1 : 0;
    if (visit.getArguments()[0] !== fn || paramNameOf(fn, index) !== declaration.getName()) return undefined;
    const condition = enclosingTest(call, fn);
    return { table: callee.getExpression(), param: declaration.getName(), ...(condition === undefined ? {} : { condition }) };
  }
  return undefined;
};

/** `r.prefix` where `r` is the element's name: the member read, or undefined. */
const memberOfElement = (expr: TsNode | undefined, param: string): string | undefined => {
  if (expr === undefined) return undefined;
  const node = unwrap(expr);
  if (!Node.isPropertyAccessExpression(node)) return undefined;
  const of = unwrap(node.getExpression());
  return Node.isIdentifier(of) && of.getText() === param ? node.getName() : undefined;
};

/** How a condition selects an element: the member it tests, and the word for the test. */
interface Selection {
  readonly member: string;
  readonly test: string;
}

const STRING_TESTS: ReadonlyMap<string, string> = new Map([
  ['startsWith', 'prefix'],
  ['endsWith', 'suffix'],
  ['includes', 'contains'],
  ['match', 'pattern'],
]);

/** The first test in a condition that names a member of the element: `startsWith(r.prefix)`, `r.command === text`, `r.pattern.test(text)`. */
const selectionOf = (condition: TsNode | undefined, param: string | undefined): Selection | undefined => {
  if (condition === undefined || param === undefined) return undefined;
  const nodes = [condition, ...condition.getDescendants()];
  for (const node of nodes) {
    if (Node.isBinaryExpression(node)) {
      const operator = node.getOperatorToken().getKind();
      if (operator !== SyntaxKind.EqualsEqualsEqualsToken && operator !== SyntaxKind.EqualsEqualsToken) continue;
      const member = memberOfElement(node.getLeft(), param) ?? memberOfElement(node.getRight(), param);
      if (member !== undefined) return { member, test: 'equals' };
      continue;
    }
    if (!Node.isCallExpression(node)) continue;
    const callee = unwrap(node.getExpression());
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const name = callee.getName();
    if (name === 'test' || name === 'exec') {
      const member = memberOfElement(callee.getExpression(), param);
      if (member !== undefined) return { member, test: 'pattern' };
      continue;
    }
    const test = STRING_TESTS.get(name);
    if (test === undefined) continue;
    const member = memberOfElement(node.getArguments()[0], param);
    if (member !== undefined) return { member, test };
  }
  return undefined;
};

/** A string, a template without substitutions, a regular expression or a number, as written. */
const literalText = (value: TsNode | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const node = unwrap(value);
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  if (Node.isRegularExpressionLiteral(node) || Node.isNumericLiteral(node)) return node.getText();
  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) {
    const declaration = declarationOf(node);
    const held = declaration === undefined ? undefined : valueOfDeclaration(declaration);
    return held === undefined || held === value ? undefined : literalText(held);
  }
  return undefined;
};

/** What an element's member holds, as written: an assignment's value, a shorthand's name, a method written in place. */
export const tableMemberOf = (element: ObjectLiteralExpression, member: string): TsNode | undefined => {
  const property = element.getProperty(member);
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) {
    const value = property.getInitializer();
    return value === undefined ? undefined : unwrap(value);
  }
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  if (Node.isMethodDeclaration(property)) return property;
  return undefined;
};

/** The written member value of an element, as a string the edge can carry. */
export const tableKeyOf = (element: ObjectLiteralExpression, member: string): string | undefined => literalText(tableMemberOf(element, member));

/** The object literal an element stands for: written in place, or a `const` naming one. */
const elementObject = (element: TsNode, depth = 0): ObjectLiteralExpression | undefined => {
  const node = unwrap(element);
  if (Node.isObjectLiteralExpression(node)) return node;
  if (depth > DEPTH || !Node.isIdentifier(node)) return undefined;
  const declaration = declarationOf(node);
  const value = declaration === undefined ? undefined : valueOfDeclaration(declaration);
  return value === undefined ? undefined : elementObject(value, depth + 1);
};

/** Every element of a table with spreads of tables written out spread in place; the rest counted. */
const elementsOf = (
  table: ArrayLiteralExpression | ObjectLiteralExpression,
  depth = 0,
): { elements: ObjectLiteralExpression[]; unread: number } => {
  const elements: ObjectLiteralExpression[] = [];
  let unread = 0;
  const spread = (expr: TsNode): void => {
    const inner = depth < DEPTH ? tableLiteralOf(expr) : undefined;
    if (inner === undefined) {
      unread += 1;
      return;
    }
    const found = elementsOf(inner, depth + 1);
    elements.push(...found.elements);
    unread += found.unread;
  };
  const one = (value: TsNode | undefined): void => {
    const object = value === undefined ? undefined : elementObject(value);
    if (object === undefined) unread += 1;
    else elements.push(object);
  };
  if (Node.isArrayLiteralExpression(table)) {
    for (const element of table.getElements()) {
      if (Node.isSpreadElement(element)) spread(element.getExpression());
      else if (!Node.isOmittedExpression(element)) one(element);
    }
    return { elements, unread };
  }
  for (const property of table.getProperties()) {
    if (Node.isSpreadAssignment(property)) spread(property.getExpression());
    else if (Node.isPropertyAssignment(property)) one(property.getInitializer());
    else if (Node.isShorthandPropertyAssignment(property)) one(property.getNameNode());
    else unread += 1;
  }
  return { elements, unread };
};

/**
 * The table a call's receiver is an element of, and what each element's member
 * holds; undefined when the receiver is not an element of a table written out
 * whose elements are objects (an empty table, or one of only unread spreads,
 * reads as no table: nothing here is surer than the receiver's own type).
 *
 * `receiver` is the expression the member is called on (`route` of
 * `route.handler(ctx)`); `call` is the call, whose enclosing `if` inside a loop
 * may be what selects the element.
 */
export const tableDispatchOf = (receiver: TsNode, member: string, call: TsNode): TableDispatch | undefined => {
  try {
    const source = elementSourceOf(receiver, call);
    if (source === undefined) return undefined;
    const table = tableLiteralOf(source.table);
    if (table === undefined) return undefined;
    const { elements, unread } = elementsOf(table);
    if (elements.length === 0) return undefined;
    const selection = selectionOf(source.condition, source.param);
    const rows: TableRow[] = [];
    let missing = 0;
    for (const element of elements) {
      const value = tableMemberOf(element, member);
      if (value === undefined) {
        // An element spread from elsewhere may hold the member; one written whole without it holds none.
        if (element.getProperties().some((property) => Node.isSpreadAssignment(property))) missing += 1;
        continue;
      }
      const key = selection === undefined ? undefined : tableKeyOf(element, selection.member);
      rows.push({ element, value, ...(selection === undefined || key === undefined ? {} : { selectedBy: `${selection.test} ${key}` }) });
    }
    // No element written out holds the member: nothing says the call is one of the table's.
    if (rows.length === 0) return undefined;
    return { table, member, rows, unread: unread + missing, total: elements.length + unread };
  } catch {
    // A question the checker throws on reads as no table, which is what was there before.
    return undefined;
  }
};

/**
 * The table a name taken out of an element is drawn from: `const { handler } =
 * route; handler(ctx)`. Undefined when the name is not one taken that way.
 */
export const tableDispatchOfName = (name: TsNode, call: TsNode): TableDispatch | undefined => {
  if (!Node.isIdentifier(name)) return undefined;
  const declaration = name.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isBindingElement(declaration)) return undefined;
  const pattern = declaration.getParent();
  const holder = pattern?.getParent();
  if (pattern === undefined || !Node.isObjectBindingPattern(pattern) || holder === undefined) return undefined;
  const member = (declaration.getPropertyNameNode() ?? declaration.getNameNode()).getText();
  // `for (const { handler } of table)`: the loop's elements.
  if (Node.isVariableDeclaration(holder)) {
    const loop = holder.getParent()?.getParent();
    if (loop !== undefined && Node.isForOfStatement(loop)) {
      const table = tableLiteralOf(loop.getExpression());
      return table === undefined ? undefined : dispatchOver(table, member);
    }
    const initializer = holder.getInitializer();
    return initializer === undefined ? undefined : tableDispatchOf(initializer, member, call);
  }
  // `table.forEach(({ handler }) => handler(ctx))`.
  if (Node.isParameterDeclaration(holder)) {
    const fn = holder.getParent();
    const visit = fn?.getParent();
    if (visit === undefined || !Node.isCallExpression(visit)) return undefined;
    const callee = unwrap(visit.getExpression());
    if (!Node.isPropertyAccessExpression(callee) || !VISITS.has(callee.getName())) return undefined;
    const table = tableLiteralOf(callee.getExpression());
    return table === undefined ? undefined : dispatchOver(table, member);
  }
  return undefined;
};

/** Every element of a table, called alike: a loop or a visit with no condition naming one. */
const dispatchOver = (table: ArrayLiteralExpression | ObjectLiteralExpression, member: string): TableDispatch | undefined => {
  const { elements, unread } = elementsOf(table);
  if (elements.length === 0) return undefined;
  const rows: TableRow[] = [];
  for (const element of elements) {
    const value = tableMemberOf(element, member);
    if (value !== undefined) rows.push({ element, value });
  }
  return rows.length === 0 ? undefined : { table, member, rows, unread, total: elements.length + unread };
};

/** The class `this` means where a node is written, when it means one: past arrows, never past a `function` or an object's method. */
const thisClassAt = (node: TsNode): ClassDeclaration | undefined => {
  for (let at = node.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isClassDeclaration(at)) return at;
    if (Node.isFunctionDeclaration(at) || Node.isFunctionExpression(at)) return undefined;
    if (Node.isMethodDeclaration(at) && Node.isObjectLiteralExpression(at.getParent())) return undefined;
  }
  return undefined;
};

/** The method of a class a reference names: `this.h`, `Handlers.h`, `handlers.h` on an instance of a class. */
const methodReferenced = (access: TsNode): ClassMethod | undefined => {
  if (!Node.isPropertyAccessExpression(access)) return undefined;
  const of = unwrap(access.getExpression());
  if (Node.isThisExpression(of)) {
    const owner = thisClassAt(access);
    return owner === undefined ? undefined : findMethod(owner, access.getName()).method;
  }
  const declaration = declarationOf(access);
  if (declaration !== undefined && (Node.isMethodDeclaration(declaration) || Node.isPropertyDeclaration(declaration)) && Node.isClassDeclaration(declaration.getParent())) {
    return declaration;
  }
  return undefined;
};

/**
 * What one element's member runs: a method of a class, a function of this
 * repository, or a function written in the element. Undefined when it holds
 * something else - a value made elsewhere, a call's result - which the caller
 * counts as unread.
 */
export const tableTargetOf = (value: TsNode): TableTarget | undefined => {
  try {
    let node = unwrap(value);
    // `this.h.bind(this)`: the method bound.
    if (Node.isCallExpression(node)) {
      const callee = unwrap(node.getExpression());
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'bind') return undefined;
      node = unwrap(callee.getExpression());
    }
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const owner = Node.isArrowFunction(node) ? thisClassAt(node) : undefined;
      return { kind: 'inline', fn: node, ...(owner === undefined ? {} : { owner }) };
    }
    if (Node.isMethodDeclaration(node) && Node.isObjectLiteralExpression(node.getParent())) return { kind: 'inline', fn: node };
    const method = methodReferenced(node);
    if (method !== undefined) return { kind: 'method', method };
    if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) {
      const origin = originOfValue(node);
      if (origin.kind !== 'local') return undefined;
      const fn = namedFunction(boundDeclaration(origin.declaration));
      return fn === undefined ? undefined : { kind: 'function', fn };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Whether a value written as an element's member - `handler:
 * this.h.bind(this)` - is called through a dispatch over its table that a call
 * in the same file makes and this module reads. Such a `.bind` is a reference
 * the dispatch follows, not a call nothing could follow; a table handed
 * elsewhere (to a library, to another file) is not known to be dispatched, and
 * its `.bind` keeps the row it had.
 */
export const isDispatchedTableMember = (value: TsNode): boolean => {
  try {
    const assignment = value.getParent();
    if (assignment === undefined || !Node.isPropertyAssignment(assignment)) return false;
    const element = assignment.getParent();
    if (element === undefined || !Node.isObjectLiteralExpression(element)) return false;
    const member = assignment.getName();
    for (const call of value.getSourceFile().getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      const dispatch = Node.isPropertyAccessExpression(callee)
        ? callee.getName() === member
          ? tableDispatchOf(callee.getExpression(), member, call)
          : undefined
        : Node.isIdentifier(callee)
          ? tableDispatchOfName(callee, call)
          : undefined;
      if (dispatch !== undefined && dispatch.member === member && dispatch.rows.some((row) => row.element === element)) return true;
    }
    return false;
  } catch {
    return false;
  }
};

/** Why a table call keeps its gap, said with the counts: "1 of 3 elements of the table is not read". */
export const tableUnreadHint = (dispatch: TableDispatch, unreadValues: number): string => {
  const unread = dispatch.unread + unreadValues;
  const verb = unread === 1 ? 'is' : 'are';
  return `${unread} of ${dispatch.total} elements of the table ${verb} not read (a spread or a value from elsewhere); the ${dispatch.total - unread} read ${dispatch.total - unread === 1 ? 'is' : 'are'} followed. Write the elements out to make every edge visible.`;
};
