import { declarationOf, evaluateExpression, locatedExpressions } from '@flowatlas/core';
import type { LocatorContext, NameLocator } from '@flowatlas/core';
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
 * The same vocabulary the channel side uses, and deliberately the same type: a
 * locator says where in a call a name is written, and a stored collection and a
 * channel are written in the same places for the same reasons. Two lists of
 * kinds that happened to agree would be one idea recorded twice, and only one of
 * the copies would ever be brought up to date. So the kinds live in the core,
 * where neither half of the graph owns them.
 *
 * What is *not* shared is the half below: turning the expression a locator found
 * into a name. A table is named by following the declaration that states it —
 * a schema object, a model class, a decorator's options. A channel is named by
 * folding a template over the closed set of values its holes can hold, and
 * refused outright when it cannot be read. Those are different questions, and
 * keeping them apart is what lets one mechanism serve both and keeps supporting
 * one more library a record rather than a parser.
 */
export type TableLocator = NameLocator;

/** The context a locator reads, under the name this side of the graph uses. */
export type TableContext = LocatorContext;

/**
 * Calls that declare a stored collection, and the argument each one names it in.
 *
 * Every one of these libraries declares its tables in the repository being read
 * rather than in a migration nobody compiles, which is the whole reason a
 * schema object can be followed to a name at all. A call not on this list is
 * not a declaration, and an expression that reaches one is reported rather than
 * guessed at.
 */
const NAMING_CALLS: ReadonlyMap<string, number> = new Map([
  // drizzle, one per dialect
  ['pgTable', 0],
  ['mysqlTable', 0],
  ['sqliteTable', 0],
  // mongoose
  ['model', 0],
  // sequelize
  ['define', 0],
]);

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
const NAMING_DECORATORS: ReadonlyMap<string, number> = new Map([['Table', 0]]);

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

/**
 * The table an alias object names, when it names exactly one.
 *
 * `knex({ il: 'inventory_level' })` is `knex('inventory_level as il')` written
 * as an object: the key is the alias and the value is the table. One entry only,
 * because an object of several is several tables, and a string value only,
 * because an object whose value is an expression - drizzle's `select({ id:
 * users.id })` - is a list of columns and names no table at all (R149).
 */
const aliasedTable = (value: unknown): string | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.values(value);
  const [only] = entries;
  return entries.length === 1 && typeof only === 'string' && only !== '' ? only : null;
};

const stringOf = (node: TsNode | undefined): string | null => {
  if (node === undefined) return null;
  const value = evaluateExpression(node);
  if (value.resolved !== true) return null;
  if (typeof value.value !== 'string') return aliasedTable(value.value);
  if (value.value === '') return null;
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
    const index = NAMING_DECORATORS.get(decorator.getName());
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
  const index = NAMING_CALLS.get(called);
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
  for (const expression of locatedExpressions(call, locators, context)) {
    const name = nameFromExpression(expression);
    if (name !== null) return name;
  }
  return null;
};
