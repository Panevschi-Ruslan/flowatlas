import type { Confidence } from '../model/edges.js';
import { entityNameOf, stripWrapperSuffix, type TypeOrigin } from '../origin.js';
import type { PackageJson } from './manifest.js';

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

/**
 * Where a table name was found. `configured`: at a call to a function the
 * configuration names under `adapters.db.tables` (P37).
 */
export type DbSource = 'type-arg' | 'receiver-prop' | 'sql-parse' | 'string-arg' | 'configured' | 'none';

export interface DbClassification {
  /**
   * Whether there is a node to draw, and nothing else.
   *
   * False when the call reaches a described package by a method that package
   * does not use to touch data, such as walking a cursor the query already
   * produced. Counting those beats emitting a second query that never happened.
   * False also when the only evidence that this was data access at all was the
   * receiver's name, which is not evidence.
   *
   * It says nothing about whether there is something to report: `unresolved`
   * answers that on its own, and the two used to be one decision. They are not
   * one decision. A call can be worth a row and not worth a node — that is what
   * the whole of R83 is about — and while the flag governed both, the only way
   * to keep a row was to mint a node beside it.
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
  /**
   * True when the type argument the entity name would come from is declared by
   * an installed package rather than by the repository being read.
   *
   * A type argument is the stored entity only when the repository declares it.
   * A video platform puts a base class of its own over the ORM's `Model` and
   * parameterises it with `AttributesOnly<…>`, a generic helper out of the ORM's
   * own typings, so walking to the first type argument named 1,898 of that
   * repository's 1,958 queries after a mapped type in `node_modules`: one table
   * node standing for a hundred real tables, and `impact AttributesOnly`
   * returning the whole server (R83).
   *
   * Supplied by the caller rather than worked out here, for the same reason
   * `nameHints` is: answering it needs the checker, and undefined means the
   * caller did not answer, which leaves the name alone.
   */
  entityFromPackage?: boolean;
  /**
   * True when the receiver's type was read off this repository's own source
   * rather than resolved by the checker.
   *
   * Supplied by the caller, for the same reason the two flags above are: reading
   * a type annotation and the import that binds its name is work on source files
   * and the core is not given any.
   *
   * It is here because it belongs in the confidence rather than in a footnote.
   * An annotation states what the author meant and nothing verified it, so an
   * answer resting on it is `heuristic` however cleanly it read: the table may be
   * a literal and the method may be on the descriptor's list, and the step nobody
   * checked is that the name in the annotation is the type it appears to be. A
   * reader filtering on `static` is filtering on the checker having agreed.
   */
  originFromSource?: boolean;
  /**
   * The package of this project's own that declares the receiver's type, when
   * that is not the package the call is written in.
   *
   * A workspace resolves its own packages through links, so the checker hands
   * back a declaration with no `node_modules` in its path and the origin reads
   * as local — which it is to the project and is not to the service. The
   * difference decides the advice: a type this service declares is a class to
   * name, and a type a sibling package declares is a wrapper, and naming the
   * package is what tells a reader where to look (R97).
   *
   * Supplied by the caller, for the reason the flags above are: answering it
   * means reading manifests, and the core is not given a file system.
   */
  workspacePackage?: string;
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
 * Names every object answers to, whoever wrote the object.
 *
 * Read off the language rather than listed, so the set cannot drift from what is
 * actually reachable and nobody has to remember the four spellings of
 * `__lookupGetter__`.
 *
 * It exists because a reader recognises a call by the package that declares the
 * receiver's type, and that test says yes to `client.toString()` as readily as
 * to `client.get(key)`. Recognising the receiver is the right test for whether a
 * call touches the library; it is not a test of whether the *method* belongs to
 * the library, and one of these names is on every value in every program whether
 * anything wrote it or not. A cache reader that did not ask minted a `cache_op`
 * labelled `other status` for `hasOwnProperty('status')` - a node with a label
 * no person wrote, which is the failure R122 found in the operations table and
 * R130 went looking for the rest of.
 */
const UNIVERSAL_METHODS: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(Object.prototype),
);

/** True for a method name the language gives every value. */
export const isUniversalMethod = (name: string): boolean => UNIVERSAL_METHODS.has(name);

/**
 * The operation a method performs, by exact name first and then by prefix.
 *
 * The longest matching prefix wins, so a specific rule overrides a general one
 * without depending on the order the keys were written in.
 *
 * Own keys only, which is not pedantry. A record written as an object literal
 * answers `toString` and `constructor` with the language's own, and those are
 * method names real code calls: `value.toString()` on a receiver a described
 * package declares was read as an operation whose name is a function, and a notification service
 * carried two query nodes labelled with the text of a native function because of
 * it. A lookup that can be asked about any word a program contains has to be
 * asked about that word only.
 */
export const operationOf = (descriptor: DbDescriptor, method: string): DbOp | null => {
  const exact = Object.hasOwn(descriptor.operations, method)
    ? descriptor.operations[method]
    : undefined;
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
 * Where the receiver's type was declared, which is what decides which advice
 * can be acted on.
 *
 * Five places and not two. The advice used to be chosen on whether the origin
 * resolved at all, so every type that did resolve was described as one this
 * repository declares — including a type declared by a package nobody here
 * controls, whose base class cannot be named in this project's configuration
 * because this project does not own the declaration. A list whose whole value
 * is that every row in it can be acted on cannot afford a row that cannot.
 */
type OriginPlace = 'unresolved' | 'local' | 'workspace' | 'package' | 'library';

const placeOf = (origin: TypeOrigin | null, workspacePackage?: string): OriginPlace => {
  if (origin === null) return 'unresolved';
  if (origin.isLocal) return workspacePackage === undefined ? 'local' : 'workspace';
  // Neither local nor from a package is the language's own declarations. A
  // receiver typed as a built-in collection can read as a store by name, and
  // there is nothing to describe when it does.
  return origin.package === null ? 'library' : 'package';
};

/** What a reader is told about the receiver whose name was the only evidence. */
interface ReceiverOrigin {
  receiver: string;
  typeName: string;
  package: string;
}

/**
 * The advice for each place, as a lookup rather than a chain of conditions, so
 * that a place with no advice of its own is a missing key here rather than a
 * silent fall-through into a sentence written about somewhere else.
 */
const RECEIVER_HINTS: Record<OriginPlace, (at: ReceiverOrigin) => string> = {
  unresolved: ({ receiver }) =>
    `The type of ${receiver} could not be resolved. Install the repository's dependencies, or name its base class under adapters.db.localBaseClasses.`,
  local: ({ receiver, typeName }) =>
    `${receiver} is typed as ${typeName}, declared in this repository. Name its base class under adapters.db.localBaseClasses if it is a data layer.`,
  workspace: ({ receiver, typeName, package: pkg }) =>
    `${receiver} is typed as ${typeName}, which the workspace package ${pkg} declares: a wrapper of this project's own, not a library anything describes. If ${pkg} is the data layer, name ${typeName} — or the class it extends — under adapters.db.localBaseClasses, so calls through it are read as data access.`,
  package: ({ receiver, typeName, package: pkg }) =>
    `${receiver} is typed as ${typeName}, which the ${pkg} package declares rather than this repository. Add a descriptor for ${pkg} if it is a data layer; there is no local base class to name for it.`,
  library: ({ receiver, typeName }) =>
    `${receiver} is typed as ${typeName}, which comes from the language's own library rather than from this repository or any package. There is nothing here to describe as a data layer; the name is the only reason it was read as one.`,
};

const receiverNameHint = (
  receiver: string,
  origin: TypeOrigin | null,
  workspacePackage?: string,
): string =>
  RECEIVER_HINTS[placeOf(origin, workspacePackage)]({
    receiver,
    typeName: origin?.typeName ?? '',
    package: workspacePackage ?? origin?.package ?? '',
  });

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
  /**
   * The name the receiver's first type argument carries, whoever declared it.
   *
   * Two questions are asked of it and they have different answers. Whether the
   * receiver is a parameterised data layer — asked below, of a package nobody has
   * described — is settled by there being a name at all. Whether that name is a
   * table is settled by this repository declaring it, which is why the two are
   * separate values here rather than one (R83).
   */
  const declared = origin === null ? null : entityNameOf(origin);
  const rawEntity = input.entityFromPackage === true ? null : declared;
  const entity = rawEntity === null ? null : stripWrapperSuffix(rawEntity);

  if (descriptor !== undefined) {
    const { table, tables, source } = tableFromOverride(input, entity);
    const op = source === 'sql-parse' ? (input.sqlOp ?? null) : operationOf(descriptor, method);
    const base: DbClassification = {
      emit: true,
      table,
      tables,
      op,
      confidence:
        table !== null && op !== null && input.originFromSource !== true ? 'static' : 'heuristic',
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
          hint: `The query names a table, but its text does not open with a verb that says whether it reads or writes (SELECT, WITH … SELECT, INSERT INTO, UPDATE, DELETE FROM or TRUNCATE, as the very first word): a leading comment hides the verb, and EXPLAIN is not one of them. Start the string with its verb, with any comment after it; a statement that neither reads nor writes, such as EXPLAIN, can be left as it is. The operation of a query read from its text comes from that verb, not from the ${descriptor.package} descriptor, so the descriptor needs no change.`,
        },
      };
    }
    return base;
  }

  // A data layer nobody has described, recognised by what declares its type and
  // by the type reading as a data layer — and by nothing else, because nothing
  // else here is readable.
  //
  // Asked of `declared` rather than of `entity`, so that a type argument this
  // repository does not declare still answers it. A receiver typed
  // `Model<AttributesOnly<Video>>` is as much a data layer as one typed
  // `Repo<Order>`; the difference between them is only which of the two names a
  // table, and reading this question off the table would have dropped a video platform's
  // 1,949 rows the moment the name stopped being one (R83).
  const hints = input.nameHints ?? {};
  const lastSegment = (input.receiverText ?? '').split('.').pop() ?? '';
  const looksLikeData =
    origin !== null &&
    ((hints.type?.test(origin.typeName) ?? false) || (hints.receiver?.test(lastSegment) ?? false));
  if (origin?.package != null && declared !== null && looksLikeData) {
    return {
      emit: true,
      // The type argument is not a table, and this row is the proof: a package
      // nobody has described is a package whose type parameters nobody here can
      // read. `Kysely<DB>` is a connection typed by the whole schema and the
      // table is a string argument, so taking the type argument gave a photo server two
      // table nodes — `DB` and `MapDB` — with 407 `queries` edges pointing at
      // them, beside these 407 rows saying the package was not understood. A
      // reader that has decided a value is unreadable does not then name a node
      // after it (R83).
      //
      // The query itself stays. Its receiver is typed by a package and carries a
      // type argument, which is more than a name, and a visit to the database
      // whose target could not be read is still a visit to the database. What it
      // loses is the identity anything joins on, which is the honest state: the
      // row below is what a reader acts on, and one descriptor turns all of them
      // into tables at once.
      table: null,
      tables: [],
      op: null,
      confidence: 'heuristic',
      package: origin.package,
      source: 'none',
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
      // A name is not evidence, so there is nothing here to draw.
      //
      // This branch has already established that nothing but the spelling of the
      // receiver suggested data: no descriptor, no package-declared type
      // carrying an entity, nothing the checker would vouch for. A photo server names
      // every adapter `Repository`, and 463 of the 1,153 `db_query` nodes this
      // minted there were the job queue, the event bus, the filesystem, ffmpeg
      // and child_process. On a scheduling app the only four nodes that named a table
      // named a component's state store, while the real queries named none (R83).
      //
      // A missing answer is a gap; a confident wrong one is a lie the rest of
      // the tool reasons from — `dead` called every real a photo server event orphaned
      // and `hotspots` ranked the event bus as a database. So the row stands
      // alone: it still says which receiver looked like data and what a reader
      // would have to write to make it certain, and naming the base class under
      // `adapters.db.localBaseClasses` is what turns the guess into a query.
      emit: false,
      table: null,
      tables: [],
      op: null,
      confidence: 'heuristic',
      package: origin?.package ?? null,
      source: 'none',
      unresolved: {
        reason: 'db-receiver-name-only',
        hint: receiverNameHint(receiver, origin, input.workspacePackage),
      },
    };
  }

  return null;
};
