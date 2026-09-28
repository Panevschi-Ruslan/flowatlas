import { hasAnyDependency, type DbAdapter, type DbDescriptor } from '@flowatlas/core';
import type { SourceFile } from 'ts-morph';
import { isGeneratedPrismaClient, prismaTableOf } from '../leaves/prisma-schema.js';
import type { TableLocator } from './table.js';

/**
 * How one library's table name is read.
 *
 * `locators` say where the name is written, tried in order; the first that
 * yields one wins.
 *
 * `entityInTypeArgs` says whether the receiver's first type argument names the
 * stored thing, so that a locator finding nothing may fall back to it. It is
 * true of every library whose receiver is a model or a repository of one thing —
 * an injected `Model<OrderDocument>` names an order and the fallback is the
 * answer. It is false of a connection parameterised by the whole schema:
 * `Kysely<DB>` says which database, and `DB` is not a table. Reading it as one
 * is worse than saying nothing, because a name that looks like an answer is not
 * checked again.
 */
export interface TableReading {
  locators: readonly TableLocator[];
  entityInTypeArgs: boolean;
}

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
 *
 * `store` is not among the receiver names, and that is a measurement rather than
 * a taste. Across the eight repositories the coverage harness reads, a receiver
 * whose name ends in `store` produced 97 rows and not one of them was a data
 * layer: they were arrays, maps, mutex registries, a plugin registry, a browser
 * object store, a framework's cookie store, and the state stores three of those
 * repositories keep their screens in. On six of the eight nothing else moved when
 * it went. On cal.com something did, and it was the point: `tables` went from 1
 * to 0 and the queries that name a table from 4 to 0, because the one table
 * cal.com was reported to have was the name of a React state type on a zustand
 * store — minted at heuristic confidence for an undescribed package, with the
 * receiver's name as the only reason to think it was data (R112). So what the
 * word did was ask a reader to describe things that store nothing, and once,
 * name one of them as a table.
 *
 * It stays among the *type* names, where a class called `OrderStore` is an
 * ordinary name for a real data layer and where the evidence is the class rather
 * than the word at the end of a variable. Trimming it there was measured too and
 * costs four rows on outline that tell a reader to name a base class, while
 * changing no query and no table anywhere.
 */
export const dataNameHints = {
  receiver: /(repository|repo|db|prisma|knex|dao)$/i,
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
 * The typed query builder whose every query starts by naming its table.
 *
 * `selectFrom`, `insertInto`, `updateTable` and `deleteFrom` are the four ways
 * in, and each one takes the table as its first argument, so the name is read
 * from exactly where the author wrote it. Everything else in a query —
 * `where`, `set`, `values`, `returning`, `execute` — is chained onto one of
 * them and describes what that one query will ask for, which is why listing it
 * here would report one visit to the database as half a dozen.
 *
 * The receiver is `Kysely<Schema>`, and the schema is the whole database rather
 * than one table, which is the reason this library needs `entityInTypeArgs`
 * turned off below: on immich, where every one of 579 queries is written this
 * way, the type argument was read as an entity and put the name of the schema
 * type on 407 nodes as though it were a table.
 */
const kyselyDescriptor: DbDescriptor = {
  package: 'kysely',
  tableOverride: NAMED_IN_ARGUMENT,
  operations: {
    selectFrom: READ,
    insertInto: WRITE,
    replaceInto: WRITE,
    mergeInto: WRITE,
    updateTable: WRITE,
    deleteFrom: DELETE,
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
 * How each library's table name is found, when its types do not carry it.
 *
 * Beside the descriptors rather than inside them, because `DbDescriptor` is the
 * core's type and the core is not allowed to learn a fourth way of finding a
 * name. Keyed by the package the descriptor is chosen by, so a library either
 * has both records or neither.
 *
 * Both facts about reading a name live in one record per library, rather than in
 * two records that could disagree: where the name is written, and whether the
 * receiver's type argument may answer when it is not written anywhere. Kysely is
 * the library that made the second fact necessary and is the only one that
 * answers no to it.
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
 *
 * A `Map`, like `descriptorAliases` below and for its reason: both are keyed by a
 * package name, and a bare object indexed by a name out of somebody else's source
 * answers for `constructor` and `toString` as readily as for `knex` (R130).
 */
export const tableReadings: ReadonlyMap<string, TableReading> = new Map([
  [
    'drizzle-orm',
    {
      locators: [
        { kind: 'argument', index: 0 },
        { kind: 'chain-call', method: 'from', index: 0 },
      ],
      entityInTypeArgs: true,
    },
  ],
  ['mongoose', { locators: [{ kind: 'receiver' }], entityInTypeArgs: true }],
  [
    'sequelize',
    {
      // The receiver first, because a model named outright is the clearest
      // statement of which table is meant; its declared type second, for an
      // instance, where the expression is a variable and the class behind it is
      // the only thing that states a table.
      locators: [{ kind: 'receiver' }, { kind: 'receiver-type' }],
      entityInTypeArgs: true,
    },
  ],
  [
    'knex',
    {
      locators: [
        { kind: 'chain-call', method: 'from', index: 0 },
        { kind: 'chain-root-argument', index: 0 },
      ],
      entityInTypeArgs: true,
    },
  ],
  ['kysely', { locators: [{ kind: 'argument', index: 0 }], entityInTypeArgs: false }],
]);

/**
 * Packages that hand out another library's data layer under their own name.
 *
 * A descriptor is chosen by the package that declares the receiver's type, and
 * that is not always the package the descriptor was written for. The mapper a
 * project actually imports may be a thin layer over the library the descriptor
 * describes: `sequelize-typescript` declares the `Model` that a decorated model
 * class extends, while every method on it, and every word of the descriptor, is
 * `sequelize`'s. On outline that one row is the difference between reading the
 * data layer and dropping every call to it.
 *
 * A record rather than a second descriptor, because the two packages are not two
 * libraries to describe; they are one library reached under two names.
 *
 * A `Map` because the key is a package name read out of an import in somebody
 * else's repository, and a bare object indexed by a word from source text
 * answers for `constructor` and `toString` too (R130).
 */
export const descriptorAliases: ReadonlyMap<string, string> = new Map([
  ['sequelize-typescript', 'sequelize'],
]);

/**
 * Modules a repository generates, and the package whose client each one is.
 *
 * A generated client is the library's own client written into the repository
 * rather than installed beside it: Prisma writes `PrismaClient` to wherever the
 * schema's generator says, and cal.com says `./generated/prisma`. A clone whose
 * install ran no scripts has an import of that path and no file behind it, so
 * the checker cannot say what came out of it - and the schema can, because it is
 * the schema that names the directory (R146).
 *
 * A record per generator, keyed by the package whose descriptor then reads the
 * call, so a second generating library is a row here and not a branch in the
 * reader that follows imports.
 */
export const generatedModules: readonly {
  readonly package: string;
  readonly generates: (from: SourceFile, target: string) => boolean;
}[] = [{ package: '@prisma/client', generates: isGeneratedPrismaClient }];

/**
 * Libraries whose calls name a model, and how the model's table is read.
 *
 * `prisma.booking.findMany()` names the delegate, and the table is what the
 * schema maps the model to: the model's own name unless `@@map` says otherwise.
 * Asked with the file the client was imported or constructed in, since that is
 * the file the schema governs. A library with no entry here keeps the name the
 * call wrote, and so does a Prisma call where no schema is readable.
 *
 * A `Map`, for the reason every table keyed by a package name here is one (R130).
 */
export const schemaTables: ReadonlyMap<string, (from: SourceFile, name: string) => string | undefined> =
  new Map([['@prisma/client', prismaTableOf]]);

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
    name: 'kysely',
    // `nestjs-kysely` is how a Nest application is handed the connection, and a
    // repository that imports only the wrapper still queries kysely.
    detect: (pkg) => hasAnyDependency(pkg, ['kysely', 'nestjs-kysely']),
    descriptor: kyselyDescriptor,
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
  kyselyDescriptor,
  localBaseDescriptor,
  mongodbDescriptor,
  mongooseDescriptor,
  pgDescriptor,
  prismaDescriptor,
  sequelizeDescriptor,
  typeormDescriptor,
};
