import { relative, sep } from 'node:path';
import {
  addressOnly,
  applicationOfFile,
  classMembersOf,
  localBaseClassNames,
  localBaseTableProperty,
  classifyDbCall,
  declaredParameterType,
  forwardNoWorse,
  isUniversalMethod,
  verbAlong,
  verbParameterOf,
  verbsAtCallers,
  narrowUnionByLiteral,
  writtenBodyOutward,
  writtenKeysOf,
  makeConfigKeyId,
  makeExternalApiId,
  makeLeafId,
  makeTableId,
  DECLARED_CONFIDENCE,
  operationOf,
  packageNameOf,
  resolveTypeOrigin,
  causeMeta,
  whyUntyped,
  type DbDescriptor,
  type NamedFunction,
  type TypeOrigin,
  type BodyRead,
  lineAndColumnAt,
  declarationOf,
  locatedExpressions,
  type GraphEdge,
  type GraphNode,
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
  Type,
} from 'ts-morph';
import { Node, SyntaxKind, VariableDeclarationKind } from 'ts-morph';
import {
  dataNameHints,
  dbAdapters,
  descriptorAliases,
  entityNamings,
  handedOverIn,
  clientCallbacks,
  handovers,
  schemaTables,
  statementMethods,
  tableReadings,
  type EntityNaming,
  type TableReading,
} from './descriptors/index.js';
import { entityTableName, locateTable, locateTableAt, statedEntityTable } from './descriptors/table.js';
import { readConfig } from './leaves/config.js';
import { loadedSettings, type LoadedSetting } from './leaves/config-load.js';
import { configuredAccessOf, repositoryExports } from './leaves/configured.js';
import { hostCallOf } from './leaves/fragment.js';
import { namesNoTable, readSqlArgument, type SqlArgument } from './leaves/sql-argument.js';
import { handedBackBy } from './leaves/handed-back.js';
import { handedOverOrigin, unconfirmedHandover } from './leaves/handover.js';
import { dataLayerOf } from './leaves/silence.js';
import { statedOrigin } from './leaves/stated.js';
import { analyzeUrl, composeAddress, surenessOf, type UrlInfo } from './leaves/url.js';
import {
  deref,
  forwardedFrom,
  isReadable,
  parameterBehind,
  settingReader,
  splitAtParameterIn,
} from './leaves/trace.js';
import { sqlOperation, sqlTables } from './sql.js';
import { perItemMetaOf } from './descriptors/per-item.js';

/** Cache libraries, and what each of their methods does to a key. */
const CACHE_PACKAGES = ['ioredis', 'cache-manager', '@nestjs/cache-manager', 'redis'];

/**
 * A `Map` rather than an object literal, and so is every table below keyed by a
 * name read out of source text.
 *
 * `descriptor.operations[method]` was an object, and `value.toString()` on a
 * receiver of a described package found `Object.prototype.toString` - a
 * `db_query` node labelled `function toString() { [native code] }`, two of them
 * in a notification service's graph, a node minted from a value nobody wrote (R122). The house
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
 * The verb a request's settings object writes outright, `{ method: 'PUT' }`.
 *
 * `settled` asks for a verb nothing can replace. `{ method: 'GET', ...init }`
 * writes a default the spread overrides, which is how a shared client sends
 * whatever its callers ask for, so it states no verb of its own.
 */
const verbInSettings = (settings: TsNode | undefined, settled = false): string | undefined => {
  if (settings === undefined || !Node.isObjectLiteralExpression(settings)) return undefined;
  const property = settings.getProperty('method');
  if (property === undefined || !Node.isPropertyAssignment(property)) return undefined;
  if (settled) {
    const written = settings.getProperties();
    const spreadAfter = written
      .slice(written.indexOf(property) + 1)
      .some((item) => Node.isSpreadAssignment(item));
    if (spreadAfter) return undefined;
  }
  const initializer = property.getInitializer();
  const value = initializer === undefined ? undefined : evaluateExpression(initializer);
  return value?.resolved === true && typeof value.value === 'string'
    ? value.value.toUpperCase()
    : undefined;
};

/** How one request is recorded, beyond where and by whom. */
interface RecordOptions {
  /** The settings of a `new Request(url, init)` the call was handed. */
  init?: TsNode;
  /**
   * The binding the request goes through (P91). Its host names nothing - the
   * deployment decides which worker answers - so only its path is kept.
   */
  binding?: { binding: string; typed: boolean };
  /**
   * Whether the site's second argument belongs to this request, as its
   * settings or its body. It does not when the site is a caller credited with a
   * request whose own settings were already read.
   */
  readsSite?: boolean;
}

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



interface Site {
  file: string;
  line: number;
  column: number;
}

const siteOf = (ctx: NestExtractContext, node: TsNode, file: string): Site => {
  const { line, column } = lineAndColumnAt(node.getSourceFile(), node.getStart());
  return { file, line, column };
};

/**
 * Whether a call the data reader would list is already explained by an edge
 * (P88 D3).
 *
 * `this.loansRepository.findOpen()` reads as data by the receiver's name alone,
 * and the graph has already drawn it as a `static` call into
 * `LoansRepository.findOpen`, a method of this repository whose queries are
 * read where they are written. That edge is a stronger fact than the name, so
 * the row saying "this looks like data" is not written beside it; it is counted
 * instead (`receiversExplainedByEdge`). A `heuristic` edge is not enough, and
 * neither is an edge into another repository's code or into a function.
 *
 * Made from the edges once, when the first such row asks: the calls pass has
 * drawn every edge into a method by then, and the leaves pass draws none.
 */
export const explainedByEdge = (
  edges: readonly GraphEdge[],
  nodeOf: (id: string) => GraphNode | undefined,
  repo: string,
): ((holder: string, file: string, line: number, method: string) => boolean) => {
  const key = (holder: string, file: string, line: number, method: string): string =>
    `${holder}\u0000${file}\u0000${String(line)}\u0000${method}`;
  const drawn = new Set<string>();
  for (const edge of edges) {
    if (edge.type !== 'calls' || edge.confidence !== 'static') continue;
    if (edge.file === undefined || edge.line === undefined) continue;
    const target = nodeOf(edge.to);
    if (target?.type !== 'method' || target.repo !== repo) continue;
    drawn.add(key(edge.from, edge.file, edge.line, target.label.slice(target.label.lastIndexOf('.') + 1)));
  }
  return (holder, file, line, method) => drawn.has(key(holder, file, line, method));
};

/** The property of `this` an argument reads, `this.collectionName`, when it is one. */
const thisPropertyOf = (argument: TsNode): string | undefined => {
  let current = argument;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return Node.isPropertyAccessExpression(current) && Node.isThisExpression(current.getExpression())
    ? current.getName()
    : undefined;
};

/** The class a node is written in, and each class it extends, nearest first. */
const classChainOf = (declaration: ClassDeclaration | undefined): ClassDeclaration[] => {
  const chain: ClassDeclaration[] = [];
  let current = declaration;
  while (current !== undefined && chain.length < 8) {
    chain.push(current);
    current = current.getBaseClass();
  }
  return chain;
};

/** The class nearest a declaration that writes a value for a property, and whether it may change. */
const fieldSetterOf = (
  declaration: TsNode | undefined,
  key: string,
): { owner: string; readonly: boolean } | undefined => {
  if (declaration === undefined || !Node.isClassDeclaration(declaration)) return undefined;
  for (const owner of classChainOf(declaration)) {
    const property = classMembersOf(owner).property(key);
    if (property?.getInitializer() === undefined) continue;
    return { owner: owner.getName() ?? key, readonly: property.isReadonly() };
  }
  return undefined;
};

/** The nearest function a node is written in. */
const functionAround = (node: TsNode): TsNode | undefined =>
  node.getFirstAncestor(
    (ancestor) =>
      Node.isMethodDeclaration(ancestor) ||
      Node.isGetAccessorDeclaration(ancestor) ||
      Node.isFunctionDeclaration(ancestor) ||
      Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isConstructorDeclaration(ancestor),
  );

/**
 * How a table name was reached, when it was not written in the call's own
 * chain (P88): through the field a class sets for its base (`inferred-property`
 * when the base was read without configuration), or through a helper of the
 * class the chain stepped into (`helper`). `changeable` when the field is not
 * `readonly`, so another assignment could change it (I4).
 */
interface TableReach {
  from?: 'inferred-property' | 'helper';
  changeable: boolean;
}

const reachOf = (call: CallExpression, expression: TsNode, keyInferred: boolean | undefined): TableReach => {
  const parent = expression.getParent();
  if (parent !== undefined && Node.isPropertyDeclaration(parent) && parent.getInitializer() === expression) {
    return { ...(keyInferred === true ? { from: 'inferred-property' as const } : {}), changeable: !parent.isReadonly() };
  }
  // In a method or getter the call is not itself written in: a helper the
  // chain stepped into. A `const` in an outer function the call closes over is
  // still the call's own body.
  const holder = functionAround(expression);
  const helper =
    holder !== undefined &&
    (Node.isMethodDeclaration(holder) || Node.isGetAccessorDeclaration(holder)) &&
    !call.getAncestors().includes(holder);
  return { ...(helper ? { from: 'helper' as const } : {}), changeable: false };
};

/** The entity class a manager's call names in its arguments, by the library's locators (P88). */
const entityClassAt = (call: CallExpression, naming: EntityNaming): ClassDeclaration | undefined => {
  for (const expression of locatedExpressions(call, naming.locators)) {
    const declaration = Node.isIdentifier(expression) ? declarationOf(expression) : undefined;
    if (declaration === undefined || !Node.isClassDeclaration(declaration)) continue;
    if (declaration.getSourceFile().getFilePath().includes('/node_modules/')) continue;
    return declaration;
  }
  return undefined;
};

/** The table an entity type argument's own class states, when it states one (P88 D1). */
const statedTableOfType = (type: Type | undefined, naming: EntityNaming): string | undefined => {
  const declaration = (type?.getSymbol() ?? type?.getAliasSymbol())?.getDeclarations()[0];
  if (declaration === undefined || !Node.isClassDeclaration(declaration)) return undefined;
  if (declaration.getSourceFile().getFilePath().includes('/node_modules/')) return undefined;
  return statedEntityTable(declaration, naming) ?? undefined;
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
  const exported = repositoryExports();
  const configuredBases = ctx.config.adapters.db.localBaseClasses;
  const localBaseClasses = localBaseClassNames(configuredBases);
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

  /**
   * Classes some class of this repository extends, by name, read the first
   * time it is asked. A base whose classes state their table is shared, and
   * only an abstract or a shared class is read as one (P88).
   */
  let extendedNames: Set<string> | undefined;
  const isExtended = (name: string): boolean => {
    if (extendedNames === undefined) {
      extendedNames = new Set();
      for (const source of repoFiles()) {
        for (const declaration of source.getClasses()) {
          const written = declaration.getExtends()?.getExpression().getText();
          if (written !== undefined) extendedNames.add(written.split('.').pop() ?? written);
        }
      }
    }
    return extendedNames.has(name);
  };

  /**
   * Whether `this.<key>` handed to a call is that library's own table
   * argument: the argument a described library's locators read the table
   * from, in a call whose result is that library's (P88 D2). A wrapper of the
   * project's own counts when it hands back the library's collection, as
   * `this.mongo.collection(name)` does.
   */
  const isTableArgument = (call: CallExpression, index: number): boolean => {
    const descriptor = descriptorFor(resolveTypeOrigin(call));
    const reading = descriptor === undefined ? undefined : tableReadings.get(descriptor.package);
    if (descriptor === undefined || reading === undefined) return false;
    const callee = call.getExpression();
    const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : undefined;
    const isOperation = name !== undefined && operationOf(descriptor, name) !== null;
    const inChain = reading.locators.some((locator) => locator.kind === 'chain-call' && locator.method === name);
    return reading.locators.some(
      (locator) =>
        (locator.kind === 'chain-call' && locator.method === name && locator.index === index) ||
        (locator.kind === 'argument' && locator.index === index && isOperation) ||
        (locator.kind === 'chain-root-argument' && locator.index === index && !isOperation && !inChain),
    );
  };

  /**
   * The property a class's own queries name their table by, when they hand
   * `this.<key>` to the library's table argument: `db.collection(this.collectionName)`
   * says, without configuration, what `{ "tableProperty": "collectionName" }`
   * says by hand (P88). Only a field the class or a base declares, and only one:
   * a class whose queries name two fields has no one property to read.
   */
  const inferredKeys = new Map<ClassDeclaration, string | null>();
  const inferredTableProperty = (declaration: ClassDeclaration): string | undefined => {
    const known = inferredKeys.get(declaration);
    if (known !== undefined) return known ?? undefined;
    const keys = new Set<string>();
    const declares = (key: string): boolean =>
      classChainOf(declaration).some((owner) => classMembersOf(owner).property(key) !== undefined);
    declaration.forEachDescendant((node, traversal) => {
      if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
        traversal.skip();
        return;
      }
      if (!Node.isCallExpression(node)) return;
      node.getArguments().forEach((argument, index) => {
        const key = thisPropertyOf(argument);
        if (key !== undefined && declares(key) && isTableArgument(node, index)) keys.add(key);
      });
    });
    const [only] = keys;
    const key = keys.size === 1 ? only : undefined;
    inferredKeys.set(declaration, key ?? null);
    return key;
  };

  /**
   * Where the classes under a base name their table: the configured
   * `tableProperty` first, which wins wherever it is written, and else the
   * property the base's own queries read, for a base that is abstract or that
   * something extends. Nearest class first (P88).
   */
  const tableKeyAbove = (
    holder: ClassDeclaration | undefined,
  ): { key: string; base: string; inferred: boolean } | undefined => {
    for (const current of classChainOf(holder)) {
      const name = current.getName();
      if (name === undefined) continue;
      const configured = localBaseTableProperty(configuredBases, name);
      if (configured !== undefined) return { key: configured, base: name, inferred: false };
      if (!current.isAbstract() && !isExtended(name)) continue;
      const inferred = inferredTableProperty(current);
      if (inferred !== undefined) return { key: inferred, base: name, inferred: true };
    }
    return undefined;
  };

  /** The property a base the origin names says its table in, configured or inferred. */
  const baseKeyOf = (origin: TypeOrigin | null): { key: string; inferred: boolean } | undefined => {
    const base = origin?.package?.startsWith('local:') === true ? origin.package.slice(6) : undefined;
    if (base === undefined) return undefined;
    const configured = localBaseTableProperty(configuredBases, base);
    if (configured !== undefined) return { key: configured, inferred: false };
    const declaration = origin?.declaration;
    const holder = declaration !== undefined && Node.isClassDeclaration(declaration) ? declaration : undefined;
    const found = classChainOf(holder).find((current) => current.getName() === base);
    const inferred = found === undefined ? undefined : inferredTableProperty(found);
    return inferred === undefined ? undefined : { key: inferred, inferred: true };
  };

  /**
   * What a receiver's type is, with the bases read without configuration among
   * the configured ones: a class under a base whose queries name their table by
   * a field is read as the configured base's classes are (P88).
   */
  const resolveOrigin = (node: TsNode): TypeOrigin | null => {
    const found = resolveTypeOrigin(node, { localBaseClasses });
    const declaration = found?.declaration;
    if (found === null || !found.isLocal || found.package !== null) return found;
    if (declaration === undefined || !Node.isClassDeclaration(declaration)) return found;
    const base = tableKeyAbove(declaration);
    if (base === undefined || !base.inferred) return found;
    return resolveTypeOrigin(node, { localBaseClasses: [...localBaseClasses, base.base] });
  };

  /**
   * What to say about a query whose table was not read.
   *
   * Through a repository base the configuration names, the table is the one the
   * receiver's class states, and the only thing missing is which property says
   * it; naming the call directly is not advice anybody could take there. Where
   * the property is known and the receiver's class sets it to something that
   * cannot be read, that class is the one to name (P88).
   */
  const unreadTableHint = (
    receiver: string,
    method: string,
    origin: TypeOrigin | null,
    call: TsNode,
  ): string => {
    const throughOrigin =
      origin?.package?.startsWith('local:') === true ? origin.package.slice(6) : undefined;
    const base = throughOrigin ?? unnamedBaseAround(call);
    const key = throughOrigin === undefined ? undefined : baseKeyOf(origin);
    if (base !== undefined && key === undefined) {
      return `${receiver}.${method} goes through ${base}, whose classes name their table somewhere the configuration has not said. Write the base as { "name": "${base}", "tableProperty": "<property>" } under adapters.db.localBaseClasses, naming the property each class sets to its table.`;
    }
    const setter = key === undefined ? undefined : fieldSetterOf(origin?.declaration, key.key);
    if (base !== undefined && key !== undefined && setter !== undefined) {
      return `${setter.owner} sets ${key.key}, the property ${base} names its table by, to a value that is not a literal or a constant, so the table ${receiver}.${method} touches cannot be read. Set it to a literal or a constant, or annotate the call.`;
    }
    return `The table ${receiver}.${method} touches is not a literal, a constant, or a schema declared in this repository, so it cannot be read. Name it directly, or annotate the call.`;
  };

  /**
   * The repository base a call is written inside, when that base says which
   * property its classes name their table in, configured or read off its own
   * queries (P88).
   */
  const configuredBaseAround = (call: TsNode): string | undefined => {
    const holder = classAround(call);
    const found = tableKeyAbove(holder);
    if (holder === undefined || found === undefined) return undefined;
    // A class that states its table is not generic: a query in it that still
    // has none is a real gap, and gets the ordinary row.
    const stated = locateTable(call as CallExpression, [{ kind: 'receiver-type-property', key: found.key }], {
      typeDeclaration: holder,
    });
    return stated === null ? found.base : undefined;
  };

  /**
   * A base configured without `tableProperty` that a call is written inside,
   * when nothing it queries says the property either.
   */
  const unnamedBaseAround = (call: TsNode): string | undefined => {
    for (const current of classChainOf(classAround(call))) {
      const name = current.getName();
      if (name === undefined || !localBaseClasses.includes(name)) continue;
      return tableKeyAbove(current) === undefined ? name : undefined;
    }
    return undefined;
  };

  /** The class a call is written in, when it is written in one. */
  const classAround = (call: TsNode): ClassDeclaration | undefined => {
    const holder = call.getFirstAncestor((node) => Node.isClassDeclaration(node));
    return holder !== undefined && Node.isClassDeclaration(holder) ? holder : undefined;
  };

  /** Whether an expression is reached from `this`, through calls, accesses and awaits. */
  const madeThroughThis = (expression: TsNode): boolean => {
    let current: TsNode | undefined = expression;
    for (let depth = 0; current !== undefined && depth < 24; depth += 1) {
      if (Node.isThisExpression(current)) return true;
      // `const c = await this.coll(); c.findOne(…)`: a constant bound once, with
      // no type of its own stated, stands for what it was bound to.
      if (Node.isIdentifier(current)) {
        const declaration: TsNode | undefined = current.getSymbol()?.getDeclarations()[0];
        if (
          declaration === undefined ||
          !Node.isVariableDeclaration(declaration) ||
          declaration.getTypeNode() !== undefined ||
          declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
        ) {
          return false;
        }
        current = declaration.getInitializer();
        continue;
      }
      if (
        Node.isCallExpression(current) ||
        Node.isPropertyAccessExpression(current) ||
        Node.isParenthesizedExpression(current) ||
        Node.isAwaitExpression(current) ||
        Node.isNonNullExpression(current) ||
        Node.isAsExpression(current)
      ) {
        current = current.getExpression();
        continue;
      }
      return false;
    }
    return false;
  };

  /** The table the class a `this` query is written in states, when it states one. */
  const ownTableOf = (
    call: CallExpression,
    receiver: TsNode,
  ): { name: string; expression: TsNode; inferred: boolean } | null => {
    if (!madeThroughThis(receiver)) return null;
    const holder = classAround(call);
    const found = tableKeyAbove(holder);
    if (holder === undefined || found === undefined) return null;
    const located = locateTableAt(call, [{ kind: 'receiver-type-property', key: found.key }], {
      typeDeclaration: holder,
    });
    return located === null ? null : { ...located, inferred: found.inferred };
  };

  const readingFor = (
    descriptor: DbDescriptor | undefined,
    origin: TypeOrigin | null,
  ): TableReading | undefined => {
    if (descriptor === undefined) return undefined;
    if (descriptor.package !== 'local') return tableReadings.get(descriptor.package);
    const key = baseKeyOf(origin);
    return key === undefined
      ? undefined
      : { locators: [{ kind: 'receiver-type-property', key: key.key }], entityInTypeArgs: false };
  };

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
    // falling back put the name of a schema type on 407 of a photo server's nodes as
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
        line: lineAndColumnAt(source, layer.base.getStart()).line,
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
    const resolved = resolveOrigin(receiver);
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
    // The same step, where the client was handed to a callback by a call a
    // record describes: `tx` of `prisma.$transaction(async (tx) => …)` is read
    // as the client the transaction was opened on, and only when that client is
    // the recorded library's (R157).
    const handedBack = Node.isPropertyAccessExpression(receiver)
      ? handedBackBy(receiver.getExpression(), clientCallbacks)
      : undefined;
    if (handedBack !== undefined) {
      const opener = clientOriginOf(handedBack.holder);
      if (opener !== null && descriptorFor(opener.origin)?.package === handedBack.record.package) {
        return {
          origin: opener.origin,
          resolved,
          fromSource: true,
          ...(opener.statedIn === undefined ? {} : { statedIn: opener.statedIn }),
        };
      }
    }
    return { origin: resolved, resolved, fromSource: false };
  };

  /**
   * What a value that is itself a client comes from: the checker's answer where
   * a descriptor knows it, and what the source states where it does not. Asked
   * of the value a transaction was opened on, which is a client rather than a
   * delegate of one.
   */
  const clientOriginOf = (
    value: TsNode,
  ): { origin: TypeOrigin; statedIn?: SourceFile } | null => {
    const resolved = resolveOrigin(value);
    if (resolved !== null && descriptorFor(resolved) !== undefined) return { origin: resolved };
    const stated = statedOrigin(value);
    return stated !== null && descriptorFor(stated) !== undefined
      ? { origin: stated, statedIn: stated.statedIn }
      : null;
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
   * - is not a statement wherever it is kept, and is counted, as a method that
   * touches no data is.
   *
   * What is left is a statement, read as a driver's query string is: one that
   * names no table is counted there, for every driver alike (R162), and one
   * whose text is computed gets the row that reader writes for computed SQL -
   * unless the library still names a table another way, when the call is read
   * as its other methods are (P126).
   */
  const statementOf = (
    call: CallExpression,
    method: string,
    descriptor: DbDescriptor,
  ): 'fragment' | { sql: SqlArgument; descriptor: DbDescriptor } | undefined => {
    const statement = statementMethods.get(descriptor.package)?.get(method);
    if (statement === undefined) return undefined;
    const sql = readSqlArgument(call.getArguments()[statement.argument]);
    if (statement.unreadFallsBack && !sql.complete) return undefined;
    const host = hostCallOf(call);
    if (host !== undefined && madeOn(host, descriptor.package)) return 'fragment';
    if (sql.text !== null && sqlOperation(sql.text) === null) return 'fragment';
    return {
      sql,
      descriptor: { ...descriptor, tableOverride: { kind: 'sql-parse', argIndex: statement.argument } },
    };
  };

  /**
   * Whether a call is the first link of a chain: made on a builder or a name,
   * not on what an earlier link of the same chain returned.
   */
  const isFirstLink = (receiver: TsNode): boolean => {
    const at = Node.isParenthesizedExpression(receiver) ? receiver.getExpression() : receiver;
    return !(Node.isCallExpression(at) && Node.isPropertyAccessExpression(at.getExpression()));
  };

  /** The static calls into this repository's methods, gathered the first time a row asks (P88). */
  let drawn: ReturnType<typeof explainedByEdge> | undefined;
  const drawnCall = (): ReturnType<typeof explainedByEdge> => {
    drawn ??= explainedByEdge(ctx.builder.edges, (id) => ctx.builder.getNode(id), ctx.repo);
    return drawn;
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

    const reading = readingFor(descriptor, origin);

    // A method that takes its statement as text, when the library has one: the
    // call is read as a driver's query is, or not read as a query at all.
    const statement = descriptor === undefined ? undefined : statementOf(call, method, descriptor);
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
    if (sql !== undefined && namesNoTable(sql)) {
      // `SELECT 1`, `BEGIN`: read in full, and nothing in it to look for. Not a
      // query site, and not a failure either (R162).
      ctx.countExternalCall(`${origin?.package ?? descriptor?.package ?? 'unknown'}.${method}`);
      return true;
    }
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
    const locatedInCall =
      reading === undefined || descriptor === undefined || statement !== undefined
        ? null
        : locateTableAt(call, reading.locators, {
            isOperation: (name) => operationOf(descriptor, name) !== null,
            ...(origin?.declaration === undefined ? {} : { typeDeclaration: origin.declaration }),
          });
    // Inside a class of a repository base, a query made through `this` whose
    // chain names nothing is on the class's own table: `this.coll().find()` in
    // `ProductRepository` is a query on what `ProductRepository` sets its table
    // property to. The chain is asked first, so a collection named outright
    // still wins (R165).
    const own =
      locatedInCall !== null || reading === undefined || statement !== undefined
        ? null
        : ownTableOf(call, receiver);
    const found = locatedInCall ?? own;
    const located = found?.name ?? null;
    // How the name was reached, when it was not in the chain itself: the field
    // a class sets for a base read without configuration, or a helper the chain
    // stepped into; and whether a field on the way may be assigned again (P88).
    const keyInferred = own !== null ? own.inferred : descriptor?.package === 'local' ? baseKeyOf(origin)?.inferred : undefined;
    const reach = found === null ? undefined : reachOf(call, found.expression, keyInferred);
    // A manager's call names its entity by the class it is handed, and the
    // class names the table: `manager.find(Rating, …)` (P88). A statement it is
    // handed names its own (P126).
    const naming = descriptor === undefined ? undefined : entityNamings.get(descriptor.package);
    const managerCall = naming !== undefined && origin !== null && naming.managers.has(origin.typeName);
    const entityClass =
      naming !== undefined &&
      managerCall &&
      statement === undefined &&
      descriptor !== undefined &&
      operationOf(descriptor, method) !== null
        ? entityClassAt(call, naming)
        : undefined;
    const entityArgTable =
      entityClass === undefined || naming === undefined ? null : entityTableName(entityClass, naming);
    // A repository base whose classes state their table is read from what they
    // state, ahead of its type argument, exactly as a described library whose
    // table is in an argument is (R165).
    const stated =
      descriptor?.package === 'local' && reading !== undefined
        ? { ...descriptor, tableOverride: { kind: 'string-arg', index: 0 } as const }
        : descriptor;
    const effective =
      statement !== undefined
        ? statement.descriptor
        : entityArgTable !== null && descriptor !== undefined
          ? { ...descriptor, tableOverride: { kind: 'entity-arg', index: 0 } as const }
          : reading === undefined || located !== null
            ? stated
            : (withoutOverride.get(descriptor?.package ?? '') ?? stated);
    // The type argument's class, read through its decorator the same way, so a
    // `Repository<Rating>` and `manager.find(Rating)` name one table (P88 D1).
    const entityTable =
      naming === undefined || entityArgTable !== null || statement !== undefined
        ? undefined
        : statedTableOfType(origin?.typeArgs[0], naming);

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
      ...(entityArgTable === null || entityClass === undefined
        ? {}
        : { entityArg: { table: entityArgTable, declared: entityClass.getName() ?? entityArgTable } }),
      ...(entityTable === undefined ? {} : { entityTable }),
    });
    if (classification === null) {
      // A described handover made on something whose type the source erased:
      // not read, and said once per query, at the chain's first link (R163).
      const unstated =
        descriptor === undefined && isFirstLink(receiver)
          ? unconfirmedHandover(receiver, handovers)
          : undefined;
      if (unstated === undefined) return false;
      ctx.report({
        file,
        line: siteOf(ctx, call, file).line,
        reason: 'db-handover-unstated',
        hint: `\`${unstated.method}()\` is called on a value whose type is not stated, so whether it hands over ${unstated.yields.package} cannot be told. State the type of what it is called on, with an annotation or a cast, and the query is read.`,
        symbol: `${receiver.getText().slice(0, 60)}.${method}`,
      });
      return true;
    }
    const site = siteOf(ctx, call, file);

    /** The row a classification asked for, wherever in this function it asked. */
    const reportUnresolved = (unresolved: { reason: string; hint: string }): void => {
      // A call into this repository's own repository, already drawn as a
      // static edge into the method where its queries are read: counted, and
      // not listed (P88 D3).
      if (unresolved.reason === 'db-receiver-name-only' && drawnCall()(holderId, file, site.line, method)) {
        ctx.countExplainedByEdge();
        return;
      }
      ctx.report({
        file,
        line: site.line,
        reason: unresolved.reason,
        hint: unresolved.hint,
        symbol: `${receiver.getText().slice(0, 60)}.${method}`,
        // A receiver read by its name alone was either typed by nothing - and
        // the code says why - or typed by a class nobody named as data (P75).
        ...(unresolved.reason === 'db-receiver-name-only'
          ? causeMeta(whyUntyped(receiver) ?? { cause: 'data-layer-unnamed' })
          : {}),
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
    //
    // And not for a statement, whose text says what it writes: the receiver's
    // type argument is the repository's entity, which the SQL need not touch.
    const entityArg =
      classification.op !== 'write' || statement !== undefined
        ? undefined
        : entityClass !== undefined && entityArgTable !== null
          ? entityClass.getType()
          : reading?.entityInTypeArgs !== false
            ? origin?.typeArgs[0]
            : undefined;
    // Lowered where a field on the way to the name may be assigned again (I4).
    const confidence = reach?.changeable === true ? 'heuristic' : classification.confidence;
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
        ...(reach?.from === undefined || classification.table === null ? {} : { tableFrom: reach.from }),
        // A batch, or a write meant to run per item, for the loop around it
        // (P89). A manager is handed the entity class first, so its criteria
        // are one argument later than a repository's (P126).
        ...perItemMetaOf(descriptor, method, call, classification.op, {
          sql: sql?.complete === true ? sql.text : null,
          leading: managerCall && statement === undefined ? 1 : 0,
        }),
        ...(classification.entityType === undefined || statement !== undefined
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
      confidence,
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
        confidence,
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
      // Inside a configured base whose classes state their table, a query has
      // no one table: it runs for every class extending the base, and each call
      // through one of them is recorded with that class's table. That is the
      // reader describing a fact, not a gap anybody can close (R165).
      const generic = configuredBaseAround(call);
      ctx.report({
        file,
        line: site.line,
        reason: 'dynamic-table-name',
        ...(generic === undefined ? {} : { level: 'info' as const }),
        hint:
          generic === undefined
            ? unreadTableHint(receiver.getText().slice(0, 40), method, origin, call)
            : `${generic} declares this query for every class that extends it; the table is each class's own, and is recorded at each call made through one of them.`,
        symbol: `${receiver.getText().slice(0, 60)}.${method}`,
      });
    }
    return true;
  };

  /**
   * A call to a function the configuration names under `adapters.db.tables`:
   * one query of the table its argument names, drawn as any other query is
   * (P37). Taken before the libraries' own reading, because the configuration
   * is the project saying what the call is. A table the argument does not name
   * as a string keeps the query and gets the ordinary row.
   */
  const emitConfigured = (call: CallExpression, scope: Scope): boolean => {
    const found = configuredAccessOf(call, ctx.config.adapters.db.tables, exported);
    if (found === undefined) return false;
    const { id: holderId, file } = scope;
    const site = siteOf(ctx, call, file);
    const id = makeLeafId('db_query', ctx.repo, file, site.line, site.column);
    if (emitted.has(id)) return true;
    emitted.add(id);
    const tables = found.table === null ? [] : [found.table];
    ctx.builder.addNode({
      id,
      type: 'db_query',
      label: `${found.op ?? 'access'} ${found.table ?? '?'}`,
      repo: ctx.repo,
      file,
      line: site.line,
      meta: {
        op: found.op,
        table: found.table,
        tables,
        package: found.access.package ?? 'local',
        method: found.access.name,
        receiver: call.getExpression().getText().slice(0, 80),
        source: 'configured',
      },
    });
    scope.ensure();
    ctx.builder.addEdge({ from: holderId, to: id, type: 'calls', confidence: DECLARED_CONFIDENCE, file, line: site.line });
    for (const table of tables) {
      const tableId = makeTableId(ctx.repo, table);
      ctx.builder.addNode({ id: tableId, type: 'table', label: table, repo: ctx.repo });
      ctx.builder.addEdge({ from: id, to: tableId, type: 'queries', confidence: DECLARED_CONFIDENCE, file, line: site.line });
    }
    if (found.table === null) {
      ctx.report({
        file,
        line: site.line,
        reason: 'dynamic-table-name',
        hint: `The table ${found.access.name} touches is argument ${String(found.access.table)}, and it is not a literal or a constant here, so it cannot be read. Name it directly, or annotate the call.`,
        symbol: call.getExpression().getText().slice(0, 60),
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
   * The parameter a request's verb comes from, when it is not written at the
   * call: `fetch(url, { method })` inside a client that takes the verb as an
   * argument writes one request for every verb it will ever send, so the verb
   * is only real at the call sites, exactly like the address (P91: read at
   * each caller by the core's one walk, `verbAlong` / `verbsAtCallers`).
   */
  const verbParameterAt = (call: CallExpression, init: TsNode | undefined): ParameterDeclaration | undefined => {
    const written = init === undefined ? call.getArguments()[1] : init;
    const settings = written === undefined ? undefined : deref(written);
    if (settings === undefined || !Node.isObjectLiteralExpression(settings)) return undefined;
    return verbParameterOf(settings.getProperty('method'));
  };

  /**
   * The binding a worker's request goes through, when it goes through one
   * (P91): `env.CATALOG.fetch(input, init)`, `this.env.CATALOG.fetch(…)`,
   * `c.env.CATALOG.fetch(…)`. A binding is a property of the environment the
   * platform hands the worker; the request reaches whichever worker the
   * deployment binds the name to, at the path of `input`, whatever host it
   * names. Recognised by the receiver's type (`Fetcher`), or, where the types
   * are not installed, by the shape alone - an upper-case property of an
   * `env` - which the linker holds to the bindings the repository declares.
   */
  const bindingOf = (callee: TsNode): { binding: string; typed: boolean } | undefined => {
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'fetch') return undefined;
    const receiver = callee.getExpression();
    if (!Node.isPropertyAccessExpression(receiver)) return undefined;
    const holder = receiver.getExpression();
    const env = Node.isIdentifier(holder) ? holder.getText() : Node.isPropertyAccessExpression(holder) ? holder.getName() : undefined;
    if (env !== 'env') return undefined;
    const type = receiver.getType();
    const named = type.getSymbol()?.getName() ?? type.getAliasSymbol()?.getName();
    if (named === 'Fetcher' || /^Fetcher\b/.test(type.getText(receiver))) return { binding: receiver.getName(), typed: true };
    const untyped = type.isAny() || type.isUnknown() || type.getText(receiver) === 'any';
    return untyped && /^[A-Z][A-Z0-9_]*$/.test(receiver.getName()) ? { binding: receiver.getName(), typed: false } : undefined;
  };

  /** Whether a call reaches the network, and where its address sits. */
  const recogniseHttp = (call: CallExpression): { method: string; urlIndex: number; binding?: { binding: string; typed: boolean } } | null => {
    const callee = call.getExpression();

    const binding = bindingOf(callee);
    if (binding !== undefined) return { method: 'GET', urlIndex: 0, binding };

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

  /**
   * The verb a request states itself, where it is made: `fetch(url, { method:
   * 'PUT' })`, or a client method named for its verb, `axios.delete(url)`.
   *
   * When a caller is credited with the request, this is still its verb (R161):
   * the caller only filled in part of the address. `settings` says the verb was
   * read out of the request's own settings, which also carry its body, so the
   * caller's second argument is neither.
   */
  const statedVerbOf = (
    call: CallExpression,
    recognised: string,
    init: TsNode | undefined,
  ): { verb: string; settings: boolean } | undefined => {
    if (recognised === 'GET') {
      const settings = init === undefined ? call.getArguments()[1] : deref(init);
      const stated = verbInSettings(settings, true);
      if (stated !== undefined) return { verb: stated, settings: true };
    }
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    // `get` is a verb and `request` is not: only a name that is its own verb
    // states one, and `fetch` only defaults to GET.
    const name = callee.getName().toLowerCase();
    return HTTP_METHODS.get(name) === name.toUpperCase()
      ? { verb: recognised, settings: false }
      : undefined;
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

  /** The dotted keys this repository's settings factories build, read the first time one is asked for. */
  let loadedMap: Map<string, LoadedSetting> | undefined;
  const loadedSettingOf = (key: string): LoadedSetting | undefined => {
    if (!key.includes('.')) return undefined;
    loadedMap ??= loadedSettings(repoFiles());
    return loadedMap.get(key);
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
    written: UrlInfo,
    method: string | null,
    owner: Holder,
    options: RecordOptions = {},
  ): void => {
    const { init, readsSite = true, binding } = options;
    // A request through a binding names a host the platform ignores: the
    // binding is where it goes (P91).
    const info: UrlInfo = binding === undefined ? written : { ...written, host: null, baseUrlEnv: null };

    // A second argument can carry the method for a generic request. `null`
    // is a verb a caller hands in that nothing can read (P91): the request is
    // recorded, and joins nothing until the verb is read.
    let verb = method;
    // True when the second argument turned out to be a request's settings
    // rather than its body — `fetch(url, { method, headers, body })`. Its keys
    // are not the keys of anything sent, and recording them as such would let
    // `method` and `headers` stand for what a call puts on the wire.
    let secondIsSettings = false;
    if (verb === 'GET' && readsSite) {
      const stated = verbInSettings(init === undefined ? site.getArguments()[1] : deref(init));
      if (stated !== undefined) {
        verb = stated;
        secondIsSettings = init === undefined;
      }
    }

    const [typeArgument] = site.getTypeArguments();
    const responseType =
      typeArgument === undefined ? null : ctx.types.collectType(typeArgument.getType(), site);
    // The second argument is a body only when it is nothing else. A settings
    // object declares the settings' type, and `RequestInit` read as the body of
    // `fetch(url, { method: 'PUT' })` named a type nothing sends.
    const bodyAtSite = readsSite && init === undefined && !secondIsSettings;
    const bodyArgument = bodyAtSite ? site.getArguments()[1] : undefined;
    const declaredBodyWide = bodyAtSite ? declaredParameterType(site, 1, ctx.checker) : undefined;
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
    // Where the base comes from beyond its key (P77): the variable of the
    // environment a settings factory reads it from, and what the code falls
    // back to without it, kept as an address and nothing more.
    const loaded = info.baseUrlEnv === null ? undefined : loadedSettingOf(info.baseUrlEnv);
    const fallback = info.baseUrlDefault ?? loaded?.otherwise;
    const baseUrlDefault = fallback === undefined ? undefined : addressOnly(fallback);
    // Where the fallback is written, when it is not where the request is.
    const defaultFrom =
      baseUrlDefault === undefined || info.baseUrlDefault !== undefined || loaded?.file === undefined
        ? undefined
        : relative(ctx.repoDir, loaded.file).split(sep).join('/');
    // Which application this request is written in, asked of the file through
    // the one function every browser reader asks too, so the two halves' readings
    // of one call cannot disagree about it (R136). A map keyed by declaration
    // answers nothing, and the request then carries nothing, as it did.
    const application = applicationOfFile(ctx.meta, owner.file);
    ctx.builder.addNode({
      id,
      type: 'http_out',
      label: `${verb ?? '?'} ${info.path ?? info.url ?? '?'}`,
      repo: ctx.repo,
      file: owner.file,
      line: place.line,
      meta: {
        method: verb,
        url: info.url,
        path: info.path,
        baseUrlEnv: info.baseUrlEnv,
        ...(loaded?.variable === undefined || loaded.variable === info.baseUrlEnv ? {} : { baseUrlVariable: loaded.variable }),
        ...(baseUrlDefault === undefined ? {} : { baseUrlDefault }),
        ...(defaultFrom === undefined ? {} : { baseUrlDefaultFrom: defaultFrom }),
        responseType,
        bodyType,
        ...(bodyType === null ? {} : { bodyFrom }),
        ...(bodyKeys === undefined ? {} : { bodyKeys }),
        ...(info.host === null ? {} : { host: info.host }),
        ...(application === undefined ? {} : { application }),
        ...(binding === undefined ? {} : { binding: binding.binding, ...(binding.typed ? {} : { bindingTyped: false }) }),
      },
    });
    owner.ensure();
    ctx.builder.addEdge({
      from: owner.id,
      to: id,
      type: 'calls',
      confidence: info.path === null || verb === null ? 'heuristic' : 'static',
      file: owner.file,
      line: place.line,
    });

    // Only where the address was read: one that was not already has its row,
    // and the annotation that fixes it states the verb too.
    if (verb === null && info.path !== null) {
      ctx.report({
        file: owner.file,
        line: place.line,
        reason: 'api-method-dynamic',
        hint: 'The verb is handed in by the caller and is not a literal, a const or an enum member here. Write it as one, or annotate the call with @CallsService.',
        symbol: site.getText().slice(0, 80),
      });
    }

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
    const here = analyzeUrl(urlArg, { whole: true });
    const split = isReadable(urlArg) ? undefined : splitAtParameterIn(urlArg, settingReader);
    const through = recognised.binding === undefined ? {} : { binding: recognised.binding };
    const stated = statedVerbOf(call, recognised.method, request?.init);
    const verbParameter = stated === undefined ? verbParameterAt(call, request?.init) : undefined;
    if (split !== undefined) {
      // A caller is drawn on only where its argument leaves the address at
      // least as sure as the request states it here: `bot${token}` with a
      // token nobody can read stays the helper's static request.
      const forwarding = forwardNoWorse(forwardedFrom(split.parameter), {
        here: { owner: holder, info: here },
        at: (hop) => {
          const owner = ownerOf(hop.site);
          if (owner === undefined || !Node.isCallExpression(hop.site)) return undefined;
          return { owner, info: composeAddress(analyzeUrl(hop.argument), split) };
        },
        sureness: ({ info }) => surenessOf(info),
      });
      for (const { site, reading, hops } of forwarding.callers) {
        if (!Node.isCallExpression(site)) continue;
        // What the request states is the request's; a caller's argument, and
        // then its name, only stand in for a verb the request leaves open.
        // Read along the calls the address came out through, so the verb and
        // the address are the same caller's (P91).
        const along = verbParameter === undefined ? undefined : verbAlong(verbParameter, hops);
        const verb = stated?.verb ?? (along === undefined ? (verbOfSite(site) ?? recognised.method) : along);
        // Where the caller is the one handing the verb in, its arguments are
        // the wrapper's - a verb, a path, a body - and its second is not the
        // body; where a wrapper of its own settled the verb on the way out
        // (`post(path, body)` into `request('POST', path, body)`), the
        // caller's are that wrapper's, and its second is (P91).
        const handedHere = along !== undefined && verbAlong(verbParameter as ParameterDeclaration, hops.slice(0, -1)) === undefined;
        recordHttp(site, reading.info, verb, reading.owner, {
          readsSite: stated?.settings !== true && !handedHere,
          ...(recognised.binding === undefined ? {} : { binding: recognised.binding }),
        });
      }
      // A caller through an interface this method implements, or one whose
      // argument says less than the request does here, is answered by the
      // request written here (R158).
      if (!forwarding.here) return true;
    }

    // The address is read here and the verb is a parameter: one request per
    // caller, each with the verb it hands in (P91). A caller nobody can name,
    // or none at all, leaves the request here with its verb unread. Where the
    // address could not be read either, a verb per caller would only be more
    // requests nothing can join, and the one request stays here, unread.
    if (verbParameter !== undefined && here.path === null) {
      recordHttp(call, here, null, holder, { init: request?.init, ...through });
      return true;
    }
    if (verbParameter !== undefined) {
      const callers = verbsAtCallers(verbParameter);
      let unnamed = callers.undecided || callers.calls.length === 0;
      for (const { site, verb } of callers.calls) {
        const owner = ownerOf(site);
        if (owner === undefined) {
          unnamed = true;
          continue;
        }
        recordHttp(site, here, verb, owner, { readsSite: false, ...through });
      }
      if (unnamed) recordHttp(call, here, null, holder, { init: request?.init, ...through });
      return true;
    }

    recordHttp(call, here, recognised.method, holder, { init: request?.init, ...through });
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
      if (emitConfigured(expression, scope)) return;
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
