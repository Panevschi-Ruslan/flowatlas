import { declarationOf, evaluateExpression } from '@flowatlas/core';
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type ClassDeclaration,
  type Node as TsNode,
} from 'ts-morph';

/**
 * Where a library keeps the name of the table, when its types do not carry it.
 *
 * `typeorm` puts the entity in a type argument and `@prisma/client` puts the
 * model in the property the call was made on, and the core reads both. The
 * libraries added in P18 do neither: a query builder is parameterised by
 * nothing a reader would recognise, and the name sits in an expression
 * somewhere in the call — an argument of this call, an argument of the next
 * call in the chain, an argument of the call the chain started from, or the
 * receiver itself.
 *
 * A locator says which of those, and nothing about how to turn the expression
 * it finds into a name; that is one question for all of them and is answered
 * once below. Supporting one more library stays a record rather than a parser
 * as long as both halves stay apart.
 */
export type TableLocator =
  | { kind: 'argument'; index: number }
  | { kind: 'chain-call'; method: string; index: number }
  | { kind: 'chain-root-argument'; index: number }
  | { kind: 'receiver' }
  | { kind: 'receiver-type' };

/**
 * Whether a method name is one of the library's operations.
 *
 * The one thing a locator needs from the descriptor it belongs to, and the
 * reason it is asked rather than assumed: `knex('users').first()` and
 * `knex.count('*').first()` are the same shape and only the first of them
 * starts from a table. What tells them apart is that `count` is an operation
 * and `db` is not.
 */
export type IsOperation = (method: string) => boolean;

/**
 * What the locators are allowed to ask about the call they are reading.
 *
 * Two questions and no more: whether a method name is one of the library's
 * operations, and what declares the type of the thing the call was made on. The
 * second is the caller's answer rather than one worked out here, because
 * resolving a receiver's type is the core's job and it has already been done by
 * the time a call is being classified.
 */
export interface TableContext {
  isOperation: IsOperation;
  /** Declaration of the receiver's type, when the core resolved one. */
  typeDeclaration?: TsNode;
}

type LocatorResolvers = {
  [K in TableLocator['kind']]: (
    call: CallExpression,
    locator: Extract<TableLocator, { kind: K }>,
    context: TableContext,
  ) => TsNode | undefined;
};

/**
 * The outermost expression of the chain a call belongs to.
 *
 * A chain is read from whichever of its links the operation happened to be on,
 * and the table can be on a link before or after that one, so the search starts
 * from the top and works down rather than from the call in one direction.
 */
const chainTop = (call: CallExpression): TsNode => {
  let top: TsNode = call;
  for (let depth = 0; depth < 32; depth += 1) {
    const parent = top.getParent();
    if (parent === undefined) return top;
    const links =
      (Node.isPropertyAccessExpression(parent) || Node.isCallExpression(parent)) &&
      parent.getExpression() === top;
    if (!links) return top;
    top = parent;
  }
  return top;
};

/**
 * Every call in one chain, outermost first.
 *
 * The step down is from a call or a property access to what it was made on,
 * which is what makes `a().b().c()` three calls of one chain and `a(b()).c()`
 * two chains.
 */
const chainCalls = (call: CallExpression): CallExpression[] => {
  const calls: CallExpression[] = [];
  let current: TsNode = chainTop(call);
  for (let depth = 0; depth < 32; depth += 1) {
    if (Node.isCallExpression(current)) {
      calls.push(current);
      current = current.getExpression();
      continue;
    }
    if (Node.isPropertyAccessExpression(current)) {
      current = current.getExpression();
      continue;
    }
    return calls;
  }
  return calls;
};

/**
 * The argument of the call named `method`, anywhere in this chain.
 *
 * `db.select().from(orders)` and `knex.select('id').from('users').first()` are
 * the same fact reached from two different links: in the first the operation is
 * before the `from` and in the second it is after it. Searching the whole chain
 * rather than one direction is what reads both, and it is how directus — where
 * every query is written the second way — stopped reporting the selected column
 * as the name of the table.
 */
const chainArgument = (
  call: CallExpression,
  method: string,
  index: number,
): TsNode | undefined => {
  for (const each of chainCalls(call)) {
    const callee = each.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== method) continue;
    const argument = each.getArguments()[index];
    if (argument !== undefined) return argument;
  }
  return undefined;
};

/**
 * The call a chain of method calls started from, when it started somewhere else.
 *
 * `db('orders').where({ id }).first()` names the table in the call that made
 * the builder, however many methods were chained onto it afterwards. Walking
 * down the receivers until one is not itself a call is what finds it without
 * caring which methods were in between.
 *
 * The step is "a call made on a call", not "a call made on a property": the
 * builder is as often reached through `this.db(...)` as through a bare `db`,
 * and a walk that treated `this.db` as another link of the chain walked past
 * the root and off the end of every real query.
 *
 * A root that is itself an operation is no root. `knex.count('*').first()` ends
 * its walk at the `count`, and reading that call's first argument reported the
 * counted column as a table — a name that looks like an answer and is not,
 * which is worse than saying nothing. The connection a real chain starts from
 * is invoked rather than called by name, so its callee is never an operation.
 */
const chainRoot = (
  call: CallExpression,
  isOperation: IsOperation,
): CallExpression | undefined => {
  let current = call;
  for (let depth = 0; depth < 16; depth += 1) {
    const callee = current.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) break;
    const receiver = callee.getExpression();
    if (!Node.isCallExpression(receiver)) break;
    current = receiver;
  }
  if (current === call) return undefined;
  const callee = current.getExpression();
  const named = Node.isPropertyAccessExpression(callee) ? callee.getName() : null;
  return named !== null && isOperation(named) ? undefined : current;
};

const receiverOf = (call: CallExpression): TsNode | undefined => {
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
};

const resolvers: LocatorResolvers = {
  argument: (call, locator) => call.getArguments()[locator.index],
  'chain-call': (call, locator) => chainArgument(call, locator.method, locator.index),
  'chain-root-argument': (call, locator, context) =>
    chainRoot(call, context.isOperation)?.getArguments()[locator.index],
  receiver: (call) => receiverOf(call),
  // Not an expression at all, but the declaration one was resolved to. A method
  // called on an instance — `document.save()` — writes nothing about a table
  // anywhere in the call, and the class the instance is typed as is where the
  // table is stated. The reading below takes a declaration as readily as an
  // expression that names one, so the two paths meet immediately.
  'receiver-type': (_call, _locator, context) => context.typeDeclaration,
};

// One cast, because a key and the map it indexes cannot be narrowed together.
// The map above is exhaustive and typed per kind, which is where the checking
// that matters happens.
const expressionFor = (
  call: CallExpression,
  locator: TableLocator,
  context: TableContext,
): TsNode | undefined =>
  (
    resolvers[locator.kind] as (
      c: CallExpression,
      l: TableLocator,
      o: TableContext,
    ) => TsNode | undefined
  )(call, locator, context);

/**
 * Calls that declare a stored collection, and the argument each one names it in.
 *
 * Every one of these libraries declares its tables in the repository being read
 * rather than in a migration nobody compiles, which is the whole reason a
 * schema object can be followed to a name at all. A call not on this list is
 * not a declaration, and an expression that reaches one is reported rather than
 * guessed at.
 */
const NAMING_CALLS: Record<string, number> = {
  // drizzle, one per dialect
  pgTable: 0,
  mysqlTable: 0,
  sqliteTable: 0,
  // mongoose
  model: 0,
  // sequelize
  define: 0,
};

/** Keys a model class states its table under, in the order a reader prefers them. */
const MODEL_NAME_KEYS = ['tableName', 'modelName'] as const;

/**
 * Decorators a model class states its table with, and the argument that holds it.
 *
 * `sequelize-typescript` is the ordinary way a TypeScript project declares a
 * sequelize model, and it states the table in a decorator rather than in an
 * `init` call: `@Table({ tableName: 'documents' })`. The options are the same
 * options `init` takes, so the keys above are read out of them unchanged — the
 * only new fact is where the object is written, which is what makes this a
 * record beside the other one rather than a second way of reading a name.
 */
const NAMING_DECORATORS: Record<string, number> = {
  Table: 0,
};

/**
 * Calls that narrow a data layer and hand back the same data layer.
 *
 * `Document.scope('withOwner').findAll()` reads the documents table, and the
 * receiver of the read is a call rather than a name. Retyping is the point of
 * these calls — sequelize's `scope` returns the library's own `ModelStatic`,
 * which is what makes the call recognisable as data access at all — but a scope
 * is a filter over one model and never another table. Walking through the call
 * to what it was made on is what reads the name; on outline, where nearly every
 * query is scoped, it is the difference between 91 unreadable tables and none.
 *
 * A list rather than a rule, because "a call whose receiver names the table" is
 * true of these methods and false of most: reading through any call at all would
 * make `Document.findAll()` claim that `findAll` returns documents to store in.
 */
const NARROWING_CALLS = new Set(['scope', 'unscoped', 'schema', 'withSchema']);

/**
 * A table written with an alias, which is the table.
 *
 * `from('directus_sessions AS s')` is how a builder joins a table to itself,
 * and reading the whole string put `directus_sessions`, `directus_sessions AS
 * s` and `directus_sessions as s` in one real repository's graph as three
 * different tables. The alias is local to the query and names nothing stored.
 */
const ALIASED = /^(\S+)\s+as\s+\S+$/i;

const stringOf = (node: TsNode | undefined): string | null => {
  if (node === undefined) return null;
  const value = evaluateExpression(node);
  if (value.resolved !== true || typeof value.value !== 'string' || value.value === '') return null;
  return ALIASED.exec(value.value)?.[1] ?? value.value;
};

/**
 * The first of `keys` an object literal states as a string.
 *
 * One property at a time rather than the whole object, because the options a
 * model is initialised with also hold the connection, and a connection is not
 * a static value. Reading the object as a whole meant one unreadable property
 * lost the one property that was the answer.
 */
const stringProperty = (node: TsNode, keys: readonly string[]): string | null => {
  if (!Node.isObjectLiteralExpression(node)) return null;
  for (const key of keys) {
    const property = node.getProperty(key);
    if (property === undefined || !Node.isPropertyAssignment(property)) continue;
    const found = stringOf(property.getInitializer());
    if (found !== null) return found;
  }
  return null;
};

/** The name a decorator states for a class, out of the options it was given. */
const nameFromDecorators = (declaration: ClassDeclaration): string | null => {
  for (const decorator of declaration.getDecorators()) {
    const index = NAMING_DECORATORS[decorator.getName()];
    if (index === undefined) continue;
    const argument = decorator.getArguments()[index];
    const found = argument === undefined ? null : stringProperty(argument, MODEL_NAME_KEYS);
    if (found !== null) return found;
  }
  return null;
};

/** The name a `Model.init(attributes, options)` call states for a model class. */
const nameFromInit = (declaration: TsNode, className: string): string | null => {
  const file = declaration.getSourceFile();
  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'init') continue;
    if (callee.getExpression().getText() !== className) continue;
    const options = call.getArguments()[1];
    const found = options === undefined ? null : stringProperty(options, MODEL_NAME_KEYS);
    if (found !== null) return found;
  }
  return null;
};

/**
 * The table a declaration stands for, when the declaration is one of the shapes
 * these libraries use to declare one.
 *
 * Kept separate from the locators so that a library which finds its table
 * expression in a different place still reads the same declarations: a drizzle
 * schema object, a mongoose model, a sequelize model, and a document made from
 * one of them are four spellings of the same fact.
 */
const nameOfDeclaration = (declaration: TsNode, depth: number): string | null => {
  if (Node.isClassDeclaration(declaration)) {
    const name = declaration.getName();
    if (name === undefined) return null;
    const stated = declaration.getStaticProperty('tableName');
    const literal =
      stated !== undefined && Node.isPropertyDeclaration(stated)
        ? stringOf(stated.getInitializer())
        : null;
    return literal ?? nameFromDecorators(declaration) ?? nameFromInit(declaration, name);
  }

  const initializer = Node.isVariableDeclaration(declaration)
    ? declaration.getInitializer()
    : undefined;
  if (initializer === undefined) return null;

  // A document is made from its model, and the model is what names the
  // collection: `new OrderModel({...}).save()` stores an order wherever
  // `OrderModel` says orders are stored.
  if (Node.isNewExpression(initializer)) {
    return depth >= 4 ? null : nameFromExpression(initializer.getExpression(), depth + 1);
  }
  if (!Node.isCallExpression(initializer)) return null;
  const callee = initializer.getExpression();
  const called = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
  const index = NAMING_CALLS[called];
  return index === undefined ? null : stringOf(initializer.getArguments()[index]);
};

/**
 * The table an expression stands for: the string it is, or the string the
 * declaration it names states.
 *
 * A literal first, because `knex('orders')` and a shared `const ORDERS` are the
 * same fact written twice and neither needs following. Everything else is a
 * name in the repository, and what it was declared as is where the answer is.
 */
const nameFromExpression = (node: TsNode, depth = 0): string | null => {
  const literal = stringOf(node);
  if (literal !== null) return literal;
  const narrowed = throughNarrowing(node);
  if (narrowed !== undefined) return depth >= 4 ? null : nameFromExpression(narrowed, depth + 1);
  // A declaration as readily as an expression that names one: `declarationOf`
  // answers for a name and nothing else, and the `receiver-type` locator hands
  // over a declaration directly.
  return nameOfDeclaration(declarationOf(node) ?? node, depth);
};

/**
 * What a narrowing call was made on, when the expression is one.
 *
 * Declared beside `nameFromExpression` because it is only ever a step on the way
 * to a name: the answer is the same question asked of a smaller expression.
 */
const throughNarrowing = (node: TsNode): TsNode | undefined => {
  if (!Node.isCallExpression(node)) return undefined;
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  return NARROWING_CALLS.has(callee.getName()) ? callee.getExpression() : undefined;
};

/**
 * The table a call touches, read through the locators its library declares.
 *
 * The locators are tried in order and the first that yields a name wins, which
 * is what lets one library describe two shapes — drizzle names the table in the
 * call itself when it writes and in the next call of the chain when it reads —
 * without either shape knowing about the other.
 *
 * Null is an answer: the name is decided at run time, or in a declaration this
 * repository does not contain. The caller reports it rather than inventing one.
 */
export const locateTable = (
  call: CallExpression,
  locators: readonly TableLocator[],
  context: TableContext,
): string | null => {
  for (const locator of locators) {
    const expression = expressionFor(call, locator, context);
    if (expression === undefined) continue;
    const name = nameFromExpression(expression);
    if (name !== null) return name;
  }
  return null;
};
