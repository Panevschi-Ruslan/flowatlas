import { readFileSync } from 'node:fs';
import { join, posix, resolve as resolvePath } from 'node:path';
import {
  ConfigPath,
  NotLiteral,
  configValueAt,
  hasAnyDependency,
  isTestFile,
  makeEntryId,
  makeHttpEntryKey,
  namedFunction,
  normalizeFilePath,
  readConfigLiteral,
  startLineOf,
  toPosixPath,
  type EntryAdapter,
  type EntryHandler,
  type EntryNode,
  type EntryWrapping,
  type ExtractContext,
} from '@flowatlas/core';
import { Node, Project, SyntaxKind, type CallExpression, type Node as TsNode, type SourceFile } from 'ts-morph';
import { packageAtDir, packageFileOf, packageFinder, type PackageAt } from './installed-packages.js';
import { strapiEnvironmentOf, strapiListens } from './listen-ports.js';
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

/**
 * The projects an installed plugin's code is parsed in (P335): one of its own
 * per package, apart from the repository's, a file opened only when a module
 * followed names it.
 */
const installedProjects = new WeakSet<object>();

/** The file of the project a path names, tried with each extension and as a directory's index. */
const moduleAt = (sourceFile: SourceFile, path: string): SourceFile | undefined => {
  const project = sourceFile.getProject();
  const lazily = installedProjects.has(project);
  const bare = path.replace(/\.[cm]?[jt]s$/, '');
  for (const candidate of [path, ...EXTENSIONS.map((extension) => `${bare}.${extension}`), ...EXTENSIONS.map((extension) => `${bare}/index.${extension}`)]) {
    const found = project.getSourceFile(candidate) ?? (lazily && /\.[cm]?[jt]s$/.test(candidate) ? project.addSourceFileAtPathIfExists(candidate) : undefined);
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
    // A package's module is not followed from the repository's code; inside an installed plugin's own code it is (P335).
    if (file === undefined || (file.isInNodeModules() && !value.getSourceFile().isInNodeModules()) || file.isDeclarationFile()) return value;
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
  if (
    Node.isObjectLiteralExpression(value) ||
    Node.isArrayLiteralExpression(value) ||
    isFactory(value, 'createCoreRouter') ||
    isFactory(value, 'createCoreController') ||
    isFactory(value, 'createContentApiRoutesFactory')
  ) {
    return value;
  }
  return objectReturned(value);
};

/** A content type's schema: whether it is a single type, and its names. */
interface ContentType {
  readonly single: boolean;
  readonly singularName: string;
  readonly pluralName: string;
}

/** The schema of `api::<api>.<type>`, or `plugin::<plugin>.<type>` of a local plugin, read from its `schema.json`. */
const contentTypeOf = (repoDir: string, uid: string, plugins: readonly Plugin[]): ContentType | undefined => {
  const api = /^api::([\w-]+)\.([\w-]+)$/.exec(uid);
  const plugin = /^plugin::([\w-]+)\.([\w-]+)$/.exec(uid);
  const local = plugin === null ? undefined : plugins.find((each) => each.name === plugin[1]);
  const candidates =
    api !== null
      ? [join(repoDir, 'src', 'api', api[1] as string, 'content-types', api[2] as string, 'schema.json')]
      : local !== undefined && plugin !== null
        ? ['server/src/content-types', 'server/content-types'].map((dir) => join(local.root, dir, plugin[2] as string, 'schema.json'))
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
  /** The key a plugin's object of routers holds it under, `'content-api'` (P335). */
  readonly name?: string;
}

/** One route as Strapi takes it, `{ method, path, handler, config }`, or nothing where its method or path is not written as a literal. */
const declaredRoute = (element: TsNode): DeclaredRoute | undefined => {
  const route = resolved(element);
  const method = textOf(propertyOf(route, 'method'));
  const path = textOf(propertyOf(route, 'path'));
  if (route === undefined || method === undefined || path === undefined) return undefined;
  const written = propertyOf(route, 'handler');
  const handlerValue = written === undefined ? undefined : unwrapValue(written);
  // A handler written as a list is Strapi's chain: the functions before the last run in front of it.
  const chain = handlerValue !== undefined && Node.isArrayLiteralExpression(handlerValue) ? handlerValue.getElements() : undefined;
  const handler = chain === undefined ? handlerValue : chain[chain.length - 1];
  const config = resolved(propertyOf(route, 'config'));
  // A route whose config writes a prefix is mounted beside its router, not under the router's own prefix.
  const ownPrefix = propertyOf(config, 'prefix') !== undefined;
  return {
    method: method.toUpperCase(),
    path,
    ...(ownPrefix ? { ownPrefix: true as const } : {}),
    at: route,
    handler: textOf(handler) ?? handler,
    policies: listOf(propertyOf(config, 'policies')),
    middlewares: [...listOf(propertyOf(config, 'middlewares')), ...(chain?.slice(0, -1) ?? [])],
  };
};

/**
 * The routes a list writes (P335): each element a route, and a list spread
 * into it - one a name holds, or one a function of the code's own returns
 * (`...authRoutes(strapi)`) - read the same way.
 */
const routesIn = (list: TsNode, depth: number): DeclaredRoute[] => {
  if (!Node.isArrayLiteralExpression(list) || depth > FOLLOW_DEPTH) return [];
  return list.getElements().flatMap((element) => {
    if (!Node.isSpreadElement(element)) return declaredRoute(element) ?? [];
    const spread = objectOf(element.getExpression());
    return spread === undefined ? [] : routesIn(spread, depth + 1);
  });
};

/** The routes one router declares: a list of routes, or an object with `routes`, `prefix` and `type`. */
const routerRoutes = (router: TsNode): DeclaredRouter | string => {
  const list = Node.isArrayLiteralExpression(router) ? router : resolved(propertyOf(router, 'routes'));
  if (list === undefined || !Node.isArrayLiteralExpression(list)) return 'it exports neither a core router nor an object with a list of routes';
  const prefix = Node.isArrayLiteralExpression(router) ? undefined : textOf(propertyOf(router, 'prefix'));
  const type = Node.isArrayLiteralExpression(router) ? undefined : textOf(propertyOf(router, 'type'));
  const routes = routesIn(list, 0);
  return { routes, ...(prefix === undefined ? {} : { prefix }), ...(type === undefined ? {} : { type }) };
};

/**
 * The routers one routes file - or a local plugin's `routes` - declares, or
 * why they are not read (P327, P329). A core router, `createCoreRouter(uid)`;
 * an object with `routes`, or a list of routes; a function Strapi calls with
 * `{ strapi }` returning one, or a factory call of the repository's own; and,
 * for a plugin, an object of routers by name, each one of those.
 */
const routersOf = (value: TsNode | undefined, repoDir: string, plugins: readonly Plugin[], byName: boolean): readonly DeclaredRouter[] | string => {
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
  // `createContentApiRoutesFactory(build)` of `@strapi/utils`: a router of `type: 'content-api'` whose routes `build` returns (P335).
  if (isFactory(router, 'createContentApiRoutesFactory')) {
    const list = objectReturned(resolved(router.getArguments()[0]));
    if (list === undefined || !Node.isArrayLiteralExpression(list)) return 'the function its content API routes factory is handed does not return a list of routes written as one';
    return [{ routes: routesIn(list, 0), type: 'content-api' }];
  }
  // A plugin's routers by name, as Strapi takes an object there: `{ 'content-api': { type, routes }, admin: () => ({ ... }) }`.
  if (byName && Node.isObjectLiteralExpression(router)) {
    const found: DeclaredRouter[] = [];
    for (const property of router.getProperties()) {
      const each = Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
      const nameNode = Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
      const name = nameNode === undefined ? undefined : Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
      const read = routersOf(each, repoDir, plugins, false);
      if (typeof read === 'string') return read;
      found.push(...read.map((one) => (name === undefined ? one : { ...one, name })));
    }
    return found;
  }
  const read = routerRoutes(router);
  return typeof read === 'string' ? read : [read];
};

/**
 * A plugin an application enables (P329, P335): its name, its directory, and
 * the object its server entry exports. An installed one - a package under
 * `node_modules`, not a workspace package - is read from its own code in a
 * project of its own, its routes the application's ways in and its code the
 * package's.
 */
interface Plugin {
  readonly name: string;
  /** Its directory, absolute. */
  readonly root: string;
  readonly server?: TsNode;
  /** The file its server's value was read from, for a row. */
  readonly file: string;
  /** The package it is, where that is installed under `node_modules` (P335). */
  readonly installed?: string;
  /** It has a server entry, whose value is not read as an object (P335). */
  readonly unreadServer?: true;
}

/** Strapi's own plugins, enabled always and none of them the repository's code (`getEnabledPlugins`'s internal list, by their names). */
const INTERNAL_PLUGINS: ReadonlySet<string> = new Set(['content-manager', 'content-type-builder', 'email', 'upload', 'i18n', 'content-releases', 'review-workflows']);

/** A source file of a project at an absolute path written without its extension, tried with each. */
const sourceIn = (project: Project, base: string): SourceFile | undefined => {
  for (const extension of EXTENSIONS) {
    const found = project.getSourceFile(`${base}.${extension}`);
    if (found !== undefined && !found.isDeclarationFile()) return found;
  }
  return undefined;
};

/** A source file of the project at a repository path, tried with each extension. */
const sourceAt = (ctx: ExtractContext, path: string): SourceFile | undefined => sourceIn(ctx.project, join(ctx.repoDir, path));

/** A configuration's object, apart from a value written as code or a path. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof NotLiteral) && !(value instanceof ConfigPath);

/** One configuration laid over another, objects merged key by key, as lodash's `merge` lays `config/env/<env>/plugins` over `config/plugins`. */
const mergedConfig = (base: unknown, over: unknown): unknown => {
  if (!isRecord(base) || !isRecord(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = mergedConfig(base[key], value);
  return out;
};

/** A plugin's package as an application's dependency: its directory, whether installed, its package's name. */
interface DependencyPlugin {
  readonly at: PackageAt;
  readonly pkg: string;
}

/** What `exports['./strapi-server']` writes under one condition, a path. */
const strapiServerExport = (at: PackageAt, condition: string): string | undefined => {
  const exportsField = at.manifest['exports'];
  const entry = isRecord(exportsField) ? exportsField['./strapi-server'] : undefined;
  const written = isRecord(entry) ? entry[condition] : undefined;
  return typeof written === 'string' ? join(at.dir, written) : undefined;
};

/**
 * The object a plugin's server entry exports (P329, P335). For a plugin of the
 * repository's: what `strapi-server.*` in its directory exports, followed
 * through the module it requires - or the source the package's `exports`
 * names for it (`source`, as Strapi's plugin kit writes) - and where that is
 * the plugin's build (`./dist/server`, not in the repository), the source it
 * is built from, `server/src/index.*` or `server/index.*`. For one installed:
 * the file Strapi loads, its `exports['./strapi-server']` for `require` or its
 * `strapi-server.js`, parsed with the modules it requires.
 */
const serverOf = (ctx: ExtractContext, root: string, at: PackageAt | undefined, installed: boolean): { readonly server?: TsNode; readonly file: string; readonly unread?: true } => {
  if (installed) {
    const project = new Project({ compilerOptions: { allowJs: true, noEmit: true }, skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true, skipLoadingLibFiles: true });
    installedProjects.add(project);
    // The source the package ships its server's build from, where it does - the same routes, before a bundler wraps them.
    const shipped = at === undefined ? undefined : strapiServerExport(at, 'source');
    const fromSource = shipped === undefined ? undefined : project.addSourceFileAtPathIfExists(shipped);
    const readFromSource = fromSource === undefined ? undefined : objectOf(moduleValue(fromSource));
    const entryPath = (at === undefined ? undefined : (strapiServerExport(at, 'require') ?? strapiServerExport(at, 'default') ?? packageFileOf(at, 'strapi-server'))) ?? join(root, 'strapi-server.js');
    const entry = readFromSource !== undefined && Node.isObjectLiteralExpression(readFromSource) ? fromSource : (project.getSourceFile(entryPath) ?? project.addSourceFileAtPathIfExists(entryPath));
    const server = entry === undefined ? undefined : entry === fromSource ? readFromSource : objectOf(moduleValue(entry));
    const read = server !== undefined && Node.isObjectLiteralExpression(server);
    return {
      file: normalizeFilePath((server ?? entry)?.getSourceFile().getFilePath() ?? entryPath, ctx.repoDir),
      ...(read ? { server } : {}),
      ...(entry !== undefined && !read ? { unread: true as const } : {}),
    };
  }
  const declaredSource = at === undefined ? undefined : strapiServerExport(at, 'source');
  const fromSource = declaredSource === undefined ? undefined : (ctx.project.getSourceFile(declaredSource) ?? sourceIn(ctx.project, declaredSource.replace(/\.[cm]?[jt]s$/, '')));
  const entry = sourceIn(ctx.project, join(root, 'strapi-server'));
  const exported = entry === undefined ? undefined : objectOf(moduleValue(entry));
  const source = fromSource ?? ['server/src/index', 'server/index', 'src/server/index'].map((each) => sourceIn(ctx.project, join(root, each))).find((each) => each !== undefined);
  const server = exported !== undefined && Node.isObjectLiteralExpression(exported) ? exported : source === undefined ? undefined : objectOf(moduleValue(source));
  const read = server !== undefined && Node.isObjectLiteralExpression(server);
  return {
    file: normalizeFilePath((server ?? entry ?? source)?.getSourceFile().getFilePath() ?? root, ctx.repoDir),
    ...(read ? { server } : {}),
    ...((entry !== undefined || source !== undefined) && !read ? { unread: true as const } : {}),
  };
};

/** Why a plugin the application enables is not read, for a row. */
interface PluginUnread {
  readonly name: string;
  readonly file: string;
  readonly why: string;
}

/**
 * The plugins an application enables (P329, P335), as Strapi's
 * `getEnabledPlugins` takes them: each key of `config/plugins.*`, with the
 * environment's `config/env/<NODE_ENV>/plugins.*` merged over it, and each
 * dependency of the application whose package says it is a Strapi plugin
 * (`strapi.kind: 'plugin'`), named by its `strapi.name`. A key written with
 * `resolve` is the directory it names, from the application's root; a key
 * with none is the dependency of that name. A plugin is enabled where its key
 * says `enabled: true`, or where it is a dependency its key does not turn off
 * - a key that names a directory without `enabled: true` is not enabled, and
 * a local plugin no key names is not loaded at all. Strapi's own plugins are
 * not the repository's code and are left out. A key enabling a plugin that is
 * neither a directory nor an installed package here is said.
 */
const pluginsOf = (ctx: ExtractContext): { readonly plugins: readonly Plugin[]; readonly unread: readonly PluginUnread[]; readonly off: ReadonlySet<string> } => {
  const base = readConfigLiteral(ctx.repoDir, EXTENSIONS.map((extension) => `config/plugins.${extension}`));
  const environment = readConfigLiteral(ctx.repoDir, EXTENSIONS.map((extension) => `config/env/${strapiEnvironmentOf(ctx.repoDir)}/plugins.${extension}`));
  const declared = mergedConfig(isRecord(base?.value) ? base.value : {}, isRecord(environment?.value) ? environment.value : undefined);
  const configFile = base === undefined ? 'package.json' : normalizeFilePath(base.file, ctx.repoDir);
  const dependencies = new Map<string, DependencyPlugin>();
  const packageDirOf = packageFinder(ctx.repoDir);
  for (const pkg of Object.keys(ctx.pkg.dependencies ?? {})) {
    const at = packageDirOf(pkg);
    const strapi = at?.manifest['strapi'];
    if (at === undefined || !isRecord(strapi) || strapi['kind'] !== 'plugin' || typeof strapi['name'] !== 'string') continue;
    dependencies.set(strapi['name'], { at, pkg });
  }
  const declarations = isRecord(declared) ? declared : {};
  const dirOf = (resolve: unknown): string | undefined => {
    if (resolve instanceof ConfigPath) return resolve.path;
    if (typeof resolve !== 'string') return undefined;
    const pkg = /^[.]{0,2}\//.test(resolve) ? undefined : packageDirOf(resolve);
    return pkg?.dir ?? resolvePath(ctx.repoDir, resolve);
  };
  const declaredDirs = new Set(Object.values(declarations).flatMap((each) => dirOf(configValueAt(each, 'resolve')) ?? []));
  const plugins: Plugin[] = [];
  const unread: PluginUnread[] = [];
  for (const name of [...new Set([...Object.keys(declarations), ...dependencies.keys()])].sort()) {
    if (INTERNAL_PLUGINS.has(name)) continue;
    const declaration = declarations[name];
    const resolve = typeof declaration === 'boolean' ? undefined : configValueAt(declaration, 'resolve');
    const written = typeof declaration === 'boolean' ? declaration : configValueAt(declaration, 'enabled');
    // A dependency whose directory a key resolves to is that key's plugin, not one of its own.
    const dependency = dependencies.get(name);
    const unused = dependency !== undefined && !declaredDirs.has(dependency.at.dir) ? dependency : undefined;
    const dir = dirOf(resolve);
    // Undefined `enabled` is filled from the dependency of that name, the only place one is written for it.
    const enabled = written === undefined ? unused !== undefined : written !== false;
    if (!enabled) continue;
    if (resolve !== undefined && dir === undefined) {
      unread.push({ name, file: configFile, why: `config/plugins resolves it from ${resolve instanceof NotLiteral ? resolve.text : 'a value'} not written as a path` });
      continue;
    }
    const root = dir ?? unused?.at.dir;
    if (root === undefined) {
      unread.push({ name, file: configFile, why: 'config/plugins enables it, and no package of that name is installed in the repository' });
      continue;
    }
    const at = dir === undefined ? unused?.at : packageAtDir(dir);
    const installed = dir === undefined ? (unused?.at.installed === true ? unused.pkg : undefined) : /[\\/]node_modules[\\/]/.test(dir) ? name : undefined;
    const { server, file, unread: serverUnread } = serverOf(ctx, root, at, installed !== undefined);
    plugins.push({
      name,
      root,
      file,
      ...(server === undefined ? {} : { server }),
      ...(installed === undefined ? {} : { installed }),
      ...(serverUnread === true ? { unreadServer: true as const } : {}),
    });
  }
  // The directories a key turns off on purpose, `enabled: false`.
  const off = Object.values(declarations).flatMap((each) => (configValueAt(each, 'enabled') === false ? (dirOf(configValueAt(each, 'resolve')) ?? []) : []));
  return { plugins, unread, off: new Set(off.map((dir) => toPosixPath(dir).replace(/\/$/, ''))) };
};

/** A key of an object written as one or returned by the function written in its place, followed to what it is. */
const keyOf = (object: TsNode | undefined, key: string): TsNode | undefined => objectOf(propertyOf(object, key));

/** Whose route a route is, which names its handler, its policies and its middlewares relative to it. */
type Owner =
  | { readonly kind: 'api'; readonly api: string }
  | { readonly kind: 'plugin'; readonly plugin: Plugin }
  /** A route the code registers on Strapi's server itself (P335): Strapi looks its handler up by a full uid, `api::<api>.<controller>.<action>`. */
  | { readonly kind: 'app' };

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
  plugins: readonly Plugin[],
  routeFile: string,
): EntryWrapping => {
  const value = unwrapValue(element);
  const kindDir = layer === 'guard' ? 'policies' : 'middlewares';
  const source = layer === 'guard' ? 'strapi/config.policies' : 'strapi/config.middlewares';
  const named = textOf(value) ?? textOf(propertyOf(value, 'name'));
  const line = startLineOf(element);
  // An installed plugin's own policies and middlewares are its package's code, kept by their names (P335).
  if (owner.kind === 'plugin' && owner.plugin.installed !== undefined) {
    return { label: named ?? `${layer === 'guard' ? 'policy' : 'middleware'}@${line}`, layer, scope: 'route', source, file: routeFile, line: 1, kind: 'name' };
  }
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
  const fromPlugin = (local: Plugin | undefined, name: string): typeof found => {
    const held = local === undefined || local.installed !== undefined ? undefined : resolved(propertyOf(keyOf(local.server, kindDir), name));
    return held === undefined ? undefined : { file: held.getSourceFile(), value: held };
  };
  if (global !== null) found = fromFile(namedFile(ctx, `src/${kindDir}`, global[1] as string));
  else if (api !== null) found = fromFile(namedFile(ctx, `src/api/${api[1]}/${kindDir}`, api[2] as string));
  else if (plugin !== null) found = fromPlugin(plugins.find((each) => each.name === plugin[1]), plugin[2] as string);
  else if (layer === 'guard' && !named.includes('::')) {
    found = owner.kind === 'api' ? fromFile(namedFile(ctx, `src/api/${owner.api}/${kindDir}`, named)) : owner.kind === 'plugin' ? fromPlugin(owner.plugin, named) : undefined;
  }
  if (found === undefined) return { label: named, layer, scope: 'route', source, file: routeFile, line, kind: 'name' };
  // A policy is its function, or the `handler` of the object its module exports; a middleware the factory its module exports.
  const fn = found.value !== undefined && Node.isObjectLiteralExpression(found.value) ? resolved(propertyOf(found.value, 'handler')) : found.value;
  const runs = runsOf(fn, named);
  return { label: named, layer, scope: 'route', source, file: normalizeFilePath(found.file.getFilePath(), ctx.repoDir), line: fn === undefined ? 1 : startLineOf(fn), kind: 'file', ...(runs === undefined ? {} : { runs }) };
};

/** The keys of an access, from the name it starts at: `plugin.routes['content-api'].routes` is `plugin`, `routes`, `content-api`, `routes`. */
const accessKeys = (node: TsNode): string[] | undefined => {
  const value = unwrapValue(node);
  if (Node.isIdentifier(value)) return [value.getText()];
  if (Node.isPropertyAccessExpression(value)) {
    const owner = accessKeys(value.getExpression());
    return owner === undefined ? undefined : [...owner, value.getName()];
  }
  if (Node.isElementAccessExpression(value)) {
    const key = textOf(value.getArgumentExpression());
    const owner = accessKeys(value.getExpression());
    return owner === undefined || key === undefined ? undefined : [...owner, key];
  }
  return undefined;
};

/** What an extension, `src/extensions/<plugin>/strapi-server.*`, does to a plugin's routes and controllers (P329, P335). */
interface Extension {
  readonly plugin: string;
  readonly file: string;
  /** The routes it pushes into the plugin's routers: the key of the router, none for a plugin's list of routes. */
  readonly pushed: readonly { readonly router?: string; readonly route: DeclaredRoute }[];
  /** The routes it pushes, by `<METHOD> <path>`, for a row where they are not read. */
  readonly said: readonly string[];
  /** What it does to the routes otherwise, not read: each write and each route not written as a literal. */
  readonly unread: readonly string[];
  /** The actions it writes onto the plugin's controllers, `plugin.controllers.auth.session = fn`, by `<controller>.<action>`. */
  readonly actions: ReadonlyMap<string, TsNode>;
}

/**
 * An extension read (P335), as Strapi runs it over the plugin before it
 * registers the plugin's routes (`applyUserExtension`): the function the file
 * exports is handed the plugin, and what it pushes into
 * `<plugin>.routes['<router>'].routes` - or into `<plugin>.routes`, where the
 * plugin's routes are a list - is served as the plugin's own route, under
 * that router; what it writes onto `<plugin>.controllers.<controller>.<action>`
 * is the action that answers in place of the plugin's.
 */
const extensionOf = (sourceFile: SourceFile, plugin: string, file: string): Extension => {
  const fn = moduleValue(sourceFile);
  const parameter = fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isFunctionDeclaration(fn)) ? fn.getParameters()[0]?.getName() : undefined;
  const handed = parameter ?? 'plugin';
  const pushed: { router?: string; route: DeclaredRoute }[] = [];
  const said: string[] = [];
  const unread: string[] = [];
  const actions = new Map<string, TsNode>();
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !['push', 'unshift'].includes(callee.getName())) continue;
    const keys = accessKeys(callee.getExpression());
    if (keys === undefined || keys[0] !== handed || keys[1] !== 'routes') continue;
    const router = keys.length === 2 ? undefined : keys.length === 4 && keys[3] === 'routes' ? keys[2] : null;
    for (const argument of call.getArguments()) {
      const route = Node.isSpreadElement(argument) ? undefined : declaredRoute(argument);
      if (route === undefined) {
        unread.push(`a route at line ${startLineOf(argument)} whose method and path are not written as literals`);
        continue;
      }
      said.push(`${route.method} ${route.path}`);
      if (router === null) unread.push(`${route.method} ${route.path} into ${callee.getExpression().getText()}`);
      else pushed.push({ ...(router === undefined ? {} : { router }), route });
    }
  }
  for (const write of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (write.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const keys = accessKeys(write.getLeft());
    if (keys === undefined || keys[0] !== handed) continue;
    if (keys[1] === 'controllers' && keys.length === 4) actions.set(`${keys[2]}.${keys[3]}`, write.getRight());
    else if (keys[1] === 'routes') unread.push(`its write of ${write.getLeft().getText()}`);
  }
  return { plugin, file, pushed, said, unread, actions };
};

/** The methods of Koa's router a route is registered with on Strapi's `server.router` (P335), and the method each serves. */
const KOA_VERBS: ReadonlyMap<string, string> = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['del', 'DELETE'],
  ['head', 'HEAD'],
  ['options', 'OPTIONS'],
  ['all', 'ALL'],
]);

/** Whether an expression is Strapi's server, `strapi.server` - an access of `server` on whatever names Strapi. */
const isServer = (node: TsNode): boolean => {
  const value = unwrapValue(node);
  return Node.isPropertyAccessExpression(value) && value.getName() === 'server';
};

/**
 * A route the code registers on Strapi's server itself (P335), in a
 * `register` or a `bootstrap` - the application's or a plugin's: what
 * `strapi.server.routes(x)` hands it, `strapi.server.api('<api>').routes(x)`,
 * and `strapi.server.router.<verb>(path, ...fns)`.
 */
type ServerCall =
  | { readonly kind: 'routes'; readonly call: CallExpression; readonly api?: string }
  | { readonly kind: 'router'; readonly call: CallExpression; readonly method: string };

const serverCallOf = (call: CallExpression): ServerCall | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const receiver = unwrapValue(callee.getExpression());
  if (callee.getName() === 'routes' && isServer(receiver)) return { kind: 'routes', call };
  if (callee.getName() === 'routes' && Node.isCallExpression(receiver)) {
    const api = receiver.getExpression();
    const name = textOf(receiver.getArguments()[0]);
    if (Node.isPropertyAccessExpression(api) && api.getName() === 'api' && isServer(api.getExpression()) && name !== undefined) return { kind: 'routes', call, api: name };
  }
  const method = KOA_VERBS.get(callee.getName());
  if (method !== undefined && Node.isPropertyAccessExpression(receiver) && receiver.getName() === 'router' && isServer(receiver.getExpression())) return { kind: 'router', call, method };
  return undefined;
};

/**
 * A Strapi application's server (P321, P327, P329, P335): where it listens,
 * and the routes of its own APIs, of the plugins it enables, and those its
 * code registers on the server.
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
 * A plugin the application enables ({@link pluginsOf}) adds its server's
 * `routes` as Strapi's `registerPluginRoutes` mounts them: a list of routes at
 * `/<plugin>` on the admin API (no `/api`); an object of routers by name,
 * each on the API its `type` names (`admin` where none, `content-api` under
 * `/api`) under its `prefix` (`/<plugin>` where none); its handlers its own
 * `controllers`'. An installed plugin's routes are read from its package and
 * its handlers are the package's code (`handlerVia: 'package'`), unless an
 * extension writes the action. Strapi's own admin panel's routes
 * (`/admin/...`, `@strapi/admin`) and its own plugins are not the
 * repository's code and are not read; an admin route the repository declares,
 * a plugin's router of `type: 'admin'`, is. A route's `config.policies` are
 * drawn as guards in front of its handler and its `config.middlewares` (and a
 * handler written as a list's functions before the last) as middleware, in
 * Strapi's order. An extension (`src/extensions/<plugin>/strapi-server.*`,
 * {@link extensionOf}) adds the routes it pushes to the plugin's router and
 * answers the actions it writes; what it does otherwise, or to a plugin not
 * read, is said. Routes the code registers on the server (P335,
 * {@link serverCallOf}) are served as Strapi's `server.routes` mounts them:
 * an object with a `type` on that API (`content-api` under `/api`, `admin` at
 * the root) under its `prefix`, an object without one or a list at the root,
 * a `server.router` route at its path; Strapi looks their handlers up by a
 * full uid. A local plugin with a server no key of `config/plugins` enables
 * is not loaded by Strapi, and is said.
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
    const extensions: Extension[] = [];
    const servers: { readonly dir: string; readonly file: string; readonly sourceFile: SourceFile }[] = [];
    const serverCalls: ServerCall[] = [];
    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      if (isTestFile(file)) continue;
      const extension = /^src\/extensions\/([^/]+)\/strapi-server\.(?:[cm]?[jt]s)$/.exec(file);
      if (extension !== null) extensions.push(extensionOf(sourceFile, extension[1] as string, file));
      else if (/(?:^|\/)strapi-server\.(?:[cm]?[jt]s)$/.test(file)) servers.push({ dir: posix.dirname(toPosixPath(sourceFile.getFilePath())), file, sourceFile });
      if (sourceFile.getFullText().includes('.server')) {
        for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const found = serverCallOf(call);
          if (found !== undefined) serverCalls.push(found);
        }
      }
      const match = API_FILE.exec(file);
      if (match === null) continue;
      const [, api, kind, name] = match as unknown as [string, string, string, string];
      if (kind === 'routes') routeFiles.push({ api, file, sourceFile });
      else if (!controllers.has(`${api}.${name}`)) controllers.set(`${api}.${name}`, controllerOf(moduleValue(sourceFile)));
    }
    const { plugins, unread: pluginsUnread, off } = pluginsOf(ctx);
    for (const { name, file, why } of pluginsUnread) {
      ctx.builder.addUnresolved({
        file,
        line: 1,
        reason: 'route-registry-unread',
        message: `The routes of the Strapi plugin ${name} are not read: ${why}.`,
        hint: 'Install the dependencies where the map is built, or resolve the plugin from a directory of the repository with a path written as a literal.',
        symbol: name,
        adapter: ADAPTER,
      });
    }
    // A plugin's server Strapi never loads: no key of config/plugins enables its directory (P335).
    const enabledRoots = new Set(plugins.map((plugin) => toPosixPath(plugin.root).replace(/\/$/, '')));
    for (const server of servers.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
      // One a key turns off (enabled: false) is off on purpose.
      if (enabledRoots.has(server.dir) || off.has(server.dir) || propertyOf(objectOf(moduleValue(server.sourceFile)), 'routes') === undefined) continue;
      if (plugins.some((plugin) => server.dir.startsWith(`${toPosixPath(plugin.root)}/`))) continue;
      ctx.builder.addUnresolved({
        file: server.file,
        line: 1,
        reason: 'plugin-not-enabled',
        level: 'info',
        message: `${server.file} is the server of a Strapi plugin no key of config/plugins enables - Strapi loads a plugin of the repository only where a key resolves its directory with enabled: true - so its routes are not served and not drawn.`,
        hint: "Enable the plugin in config/plugins, { '<name>': { enabled: true, resolve: './<its directory>' } }, to have it served.",
        symbol: posix.basename(server.dir),
        adapter: ADAPTER,
      });
    }
    const routed = plugins.filter((plugin) => propertyOf(plugin.server, 'routes') !== undefined);
    if (routeFiles.length === 0 && routed.length === 0 && extensions.length === 0 && serverCalls.length === 0 && !plugins.some((plugin) => plugin.unreadServer === true)) return entries;
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
    const unreadRoutes = (file: string, why: string, line = 1): void => {
      ctx.builder.addUnresolved({
        file,
        line,
        reason: 'route-registry-unread',
        message: `The routes of ${file} are not read: ${why}.`,
        hint: "Export createCoreRouter('api::<api>.<type>') with the type's schema.json beside it, or an object (or a function returning one) whose routes are written as a list of { method, path, handler }.",
        symbol: file,
        adapter: ADAPTER,
      });
    };
    /** The actions extensions write onto each plugin's controllers. */
    const overrides = new Map<string, Map<string, TsNode>>();
    for (const extension of extensions) {
      const held = overrides.get(extension.plugin) ?? new Map<string, TsNode>();
      for (const [key, value] of extension.actions) held.set(key, value);
      overrides.set(extension.plugin, held);
    }
    /** The plugin a handler's name is an action of: the route's own plugin's, or the plugin a full uid names. */
    const pluginOfHandler = (owner: Owner, name: string): { readonly plugin: Plugin; readonly action: string } | undefined => {
      const qualified = /^plugin::([\w-]+)\.(.+)$/.exec(name);
      if (qualified !== null) {
        const plugin = plugins.find((each) => each.name === qualified[1]);
        return plugin === undefined ? undefined : { plugin, action: qualified[2] as string };
      }
      return owner.kind === 'plugin' && !name.startsWith('api::') ? { plugin: owner.plugin, action: name } : undefined;
    };
    /** The controller a handler's name finds for a route of an owner. */
    const controllerFor = (owner: Owner, name: string): Controller | undefined => {
      const qualified = /^(api|plugin)::([\w-]+)\.([\w-]+)$/.exec(name);
      if (owner.kind === 'app' && qualified === null) return undefined;
      if (owner.kind === 'api' || qualified?.[1] === 'api') {
        return controllers.get(qualified === null ? `${owner.kind === 'api' ? owner.api : ''}.${name}` : `${qualified[2]}.${qualified[3]}`);
      }
      const plugin = qualified === null ? (owner.kind === 'plugin' ? owner.plugin : undefined) : plugins.find((each) => each.name === qualified[2]);
      const held = plugin === undefined ? undefined : keyOf(keyOf(plugin.server, 'controllers'), qualified === null ? name : (qualified[3] as string));
      return held === undefined ? undefined : controllerOf(held);
    };
    const handlerOfNode = (node: TsNode, label: string): EntryHandler | undefined => {
      const fn = repoFunctionOf(node);
      return fn !== undefined ? handlerOfFunction(fn, ctx) : inlineHandlerOf(unwrapValue(node), label, ctx);
    };
    const emit = (route: DeclaredRoute, file: string, owner: Owner, mount: string, routerPrefix: string | undefined): void => {
      const path = joinPath(mount, route.ownPrefix === true ? undefined : routerPrefix, route.path);
      const key = makeHttpEntryKey(route.method, path);
      const id = makeEntryId(ctx.repo, 'http', key);
      if (seen.has(id)) return;
      seen.add(id);
      const label = `${route.method} ${path}`;
      let handler: EntryHandler | undefined;
      let handlerVia: 'function' | 'inline' | 'framework' | 'package' | 'unread' = 'unread';
      let named: string | undefined;
      if (typeof route.handler === 'string') {
        named = route.handler;
        const dot = route.handler.lastIndexOf('.');
        const action = route.handler.slice(dot + 1);
        const ofPlugin = pluginOfHandler(owner, route.handler);
        // An action an extension writes answers in place of the plugin's own (P335).
        const written = ofPlugin === undefined ? undefined : overrides.get(ofPlugin.plugin.name)?.get(ofPlugin.action);
        if (written !== undefined) handler = handlerOfNode(written, route.handler);
        else if (ofPlugin?.plugin.installed !== undefined) handlerVia = 'package';
        else {
          const controller = controllerFor(owner, route.handler.slice(0, dot));
          handler = controller === undefined ? undefined : actionHandler(controller, action, route.handler, ctx);
          if (handler === undefined && route.core === true && (controller === undefined || controller.core) && (CORE_ACTIONS as readonly string[]).includes(action)) handlerVia = 'framework';
        }
        if (handler !== undefined) handlerVia = 'inline' in handler ? 'inline' : 'function';
      } else if (route.handler !== undefined) {
        if (owner.kind === 'plugin' && owner.plugin.installed !== undefined) handlerVia = 'package';
        else {
          handler = handlerOfNode(route.handler, label);
          if (handler !== undefined) handlerVia = 'inline' in handler ? 'inline' : 'function';
        }
      }
      if (handlerVia === 'unread') {
        ctx.builder.addUnresolved({
          file,
          line: route.at.getSourceFile().isInNodeModules() ? 1 : startLineOf(route.at),
          reason: 'route-handler-unread',
          message: `The handler of ${label}${named === undefined ? '' : `, ${named},`} was not found in the ${owner.kind === 'api' ? "API's" : owner.kind === 'plugin' ? `plugin ${owner.plugin.name}'s` : 'application\'s'} controllers, so the code behind the route is not pointed at.`,
          hint:
            owner.kind === 'api'
              ? 'Write the action in src/api/<api>/controllers/<controller>, as a member of the object the file exports or of the one createCoreController returns.'
              : owner.kind === 'plugin'
                ? "Write the action in the plugin's controllers, as a member of the object its server exports under controllers."
                : 'Name the handler by its full uid, api::<api>.<controller>.<action>, as Strapi looks up a route registered on its server.',
          symbol: named ?? label,
          adapter: ADAPTER,
        });
      }
      // Strapi runs a route's policies, then its middlewares, then the handler (compose-endpoint).
      const wrapping = [
        ...route.policies.map((each) => wrapperOf(ctx, each, 'guard', owner, plugins, file)),
        ...route.middlewares.map((each) => wrapperOf(ctx, each, 'middleware', owner, plugins, file)),
      ];
      const installed = owner.kind === 'plugin' ? owner.plugin.installed : undefined;
      entries.push({
        id,
        kind: 'http',
        label,
        key,
        ...(handler === undefined ? {} : { handler }),
        request: REQUEST,
        file,
        line: route.at.getSourceFile().isInNodeModules() ? 1 : startLineOf(route.at),
        ...(wrapping.length === 0 ? {} : { wrapping }),
        meta: {
          method: route.method,
          path,
          adapter: ADAPTER,
          registration:
            route.core === true ? 'strapi/core-router' : owner.kind === 'plugin' ? 'strapi/plugin-routes' : owner.kind === 'app' ? 'strapi/server-routes' : 'strapi/routes',
          ...(owner.kind === 'plugin' ? { plugin: owner.plugin.name } : {}),
          ...(installed === undefined ? {} : { package: installed, declaredIn: normalizeFilePath(route.at.getSourceFile().getFilePath(), ctx.repoDir) }),
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
    for (const plugin of plugins) {
      const value = propertyOf(plugin.server, 'routes');
      const additions = extensions.filter((each) => each.plugin === plugin.name);
      if (plugin.unreadServer === true) {
        unreadRoutes(plugin.file, "its server entry does not export an object, nor a function returning one, that is read");
        continue;
      }
      if (value === undefined && additions.every((each) => each.pushed.length === 0)) continue;
      const list = resolved(value);
      const read = value === undefined ? [] : routersOf(value, ctx.repoDir, plugins, true);
      if (typeof read === 'string') {
        unreadRoutes(plugin.file, read);
        continue;
      }
      const owner: Owner = { kind: 'plugin', plugin };
      // An installed plugin's routes are drawn at the application's package.json, where it is installed from (P335).
      const fileOf = (route: DeclaredRoute): string => (plugin.installed !== undefined ? 'package.json' : normalizeFilePath(route.at.getSourceFile().getFilePath(), ctx.repoDir));
      const listed = list === undefined || Node.isArrayLiteralExpression(list);
      /** Where a router is mounted: a plugin's list of routes on the admin API at /<plugin>; a named router on its own type, under its own prefix. */
      const mountOf = (router: DeclaredRouter | undefined): { readonly mount: string; readonly prefix: string } => ({
        mount: !listed && router?.type === 'content-api' ? apiPrefix : '',
        prefix: listed ? `/${plugin.name}` : (router?.prefix ?? `/${plugin.name}`),
      });
      for (const router of read) {
        const { mount, prefix } = mountOf(router);
        for (const route of router.routes) emit(route, fileOf(route), owner, mount, prefix);
      }
      // What an extension pushes into one of its routers is served there (P335).
      for (const extension of additions) {
        for (const { router: key, route } of extension.pushed) {
          const router = key === undefined ? undefined : read.find((each) => each.name === key);
          if ((key === undefined) !== listed || (key !== undefined && router === undefined)) {
            ctx.builder.addUnresolved({
              file: extension.file,
              line: startLineOf(route.at),
              reason: 'route-mount-unread',
              message: `${extension.file} adds ${route.method} ${route.path} to ${key === undefined ? 'a list of routes' : `the router ${key}`} of the plugin ${plugin.name}, which has ${listed ? 'a list of routes' : key === undefined ? 'routers by name' : 'no such router'} there, so it is not read as a way in.`,
              hint: "Push the route into a router the plugin's server declares, plugin.routes['<router>'].routes.",
              symbol: plugin.name,
              adapter: ADAPTER,
            });
            continue;
          }
          const { mount, prefix } = mountOf(router);
          emit(route, extension.file, owner, mount, prefix);
        }
      }
    }
    for (const extension of [...extensions].sort(byFile)) {
      const held = plugins.some((each) => each.name === extension.plugin);
      const notRead = held ? extension.unread : extension.said;
      if (notRead.length === 0) continue;
      ctx.builder.addUnresolved({
        file: extension.file,
        line: 1,
        reason: 'route-mount-unread',
        message: held
          ? `${extension.file} changes the routes of the plugin ${extension.plugin} otherwise than by pushing a route written as a literal into one of its routers - ${notRead.join(', ')} - so what that changes is not read.`
          : `${extension.file} adds ${notRead.join(', ')} to the routes of the plugin ${extension.plugin}, which is not installed in the repository nor one of its own, so its router and the prefix it serves them under are not read, nor are they as ways in.`,
        hint: held
          ? "Push each route, written as { method, path, handler }, into plugin.routes['<router>'].routes."
          : 'Install the dependencies where the map is built, or declare the route in an API of the application (src/api/<api>/routes).',
        symbol: extension.plugin,
        adapter: ADAPTER,
      });
    }
    // Routes the code registers on Strapi's server (P335).
    for (const each of serverCalls) {
      const call = each.call;
      const file = normalizeFilePath(call.getSourceFile().getFilePath(), ctx.repoDir);
      const owner: Owner = { kind: 'app' };
      if (each.kind === 'router') {
        const args = call.getArguments();
        // Koa's router takes a route's name before its path where it is given one.
        const named = args.length >= 3 && textOf(args[0]) !== undefined && textOf(args[1]) !== undefined;
        const path = textOf(args[named ? 1 : 0]);
        const fns = args.slice(named ? 2 : 1);
        if (path === undefined || fns.length === 0) {
          unreadRoutes(file, `the path of the route ${call.getExpression().getText()} registers is not written as a literal`, startLineOf(call));
          continue;
        }
        emit({ method: each.method, path, at: call, handler: fns[fns.length - 1], policies: [], middlewares: fns.slice(0, -1) }, file, owner, '', undefined);
        continue;
      }
      const value = objectOf(call.getArguments()[0]);
      if (value !== undefined && Node.isArrayLiteralExpression(value)) {
        const mount = each.api === undefined ? '' : each.api === 'content-api' ? apiPrefix : '';
        for (const route of routesIn(value, 0)) emit(route, file, owner, mount, undefined);
        continue;
      }
      const router = value === undefined ? 'it hands the server a value not written as a list of routes nor an object of them' : routerRoutes(value);
      if (typeof router === 'string') {
        unreadRoutes(file, router, startLineOf(call));
        continue;
      }
      const type = each.api ?? router.type;
      if (type !== undefined && type !== 'content-api' && type !== 'admin') {
        unreadRoutes(file, `it hands them to the API ${type}, which is not one Strapi's server has (content-api, admin)`, startLineOf(call));
        continue;
      }
      for (const route of router.routes) emit(route, file, owner, type === 'content-api' ? apiPrefix : '', router.prefix);
    }
    return entries;
  },
};
