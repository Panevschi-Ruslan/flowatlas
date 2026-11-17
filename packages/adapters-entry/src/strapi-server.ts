import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
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
  type EntryWrapping,
  type ExtractContext,
} from '@flowatlas/core';
import { Node, SyntaxKind, type CallExpression, type Node as TsNode, type SourceFile } from 'ts-morph';
import { strapiListens } from './listen-ports.js';
import { KOA_REQUEST, readingOf } from './request-readings.js';
import { fileOfNode, handlerOfFunction, inlineHandlerOf, joinPath, repoFunctionOf, repoSources, unwrapValue } from './shared.js';

const ADAPTER = 'strapi-server';

/** How a Strapi controller's action is handed its request: Koa's context (P327). */
const REQUEST = readingOf(KOA_REQUEST);

/** Where Strapi puts the routes of an application's own APIs, `content-api` routes, where `config/api` writes no other (P327). */
const DEFAULT_PREFIX = '/api';

/** A file of an API's routes or controllers: `src/api/<api>/routes/<name>.ts`. Strapi reads that directory only, no deeper. */
const API_FILE = /^src\/api\/([^/]+)\/(routes|controllers)\/([^/]+)\.(?:[cm]?[jt]s)$/;

/** The extensions a module of the application's own is written with, the source's first. */
const EXTENSIONS = ['ts', 'js', 'mts', 'mjs', 'cts', 'cjs'];

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
  // A key written as a string, `'can-edit': canEdit`, by its value.
  const property =
    object.getProperty(key) ??
    object.getProperties().find((each) => {
      const name = Node.isPropertyAssignment(each) ? each.getNameNode() : undefined;
      return name !== undefined && (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) && name.getLiteralValue() === key;
    });
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return property;
};

/** The file of the project a path names, tried with each extension and as a directory's index. */
const moduleAt = (sourceFile: SourceFile, path: string): SourceFile | undefined => {
  const project = sourceFile.getProject();
  const bare = path.replace(/\.[cm]?[jt]s$/, '');
  for (const candidate of [path, ...EXTENSIONS.map((extension) => `${bare}.${extension}`), ...EXTENSIONS.map((extension) => `${bare}/index.${extension}`)]) {
    const found = project.getSourceFile(candidate);
    if (found !== undefined && !found.isDeclarationFile()) return found;
  }
  return undefined;
};

/** The file `require('./x')` loads, where it is one of the project's. */
const requiredFile = (call: CallExpression): SourceFile | undefined => {
  const path = textOf(call.getArguments()[0]);
  if (path === undefined || !path.startsWith('.')) return undefined;
  return moduleAt(call.getSourceFile(), posix.join(posix.dirname(call.getSourceFile().getFilePath()), path));
};

const FOLLOW_DEPTH = 8;

/**
 * An expression through what names it, to what it holds (P327, P329): a
 * constant, a function declared, a module imported or required -
 * `import routes from './routes'`, `require('./server')`, `{ routes }` of a
 * module's exports.
 */
const resolved = (node: TsNode | undefined, depth = 0): TsNode | undefined => {
  if (node === undefined || depth > FOLLOW_DEPTH) return node;
  const value = unwrapValue(node);
  if (Node.isCallExpression(value) && value.getExpression().getText() === 'require') {
    const file = requiredFile(value);
    return file === undefined ? value : (moduleValue(file, depth + 1) ?? value);
  }
  if (Node.isPropertyAccessExpression(value)) {
    // `require('./server').routes`, `server.routes`: the key of what the object is.
    const owner = resolved(value.getExpression(), depth + 1);
    const property = propertyOf(owner, value.getName());
    return property === undefined ? value : resolved(property, depth + 1);
  }
  if (!Node.isIdentifier(value)) return value;
  const first = value.getSymbol()?.getDeclarations()[0];
  // `{ routes }`: the name's own value, not the key it writes.
  const declaration = first !== undefined && Node.isShorthandPropertyAssignment(first) ? first.getValueSymbol()?.getDeclarations()[0] : first;
  if (declaration === undefined) return value;
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) return resolved(initializer, depth + 1);
    return value;
  }
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  if (Node.isImportClause(declaration) || Node.isImportSpecifier(declaration)) {
    const file = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierSourceFile();
    if (file === undefined || file.isInNodeModules() || file.isDeclarationFile()) return value;
    if (Node.isImportClause(declaration)) return moduleValue(file, depth + 1) ?? value;
    return exportedValue(file, declaration.getName(), depth + 1) ?? value;
  }
  return value;
};

/** What a module exports by a name: a constant's value, a function declared. */
const exportedValue = (file: SourceFile, name: string, depth: number): TsNode | undefined => {
  const declaration = file.getExportedDeclarations().get(name)?.[0];
  if (declaration === undefined) {
    // `module.exports = { routes }`: the key of the module's whole value.
    const whole = moduleValue(file, depth + 1);
    const property = propertyOf(whole, name);
    return property === undefined ? undefined : resolved(property, depth + 1);
  }
  if (Node.isVariableDeclaration(declaration)) return resolved(declaration.getInitializer(), depth + 1);
  if (Node.isFunctionDeclaration(declaration)) return declaration;
  return Node.isExpression(declaration) ? resolved(declaration, depth + 1) : undefined;
};

/** What a module exports as its whole value: `export default x`, `export = x` or `module.exports = x`. */
const moduleValue = (sourceFile: SourceFile, depth = 0): TsNode | undefined => {
  if (depth > FOLLOW_DEPTH) return undefined;
  const assignment = sourceFile.getExportAssignments()[0];
  if (assignment !== undefined) return resolved(assignment.getExpression(), depth + 1);
  const declared = sourceFile.getDefaultExportSymbol()?.getDeclarations()[0];
  if (declared !== undefined && Node.isFunctionDeclaration(declared)) return declared;
  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const expression = statement.getExpression();
    if (Node.isBinaryExpression(expression) && expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken && expression.getLeft().getText() === 'module.exports') {
      return resolved(expression.getRight(), depth + 1);
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

/**
 * What a function hands back, where it is written as an object (P327, P329):
 * `() => ({ ... })`, a function returning one - Strapi calls a router written
 * as a function with `{ strapi }` - and what a call of a function of the
 * repository's own answers, a factory returning the router.
 */
const objectReturned = (fn: TsNode | undefined, depth = 0): TsNode | undefined => {
  if (fn === undefined || depth > FOLLOW_DEPTH) return undefined;
  if (Node.isCallExpression(fn)) {
    const callee = resolved(fn.getExpression(), depth + 1);
    return callee === undefined || callee === fn.getExpression() ? undefined : objectReturned(callee, depth + 1);
  }
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn)) return undefined;
  const body = fn.getBody();
  if (body === undefined) return undefined;
  if (!Node.isBlock(body)) return resolved(body, depth + 1);
  const returned = body.getStatements().find((each) => Node.isReturnStatement(each));
  return returned !== undefined && Node.isReturnStatement(returned) ? resolved(returned.getExpression(), depth + 1) : undefined;
};

/** An object as Strapi takes it: written as one, or what the function or factory call written in its place returns. */
const objectOf = (node: TsNode | undefined): TsNode | undefined => {
  const value = resolved(node);
  if (value === undefined) return undefined;
  if (Node.isObjectLiteralExpression(value) || Node.isArrayLiteralExpression(value) || isFactory(value, 'createCoreRouter') || isFactory(value, 'createCoreController')) return value;
  return objectReturned(value);
};

/** A content type's schema: whether it is a single type, and its names. */
interface ContentType {
  readonly single: boolean;
  readonly singularName: string;
  readonly pluralName: string;
}

/** The schema of `api::<api>.<type>`, or `plugin::<plugin>.<type>` of a local plugin, read from its `schema.json`. */
const contentTypeOf = (repoDir: string, uid: string, plugins: readonly LocalPlugin[]): ContentType | undefined => {
  const api = /^api::([\w-]+)\.([\w-]+)$/.exec(uid);
  const plugin = /^plugin::([\w-]+)\.([\w-]+)$/.exec(uid);
  const local = plugin === null ? undefined : plugins.find((each) => each.name === plugin[1]);
  const candidates =
    api !== null
      ? [join(repoDir, 'src', 'api', api[1] as string, 'content-types', api[2] as string, 'schema.json')]
      : local !== undefined && plugin !== null
        ? ['server/src/content-types', 'server/content-types'].map((dir) => join(repoDir, local.dir, dir, plugin[2] as string, 'schema.json'))
        : [];
  for (const path of candidates) {
    let schema: unknown;
    try {
      schema = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    if (typeof schema !== 'object' || schema === null) continue;
    const { kind, info } = schema as { kind?: unknown; info?: { singularName?: unknown; pluralName?: unknown } };
    if (typeof info?.singularName !== 'string' || typeof info.pluralName !== 'string') continue;
    return { single: kind === 'singleType', singularName: info.singularName, pluralName: info.pluralName };
  }
  return undefined;
};

/** The prefix Strapi serves an application's own API routes under: `config/api`'s `rest.prefix`, or `/api`. */
const apiPrefixOf = (ctx: ExtractContext): { readonly prefix: string; readonly unread?: string } => {
  const config = readConfigLiteral(ctx.repoDir, EXTENSIONS.map((extension) => `config/api.${extension}`));
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
  /** What the route's own `config` and a handler written as a list put in front of the handler (P329). */
  readonly policies: readonly TsNode[];
  readonly middlewares: readonly TsNode[];
  /** A core router's route, whose action Strapi's core controller answers where the controller does not. */
  readonly core?: true;
  /** Its config writes a prefix: Strapi mounts it beside its router, not under the router's own prefix. */
  readonly ownPrefix?: true;
}

/**
 * A controller of the application's - an API's file, or a key of a local
 * plugin's `controllers` - and the object its actions are written in: a plain
 * object, or what `createCoreController(uid, factory)`'s factory returns.
 */
interface Controller {
  readonly actions?: TsNode;
  /** Whether it is built by `createCoreController`, which answers the core actions it does not write. */
  readonly core: boolean;
}

const controllerOf = (value: TsNode | undefined): Controller => {
  if (isFactory(value, 'createCoreController')) {
    const factory = resolved(value.getArguments()[1]);
    const actions = factory === undefined ? undefined : Node.isObjectLiteralExpression(factory) ? factory : objectReturned(factory);
    return { core: true, ...(actions === undefined ? {} : { actions }) };
  }
  if (value !== undefined && Node.isObjectLiteralExpression(value)) return { core: false, actions: value };
  const returned = objectReturned(value);
  return { core: false, ...(returned === undefined ? {} : { actions: returned }) };
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

/** The elements of a list a route's config writes, `policies: ['global::is-owner']`. */
const listOf = (node: TsNode | undefined): readonly TsNode[] => {
  const list = resolved(node);
  return list !== undefined && Node.isArrayLiteralExpression(list) ? list.getElements() : [];
};

/** One router of a routes file: its routes, its prefix, and the API it is mounted on where it says (`type`). */
interface DeclaredRouter {
  readonly routes: readonly DeclaredRoute[];
  readonly prefix?: string;
  readonly type?: string;
}

/** The routes one router declares: a list of routes, or an object with `routes`, `prefix` and `type`. */
const routerRoutes = (router: TsNode): DeclaredRouter | string => {
  const list = Node.isArrayLiteralExpression(router) ? router : resolved(propertyOf(router, 'routes'));
  if (list === undefined || !Node.isArrayLiteralExpression(list)) return 'it exports neither a core router nor an object with a list of routes';
  const prefix = Node.isArrayLiteralExpression(router) ? undefined : textOf(propertyOf(router, 'prefix'));
  const type = Node.isArrayLiteralExpression(router) ? undefined : textOf(propertyOf(router, 'type'));
  const routes = list.getElements().flatMap((element): DeclaredRoute[] => {
    const route = resolved(element);
    const method = textOf(propertyOf(route, 'method'));
    const path = textOf(propertyOf(route, 'path'));
    if (route === undefined || method === undefined || path === undefined) return [];
    const written = propertyOf(route, 'handler');
    const handlerValue = written === undefined ? undefined : unwrapValue(written);
    // A handler written as a list is Strapi's chain: the functions before the last run in front of it.
    const chain = handlerValue !== undefined && Node.isArrayLiteralExpression(handlerValue) ? handlerValue.getElements() : undefined;
    const handler = chain === undefined ? handlerValue : chain[chain.length - 1];
    const config = resolved(propertyOf(route, 'config'));
    // A route whose config writes a prefix is mounted beside its router, not under the router's own prefix.
    const ownPrefix = propertyOf(config, 'prefix') !== undefined;
    return [
      {
        method: method.toUpperCase(),
        path,
        ...(ownPrefix ? { ownPrefix: true as const } : {}),
        at: route,
        handler: textOf(handler) ?? handler,
        policies: listOf(propertyOf(config, 'policies')),
        middlewares: [...listOf(propertyOf(config, 'middlewares')), ...(chain?.slice(0, -1) ?? [])],
      },
    ];
  });
  return { routes, ...(prefix === undefined ? {} : { prefix }), ...(type === undefined ? {} : { type }) };
};

/**
 * The routers one routes file - or a local plugin's `routes` - declares, or
 * why they are not read (P327, P329). A core router, `createCoreRouter(uid)`;
 * an object with `routes`, or a list of routes; a function Strapi calls with
 * `{ strapi }` returning one, or a factory call of the repository's own; and,
 * for a plugin, an object of routers by name, each one of those.
 */
const routersOf = (value: TsNode | undefined, repoDir: string, plugins: readonly LocalPlugin[], byName: boolean): readonly DeclaredRouter[] | string => {
  const router = objectOf(value);
  if (router === undefined) return 'it exports neither a core router nor an object with a list of routes';
  if (isFactory(router, 'createCoreRouter')) {
    const [uidArgument, optionsArgument] = router.getArguments();
    const uid = textOf(uidArgument);
    if (uid === undefined) return 'its content type is not written as a literal';
    const type = contentTypeOf(repoDir, uid, plugins);
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
      .map(
        (route): DeclaredRoute => ({ method: route.method, path: `/${name}${route.under}`, at: router, handler: `${uid}.${route.action}`, core: true, policies: [], middlewares: [] }),
      );
    return [{ routes, ...(prefix === undefined ? {} : { prefix }) }];
  }
  // A plugin's routers by name, as Strapi takes an object there: `{ 'content-api': { type, routes }, admin: () => ({ ... }) }`.
  if (byName && Node.isObjectLiteralExpression(router)) {
    const found: DeclaredRouter[] = [];
    for (const property of router.getProperties()) {
      const each = Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
      const read = routersOf(each, repoDir, plugins, false);
      if (typeof read === 'string') return read;
      found.push(...read);
    }
    return found;
  }
  const read = routerRoutes(router);
  return typeof read === 'string' ? read : [read];
};

/** A local plugin of the application's: its name, its directory, and the object its server entry exports. */
interface LocalPlugin {
  readonly name: string;
  readonly dir: string;
  readonly server?: TsNode;
  /** The file its server's value was read from, for a row. */
  readonly file: string;
}

/** A source file of the project at a repository path, tried with each extension. */
const sourceAt = (ctx: ExtractContext, path: string): SourceFile | undefined => {
  for (const extension of EXTENSIONS) {
    const found = ctx.project.getSourceFile(join(ctx.repoDir, `${path}.${extension}`));
    if (found !== undefined && !found.isDeclarationFile()) return found;
  }
  return undefined;
};

/**
 * The local plugins an application enables (P329): each key of
 * `config/plugins.*` written with `resolve`, a path in the repository -
 * `'./src/plugins/reviews'` - and not `enabled: false`, as Strapi's
 * `getEnabledPlugins` takes it, resolved from the application's root. Its
 * server is what `strapi-server.*` in that directory exports, followed through
 * the module it requires; where that is the plugin's build (`./dist/server`,
 * not in the repository), the source it is built from, `server/src/index.*`
 * or `server/index.*`.
 */
const localPluginsOf = (ctx: ExtractContext): readonly LocalPlugin[] => {
  const config = readConfigLiteral(ctx.repoDir, EXTENSIONS.map((extension) => `config/plugins.${extension}`));
  const value = config?.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const plugins: LocalPlugin[] = [];
  for (const [name, declaration] of Object.entries(value as Record<string, unknown>)) {
    const resolve = configValueAt(declaration, 'resolve');
    if (typeof resolve !== 'string' || configValueAt(declaration, 'enabled') === false) continue;
    const dir = posix.normalize(resolve).replace(/^\.\//, '').replace(/\/$/, '');
    if (dir.startsWith('..') || dir.startsWith('/')) continue;
    const entry = sourceAt(ctx, `${dir}/strapi-server`);
    const exported = entry === undefined ? undefined : objectOf(moduleValue(entry));
    const source = ['server/src/index', 'server/index', 'src/server/index'].map((each) => sourceAt(ctx, `${dir}/${each}`)).find((each) => each !== undefined);
    const server = exported !== undefined && Node.isObjectLiteralExpression(exported) ? exported : source === undefined ? undefined : objectOf(moduleValue(source));
    const file = normalizeFilePath((server ?? entry ?? source)?.getSourceFile().getFilePath() ?? join(ctx.repoDir, dir), ctx.repoDir);
    plugins.push({ name, dir, file, ...(server === undefined ? {} : { server }) });
  }
  return plugins;
};

/** A key of an object written as one or returned by the function written in its place, followed to what it is. */
const keyOf = (object: TsNode | undefined, key: string): TsNode | undefined => objectOf(propertyOf(object, key));

/** Whose route a route is, which names its handler, its policies and its middlewares relative to it. */
type Owner = { readonly kind: 'api'; readonly api: string } | { readonly kind: 'plugin'; readonly plugin: LocalPlugin };

/** The file a uid of the application's own names under a directory: `src/policies/<name>.*`. */
const namedFile = (ctx: ExtractContext, dir: string, name: string): SourceFile | undefined => sourceAt(ctx, `${dir}/${name}`) ?? sourceAt(ctx, `${dir}/${name}/index`);

/**
 * What a policy or a middleware a route's config names is (P329), as Strapi's
 * registries resolve the name: `global::<name>` the application's
 * `src/policies` or `src/middlewares`, `api::<api>.<name>` that API's own,
 * `plugin::<plugin>.<name>` a local plugin's `policies` or `middlewares`; a
 * policy's bare name the route's own API's or plugin's; a function written in
 * the route itself. Strapi's own (`admin::`, `strapi::`, an installed plugin's)
 * is no code of the repository, and keeps its name.
 */
const wrapperOf = (
  ctx: ExtractContext,
  element: TsNode,
  layer: 'guard' | 'middleware',
  owner: Owner,
  plugins: readonly LocalPlugin[],
  routeFile: string,
): EntryWrapping => {
  const value = unwrapValue(element);
  const kindDir = layer === 'guard' ? 'policies' : 'middlewares';
  const source = layer === 'guard' ? 'strapi/config.policies' : 'strapi/config.middlewares';
  const named = textOf(value) ?? textOf(propertyOf(value, 'name'));
  const line = startLineOf(element);
  const runsOf = (fn: TsNode | undefined, label: string): EntryHandler | undefined => {
    if (fn === undefined) return undefined;
    const declared = repoFunctionOf(fn) ?? (Node.isFunctionDeclaration(fn) ? namedFunction(fn) : undefined);
    if (declared !== undefined) return handlerOfFunction(declared, ctx);
    return inlineHandlerOf(fn, label, ctx);
  };
  if (named === undefined) {
    // A function written in the route, or one of the code's own it names.
    const fn = resolved(value);
    const declared = fn === undefined ? undefined : (repoFunctionOf(value) ?? (Node.isFunctionDeclaration(fn) ? namedFunction(fn) : undefined));
    const label = declared?.name ?? `${layer === 'guard' ? 'policy' : 'middleware'}@${line}`;
    const runs = runsOf(fn, label);
    return { label, layer, scope: 'route', source, file: declared === undefined ? routeFile : fileOfNode(declared.declaration, ctx), line: declared?.line ?? line, kind: 'function', ...(runs === undefined ? {} : { runs }) };
  }
  const global = /^global::(.+)$/.exec(named);
  const api = /^api::([\w-]+)\.(.+)$/.exec(named);
  const plugin = /^plugin::([\w-]+)\.(.+)$/.exec(named);
  let found: { readonly file: SourceFile; readonly value?: TsNode } | undefined;
  const fromFile = (file: SourceFile | undefined): typeof found => (file === undefined ? undefined : { file, ...(moduleValue(file) === undefined ? {} : { value: moduleValue(file) as TsNode }) });
  const fromPlugin = (local: LocalPlugin | undefined, name: string): typeof found => {
    const held = local === undefined ? undefined : resolved(propertyOf(keyOf(local.server, kindDir), name));
    return held === undefined ? undefined : { file: held.getSourceFile(), value: held };
  };
  if (global !== null) found = fromFile(namedFile(ctx, `src/${kindDir}`, global[1] as string));
  else if (api !== null) found = fromFile(namedFile(ctx, `src/api/${api[1]}/${kindDir}`, api[2] as string));
  else if (plugin !== null) found = fromPlugin(plugins.find((each) => each.name === plugin[1]), plugin[2] as string);
  else if (layer === 'guard' && !named.includes('::')) {
    found = owner.kind === 'api' ? fromFile(namedFile(ctx, `src/api/${owner.api}/${kindDir}`, named)) : fromPlugin(owner.plugin, named);
  }
  if (found === undefined) return { label: named, layer, scope: 'route', source, file: routeFile, line, kind: 'name' };
  // A policy is its function, or the `handler` of the object its module exports; a middleware the factory its module exports.
  const fn = found.value !== undefined && Node.isObjectLiteralExpression(found.value) ? resolved(propertyOf(found.value, 'handler')) : found.value;
  const runs = runsOf(fn, named);
  return { label: named, layer, scope: 'route', source, file: normalizeFilePath(found.file.getFilePath(), ctx.repoDir), line: fn === undefined ? 1 : startLineOf(fn), kind: 'file', ...(runs === undefined ? {} : { runs }) };
};

/**
 * A Strapi application's server (P321, P327, P329): where it listens, and
 * the routes of its own APIs and local plugins.
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
 * `routes: [{ method, path, handler }]`, exported as an object, as a function
 * Strapi calls with `{ strapi }`, or as what a factory of the code's own
 * returns (P329). A handler `<controller>.<action>` (or
 * `api::<api>.<controller>.<action>`) is the action of
 * `src/api/<api>/controllers/<controller>.*` where that file writes it - a
 * plain object's member, or one of the object `createCoreController`'s
 * factory returns - and Strapi's own core action where a core controller does
 * not; a route whose handler is not found says so.
 *
 * A local plugin `config/plugins` enables with a `resolve` path (P329) adds
 * its server's `routes` as Strapi's `registerPluginRoutes` mounts them: a
 * list of routes at `/<plugin>` on the admin API (no `/api`); an object of
 * routers by name, each on the API its `type` names (`admin` where none,
 * `content-api` under `/api`) under its `prefix` (`/<plugin>` where none);
 * its handlers its own `controllers`'. Strapi's own admin panel's routes
 * (`/admin/...`, `@strapi/admin`) are not the repository's code and are not
 * read; an admin route the repository declares, a plugin's router of `type:
 * 'admin'`, is. A route's `config.policies` are drawn as guards in front of
 * its handler and its `config.middlewares` (and a handler written as a list's
 * functions before the last) as middleware, in Strapi's order. Routes an
 * extension (`src/extensions/<plugin>/strapi-server.*`) adds to a plugin the
 * repository does not hold are said, since that plugin's router and prefix
 * are not its code.
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
    const extensions: { readonly plugin: string; readonly file: string; readonly sourceFile: SourceFile }[] = [];
    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      const extension = /^src\/extensions\/([^/]+)\/strapi-server\.(?:[cm]?[jt]s)$/.exec(file);
      if (extension !== null) extensions.push({ plugin: extension[1] as string, file, sourceFile });
      const match = API_FILE.exec(file);
      if (match === null) continue;
      const [, api, kind, name] = match as unknown as [string, string, string, string];
      if (kind === 'routes') routeFiles.push({ api, file, sourceFile });
      else if (!controllers.has(`${api}.${name}`)) controllers.set(`${api}.${name}`, controllerOf(moduleValue(sourceFile)));
    }
    const plugins = localPluginsOf(ctx);
    const routed = plugins.filter((plugin) => propertyOf(plugin.server, 'routes') !== undefined);
    if (routeFiles.length === 0 && routed.length === 0 && extensions.length === 0) return entries;
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
    const unreadRoutes = (file: string, why: string): void => {
      ctx.builder.addUnresolved({
        file,
        line: 1,
        reason: 'route-registry-unread',
        message: `The routes of ${file} are not read: ${why}.`,
        hint: "Export createCoreRouter('api::<api>.<type>') with the type's schema.json beside it, or an object (or a function returning one) whose routes are written as a list of { method, path, handler }.",
        symbol: file,
        adapter: ADAPTER,
      });
    };
    /** The controller a handler's name finds for a route of an owner. */
    const controllerFor = (owner: Owner, name: string): Controller | undefined => {
      const qualified = /^(api|plugin)::([\w-]+)\.([\w-]+)$/.exec(name);
      if (owner.kind === 'api' || qualified?.[1] === 'api') {
        return controllers.get(qualified === null ? `${owner.kind === 'api' ? owner.api : ''}.${name}` : `${qualified[2]}.${qualified[3]}`);
      }
      const plugin = qualified === null ? owner.plugin : plugins.find((each) => each.name === qualified[2]);
      const held = plugin === undefined ? undefined : keyOf(keyOf(plugin.server, 'controllers'), qualified === null ? name : (qualified[3] as string));
      return held === undefined ? undefined : controllerOf(held);
    };
    const emit = (route: DeclaredRoute, file: string, owner: Owner, mount: string, routerPrefix: string | undefined): void => {
      const path = joinPath(mount, route.ownPrefix === true ? undefined : routerPrefix, route.path);
      const key = makeHttpEntryKey(route.method, path);
      const id = makeEntryId(ctx.repo, 'http', key);
      if (seen.has(id)) return;
      seen.add(id);
      const label = `${route.method} ${path}`;
      let handler: EntryHandler | undefined;
      let handlerVia: 'function' | 'inline' | 'framework' | 'unread' = 'unread';
      let named: string | undefined;
      if (typeof route.handler === 'string') {
        named = route.handler;
        const dot = route.handler.lastIndexOf('.');
        const action = route.handler.slice(dot + 1);
        const controller = controllerFor(owner, route.handler.slice(0, dot));
        handler = controller === undefined ? undefined : actionHandler(controller, action, route.handler, ctx);
        if (handler !== undefined) handlerVia = 'inline' in handler ? 'inline' : 'function';
        else if (route.core === true && (controller === undefined || controller.core) && (CORE_ACTIONS as readonly string[]).includes(action)) handlerVia = 'framework';
      } else if (route.handler !== undefined) {
        const fn = repoFunctionOf(route.handler);
        handler = fn !== undefined ? handlerOfFunction(fn, ctx) : inlineHandlerOf(unwrapValue(route.handler), label, ctx);
        if (handler !== undefined) handlerVia = 'inline' in handler ? 'inline' : 'function';
      }
      if (handlerVia === 'unread') {
        ctx.builder.addUnresolved({
          file,
          line: startLineOf(route.at),
          reason: 'route-handler-unread',
          message: `The handler of ${label}${named === undefined ? '' : `, ${named},`} was not found in the ${owner.kind === 'api' ? "API's" : `plugin ${owner.plugin.name}'s`} controllers, so the code behind the route is not pointed at.`,
          hint:
            owner.kind === 'api'
              ? 'Write the action in src/api/<api>/controllers/<controller>, as a member of the object the file exports or of the one createCoreController returns.'
              : "Write the action in the plugin's controllers, as a member of the object its server exports under controllers.",
          symbol: named ?? label,
          adapter: ADAPTER,
        });
      }
      // Strapi runs a route's policies, then its middlewares, then the handler (compose-endpoint).
      const wrapping = [
        ...route.policies.map((each) => wrapperOf(ctx, each, 'guard', owner, plugins, file)),
        ...route.middlewares.map((each) => wrapperOf(ctx, each, 'middleware', owner, plugins, file)),
      ];
      entries.push({
        id,
        kind: 'http',
        label,
        key,
        ...(handler === undefined ? {} : { handler }),
        request: REQUEST,
        file,
        line: startLineOf(route.at),
        ...(wrapping.length === 0 ? {} : { wrapping }),
        meta: {
          method: route.method,
          path,
          adapter: ADAPTER,
          registration: route.core === true ? 'strapi/core-router' : owner.kind === 'plugin' ? 'strapi/plugin-routes' : 'strapi/routes',
          ...(owner.kind === 'plugin' ? { plugin: owner.plugin.name } : {}),
          handlerVia,
          ...(named === undefined ? {} : { handlerName: named }),
          // Strapi's own authentication and the application's global middlewares are not read.
          middlewareRead: false,
        },
      });
    };
    const byFile = (a: { readonly file: string }, b: { readonly file: string }): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
    for (const { api, file, sourceFile } of [...routeFiles].sort(byFile)) {
      const read = routersOf(moduleValue(sourceFile), ctx.repoDir, plugins, false);
      if (typeof read === 'string') {
        unreadRoutes(file, read);
        continue;
      }
      // An API's routers are mounted on the content API, whatever they say.
      for (const router of read) for (const route of router.routes) emit(route, file, { kind: 'api', api }, apiPrefix, router.prefix);
    }
    for (const plugin of routed) {
      const value = propertyOf(plugin.server, 'routes');
      const list = resolved(value);
      const read = routersOf(value, ctx.repoDir, plugins, true);
      if (typeof read === 'string') {
        unreadRoutes(plugin.file, read);
        continue;
      }
      const owner: Owner = { kind: 'plugin', plugin };
      for (const router of read) {
        // A plugin's list of routes is one router on the admin API at /<plugin>; a named router says its own type and prefix.
        const contentApi = list !== undefined && !Node.isArrayLiteralExpression(list) && router.type === 'content-api';
        const prefix = list !== undefined && Node.isArrayLiteralExpression(list) ? `/${plugin.name}` : (router.prefix ?? `/${plugin.name}`);
        for (const route of router.routes) emit(route, normalizeFilePath(route.at.getSourceFile().getFilePath(), ctx.repoDir), owner, contentApi ? apiPrefix : '', prefix);
      }
    }
    for (const { plugin, file, sourceFile } of extensions.sort(byFile)) {
      // Routes an extension pushes into a plugin's router: `plugin.routes['content-api'].routes.push({ ... })`.
      const pushed = sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((call) => {
          const callee = call.getExpression();
          return Node.isPropertyAccessExpression(callee) && callee.getName() === 'push' && /\.routes\b/.test(callee.getExpression().getText());
        })
        .flatMap((call) => call.getArguments())
        .flatMap((argument) => {
          const route = resolved(argument);
          const method = textOf(propertyOf(route, 'method'));
          const path = textOf(propertyOf(route, 'path'));
          return method === undefined || path === undefined ? [] : [`${method.toUpperCase()} ${path}`];
        });
      if (pushed.length === 0) continue;
      const local = plugins.some((each) => each.name === plugin);
      ctx.builder.addUnresolved({
        file,
        line: 1,
        reason: 'route-mount-unread',
        message: local
          ? `${file} adds ${pushed.join(', ')} to the routes of the plugin ${plugin} at run time, into a router this does not follow there, so they are not read as ways in.`
          : `${file} adds ${pushed.join(', ')} to the routes of the plugin ${plugin}, whose router and the prefix it serves them under are the plugin's own code, not the repository's, so they are not read as ways in.`,
        hint: 'Declare the route in an API of the application (src/api/<api>/routes), where its address is the application\'s own.',
        symbol: plugin,
        adapter: ADAPTER,
      });
    }
    return entries;
  },
};
