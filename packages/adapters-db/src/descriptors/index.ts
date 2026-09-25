import { hasAnyDependency, type DbAdapter, type DbDescriptor } from '@flowatlas/core';
import type { TableLocator } from './table.js';

/**
 * What each data layer's methods do.
 *
 * The entity comes from the type system; only the operation and, where the types
 * hold nothing, the table name need writing down. That is why supporting another
 * library is a record here rather than another parser.
 */

/**
 * Names that suggest a data layer when the types do not settle it.
 *
 * The last resort, and the only place a guess is made from a name. It lives here
 * rather than in the core because a list of library names and project
 * conventions is precisely the knowledge the core must not hold.
 */
export const dataNameHints = {
  receiver: /(repository|repo|db|prisma|knex|dao|store)$/i,
  type: /(repository|repo|model|collection|dao|store|table|entitymanager|queryrunner|knex|prisma|db)$/i,
};

const READ = 'read' as const;
const WRITE = 'write' as const;
const DELETE = 'delete' as const;

const typeormDescriptor: DbDescriptor = {
  package: 'typeorm',
  operations: {
    find: READ,
    findBy: READ,
    createQueryBuilder: READ,
    query: READ,
    findOne: READ,
    findOneBy: READ,
    findOneOrFail: READ,
    findAndCount: READ,
    findAndCountBy: READ,
    count: READ,
    countBy: READ,
    exists: READ,
    existsBy: READ,
    sum: READ,
    average: READ,
    minimum: READ,
    maximum: READ,
    save: WRITE,
    insert: WRITE,
    update: WRITE,
    upsert: WRITE,
    increment: WRITE,
    decrement: WRITE,
    recover: WRITE,
    restore: WRITE,
    delete: DELETE,
    remove: DELETE,
    softDelete: DELETE,
    softRemove: DELETE,
    clear: DELETE,
  },
};

const prismaDescriptor: DbDescriptor = {
  package: '@prisma/client',
  // The property the call was made on names the model: `prisma.order.findMany()`.
  tableOverride: { kind: 'receiver-prop' },
  operations: {
    findUnique: READ,
    findUniqueOrThrow: READ,
    findFirst: READ,
    findFirstOrThrow: READ,
    findMany: READ,
    count: READ,
    aggregate: READ,
    groupBy: READ,
    create: WRITE,
    createMany: WRITE,
    update: WRITE,
    updateMany: WRITE,
    upsert: WRITE,
    delete: DELETE,
    deleteMany: DELETE,
  },
};

const pgDescriptor: DbDescriptor = {
  package: 'pg',
  // The types say nothing here; everything is inside the query string.
  tableOverride: { kind: 'sql-parse', argIndex: 0 },
  operations: { query: READ, execute: READ },
};

/**
 * A repository base declared in the project itself.
 *
 * Matched by the marker origin rather than by a package name, so the core still
 * knows nothing about what is behind it.
 */
const localBaseDescriptor: DbDescriptor = {
  package: 'local',
  // Prefixes, because a project's own repository base is used through dozens of
  // hand-written finders rather than a fixed set of method names.
  operations: {
    'find*': READ,
    'get*': READ,
    'list*': READ,
    'count*': READ,
    'exists*': READ,
    'search*': READ,
    'query*': READ,
    'sum*': READ,
    'aggregate*': READ,
    'load*': READ,
    'read*': READ,
    'fetch*': READ,
    'create*': WRITE,
    'insert*': WRITE,
    'add*': WRITE,
    'save*': WRITE,
    'update*': WRITE,
    'upsert*': WRITE,
    'replace*': WRITE,
    'set*': WRITE,
    'increment*': WRITE,
    'decrement*': WRITE,
    'bulk*': WRITE,
    'mark*': WRITE,
    'assign*': WRITE,
    'revoke*': WRITE,
    'cas*': WRITE,
    'push*': WRITE,
    'pull*': WRITE,
    'delete*': DELETE,
    'remove*': DELETE,
    'destroy*': DELETE,
    'purge*': DELETE,
    'drop*': DELETE,
    'clear*': DELETE,
  },
};

/** The driver, used directly rather than through a mapper. */
const mongodbDescriptor: DbDescriptor = {
  package: 'mongodb',
  operations: {
    find: READ,
    findOne: READ,
    countDocuments: READ,
    estimatedDocumentCount: READ,
    distinct: READ,
    aggregate: READ,
    insertOne: WRITE,
    insertMany: WRITE,
    updateOne: WRITE,
    updateMany: WRITE,
    replaceOne: WRITE,
    bulkWrite: WRITE,
    findOneAndUpdate: WRITE,
    findOneAndReplace: WRITE,
    deleteOne: DELETE,
    deleteMany: DELETE,
    findOneAndDelete: DELETE,
    drop: DELETE,
  },
};

/**
 * A table named in an argument rather than in the types.
 *
 * Every library added in P18 keeps the table in an expression somewhere in the
 * call, so every one of them hands the core the same override and lets
 * `tableLocators` below say where that expression is. The index is the core's
 * own fallback for a plain string argument and is never reached here: the
 * locator has already read the name by the time the call is classified.
 */
const NAMED_IN_ARGUMENT = { kind: 'string-arg', index: 0 } as const;

/**
 * The query builder whose receiver is parameterised by nothing a reader would
 * recognise: `db` is the connection and stays the connection through every
 * call, so the method name settles the operation and nothing else.
 *
 * Only the four calls that enter the data layer are listed. `from`, `where`,
 * `set` and `values` hang off one of them and are counted as what they are — a
 * builder being built, not a second visit to the database.
 */
const drizzleDescriptor: DbDescriptor = {
  package: 'drizzle-orm',
  tableOverride: NAMED_IN_ARGUMENT,
  operations: {
    select: READ,
    selectDistinct: READ,
    insert: WRITE,
    update: WRITE,
    delete: DELETE,
  },
};

/**
 * The mapper, whose model carries the document type and names the collection
 * at once. The type argument is the entity, exactly as with `typeorm`; the
 * collection is the string the model was declared with, which is the name a
 * reader looking at the database itself would see.
 */
const mongooseDescriptor: DbDescriptor = {
  package: 'mongoose',
  tableOverride: NAMED_IN_ARGUMENT,
  operations: {
    find: READ,
    findOne: READ,
    findById: READ,
    countDocuments: READ,
    estimatedDocumentCount: READ,
    distinct: READ,
    aggregate: READ,
    exists: READ,
    create: WRITE,
    insertMany: WRITE,
    save: WRITE,
    updateOne: WRITE,
    updateMany: WRITE,
    replaceOne: WRITE,
    bulkWrite: WRITE,
    findOneAndUpdate: WRITE,
    findByIdAndUpdate: WRITE,
    findOneAndReplace: WRITE,
    deleteOne: DELETE,
    deleteMany: DELETE,
    findOneAndDelete: DELETE,
    findByIdAndDelete: DELETE,
    findByIdAndRemove: DELETE,
    remove: DELETE,
  },
};

/**
 * The model called as a class — `Invoice.findAll()` rather than through an
 * injected repository. The table is whatever the model was defined or
 * initialised with, and the receiver is the class itself, which is why the
 * locator reads the receiver's declaration rather than an argument.
 */
const sequelizeDescriptor: DbDescriptor = {
  package: 'sequelize',
  tableOverride: NAMED_IN_ARGUMENT,
  operations: {
    findAll: READ,
    findOne: READ,
    findByPk: READ,
    findAndCountAll: READ,
    count: READ,
    min: READ,
    max: READ,
    sum: READ,
    create: WRITE,
    bulkCreate: WRITE,
    update: WRITE,
    upsert: WRITE,
    increment: WRITE,
    decrement: WRITE,
    save: WRITE,
    findOrCreate: WRITE,
    restore: WRITE,
    destroy: DELETE,
    truncate: DELETE,
  },
};

/**
 * The query builder that starts from the table: `knex('orders')` makes a
 * builder for one table, and every method chained onto it is about that table.
 *
 * Only the calls that finish a query are listed. `where`, `join` and `orderBy`
 * narrow a query some later call will run, and listing them would emit one row
 * per link of the chain for a single visit to the database.
 */
const knexDescriptor: DbDescriptor = {
  package: 'knex',
  tableOverride: NAMED_IN_ARGUMENT,
  operations: {
    select: READ,
    first: READ,
    pluck: READ,
    count: READ,
    countDistinct: READ,
    min: READ,
    max: READ,
    sum: READ,
    avg: READ,
    insert: WRITE,
    update: WRITE,
    upsert: WRITE,
    increment: WRITE,
    decrement: WRITE,
    del: DELETE,
    delete: DELETE,
    truncate: DELETE,
  },
};

/**
 * Where each library keeps the expression that names the table.
 *
 * Beside the descriptors rather than inside them, because `DbDescriptor` is the
 * core's type and the core is not allowed to learn a fourth way of finding a
 * name. Keyed by the package the descriptor is chosen by, so a library either
 * has both records or neither.
 *
 * Drizzle has two locators because it writes the table in two places: in the
 * call itself when it writes (`db.insert(orders)`) and in a `from` elsewhere in
 * the chain when it reads (`db.select().from(orders)`). The first that yields a
 * name wins, which is how one record describes both shapes without either of
 * them knowing about the other.
 *
 * Knex has two for the same reason, and their order is what directus taught:
 * `knex('users').where(…).first()` starts from the table, but
 * `knex.select('id').from('users').first()` names the table in a `from` and the
 * *column* in the call the chain started from. Asking the root first reported
 * `id` as a table on most of a real repository's queries, so the `from` is
 * asked first and the root is the fallback.
 */
export const tableLocators: Record<string, readonly TableLocator[]> = {
  'drizzle-orm': [
    { kind: 'argument', index: 0 },
    { kind: 'chain-call', method: 'from', index: 0 },
  ],
  mongoose: [{ kind: 'receiver' }],
  sequelize: [{ kind: 'receiver' }],
  knex: [
    { kind: 'chain-call', method: 'from', index: 0 },
    { kind: 'chain-root-argument', index: 0 },
  ],
};

export const dbAdapters: readonly DbAdapter[] = [
  {
    name: 'typeorm',
    detect: (pkg) => hasAnyDependency(pkg, ['typeorm', '@nestjs/typeorm']),
    descriptor: typeormDescriptor,
  },
  {
    name: 'prisma',
    detect: (pkg) => hasAnyDependency(pkg, ['@prisma/client', 'prisma']),
    descriptor: prismaDescriptor,
  },
  {
    name: 'pg',
    detect: (pkg) => hasAnyDependency(pkg, ['pg', 'postgres', 'mysql2']),
    descriptor: pgDescriptor,
  },
  {
    name: 'mongodb',
    detect: (pkg) => hasAnyDependency(pkg, ['mongodb', '@nestjs/mongoose', 'mongoose']),
    descriptor: mongodbDescriptor,
  },
  {
    name: 'drizzle',
    detect: (pkg) => hasAnyDependency(pkg, ['drizzle-orm']),
    descriptor: drizzleDescriptor,
  },
  {
    name: 'mongoose',
    detect: (pkg) => hasAnyDependency(pkg, ['mongoose', '@nestjs/mongoose']),
    descriptor: mongooseDescriptor,
  },
  {
    name: 'sequelize',
    detect: (pkg) =>
      hasAnyDependency(pkg, ['sequelize', 'sequelize-typescript', '@nestjs/sequelize']),
    descriptor: sequelizeDescriptor,
  },
  {
    name: 'knex',
    detect: (pkg) => hasAnyDependency(pkg, ['knex']),
    descriptor: knexDescriptor,
  },
  {
    name: 'local-base',
    // Always available: whether it applies is decided by the configuration
    // naming a base class, not by any dependency.
    detect: () => true,
    descriptor: localBaseDescriptor,
  },
];

export {
  drizzleDescriptor,
  knexDescriptor,
  localBaseDescriptor,
  mongodbDescriptor,
  mongooseDescriptor,
  pgDescriptor,
  prismaDescriptor,
  sequelizeDescriptor,
  typeormDescriptor,
};
