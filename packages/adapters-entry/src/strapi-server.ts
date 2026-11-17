import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  configValueAt,
  hasAnyDependency,
  makeEntryId,
  makeHttpEntryKey,
  namedFunction,
  normalizeFilePath,
  readConfigLiteral,
  startLineOf,
  type EntryAdapter,
  type EntryHandler,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import { Node, SyntaxKind, type CallExpression, type Node as TsNode, type SourceFile } from 'ts-morph';
import { strapiListens } from './listen-ports.js';
import { KOA_REQUEST, readingOf } from './request-readings.js';
import { handlerOfFunction, inlineHandlerOf, joinPath, repoFunctionOf, repoSources, unwrapValue } from './shared.js';

const ADAPTER = 'strapi-server';

/** How a Strapi controller's action is handed its request: Koa's context (P327). */
const REQUEST = readingOf(KOA_REQUEST);

/** Where Strapi puts the routes of an application's own APIs, `content-api` routes, where `config/api` writes no other (P327). */
const DEFAULT_PREFIX = '/api';

/** A file of an API's routes or controllers: `src/api/<api>/routes/<name>.ts`. Strapi reads that directory only, no deeper. */
const API_FILE = /^src\/api\/([^/]+)\/(routes|controllers)\/([^/]+)\.(?:[cm]?[jt]s)$/;

/** The actions Strapi's core controller answers, as its core router routes them (P327). */
const CORE_ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const;

/** One route of a core router, for a collection type or a single type. */
interface CoreRoute {
  readonly action: (typeof CORE_ACTIONS)[number];
  readonly method: string;
  /** The path under the type's name: `''` or `'/:id'`. */
  readonly under: string;
}

const COLLECTION_ROUTES: readonly CoreRoute[] = [
  { action: 'find', method: 'GET', under: '' },
  { action: 'findOne', method: 'GET', under: '/:id' },
  { action: 'create', method: 'POST', under: '' },
  { action: 'update', method: 'PUT', under: '/:id' },
  { action: 'delete', method: 'DELETE', under: '/:id' },
];

const SINGLE_ROUTES: readonly CoreRoute[] = [
  { action: 'find', method: 'GET', under: '' },
  { action: 'update', method: 'PUT', under: '' },
  { action: 'delete', method: 'DELETE', under: '' },
];

/** A string literal's value. */
const textOf = (node: TsNode | undefined): string | undefined => {
  if (node === undefined) return undefined;
  const value = unwrapValue(node);
  return Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) ? value.getLiteralValue() : undefined;
};

/** A property of an object literal, by name. */
const propertyOf = (object: TsNode | undefined, key: string): TsNode | undefined => {
  if (object === undefined || !Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(key);
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  return property;
};

/** An expression through a constant naming it, to what it holds. */
const resolved = (node: TsNode | undefined, depth = 0): TsNode | undefined => {
  if (node === undefined || depth > 4) return node;
  const value = unwrapValue(node);
  if (!Node.isIdentifier(value)) return value;
  const declaration = value.getSymbol()?.getDeclarations()[0];
  return declaration !== undefined && Node.isVariableDeclaration(declaration) ? resolved(declaration.getInitializer(), depth + 1) : value;
};

/** What a module exports as its whole value: `export default x`, `export = x` or `module.exports = x`. */
const moduleValue = (sourceFile: SourceFile): TsNode | undefined => {
  const assignment = sourceFile.getExportAssignments()[0];
  if (assignment !== undefined) return resolved(assignment.getExpression());
  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const expression = statement.getExpression();
    if (Node.isBinaryExpression(expression) && expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken && expression.getLeft().getText() === 'module.exports') {
      return resolved(expression.getRight());
    }
  }
  return undefined;
};

/** Whether a call is one of Strapi's factories by name: `createCoreRouter(...)`, `factories.createCoreRouter(...)`. */
const isFactory = (node: TsNode | undefined, name: string): node is CallExpression => {
  if (node === undefined || !Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  return (Node.isIdentifier(callee) && callee.getText() === name) || (Node.isPropertyAccessExpression(callee) && callee.getName() === name);
};

/** What a function hands back, where it is written as an object: `() => ({ ... })`, or a body returning one. */
const objectReturned = (fn: TsNode | undefined): TsNode | undefined => {
  if (fn === undefined || (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn))) return undefined;
  const body = fn.getBody();
  if (!Node.isBlock(body)) return resolved(body);
  const returned = body.getStatements().find((each) => Node.isReturnStatement(each));
  return returned !== undefined && Node.isReturnStatement(returned) ? resolved(returned.getExpression()) : undefined;
};

/** A content type's schema: whether it is a single type, and its names. */
interface ContentType {
  readonly single: boolean;
  readonly singularName: string;
  readonly pluralName: string;
}

/** The schema of `api::<api>.<type>`, read from `src/api/<api>/content-types/<type>/schema.json`. */
const contentTypeOf = (repoDir: string, uid: string): ContentType | undefined => {
  const match = /^api::([\w-]+)\.([\w-]+)$/.exec(uid);
  if (match === null) return undefined;
  let schema: unknown;
  try {
    schema = JSON.parse(readFileSync(join(repoDir, 'src', 'api', match[1] as string, 'content-types', match[2] as string, 'schema.json'), 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof schema !== 'object' || schema === null) return undefined;
  const { kind, info } = schema as { kind?: unknown; info?: { singularName?: unknown; pluralName?: unknown } };
  if (typeof info?.singularName !== 'string' || typeof info.pluralName !== 'string') return undefined;
  return { single: kind === 'singleType', singularName: info.singularName, pluralName: info.pluralName };
};

/** The prefix Strapi serves an application's own API routes under: `config/api`'s `rest.prefix`, or `/api`. */
const apiPrefixOf = (ctx: ExtractContext): { readonly prefix: string; readonly unread?: string } => {
  const config = readConfigLiteral(ctx.repoDir, ['ts', 'js', 'mjs', 'cjs'].map((extension) => `config/api.${extension}`));
  const written = config === undefined ? undefined : configValueAt(config.value, 'rest.prefix');
  if (written === undefined) return { prefix: DEFAULT_PREFIX };
  if (typeof written === 'string') return { prefix: written };
  return { prefix: DEFAULT_PREFIX, unread: config === undefined ? 'config/api' : normalizeFilePath(config.file, ctx.repoDir) };
};

/** One route a routes file declares, before its handler is looked for. */
interface DeclaredRoute {
  readonly method: string;
  readonly path: string;
  readonly at: TsNode;
  /** `<controller>.<action>`, or the function written in the route. */
  readonly handler: string | TsNode | undefined;
  /** A core router's route, whose action Strapi's core controller answers where the controller does not. */
  readonly core?: true;
  /** Its config writes a prefix: Strapi mounts it beside its router, not under the router's own prefix. */
  readonly ownPrefix?: true;
}

/**
 * The controller files of the repository's APIs, by `<api>.<name>`, and the
 * object each one's actions are written in: a plain object, or what
 * `createCoreController(uid, factory)`'s factory returns.
 */
interface Controller {
  readonly file: SourceFile;
  readonly actions?: TsNode;
  /** Whether it is built by `createCoreController`, which answers the core actions it does not write. */
  readonly core: boolean;
}

const controllerOf = (sourceFile: SourceFile): Controller => {
  const value = moduleValue(sourceFile);
  if (isFactory(value, 'createCoreController')) {
    const factory = resolved(value.getArguments()[1]);
    const actions = factory === undefined ? undefined : Node.isObjectLiteralExpression(factory) ? factory : objectReturned(factory);
    return { file: sourceFile, core: true, ...(actions === undefined ? {} : { actions }) };
  }
  if (value !== undefined && Node.isObjectLiteralExpression(value)) return { file: sourceFile, core: false, actions: value };
  const returned = objectReturned(value);
  return { file: sourceFile, core: false, ...(returned === undefined ? {} : { actions: returned }) };
};

/** The handler an action of a controller is, where it is written there. */
const actionHandler = (controller: Controller, action: string, label: string, ctx: ExtractContext): EntryHandler | undefined => {
  const actions = controller.actions;
  if (actions === undefined || !Node.isObjectLiteralExpression(actions)) return undefined;
  const property = actions.getProperty(action);
  if (property === undefined) return undefined;
  if (Node.isMethodDeclaration(property)) return inlineHandlerOf(property, label, ctx);
  if (Node.isShorthandPropertyAssignment(property)) {
    const declaration = property.getValueSymbol()?.getDeclarations()[0];
    const fn = declaration === undefined ? undefined : namedFunction(declaration);
    return fn === undefined ? undefined : handlerOfFunction(fn, ctx);
  }
  if (!Node.isPropertyAssignment(property)) return undefined;
  const value = property.getInitializer();
  if (value === undefined) return undefined;
  const fn = repoFunctionOf(value);
  return fn !== undefined ? handlerOfFunction(fn, ctx) : inlineHandlerOf(unwrapValue(value), label, ctx);
};

/** The routes one routes file declares, and the prefix of its router; or why it is not read. */
const routesOf = (value: TsNode | undefined, repoDir: string): { readonly routes: readonly DeclaredRoute[]; readonly prefix?: string } | string => {
  if (isFactory(value, 'createCoreRouter')) {
    const [uidArgument, optionsArgument] = value.getArguments();
    const uid = textOf(uidArgument);
    if (uid === undefined) return 'its content type is not written as a literal';
    const type = contentTypeOf(repoDir, uid);
    if (type === undefined) return `the schema of ${uid} was not found under src/api`;
    const options = resolved(optionsArgument);
    const names = (key: string): string[] | undefined => {
      const list = resolved(propertyOf(options, key));
      if (list === undefined || !Node.isArrayLiteralExpression(list)) return undefined;
      return list.getElements().flatMap((each) => {
        const text = textOf(each);
        return text === undefined ? [] : [text];
      });
    };
    const only = names('only');
    const except = names('except') ?? [];
    const name = type.single ? type.singularName : type.pluralName;
    const prefix = textOf(propertyOf(options, 'prefix'));
    const routes = (type.single ? SINGLE_ROUTES : COLLECTION_ROUTES)
      .filter((route) => !except.includes(route.action) && (only === undefined || only.includes(route.action)))
      .map((route): DeclaredRoute => ({ method: route.method, path: `/${name}${route.under}`, at: value, handler: `${uid}.${route.action}`, core: true }));
    return { routes, ...(prefix === undefined ? {} : { prefix }) };
  }
  const router = value !== undefined && Node.isObjectLiteralExpression(value) ? value : objectReturned(value);
  const list = resolved(propertyOf(router, 'routes'));
  if (list === undefined || !Node.isArrayLiteralExpression(list)) return 'it exports neither a core router nor an object with a list of routes';
  const prefix = textOf(propertyOf(router, 'prefix'));
  const routes = list.getElements().flatMap((element): DeclaredRoute[] => {
    const route = resolved(element);
    const method = textOf(propertyOf(route, 'method'));
    const path = textOf(propertyOf(route, 'path'));
    if (route === undefined || method === undefined || path === undefined) return [];
    const handler = propertyOf(route, 'handler');
    // A route whose config writes a prefix is mounted beside its router, not under the router's own prefix.
    const ownPrefix = propertyOf(resolved(propertyOf(route, 'config')), 'prefix') !== undefined;
    return [
      {
        method: method.toUpperCase(),
        path,
        ...(ownPrefix ? { ownPrefix: true as const } : {}),
        at: route,
        handler: textOf(handler) ?? (handler === undefined ? undefined : unwrapValue(handler)),
      },
    ];
  });
  return { routes, ...(prefix === undefined ? {} : { prefix }) };
};

/**
 * A Strapi application's server (P321, P327): where it listens, and the
 * routes of its own APIs.
 *
 * Strapi starts its own server, from `config/server.*`, and the application
 * declares neither Koa, which it is built on, nor a `listen` of its own: no
 * other adapter is detected for it. Its ways in are the routes files of each
 * API, `src/api/<api>/routes/*`, served under `/api` (or `config/api`'s
 * `rest.prefix`): a core router, `createCoreRouter('api::<api>.<type>')`, is
 * the five routes of a collection type (`GET`, `POST /<plural>`, `GET`,
 * `PUT`, `DELETE /<plural>/:id`) or the three of a single type (`GET`, `PUT`,
 * `DELETE /<singular>`), named by the type's `schema.json`, narrowed by
 * `only` and `except` and put under its `prefix`; a custom one is its
 * `routes: [{ method, path, handler }]`. A handler `<controller>.<action>`
 * (or `api::<api>.<controller>.<action>`) is the action of
 * `src/api/<api>/controllers/<controller>.*` where that file writes it -
 * a plain object's member, or one of the object `createCoreController`'s
 * factory returns - and Strapi's own core action where a core controller
 * does not; a route whose handler is not found says so.
 */
export const strapiServerAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasAnyDependency(pkg, ['@strapi/strapi']),
  listens: strapiListens,
  extractEntries(ctx: ExtractContext): EntryNode[] {
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const routeFiles: { readonly api: string; readonly file: string; readonly sourceFile: SourceFile }[] = [];
    const controllers = new Map<string, Controller>();
    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      const match = API_FILE.exec(file);
      if (match === null) continue;
      const [, api, kind, name] = match as unknown as [string, string, string, string];
      if (kind === 'routes') routeFiles.push({ api, file, sourceFile });
      else if (!controllers.has(`${api}.${name}`)) controllers.set(`${api}.${name}`, controllerOf(sourceFile));
    }
    if (routeFiles.length === 0) return entries;
    const { prefix: apiPrefix, unread: prefixUnread } = apiPrefixOf(ctx);
    if (prefixUnread !== undefined) {
      ctx.builder.addUnresolved({
        file: prefixUnread,
        line: 1,
        reason: 'route-mount-unread',
        message: `The prefix Strapi serves the APIs' routes under (rest.prefix) is not written as a literal, so ${DEFAULT_PREFIX}, Strapi's own, is assumed.`,
        hint: "Write rest.prefix as a string in config/api, or keep Strapi's /api.",
        symbol: 'rest.prefix',
        adapter: ADAPTER,
      });
    }
    for (const { api, file, sourceFile } of routeFiles.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
      const read = routesOf(moduleValue(sourceFile), ctx.repoDir);
      if (typeof read === 'string') {
        ctx.builder.addUnresolved({
          file,
          line: 1,
          reason: 'route-registry-unread',
          message: `The routes of ${file} are not read: ${read}.`,
          hint: "Export createCoreRouter('api::<api>.<type>') with the type's schema.json beside it, or an object whose routes are written as a list of { method, path, handler }.",
          symbol: file,
          adapter: ADAPTER,
        });
        continue;
      }
      for (const route of read.routes) {
        const path = joinPath(apiPrefix, route.ownPrefix === true ? undefined : read.prefix, route.path);
        const key = makeHttpEntryKey(route.method, path);
        const id = makeEntryId(ctx.repo, 'http', key);
        if (seen.has(id)) continue;
        seen.add(id);
        const label = `${route.method} ${path}`;
        let handler: EntryHandler | undefined;
        let handlerVia: 'function' | 'inline' | 'framework' | 'unread' = 'unread';
        let named: string | undefined;
        if (typeof route.handler === 'string') {
          named = route.handler;
          const dot = route.handler.lastIndexOf('.');
          const action = route.handler.slice(dot + 1);
          const controllerName = route.handler.slice(0, dot);
          const qualified = /^api::([\w-]+)\.([\w-]+)$/.exec(controllerName);
          const controller = controllers.get(qualified === null ? `${api}.${controllerName}` : `${qualified[1]}.${qualified[2]}`);
          handler = controller === undefined ? undefined : actionHandler(controller, action, route.handler, ctx);
          if (handler !== undefined) handlerVia = 'inline' in handler ? 'inline' : 'function';
          else if (route.core === true && (controller === undefined || controller.core) && (CORE_ACTIONS as readonly string[]).includes(action)) handlerVia = 'framework';
        } else if (route.handler !== undefined) {
          const fn = repoFunctionOf(route.handler);
          handler = fn !== undefined ? handlerOfFunction(fn, ctx) : inlineHandlerOf(route.handler, label, ctx);
          if (handler !== undefined) handlerVia = 'inline' in handler ? 'inline' : 'function';
        }
        if (handlerVia === 'unread') {
          ctx.builder.addUnresolved({
            file,
            line: startLineOf(route.at),
            reason: 'route-handler-unread',
            message: `The handler of ${label}${named === undefined ? '' : `, ${named},`} was not found in the API's controllers, so the code behind the route is not pointed at.`,
            hint: 'Write the action in src/api/<api>/controllers/<controller>, as a member of the object the file exports or of the one createCoreController returns.',
            symbol: named ?? label,
            adapter: ADAPTER,
          });
        }
        entries.push({
          id,
          kind: 'http',
          label,
          key,
          ...(handler === undefined ? {} : { handler }),
          request: REQUEST,
          file,
          line: startLineOf(route.at),
          meta: {
            method: route.method,
            path,
            adapter: ADAPTER,
            registration: route.core === true ? 'strapi/core-router' : 'strapi/routes',
            handlerVia,
            ...(named === undefined ? {} : { handlerName: named }),
            middlewareRead: false,
          },
        });
      }
    }
    return entries;
  },
};
