import type { Confidence } from '../model/edges.js';
import { entityNameOf, stripWrapperSuffix, type TypeOrigin } from '../origin.js';
import type { PackageJson } from './context.js';

/** What a call does to the data it touches. */
export type DbOp = 'read' | 'write' | 'delete';

/**
 * How to find the entity name when the type arguments do not carry it.
 *
 * `receiver-prop` — the property the call was made on names the entity.
 * `sql-parse`     — the entity names are inside a query string argument.
 * `string-arg`    — the entity name is a plain string argument.
 */
export type TableOverride =
  | { kind: 'receiver-prop' }
  | { kind: 'sql-parse'; argIndex: number }
  | { kind: 'string-arg'; index: number };

/**
 * The little that cannot be read out of the type system.
 *
 * The entity name comes from the type arguments of the receiver, and the
 * package that declares that type is what marks the call as data access. A
 * descriptor only fills the gaps: which method means which operation, and where
 * to look for the entity name when the types do not hold it. That is why
 * supporting one more library is a new record here, not a new parser.
 */
export interface DbDescriptor {
  /** Name of the package that declares the receiver type. */
  package: string;
  /**
   * Method name to operation. The type alone cannot tell a read from a write.
   *
   * A key ending in `*` matches by prefix, which is what makes a repository of
   * hand-written finders describable in a few lines instead of one entry per
   * method. Exact names win over prefixes.
   */
  operations: Record<string, DbOp>;
  tableOverride?: TableOverride;
}

export interface DbAdapter {
  name: string;
  detect(pkg: PackageJson): boolean;
  descriptor: DbDescriptor;
}

/** Where a table name was found. */
export type DbSource = 'type-arg' | 'receiver-prop' | 'sql-parse' | 'string-arg' | 'none';

export interface DbClassification {
  /**
   * False when the call reaches a described package by a method that package
   * does not use to touch data, such as walking a cursor the query already
   * produced. Counting those beats emitting a second query that never happened.
   */
  emit: boolean;
  /** Primary table, or null when the call is data access whose target is unknown. */
  table: string | null;
  /** Every table the call touches, which for a query can be several. */
  tables: string[];
  op: DbOp | null;
  confidence: Confidence;
  package: string | null;
  source: DbSource;
  /** Declared name before any persistence suffix was removed. */
  entityType?: string;
  unresolved?: { reason: string; hint: string };
}

export interface DbCallInput {
  /** Method called on the receiver. */
  method: string;
  origin: TypeOrigin | null;
  /** Descriptor for the package that declares the receiver, when one is registered. */
  descriptor?: DbDescriptor;
  /** Source text of the receiver, used only for the last-resort name check. */
  receiverText?: string;
  /** Tables read out of a query string, when the descriptor asks for that. */
  sqlTables?: readonly string[];
  /** Operation read from a query's verb, which the type system cannot give. */
  sqlOp?: DbOp | null;
  /** True when a query argument was present but could not be read. */
  sqlUnreadable?: boolean;
  /** Property the call was made on, when the descriptor asks for that. */
  receiverProp?: string;
  /** A literal string argument, when the descriptor asks for that. */
  stringArg?: string;
  /** Patterns the caller uses to recognise a data layer by name. */
  nameHints?: DataNameHints;
}

/**
 * Patterns that suggest a data layer when the type system does not settle it.
 *
 * Supplied by the caller rather than written here: the names of libraries and
 * the conventions projects follow are exactly the knowledge the core is not
 * allowed to hold. Without them the last resort is skipped, and a call nothing
 * can vouch for produces nothing.
 */
export interface DataNameHints {
  /** Matched against the last segment of the receiver's source text. */
  receiver?: RegExp;
  /** Matched against the name of the receiver's declared type. */
  type?: RegExp;
}

/**
 * The operation a method performs, by exact name first and then by prefix.
 *
 * The longest matching prefix wins, so a specific rule overrides a general one
 * without depending on the order the keys were written in.
 */
export const operationOf = (descriptor: DbDescriptor, method: string): DbOp | null => {
  const exact = descriptor.operations[method];
  if (exact !== undefined) return exact;
  let best: { length: number; op: DbOp } | undefined;
  for (const [key, op] of Object.entries(descriptor.operations)) {
    if (!key.endsWith('*')) continue;
    const prefix = key.slice(0, -1);
    if (!method.startsWith(prefix)) continue;
    if (best === undefined || prefix.length > best.length) best = { length: prefix.length, op };
  }
  return best?.op ?? null;
};

const tableFromOverride = (
  input: DbCallInput,
  entity: string | null,
): { table: string | null; tables: string[]; source: DbSource } => {
  const override = input.descriptor?.tableOverride;
  if (override === undefined) {
    return entity === null
      ? { table: null, tables: [], source: 'none' }
      : { table: entity, tables: [entity], source: 'type-arg' };
  }
  if (override.kind === 'receiver-prop') {
    const name = input.receiverProp ?? null;
    return { table: name, tables: name === null ? [] : [name], source: 'receiver-prop' };
  }
  if (override.kind === 'sql-parse') {
    const tables = [...(input.sqlTables ?? [])];
    return { table: tables[0] ?? null, tables, source: 'sql-parse' };
  }
  const name = input.stringArg ?? null;
  return { table: name, tables: name === null ? [] : [name], source: 'string-arg' };
};

/**
 * Decides whether a call is data access, and what it touches.
 *
 * Three answers in descending order of confidence, exactly as the plan lays out.
 * The package that declares the receiver's type is what separates the first two
 * from the third; a name alone only ever produces a guess. An unfamiliar data
 * layer still reaches the graph, losing only the distinction between reading and
 * writing, because a tool that stays silent about what it did not understand is
 * worse than one that says so.
 */
export const classifyDbCall = (input: DbCallInput): DbClassification | null => {
  const { origin, descriptor, method } = input;
  const rawEntity = origin === null ? null : entityNameOf(origin);
  const entity = rawEntity === null ? null : stripWrapperSuffix(rawEntity);

  if (descriptor !== undefined) {
    const { table, tables, source } = tableFromOverride(input, entity);
    const op = source === 'sql-parse' ? (input.sqlOp ?? null) : operationOf(descriptor, method);
    const base: DbClassification = {
      emit: true,
      table,
      tables,
      op,
      confidence: table !== null && op !== null ? 'static' : 'heuristic',
      package: origin?.package ?? descriptor.package,
      source,
      ...(rawEntity !== null && rawEntity !== entity ? { entityType: rawEntity } : {}),
    };
    if (source === 'sql-parse' && table === null) {
      return {
        ...base,
        unresolved: {
          reason: 'sql-parse-failed',
          hint: 'The query is not a literal, so the tables it touches cannot be read. Use a literal, or annotate the call.',
        },
      };
    }
    if (op === null) {
      // The descriptor lists what this package uses to touch data. A method that
      // is not on the list is something else, and saying so once per package
      // beats saying it once per call site.
      // Whether a call touches data is the descriptor's answer, not the table
      // lookup's. Only a query string that parsed but named no verb is a genuine
      // failure worth a row of its own.
      if (source !== 'sql-parse') return { ...base, emit: false, table: null, tables: [] };
      return {
        ...base,
        unresolved: {
          reason: 'unknown-db-operation',
          hint: `Add ${JSON.stringify(method)} to the operations of the ${descriptor.package} descriptor to record whether it reads or writes.`,
        },
      };
    }
    return base;
  }

  // A package nobody has described yet still names the entity in its types,
  // but only when the type itself reads as a data layer.
  const hints = input.nameHints ?? {};
  const lastSegment = (input.receiverText ?? '').split('.').pop() ?? '';
  const looksLikeData =
    origin !== null &&
    ((hints.type?.test(origin.typeName) ?? false) || (hints.receiver?.test(lastSegment) ?? false));
  if (origin?.package != null && entity !== null && looksLikeData) {
    return {
      emit: true,
      table: entity,
      tables: [entity],
      op: null,
      confidence: 'heuristic',
      package: origin.package,
      source: 'type-arg',
      ...(rawEntity !== null && rawEntity !== entity ? { entityType: rawEntity } : {}),
      unresolved: {
        reason: 'unknown-db-package',
        hint: `Add a descriptor for ${origin.package} to record which of its methods read and which write.`,
      },
    };
  }

  const receiver = input.receiverText ?? '';
  const last = lastSegment === '' ? receiver : lastSegment;
  // A capitalised receiver names the class itself, so the call is a static
  // helper rather than a use of an instance.
  const isClassReference = /^[A-Z]/.test(last);
  if (!isClassReference && (hints.receiver?.test(last) ?? false)) {
    return {
      emit: true,
      table: null,
      tables: [],
      op: null,
      confidence: 'heuristic',
      package: origin?.package ?? null,
      source: 'none',
      unresolved: {
        reason: 'db-receiver-name-only',
        hint: origin === null
          ? `The type of ${receiver} could not be resolved. Install the repository's dependencies, or name its base class under adapters.db.localBaseClasses.`
          : `${receiver} is typed as ${origin.typeName}, declared in this repository. Name its base class under adapters.db.localBaseClasses if it is a data layer.`,
      },
    };
  }

  return null;
};
