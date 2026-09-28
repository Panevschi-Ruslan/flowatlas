import {
  applicationOfFile,
  classifyDbCall,
  declaredParameterType,
  isUniversalMethod,
  narrowUnionByLiteral,
  writtenBodyOutward,
  writtenKeysOf,
  makeConfigKeyId,
  makeExternalApiId,
  makeLeafId,
  makeTableId,
  operationOf,
  packageNameOf,
  resolveTypeOrigin,
  type DbDescriptor,
  type NamedFunction,
  type TypeOrigin,
  type BodyRead,
} from '@flowatlas/core';
import {
  definePass,
  enclosingMethod,
  evaluateExpression,
  forEachCall,
  parametersOf,
  scopesOf,
  type Holder,
  type NestExtractContext,
  type NestExtractorPass,
  type Scope,
} from '@flowatlas/extractor-nestjs';
import type {
  CallExpression,
  ClassDeclaration,
  MethodDeclaration,
  Node as TsNode,
  ParameterDeclaration,
  SourceFile,
} from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import {
  dataNameHints,
  dbAdapters,
  descriptorAliases,
  handedOverIn,
  handovers,
  schemaTables,
  tableReadings,
  type TableReading,
} from './descriptors/index.js';
import { locateTable } from './descriptors/table.js';
import { readConfig } from './leaves/config.js';
import { hostCallOf } from './leaves/fragment.js';
import { readSqlArgument, type SqlArgument } from './leaves/sql-argument.js';
import { handedOverOrigin } from './leaves/handover.js';
import { dataLayerOf } from './leaves/silence.js';
import { statedOrigin } from './leaves/stated.js';
import { analyzeUrl, routePathOf, type UrlInfo } from './leaves/url.js';
import {
  deref,
  forwardedFrom,
  isReadable,
  parameterBehind,
  settingReader,
  splitAtParameterIn,
  type SplitAddress,
} from './leaves/trace.js';
import { sqlOperation, sqlTables } from './sql.js';

/** Cache libraries, and what each of their methods does to a key. */
const CACHE_PACKAGES = ['ioredis', 'cache-manager', '@nestjs/cache-manager', 'redis'];

/**
 * A `Map` rather than an object literal, and so is every table below keyed by a
 * name read out of source text.
 *
 * `descriptor.operations[method]` was an object, and `value.toString()` on a
 * receiver of a described package found `Object.prototype.toString` - a
 * `db_query` node labelled `function toString() { [native code] }`, two of them
 * in novu's graph, a node minted from a value nobody wrote (R122). The house
 * style is object lookup for dispatch and it is the right one; the cost of it is
 * this single hazard, and a `Map` has no prototype chain to fall through. Every
 * word a program contains can be asked of these, so none of them may answer for
 * a word only the language put there (R130).
 */
const CACHE_OPS: ReadonlyMap<string, 'get' | 'set' | 'del' | 'other'> = new Map([
  ['get', 'get'],
  ['mget', 'get'],
  ['getdel', 'get'],
  ['hget', 'get'],
  ['hgetall', 'get'],
  ['exists', 'get'],
  ['ttl', 'get'],
  ['set', 'set'],
  ['mset', 'set'],
  ['setex', 'set'],
  ['psetex', 'set'],
  ['setnx', 'set'],
  ['hset', 'set'],
  ['expire', 'set'],
  ['wrap', 'set'],
  ['del', 'del'],
  ['unlink', 'del'],
  ['hdel', 'del'],
  ['reset', 'del'],
  ['flushall', 'del'],
]);

const HTTP_PACKAGES = ['axios', '@nestjs/axios'];

const HTTP_METHODS: ReadonlyMap<string, string> = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['head', 'HEAD'],
  ['options', 'OPTIONS'],
  ['request', 'ALL'],
  ['axios', 'ALL'],
  ['fetch', 'GET'],
]);

/** A local binding that holds the platform's fetch, alone or as a fallback. */
const isFetchAlias = (callee: TsNode): boolean => {
  const held = deref(callee);
  if (held === callee) return false;
  const isFetch = (node: TsNode): boolean => Node.isIdentifier(node) && node.getText() === 'fetch';
  if (isFetch(held)) return true;
  if (!Node.isBinaryExpression(held)) return false;
  const operator = held.getOperatorToken().getKind();
  if (operator !== SyntaxKind.QuestionQuestionToken && operator !== SyntaxKind.BarBarToken) return false;
  return isFetch(held.getRight()) || isFetch(held.getLeft());
};

/**
 * The address and options a `Request` was built with, when the call is handed one.
 *
 * `fetch(new Request(url, init))` is the same request as `fetch(url, init)`,
 * written one object further away.
 */
const requestParts = (argument: TsNode): { url: TsNode; init?: TsNode } | undefined => {
  const built = deref(argument);
  if (!Node.isNewExpression(built) || built.getExpression().getText() !== 'Request') return undefined;
  const [url, init] = built.getArguments();
  return url === undefined ? undefined : { url, ...(init === undefined ? {} : { init }) };
};

/** Whether a value is a function that answers with a `Response`, i.e. fetch. */
const returnsResponse = (node: TsNode): boolean =>
  node
    .getType()
    .getCallSignatures()
    .some((signature) => /^(Promise<Response>|Response)$/.test(signature.getReturnType().getText()));

/** Verbs a request can carry, for reading one out of an argument. */
const KNOWN_VERBS = new Set(HTTP_METHODS.values());


interface Site {
  file: string;
  line: number;
  column: number;
}

const siteOf = (ctx: NestExtractContext, node: TsNode, file: string): Site => {
  const { line, column } = node.getSourceFile().getLineAndColumnAtPos(node.getStart());
  return { file, line, column };
};

/**
 * The thing a leaf hangs off, and how to put it in the graph.
 *
 * A method and a module-level function hold a query the same way; the only
 * difference between them is which node has to exist before an edge can point
 * at it. Keeping that difference behind `ensure` is what lets every emitter
 * below be written once and read both.
 *
 * `ensure` runs when a leaf is actually recorded rather than when the body is
 * opened, because a repository is mostly functions that touch nothing and a
 * node for each of them is not what anybody asked the graph for.
 */
// `Holder` and `Scope` come from the extractor, which is where the walk that
// produces them lives. They were declared here first, and copied when the
// broker reader needed the same walk; one of the two copies had to go, and the
// one that stays is the one beside the walk.

/**
 * The leaves a chain of calls ends at.
 *
 * Every one of them is found the same way: resolve the type of whatever the call
 * was made on, and see which package declares it. That is the only signal that
 * separates reading data from any other method call, which is why a receiver
 * called `orderRepo` whose type is local proves nothing and a receiver called
 * `orderCache` whose type comes from a database package proves everything.
 */
export const extractLeaves = (ctx: NestExtractContext): void => {
  const localBaseClasses = ctx.config.adapters.db.localBaseClasses;
  const byPackage = new Map<string, DbDescriptor>();
  for (const adapter of ctx.adapters.db) byPackage.set(adapter.descriptor.package, adapter.descriptor);
  // A library the project reaches only through a package that hands it over is
  // readable without being detected: the knex a MikroORM manager returns is read
  // wherever a call is traced to it, and nothing is said about a project that
  // never makes one (R149).
  for (const library of handedOverIn(ctx.pkg)) {
    if (byPackage.has(library)) continue;
    const adapter = dbAdapters.find((candidate) => candidate.descriptor.package === library);
    if (adapter !== undefined) byPackage.set(library, adapter.descriptor);
  }

  const descriptorFor = (origin: TypeOrigin | null): DbDescriptor | undefined => {
    if (origin?.package == null) return undefined;
    if (origin.package.startsWith('local:')) return byPackage.get('local');
    // The package that declares the receiver's type is not always the package
    // the descriptor was written for; one library reached under two names is an
    // alias rather than a second description of it.
    const described = descriptorAliases.get(origin.package) ?? origin.package;
    return byPackage.get(described);
  };

  /**
   * The same descriptor with its table override dropped, prepared once.
   *
   * A library that keeps its table in an argument still sometimes carries the
   * entity in a type argument as well — an injected `Model<OrderDocument>` is
   * the ordinary way to hold a mongoose model — and an override that found
   * nothing must not be allowed to hide the answer the type system already had.
   * Handing the call a descriptor without the override is how it falls back,
   * and it keeps `meta.source` honest about where the name came from, which a
   * fallback stuffed into `stringArg` would not.
   */
  const withoutOverride = new Map<string, DbDescriptor>();
  for (const [name, descriptor] of byPackage) {
    // Only where the type argument is the stored thing. A connection
    // parameterised by the whole schema has nothing to fall back to, and
    // falling back put the name of a schema type on 407 of immich's nodes as
    // though it were a table.
    if (tableReadings.get(name)?.entityInTypeArgs !== true) continue;
    const { tableOverride: _dropped, ...rest } = descriptor;
    withoutOverride.set(name, rest);
  }

  const seenConfig = new Set<string>();

  /**
   * What reads as a data layer, and what was actually read through it.
   *
   * Finding nothing is an answer, and on a data layer it is the wrong one often
   * enough to be worth checking. The two are compared once the walk is over,
   * because a class is only unread after every call on it has been seen.
   */
  const dataLayers = new Map<
    string,
    { file: string; line: number; chain: readonly string[]; workspacePackage?: string }
  >();
  const readAsData = new Set<string>();

  /**
   * The leaves already recorded, which is also how many queries were found.
   *
   * Counting emissions rather than nodes is what made a chain count twice, so
   * the count is the set of nodes itself and cannot drift from it (R49).
   */
  const emitted = new Set<string>();

  /**
   * The package of this project's own that declares something, when it is not
   * this repository.
   *
   * The same line `repoFiles` draws — a file under `node_modules` is somebody
   * else's, a file outside this repository's directory is another repository's —
   * asked of a declaration rather than of a file being walked. A workspace
   * reaches its own packages through links, so a wrapper's declaration arrives
   * with no `node_modules` in its path and reads as local; this is what tells the
   * row it belongs to a sibling, and which one (R97).
   */
  const workspacePackageOf = (declaration: TsNode | undefined): string | undefined => {
    if (declaration === undefined) return undefined;
    const path = declaration.getSourceFile().getFilePath();
    if (path.startsWith(`${ctx.repoDir}/`) || path.includes('/node_modules/')) return undefined;
    return packageNameOf(path) ?? undefined;
  };

  // Answered once per class rather than once per call: a repository asks this
  // of the same few classes thousands of times, and every answer costs a walk
  // up the inheritance chain through the checker.
  const layerNames = new Map<TsNode, string | undefined>();

  /**
   * The class a reader would name in the configuration for this type.
   *
   * Registering it here rather than at the end is what keeps the check to the
   * classes this repository actually uses: a data layer nobody calls is not a
   * gap in what was read.
   */
  const dataLayerNameOf = (declaration: TsNode | undefined): string | undefined => {
    if (declaration === undefined || !Node.isClassDeclaration(declaration)) return undefined;
    const known = layerNames.get(declaration);
    if (known !== undefined || layerNames.has(declaration)) return known;

    const layer = dataLayerOf(declaration, (name) => dataNameHints.type.test(name));
    const name = layer?.base.getName();
    layerNames.set(declaration, name);
    if (layer === undefined || name === undefined) return undefined;
    if (!dataLayers.has(name)) {
      const source = layer.base.getSourceFile();
      const workspacePackage = workspacePackageOf(layer.base);
      dataLayers.set(name, {
        file: ctx.fileOf(layer.base),
        line: source.getLineAndColumnAtPos(layer.base.getStart()).line,
        chain: layer.chain,
        ...(workspacePackage === undefined ? {} : { workspacePackage }),
      });
    }
    return name;
  };

  const emitConfig = (node: TsNode, holder: Holder): void => {
    const { id: holderId, file } = holder;
    const read = readConfig(node);
    if (read === null) return;
    const site = siteOf(ctx, node, file);
    if (read.dynamic === true) {
      ctx.report({
        file,
        line: site.line,
        reason: 'dynamic-config-key',
        hint: 'The key is computed, so nothing can be recorded. Use a literal key.',
        symbol: node.getText().slice(0, 80),
      });
      return;
    }
    const id = makeConfigKeyId(ctx.repo, read.key);
    const marker = `${holderId} ${id}`;
    ctx.builder.addNode({
      id,
      type: 'config_key',
      label: read.key,
      repo: ctx.repo,
      file,
      line: site.line,
      meta: {
        key: read.key,
        source: read.source,
        ...(read.defaultValue === undefined ? {} : { defaultValue: read.defaultValue }),
      },
    });
    if (seenConfig.has(marker)) return;
    seenConfig.add(marker);
    holder.ensure();
    ctx.builder.addEdge({
      from: holderId,
      to: id,
      type: 'reads_config',
      // A platform binding is recognised by shape rather than by type, so it is
      // only ever a strong guess.
      confidence: read.source === 'binding' ? 'heuristic' : 'static',
      file,
      line: site.line,
    });
  };

  /**
   * Whether the type an entity name would be read from is declared by a package.
   *
   * The core states the rule — a type argument is the stored entity only when
   * this repository declares it — and this answers it, because answering needs
   * the checker and the core is not given one. A workspace package reached
   * through a link has no `node_modules` in the path of its own sources, so a
   * monorepo's shared entities still read as declarations of the project.
   *
   * Undefined where there is nothing to judge: no type argument, or one the
   * checker gives no declaration for. Undefined leaves the name alone, so this
   * only ever takes a name away, never invents one.
   */
  const entityFromPackage = (origin: TypeOrigin | null): boolean | undefined => {
    const [first] = origin?.typeArgs ?? [];
    if (first === undefined) return undefined;
    const declaration = (first.getSymbol() ?? first.getAliasSymbol())?.getDeclarations()[0];
    if (declaration === undefined) return undefined;
    return declaration.getSourceFile().getFilePath().includes('/node_modules/');
  };

  /**
   * Where a receiver's type comes from: the checker's answer, and the source's
   * own when the checker gave nothing a descriptor could be found for.
   *
   * One place, because both calls that classify a receiver ask the same question
   * and a second copy of the order they are asked in is a second answer waiting
   * to differ. The checker always wins where it answers: an installed repository
   * reads exactly as it did, and the fallback costs it nothing.
   *
   * `resolved` is handed back beside the answer because two different questions
   * are asked of an origin. Which library to read the call with is answered by
   * either of them; whether the receiver is a data layer of this repository -
   * the class a reader would name in the configuration - is a fact about what
   * the checker found here, and a stated origin is by definition a type this
   * repository does not declare.
   */
  const originOf = (
    receiver: TsNode,
  ): {
    origin: TypeOrigin | null;
    resolved: TypeOrigin | null;
    fromSource: boolean;
    statedIn?: SourceFile;
  } => {
    const resolved = resolveTypeOrigin(receiver, { localBaseClasses });
    if (descriptorFor(resolved) !== undefined) return { origin: resolved, resolved, fromSource: false };
    const stated = statedOrigin(receiver);
    // Only a library somebody has described. Where nobody has, nothing is known
    // about the receiver's methods either, so reading its type off the source
    // would change no answer and would only make a row say something new about
    // a call it still could not read.
    if (stated !== null && descriptorFor(stated) !== undefined) {
      return { origin: stated, resolved, fromSource: true, statedIn: stated.statedIn };
    }
    // The receiver was handed over by a call the descriptors record, which is
    // the step the checker would have taken had it had the types (R149).
    const handed = handedOverOrigin(receiver, handovers);
    if (handed !== null && descriptorFor(handed) !== undefined) {
      return { origin: handed, resolved, fromSource: true };
    }
    // A library whose calls name the table as a property of the client holds the
    // client one step further out: in `prisma.booking.findMany()` the receiver is
    // `prisma.booking`, a delegate whose type exists only in the generated client,
    // and what the source states a type for is `prisma`. Asked only where the
    // descriptor that answers says the table is that property, so no other
    // library's receiver is ever read from the value it was reached through
    // (R146).
    const client = Node.isPropertyAccessExpression(receiver) ? statedOrigin(receiver.getExpression()) : null;
    if (client !== null && descriptorFor(client)?.tableOverride?.kind === 'receiver-prop') {
      return { origin: client, resolved, fromSource: true, statedIn: client.statedIn };
    }
    return { origin: resolved, resolved, fromSource: false };
  };

  /**
   * The table a call names by a property of its receiver, as the library's
   * schema maps it.
   *
   * `prisma.user` is the delegate of `model User`, and the table is `users` when
   * the model says `@@map("users")`. The schema asked is the one governing the
   * file the client was stated in - the wrapper, where a schema sits beside the
   * client it generates - or, for a client the checker resolved, the file the
   * call is in. Where no schema is readable the call's own word stands.
   */
  const tableOfProperty = (
    descriptor: DbDescriptor | undefined,
    name: string,
    anchor: SourceFile,
  ): string => {
    if (descriptor === undefined) return name;
    return schemaTables.get(descriptor.package)?.(anchor, name) ?? name;
  };

  /** Whether a call is made on something the same library declares. */
  const madeOn = (call: CallExpression, pkg: string): boolean => {
    const callee = call.getExpression();
    const target = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
    return descriptorFor(originOf(target).origin)?.package === pkg;
  };

  /**
   * What a call that takes its statement as text is: a statement to read, a
   * fragment of some other query, or not such a call at all (undefined).
   *
   * Where the call sits decides first. Handed to a call of the same library -
   * `.where(knex.raw('…'))`, `.update({ at: knex.raw('now()') })` - it is part of
   * that call's query, which is read on its own chain, and counting it again
   * would report one visit to the database as two. That holds even when the
   * fragment is a whole sub-select: it runs inside the query that took it.
   *
   * Where the call sits cannot say what a value kept in a variable becomes, so
   * the text decides next. A text no verb opens - `lower(email)`, `"${alias}".id`
   * - is not a statement wherever it is kept, and a whole statement that names
   * no table - `SELECT 1` - touches nothing a reader could look for. Both are
   * counted, as a method that touches no data is.
   *
   * What is left is a statement. Its tables are read with the reader a driver's
   * query string is read with, and one whose text is computed gets the row that
   * reader writes for computed SQL.
   */
  const statementOf = (
    call: CallExpression,
    method: string,
    descriptor: DbDescriptor,
    reading: TableReading | undefined,
  ): 'fragment' | { sql: SqlArgument; descriptor: DbDescriptor } | undefined => {
    const index = reading?.statements?.get(method);
    if (index === undefined) return undefined;
    const host = hostCallOf(call);
    if (host !== undefined && madeOn(host, descriptor.package)) return 'fragment';
    const sql = readSqlArgument(call.getArguments()[index]);
    if (sql.text !== null && sqlOperation(sql.text) === null) return 'fragment';
    if (sql.complete && sql.text !== null && sqlTables(sql.text).length === 0) return 'fragment';
    return { sql, descriptor: { ...descriptor, tableOverride: { kind: 'sql-parse', argIndex: index } } };
  };

  const emitDb = (call: CallExpression, scope: Scope): boolean => {
    const { id: holderId, file, owner } = scope;
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return false;
    const receiver = callee.getExpression();
    const method = callee.getName();
    const { origin, resolved, fromSource, statedIn } = originOf(receiver);
    const descriptor = descriptorFor(origin);

    // A data layer is something a class depends on. A call on `this` is a class
    // reaching into itself, which says nothing about whether what it stores can
    // be seen from outside.
    const layer =
      resolved?.isLocal === true && !Node.isThisExpression(receiver)
        ? dataLayerNameOf(resolved.declaration)
        : undefined;

    // A repository base named in the configuration only applies to what extends it.
    if (descriptor?.package === 'local' && origin?.package?.startsWith('local:') !== true) {
      return false;
    }

    const reading = descriptor === undefined ? undefined : tableReadings.get(descriptor.package);

    // A method that takes its statement as text, when the library has one: the
    // call is read as a driver's query is, or not read as a query at all.
    const statement =
      descriptor === undefined ? undefined : statementOf(call, method, descriptor, reading);
    if (statement === 'fragment') {
      ctx.countExternalCall(`${origin?.package ?? descriptor?.package ?? 'unknown'}.${method}`);
      return true;
    }

    let parsedTables: string[] | undefined;
    let parsedOp: 'read' | 'write' | 'delete' | null | undefined;
    const sql =
      statement?.sql ??
      (descriptor?.tableOverride?.kind === 'sql-parse'
        ? readSqlArgument(call.getArguments()[descriptor.tableOverride.argIndex])
        : undefined);
    if (sql !== undefined) {
      // Only a whole statement is read. One whose tables are decided at run time
      // names none, and says so in the row the core writes for it.
      const whole = sql.complete ? sql.text : null;
      parsedTables = whole === null ? [] : sqlTables(whole);
      parsedOp = whole === null ? null : sqlOperation(whole);
    }

    // A library whose table is in an expression rather than in the types. The
    // locators say where to look; what comes back is either the name or the
    // fact that it was decided at run time, which is reported below rather than
    // guessed at. A statement names its tables in its text, and no locator is
    // asked.
    const located =
      reading === undefined || descriptor === undefined || statement !== undefined
        ? null
        : locateTable(call, reading.locators, {
            isOperation: (name) => operationOf(descriptor, name) !== null,
            ...(origin?.declaration === undefined ? {} : { typeDeclaration: origin.declaration }),
          });
    const effective =
      statement !== undefined
        ? statement.descriptor
        : reading === undefined || located !== null
          ? descriptor
          : (withoutOverride.get(descriptor?.package ?? '') ?? descriptor);

    const fromPackage = entityFromPackage(origin);
    const workspacePackage =
      origin?.isLocal === true ? workspacePackageOf(origin.declaration) : undefined;

    const classification = classifyDbCall({
      method,
      origin,
      ...(effective === undefined ? {} : { descriptor: effective }),
      receiverText: receiver.getText(),
      nameHints: dataNameHints,
      ...(fromSource ? { originFromSource: true } : {}),
      ...(fromPackage === undefined ? {} : { entityFromPackage: fromPackage }),
      ...(workspacePackage === undefined ? {} : { workspacePackage }),
      ...(parsedTables === undefined ? {} : { sqlTables: parsedTables }),
      ...(parsedOp === undefined ? {} : { sqlOp: parsedOp }),
      ...(Node.isPropertyAccessExpression(receiver)
        ? {
            receiverProp: tableOfProperty(
              descriptor,
              receiver.getName(),
              statedIn ?? call.getSourceFile(),
            ),
          }
        : {}),
      ...(located === null ? {} : { stringArg: located }),
    });
    if (classification === null) return false;
    const site = siteOf(ctx, call, file);

    /** The row a classification asked for, wherever in this function it asked. */
    const reportUnresolved = (unresolved: { reason: string; hint: string }): void => {
      ctx.report({
        file,
        line: site.line,
        reason: unresolved.reason,
        hint: unresolved.hint,
        symbol: `${receiver.getText().slice(0, 60)}.${method}`,
      });
    };

    // Nothing to draw, which is not the same as nothing to say. A method a
    // described package does not use to touch data is counted and forgotten; a
    // receiver that only looked like a data layer because of its name gets the
    // row it always got, and no longer has to mint a node to carry it (R83).
    if (!classification.emit) {
      if (classification.unresolved === undefined) {
        ctx.countExternalCall(`${classification.package ?? 'unknown'}.${method}`);
      } else reportUnresolved(classification.unresolved);
      return true;
    }

    const id = makeLeafId('db_query', ctx.repo, file, site.line, site.column);

    // One node per visit to the database, and one count per node.
    //
    // A leaf is identified by where it is written, and every link of a chain is
    // written at the same place: `knex.select('id').from('users').first()`
    // holds two recognised operations that both land on this id. That the node
    // is one is right — it is one visit to the database — but it used to be
    // emitted twice, and the internal count of queries, which is what decides
    // whether to report a data layer nobody could read, counted the chain twice
    // (R49).
    //
    // What the node records is the outermost link, which is the one the walk
    // reaches first: in every one of these builders the chain is lazy, so the
    // call at the end of it is the one that goes to the database and the links
    // before it only describe what it will ask for. `first` on a chain that
    // began with `select` is the query; the `select` is how it was built.
    if (emitted.has(id)) return true;
    emitted.add(id);

    if (layer !== undefined) readAsData.add(layer);
    // A repository class that queries a driver itself is read, even though the
    // call that reaches it was not the query. What the graph loses in that case
    // is nothing: the operation hangs off the repository's own method.
    const ownLayer = owner === undefined ? undefined : dataLayerNameOf(owner);
    if (ownLayer !== undefined) readAsData.add(ownLayer);
    // Only for a write: a read cannot lose what a sender believed it saved, and
    // collecting a type nobody will ask about is a type in everybody's registry.
    //
    // And only where the type argument is the thing being stored. A connection
    // parameterised by the whole schema would otherwise register the schema as
    // the shape of every row written through it, which is the same fabrication
    // as reading it as a table, hidden in another field.
    const entityArg =
      classification.op === 'write' && reading?.entityInTypeArgs !== false
        ? origin?.typeArgs[0]
        : undefined;
    const entityTypeId = entityArg === undefined ? undefined : ctx.types.collectType(entityArg, call);
    ctx.builder.addNode({
      id,
      type: 'db_query',
      label: `${classification.op ?? 'access'} ${classification.table ?? '?'}`,
      repo: ctx.repo,
      file,
      line: site.line,
      meta: {
        op: classification.op,
        table: classification.table,
        tables: classification.tables,
        package: classification.package,
        method,
        receiver: receiver.getText().slice(0, 80),
        source: classification.source,
        ...(classification.entityType === undefined
          ? {}
          : { entityType: classification.entityType }),
        // The document this call writes, recorded in the registry so that
        // whoever asks what a write stores can read its fields. Without it the
        // answer depended on the schema happening to be on a boundary for some
        // other reason, which is not a fact about the write at all (R30).
        //
        // Beside `entityType` rather than inside it, because `entityType` is
        // the declared name only when a wrapper suffix was stripped off it.
        // `Repository<OrderEntity>` and `Repository<Order>` are the same fact
        // about the same write, and recording the document for the first and
        // not the second is why a project that does not suffix its entities
        // was told `unknown` for every field a validation pipe strips (R48).
        ...(entityTypeId === undefined ? {} : { entityTypeId }),
      },
    });
    scope.ensure();
    ctx.builder.addEdge({
      from: holderId,
      to: id,
      type: 'calls',
      confidence: classification.confidence,
      file,
      line: site.line,
    });

    for (const table of classification.tables) {
      const tableId = makeTableId(ctx.repo, table);
      ctx.builder.addNode({ id: tableId, type: 'table', label: table, repo: ctx.repo });
      ctx.builder.addEdge({
        from: id,
        to: tableId,
        type: 'queries',
        confidence: classification.confidence,
        file,
        line: site.line,
      });
    }

    if (classification.unresolved !== undefined) reportUnresolved(classification.unresolved);

    // A query in the graph whose table is not. The query itself stays — losing
    // the whole call because one of its two facts could not be read is what a
    // tool that stays silent about what it did not understand does — and the row
    // says which fact is missing, so a reader can see the difference between a
    // table nothing touches and a table nothing could name.
    // Once per query, not once per link: the chain was settled above, so this
    // is reached by the one call the node was recorded for.
    //
    // Every such query and not only a builder's. A described library that keeps
    // its entity in a type argument loses the name too — when the argument is
    // the generic parameter of a data layer written generically, and now also
    // when it resolves to a declaration in `node_modules` rather than in this
    // repository (R83) — and said nothing at all about it. A node with no table
    // and no row is the one shape this pass must not produce, because it is
    // invisible to `doctor` and therefore to everybody. Guarded on there being
    // no row already, so the queries that carry their own reason keep it.
    if (classification.table === null && classification.unresolved === undefined) {
      ctx.report({
        file,
        line: site.line,
        reason: 'dynamic-table-name',
        hint: `The table ${receiver.getText().slice(0, 40)}.${method} touches is not a literal, a constant, or a schema declared in this repository, so it cannot be read. Name it directly, or annotate the call.`,
        symbol: `${receiver.getText().slice(0, 60)}.${method}`,
      });
    }
    return true;
  };

  const emitCache = (call: CallExpression, holder: Holder): boolean => {
    const { id: holderId, file } = holder;
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return false;
    const origin = resolveTypeOrigin(callee.getExpression());
    if (origin?.package == null || !CACHE_PACKAGES.includes(origin.package)) return false;

    const method = callee.getName();
    // The receiver says the call reaches the library; it does not say the method
    // does. `cache.hasOwnProperty('status')` was recorded as a cache operation on
    // the key `status`, because an unrecognised method is ordinary here - a client
    // declares hundreds of commands and `other` is the honest answer for the ones
    // no table names. A name the language gives every value is the one case where
    // it is not (R130).
    if (isUniversalMethod(method)) return false;
    const op = CACHE_OPS.get(method.toLowerCase()) ?? 'other';
    const [keyArg] = call.getArguments();
    const key = keyArg === undefined ? undefined : evaluateExpression(keyArg);

    let keyPattern: string | null = null;
    if (key?.resolved === true && typeof key.value === 'string') keyPattern = key.value;
    else if (keyArg !== undefined && Node.isTemplateExpression(keyArg)) {
      const head = keyArg.getHead().getLiteralText();
      keyPattern =
        head === ''
          ? null
          : head + keyArg.getTemplateSpans().map((span) => `*${span.getLiteral().getLiteralText()}`).join('');
    }

    const site = siteOf(ctx, call, file);
    const id = makeLeafId('cache_op', ctx.repo, file, site.line, site.column);
    ctx.builder.addNode({
      id,
      type: 'cache_op',
      label: `${op} ${keyPattern ?? '?'}`,
      repo: ctx.repo,
      file,
      line: site.line,
      meta: { op, keyPattern, package: origin.package, method },
    });
    holder.ensure();
    ctx.builder.addEdge({
      from: holderId,
      to: id,
      type: 'caches',
      confidence: keyPattern === null ? 'heuristic' : 'static',
      file,
      line: site.line,
    });
    if (keyPattern === null) {
      ctx.report({
        file,
        line: site.line,
        reason: 'dynamic-cache-key',
        hint: 'The key is built at run time. A literal prefix would make the pattern visible.',
        symbol: `${callee.getExpression().getText().slice(0, 60)}.${method}`,
      });
    }
    return true;
  };

  /**
   * Puts an address back together from its two halves.
   *
   * The client knew the base and the caller knew the path; neither knew the
   * whole address, and the request is only useful once they are joined.
   */
  const compose = (info: UrlInfo, split?: SplitAddress): UrlInfo => {
    if (split === undefined) return info;
    if (info.host !== null) return info;
    const path = info.path === null ? null : routePathOf(split.before + info.path + split.after);
    const env = split.baseUrlEnv ?? info.baseUrlEnv;
    return {
      url: path === null ? info.url : `${env === null ? '' : `\${${env}}`}${path}`,
      path,
      baseUrlEnv: env,
      host: null,
    };
  };

  /**
   * Where a request's verb comes from, when it is not written at the call.
   *
   * A client that takes the verb as an argument writes `fetch(url, { method })`
   * once for every verb it will ever send, so the verb is only real at the call
   * sites, exactly like the address.
   */
  interface VerbSource {
    parameter: ParameterDeclaration;
    /** Name of the method that takes it, so a caller can be recognised. */
    owner: string;
    index: number;
  }

  const verbParameterOf = (call: CallExpression): VerbSource | undefined => {
    const [, second] = call.getArguments();
    const optionsArg = second === undefined ? undefined : deref(second);
    if (optionsArg === undefined || !Node.isObjectLiteralExpression(optionsArg)) return undefined;
    const property = optionsArg.getProperty('method');
    if (property === undefined) return undefined;

    // `{ method }` names a binding in scope rather than pointing at one, so the
    // parameter is found by name on the method the shorthand sits in.
    const owningMethod = enclosingMethod(call);
    const parameter = Node.isPropertyAssignment(property)
      ? parameterBehind(property.getInitializer() ?? property)
      : Node.isShorthandPropertyAssignment(property) && owningMethod !== undefined
        ? parametersOf(owningMethod).find((item) => item.getName() === property.getName())
        : undefined;

    const owner = parameter === undefined ? undefined : enclosingMethod(parameter);
    if (parameter === undefined || owner === undefined) return undefined;
    const index = parametersOf(owner).findIndex((item) => item === parameter);
    return index < 0 ? undefined : { parameter, owner: owner.getName(), index };
  };

  /** The verb a caller supplies to a client that takes one. */
  const verbFromSite = (site: TsNode, source: VerbSource | undefined): string | undefined => {
    if (source === undefined || !Node.isCallExpression(site)) return undefined;
    const callee = site.getExpression();
    const called = Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
    if (called !== source.owner) return undefined;
    const argument = site.getArguments()[source.index];
    if (argument === undefined) return undefined;
    const value = evaluateExpression(argument);
    if (!value.resolved || typeof value.value !== 'string') return undefined;
    const verb = value.value.toUpperCase();
    return KNOWN_VERBS.has(verb) ? verb : undefined;
  };

  /** Whether a call reaches the network, and where its address sits. */
  const recogniseHttp = (call: CallExpression): { method: string; urlIndex: number } | null => {
    const callee = call.getExpression();

    if (Node.isIdentifier(callee) && callee.getText() === 'fetch') {
      return { method: 'GET', urlIndex: 0 };
    }
    // `const send = this.http ?? fetch; send(url)` — a transport a test can
    // swap, falling back to the platform's. The binding is still fetch, and
    // every call through it is a request.
    if (Node.isIdentifier(callee) && isFetchAlias(callee)) {
      return { method: 'GET', urlIndex: 0 };
    }
    if (Node.isPropertyAccessExpression(callee)) {
      const origin = resolveTypeOrigin(callee.getExpression());
      if (origin?.package == null || !HTTP_PACKAGES.includes(origin.package)) return null;
      const method = HTTP_METHODS.get(callee.getName().toLowerCase());
      return method === undefined ? null : { method, urlIndex: 0 };
    }
    // `this.getFetcher()(url, init)` — a client that picks its own transport at
    // run time still ends at something shaped exactly like fetch, and the type
    // says so even though the name no longer does.
    if (Node.isCallExpression(callee) && returnsResponse(callee)) {
      return { method: 'GET', urlIndex: 0 };
    }
    return null;
  };

  /** The verb a wrapper's own name gives away, for a request made through one. */
  const verbOfSite = (site: TsNode): string | undefined => {
    if (!Node.isCallExpression(site)) return undefined;
    const callee = site.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    return HTTP_METHODS.get(callee.getName().toLowerCase());
  };

  /** The method node a call sits inside, when it sits inside one this repo owns. */
  const ownerOf = (site: TsNode): Holder | undefined => {
    // However that method was written: the loop below reads a field-method's
    // body, so asking only for a declared one here would drop what it found.
    const declaration = enclosingMethod(site);
    if (declaration === undefined) return undefined;
    const methodId = ctx.methodIdOf(declaration);
    if (methodId === undefined || !ctx.builder.has(methodId)) return undefined;
    return {
      id: methodId,
      file: ctx.fileOf(declaration),
      ensure: () => {
        ctx.ensureMethodNode(declaration);
      },
    };
  };

  /**
   * Records one outgoing request.
   *
   * `site` is the call the request is attributed to, which is not always the
   * call that reaches the network: a request made inside a shared client belongs
   * to whoever asked for it, since that is where the address, the verb and the
   * response type are actually known.
   */
  const recordHttp = (
    site: CallExpression,
    urlArg: TsNode,
    method: string,
    owner: Holder,
    split?: SplitAddress,
    init?: TsNode,
  ): void => {
    const info = compose(analyzeUrl(urlArg), split);

    // A second argument can carry the method for a generic request.
    let verb = method;
    // True when the second argument turned out to be a request's settings
    // rather than its body — `fetch(url, { method, headers, body })`. Its keys
    // are not the keys of anything sent, and recording them as such would let
    // `method` and `headers` stand for what a call puts on the wire.
    let secondIsSettings = false;
    if (verb === 'GET') {
      const optionsArg = init === undefined ? site.getArguments()[1] : deref(init);
      if (optionsArg !== undefined && Node.isObjectLiteralExpression(optionsArg)) {
        const property = optionsArg.getProperty('method');
        if (property !== undefined && Node.isPropertyAssignment(property)) {
          const initializer = property.getInitializer();
          const value = initializer === undefined ? undefined : evaluateExpression(initializer);
          if (value?.resolved === true && typeof value.value === 'string') {
            verb = value.value.toUpperCase();
            secondIsSettings = init === undefined;
          }
        }
      }
    }

    const [typeArgument] = site.getTypeArguments();
    const responseType =
      typeArgument === undefined ? null : ctx.types.collectType(typeArgument.getType(), site);
    const bodyArgument = init === undefined ? site.getArguments()[1] : undefined;
    const declaredBodyWide = declaredParameterType(site, 1, ctx.checker);
    const declaredBody =
      declaredBodyWide !== undefined && bodyArgument !== undefined
        ? narrowUnionByLiteral(declaredBodyWide, bodyArgument)
        : declaredBodyWide;
    // A declared type says what a call is permitted to send; the keys of an
    // object written in the source say what it does send, and reporting the
    // permission as the act named keys no call there writes (R34). The type
    // stays the declared one — it is the better answer for what each field is —
    // and the keys are recorded beside it.
    const carries = verb === 'POST' || verb === 'PUT' || verb === 'PATCH';
    const writtenBody = carries && !secondIsSettings ? writtenBodyOutward(bodyArgument) : [];
    const bodyKeys = writtenKeysOf(writtenBody);
    const bodyFrom: BodyRead =
      bodyKeys !== undefined
        ? writtenBody.length === 1
          ? 'literal'
          : 'literals'
        : declaredBody !== undefined
          ? 'type'
          : 'value';
    const bodyType = !carries
      ? null
      : declaredBody !== undefined
        ? ctx.types.collectType(declaredBody, site)
        : bodyArgument === undefined
          ? null
          : ctx.types.collectType(bodyArgument.getType(), bodyArgument);

    const place = siteOf(ctx, site, owner.file);
    const id = makeLeafId('http_out', ctx.repo, owner.file, place.line, place.column);
    // Which application this request is written in, asked of the file through
    // the one function every browser reader asks too, so the two halves' readings
    // of one call cannot disagree about it (R136). A map keyed by declaration
    // answers nothing, and the request then carries nothing, as it did.
    const application = applicationOfFile(ctx.meta, owner.file);
    ctx.builder.addNode({
      id,
      type: 'http_out',
      label: `${verb} ${info.path ?? info.url ?? '?'}`,
      repo: ctx.repo,
      file: owner.file,
      line: place.line,
      meta: {
        method: verb,
        url: info.url,
        path: info.path,
        baseUrlEnv: info.baseUrlEnv,
        responseType,
        bodyType,
        ...(bodyType === null ? {} : { bodyFrom }),
        ...(bodyKeys === undefined ? {} : { bodyKeys }),
        ...(info.host === null ? {} : { host: info.host }),
        ...(application === undefined ? {} : { application }),
      },
    });
    owner.ensure();
    ctx.builder.addEdge({
      from: owner.id,
      to: id,
      type: 'calls',
      confidence: info.path === null ? 'heuristic' : 'static',
      file: owner.file,
      line: place.line,
    });

    if (info.host !== null) {
      const apiId = makeExternalApiId(info.host);
      ctx.builder.addNode({
        id: apiId,
        type: 'external_api',
        label: info.host,
        repo: ctx.repo,
        meta: { host: info.host },
      });
      ctx.builder.addEdge({
        from: id,
        to: apiId,
        type: 'calls',
        confidence: 'static',
        file: owner.file,
        line: place.line,
      });
    }

    if (info.path === null) {
      ctx.report({
        file: owner.file,
        line: place.line,
        reason: 'dynamic-http-url',
        hint: 'The address is built at run time. Annotate the call with the service and route it reaches.',
        symbol: site.getText().slice(0, 80),
      });
    }
  };

  const emitHttp = (call: CallExpression, holder: Holder): boolean => {
    const recognised = recogniseHttp(call);
    if (recognised === null) return false;
    const written = call.getArguments()[recognised.urlIndex];
    if (written === undefined) return false;
    const request = recognised.urlIndex === 0 ? requestParts(written) : undefined;
    const urlArg = request?.url ?? written;

    // The address is not always written where the request is made. A shared
    // client knows the base and takes the path as a parameter, so the request
    // belongs to whoever asked for it; recording it here instead would leave
    // one dead end standing in for every caller.
    const split = isReadable(urlArg) ? undefined : splitAtParameterIn(urlArg, settingReader);
    if (split !== undefined) {
      const verbSource = verbParameterOf(call);
      let recorded = 0;
      for (const hop of forwardedFrom(split.parameter)) {
        const owner = ownerOf(hop.site);
        if (owner === undefined || !Node.isCallExpression(hop.site)) continue;
        const verb =
          verbOfSite(hop.site) ?? verbFromSite(hop.site, verbSource) ?? recognised.method;
        recordHttp(hop.site, hop.argument, verb, owner, split);
        recorded += 1;
      }
      if (recorded > 0) return true;
    }

    recordHttp(call, urlArg, recognised.method, holder, undefined, request?.init);
    return true;
  };

  /**
   * Every body whose calls are read, and the node each one's leaves hang off.
   *
   * Classes first, and then the functions, so that a graph reads in the order
   * it always has.
   *
   * The functions are the point. This walk used to be the methods of the
   * indexed classes and nothing else, so a query written in a module-level
   * function — the shape most TypeScript that is not Nest is written in —
   * produced no node at all: not an unresolved row, not a dynamic-table
   * report, nothing (R52). Two fixtures were bent around that limit and a real
   * drizzle repository read as a project with no data layer, because its data
   * layer is a module of exported functions.
   *
   * Three sources, because there are three ways a body of this repository can
   * be written: a method, a function declared at the top of a module (which
   * covers `function list()` and `const list = () => …` alike), and a function
   * written in place where an entry point was registered, which the entries
   * pass has already named. A function declared inside one of those is not a
   * fourth: the walk of a body reads what is nested in it.
   *
   * Unreached is not the same as unwritten, which is why a body is read whether
   * or not anything calls it. A method holding a query is already read that
   * way — the class index holds every class in the repository — and a function
   * that no entry point reaches still says what it does to the database.
   */
  /** The files of this repository, which is what both walks below read. */
  const repoFiles = function* (): Generator<SourceFile> {
    for (const source of ctx.project.getSourceFiles()) {
      const path = source.getFilePath();
      // A file of an installed package, or of another repository read into the
      // same project, is not this repository's to answer for.
      if (path.includes('/node_modules/') || !path.startsWith(`${ctx.repoDir}/`)) continue;
      yield source;
    }
  };


  /**
   * A query written where there is no body to hang it off.
   *
   * Everything a body can be is walked above, which leaves the statements of a
   * module itself: `const rows = await db.select().from(orders)` at the top
   * level of a file runs once at import and belongs to no function anybody can
   * name. There is nothing to attach a leaf to, so the answer is a row saying
   * the query is there and why it is not in the graph — which is the whole
   * difference between this and what the reader used to do with a function,
   * which was to say nothing at all (R52).
   *
   * Recognised by the descriptor alone rather than by the full classification:
   * what is being reported is that a call was skipped, and the package and the
   * method name settle that much without reading the table out of it.
   */
  const reportModuleLevel = (source: SourceFile, file: string): void => {
    // A body of its own, read as a scope above. `forEachDescendant` never
    // visits the node it was called on, so a statement that is itself a
    // function has to be turned away here rather than in the walk below.
    const isBody = (node: TsNode): boolean =>
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isClassDeclaration(node) ||
      Node.isClassExpression(node);

    for (const statement of source.getStatements()) {
      if (isBody(statement)) continue;
      statement.forEachDescendant((node, traversal) => {
        if (isBody(node)) {
          traversal.skip();
          return;
        }
        if (!Node.isCallExpression(node)) return;
        const callee = node.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;
        const { origin } = originOf(callee.getExpression());
        const descriptor = descriptorFor(origin);
        if (descriptor === undefined || operationOf(descriptor, callee.getName()) === null) return;
        const site = siteOf(ctx, node, file);
        ctx.report({
          file,
          line: site.line,
          reason: 'db-call-at-module-level',
          hint: 'The query runs when the module is imported, so there is no function or method to record it under. Move it into one to make it visible.',
          symbol: `${callee.getExpression().getText().slice(0, 60)}.${callee.getName()}`,
        });
      });
    }
  };

  for (const source of repoFiles()) reportModuleLevel(source, ctx.fileOf(source));

  for (const scope of scopesOf(ctx)) {
    forEachCall(scope.body, (call) => {
      const expression = call as unknown as CallExpression;
      if (emitDb(expression, scope)) return;
      if (emitCache(expression, scope)) return;
      emitHttp(expression, scope);
    });

    scope.body.forEachDescendant((node, traversal) => {
      if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
        traversal.skip();
        return;
      }
      if (
        Node.isCallExpression(node) ||
        Node.isPropertyAccessExpression(node) ||
        Node.isElementAccessExpression(node)
      ) {
        emitConfig(node, scope);
      }
    });
  }

  // Silence is an answer, and on a data layer it is usually the wrong one. A
  // repository whose store nothing recognises answers every question with half
  // a map and says nothing about the half that is missing, which is the one
  // failure this tool must not have.
  for (const [name, seen] of dataLayers) {
    if (readAsData.has(name)) continue;
    const named = seen.chain.some((link) => localBaseClasses.includes(link));
    ctx.report({
      file: seen.file,
      line: seen.line,
      reason: 'db-layer-unread',
      message:
        seen.workspacePackage === undefined
          ? `${name} reads as a data layer, and nothing was read through it.`
          : `${name}, which the workspace package ${seen.workspacePackage} declares, reads as a data layer, and nothing was read through it.`,
      hint: named
        ? `${name} is already named under adapters.db.localBaseClasses, so the methods called on it are not among the operations of the local-base descriptor.`
        : `Add ${JSON.stringify(name)} to adapters.db.localBaseClasses in flowatlas.config.json, so calls through it are recorded as data access.`,
      symbol: name,
      adapter: 'local-base',
    });
  }

  // A database this repository is known to use, and not one query anywhere.
  // Nothing here is named like a data layer either, so this is the one case
  // that rests on the manifest rather than on what the code is called.
  const declaredDb = ctx.adapters.db.filter((adapter) => adapter.descriptor.package !== 'local');
  if (emitted.size === 0 && dataLayers.size === 0 && declaredDb.length > 0) {
    const names = declaredDb.map((adapter) => adapter.name).join(', ');
    ctx.report({
      file: 'package.json',
      line: 1,
      reason: 'db-package-unread',
      message: `The ${names} adapter applies to this repository and found no data operation in it.`,
      hint: 'If the data layer is a class of this repository, add its base class to adapters.db.localBaseClasses in flowatlas.config.json; if it is another library, add a descriptor for it in adapters-db.',
      symbol: names,
    });
  }
};

export const leavesPass: NestExtractorPass = definePass('leaves', extractLeaves);
