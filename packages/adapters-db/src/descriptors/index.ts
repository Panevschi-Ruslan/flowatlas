import { hasAnyDependency, type DbAdapter, type DbDescriptor } from '@flowatlas/core';

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
    name: 'local-base',
    // Always available: whether it applies is decided by the configuration
    // naming a base class, not by any dependency.
    detect: () => true,
    descriptor: localBaseDescriptor,
  },
];

export { localBaseDescriptor, mongodbDescriptor, pgDescriptor, prismaDescriptor, typeormDescriptor };
