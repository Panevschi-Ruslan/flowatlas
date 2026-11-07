import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  ConfigPath,
  NotLiteral,
  configValueAt,
  isWithinDir,
  normalizePath,
  toPosixPath,
  workspaceGlobs,
  workspacePackages,
  workspaceRootsAbove,
  type Unresolved,
} from '@flowatlas/core';
import { ts } from 'ts-morph';
import type { NuxtLayer, NuxtLayout } from './framework-conventions.js';

/**
 * What the Nuxt modules of a repository add when the application builds
 * (P251), read off their syntax.
 *
 * A module is a function Nuxt runs while it builds, and what it adds - a
 * directory whose exports are used unimported, a route served from a file
 * nowhere near `server/`, a page at an address no directory gives, an alias -
 * is written nowhere else. A module of the repository is code the reader has:
 * each file of a part's `modules/` (registered by Nuxt itself), and each entry
 * of a part's `modules` that names a path or a package of the workspace. Its
 * file is parsed, never run, and each call of Nuxt's kit is read where its
 * argument is a literal or a path built from the module's own file - the way
 * the module starter writes one (`createResolver(import.meta.url).resolve()`,
 * `resolve(__dirname, ...)`, `fileURLToPath(new URL(..., import.meta.url))`).
 * Anything else is a row naming the call.
 *
 * A module installed from a registry is a package's code, which no reader
 * reads as the repository's: it is named in a note, with what it adds where
 * that is fixed and documented and none of it the repository's.
 */

const NUXT_ADAPTER = 'nitro-routes';

/** An absolute path as the graph names a file: relative to the repository, climbing out with `..` where it is outside. */
const fromRepo = (repoDir: string, path: string): string => toPosixPath(relative(repoDir, path));

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const realOf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** A list in a sentence: `a`, `a and b`, `a, b and c`. */
const inWords = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// ---------------------------------------------------------------------------
// Packages

/** A package name and the path inside it an entry names: `@shop/base/layer` is `@shop/base` and `layer`. */
const packageOf = (specifier: string): { name: string; subpath: string } => {
  const parts = specifier.split('/');
  const width = specifier.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, width).join('/'), subpath: parts.slice(width).join('/') };
};

/**
 * The directory of a package Nuxt is handed by its name (P243, P251): a
 * package of the workspace by that name, or what `node_modules` links it to
 * when the link leads out of every `node_modules` - a workspace package
 * installed. One installed from a registry is no code of the repository.
 */
export const nuxtPackageDir = (root: string, from: string, specifier: string): { dir: string } | { why: 'installed' | 'not-installed' } => {
  const { name, subpath } = packageOf(specifier.replace(/^npm:/, ''));
  const workspaces = [...(workspaceGlobs(root).length > 0 ? [root] : []), ...workspaceRootsAbove(root)];
  for (const workspace of workspaces) {
    const member = workspacePackages(workspace).find((pkg) => pkg.name === name);
    if (member !== undefined) return { dir: join(member.dir, subpath) };
  }
  for (let at = from; ; at = dirname(at)) {
    const linked = join(at, 'node_modules', name);
    if (existsSync(linked)) {
      const real = toPosixPath(realOf(linked));
      return real.includes('/node_modules/') ? { why: 'installed' } : { dir: join(real, subpath) };
    }
    if (dirname(at) === at) return { why: 'not-installed' };
  }
};

/**
 * What a few popular modules add, where that is fixed, documented and none of
 * it the repository's code (P251): names, components or settings of their
 * own package. Said in the note so a reader knows nothing of the graph is
 * missing for them. `@pinia/nuxt`'s `stores/` is read as the application's
 * own (P240) and is said nowhere.
 */
export const NUXT_KNOWN_MODULES: ReadonlyMap<string, string> = new Map([
  ['@vueuse/nuxt', "the composables of `@vueuse/core`, by name"],
  ['@nuxt/image', 'the `<NuxtImg>` and `<NuxtPicture>` components of its own package'],
  ['@nuxt/icon', 'the `<Icon>` component of its own package'],
  ['@nuxt/fonts', 'fonts, and no code'],
  ['@nuxt/eslint', 'lint settings, and no code'],
  ['@nuxt/devtools', 'tools for development, and no code'],
  ['@nuxtjs/tailwindcss', 'styles, and no code'],
  ['@nuxtjs/color-mode', 'the `useColorMode` composable of its own package'],
]);

/** Modules whose additions are already read as the application's own (P240). */
const READ_ELSEWHERE = new Set(['@pinia/nuxt']);

// ---------------------------------------------------------------------------
// What one module adds

/** A directory a module scans for names, repo-relative. */
export interface ModuleImportDir {
  readonly dir: string;
  readonly nested: boolean;
}

/** One name a module adds from one file (`addImports`). */
export interface ModuleImport {
  /** Repo-relative file. */
  readonly file: string;
  /** The name files use it by. */
  readonly name: string;
  /** The export it is: its own name, or `default`. */
  readonly export: string;
}

/** A server handler a module adds (`addServerHandler`). */
export interface ModuleHandler {
  /** The address, as written; none for one that stands in front of every route. */
  readonly route?: string;
  /** Upper case, `ALL` where none is written. */
  readonly method: string;
  /** Repo-relative file whose default export handles it. */
  readonly handler: string;
  /** Repo-relative module file, and the line of the call, where the route is declared. */
  readonly file: string;
  readonly line: number;
  readonly middleware: boolean;
}

/** A page a module adds (`extendPages`). */
export interface ModulePage {
  readonly path: string;
  /** Repo-relative component file. */
  readonly file: string;
  readonly line: number;
}

/** An alias a module sets, and whether it replaces what the configuration writes (`=`) or only fills it in (`||=`). */
export interface ModuleAlias {
  readonly key: string;
  /** Repo-relative target. */
  readonly target: string;
  readonly replaces: boolean;
}

/** Everything one module adds that this reader reads. */
export interface NuxtModuleAdditions {
  readonly importDirs: readonly ModuleImportDir[];
  readonly serverImportDirs: readonly ModuleImportDir[];
  readonly imports: readonly ModuleImport[];
  readonly serverImports: readonly ModuleImport[];
  readonly handlers: readonly ModuleHandler[];
  readonly pages: readonly ModulePage[];
  readonly aliases: readonly ModuleAlias[];
  /** Repo-relative directories of components it registers by name: said, not drawn. */
  readonly componentDirs: readonly string[];
  /** Route middleware it adds, by name: said, not drawn. */
  readonly routeMiddleware: readonly string[];
  /** Calls of the kit this reader does not read, by name: what they add is not drawn by any reader. */
  readonly notRead: readonly string[];
  /**
   * The calls read that are written under a condition (`if (options.x)`):
   * read as made, since what the condition is handed is the configuration's
   * options at build time, and said in the note so the reading is not taken
   * for more than it is.
   */
  readonly conditional: readonly string[];
}

/** One module of the repository the application is built with. */
export interface NuxtModule {
  /** Repo-relative file. */
  readonly file: string;
  /** As a row names it: the entry `modules` writes, or the file Nuxt registers by itself. */
  readonly name: string;
  /** The part that registers it. */
  readonly layer: NuxtLayer;
  /** Where that part is ranked, the application `0`. */
  readonly rank: number;
  /** Absolute directory it is built in from: the package, or the directory the path names. */
  readonly dir: string;
  readonly additions: NuxtModuleAdditions;
}

/** A module installed as a package, named by a part. */
export interface InstalledModule {
  readonly name: string;
  readonly why: 'installed' | 'not-installed';
  /** What it adds, from {@link NUXT_KNOWN_MODULES}, where that is known. */
  readonly adds?: string;
  readonly layer: NuxtLayer;
}

/** Every module of a Nuxt application, first to last, and what was not read. */
export interface NuxtModules {
  readonly modules: readonly NuxtModule[];
  readonly installed: readonly InstalledModule[];
  /** Modules and additions not read, as gaps. */
  readonly rows: readonly Unresolved[];
}

/** The expression under any number of parentheses, `as`, `satisfies` and `!`. */
const unwrap = (node: ts.Expression): ts.Expression => {
  let at = node;
  while (
    ts.isParenthesizedExpression(at) ||
    ts.isAsExpression(at) ||
    ts.isSatisfiesExpression(at) ||
    ts.isTypeAssertionExpression(at) ||
    ts.isNonNullExpression(at) ||
    ts.isAwaitExpression(at)
  ) {
    at = at.expression;
  }
  return at;
};

const literalText = (node: ts.Expression | undefined): string | undefined => {
  if (node === undefined) return undefined;
  const value = unwrap(node);
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined;
};

/** The callee's last name: `addImportsDir`, `kit.addImportsDir` alike. */
const calleeName = (call: ts.CallExpression): string | undefined => {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
};

/** A property of an object literal by its name: its value, or `true` for a method or a shorthand. */
const propertyOf = (object: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined => {
  for (const property of object.properties) {
    const name = property.name;
    const named = name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;
    if (named !== key) continue;
    if (ts.isPropertyAssignment(property)) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
  }
  return undefined;
};

/** The calls of the kit that add nothing a reader draws, said by name in the note. */
const NOT_READ = new Set([
  'addPlugin',
  'addPluginTemplate',
  'addServerPlugin',
  'addTemplate',
  'addTypeTemplate',
  'addServerTemplate',
  'addLayout',
  'addServerScanDir',
  'addVitePlugin',
  'addWebpackPlugin',
  'addBuildPlugin',
  'addImportsSources',
  'addComponent',
  'addPrerenderRoutes',
  'extendRouteRules',
  'extendViteConfig',
  'extendWebpackConfig',
]);

/** What reading one module file finds: its additions, the modules it installs and the calls it could not read. */
interface ModuleReading {
  readonly additions: NuxtModuleAdditions;
  /** `installModule(...)`: a path built from the file, or a package name. */
  readonly installs: ReadonlyArray<{ path: string } | { name: string }>;
  readonly rows: readonly Unresolved[];
}

/** Where a path a module writes leads: an absolute path, or nothing this reader can place. */
interface PathScope {
  readonly file: ts.SourceFile;
  readonly moduleFile: string;
  readonly moduleDir: string;
  /** `const resolver = createResolver(import.meta.url)`: names whose `.resolve` is from the module's directory. */
  readonly resolvers: ReadonlySet<string>;
  /** `const { resolve } = createResolver(import.meta.url)`: names that resolve from the module's directory. */
  readonly resolveFns: ReadonlySet<string>;
  /** Every `const name = ...` of the file, for a path held in a name. */
  readonly consts: ReadonlyMap<string, ts.Expression>;
  /** The application's `srcDir`, absolute, which `~` and `@` name in every part. */
  readonly appSrc: string;
  /** The repository's root, which `~~` and `@@` name. */
  readonly root: string;
}

/** Whether a call is `createResolver(import.meta.url)`, or one of its forms. */
const isModuleResolver = (node: ts.Expression | undefined, file: ts.SourceFile): boolean => {
  if (node === undefined) return false;
  const value = unwrap(node);
  if (!ts.isCallExpression(value) || calleeName(value) !== 'createResolver') return false;
  const [base] = value.arguments;
  const text = base === undefined ? '' : unwrap(base).getText(file);
  return text === 'import.meta.url' || text === '__dirname' || text === 'import.meta.dirname' || text === '__filename';
};

/** The bindings a module file's paths may be held in. */
const scopeOf = (file: ts.SourceFile, moduleFile: string, appSrc: string, root: string): PathScope => {
  const resolvers = new Set<string>();
  const resolveFns = new Set<string>();
  const consts = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (ts.isIdentifier(node.name)) {
        if (isModuleResolver(node.initializer, file)) resolvers.add(node.name.text);
        else consts.set(node.name.text, node.initializer);
      } else if (ts.isObjectBindingPattern(node.name) && isModuleResolver(node.initializer, file)) {
        for (const element of node.name.elements) {
          const property = element.propertyName !== undefined && ts.isIdentifier(element.propertyName) ? element.propertyName.text : ts.isIdentifier(element.name) ? element.name.text : undefined;
          if (property === 'resolve' && ts.isIdentifier(element.name)) resolveFns.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { file, moduleFile, moduleDir: dirname(moduleFile), resolvers, resolveFns, consts, appSrc, root };
};

/**
 * A path a module writes, absolute, or undefined when it is not one this
 * reader can place: built from the module's file, held in a name of the
 * file, absolute, or written with one of Nuxt's own aliases. A plain
 * relative string is not placed: Nuxt resolves it against the application,
 * and a module's author nearly always meant the module (D4).
 */
const pathIn = (scope: PathScope, node: ts.Expression | undefined, depth = 0): string | undefined => {
  if (node === undefined || depth > 8) return undefined;
  const value = unwrap(node);
  const text = literalText(value);
  if (text !== undefined) {
    if (isAbsolute(text)) return text;
    const alias = /^(~~|@@|~|@)(?:\/(.*))?$/.exec(text);
    if (alias === null) return undefined;
    return join(alias[1] === '~~' || alias[1] === '@@' ? scope.root : scope.appSrc, alias[2] ?? '');
  }
  if (ts.isTemplateExpression(value)) {
    let out = value.head.text;
    for (const span of value.templateSpans) {
      const part = pathIn(scope, span.expression, depth + 1);
      if (part === undefined) return undefined;
      out += part + span.literal.text;
    }
    return isAbsolute(out) ? out : undefined;
  }
  const source = value.getText(scope.file);
  if (source === '__dirname' || source === 'import.meta.dirname') return scope.moduleDir;
  if (source === '__filename' || source === 'import.meta.url' || source === 'import.meta.filename') return scope.moduleFile;
  if (ts.isIdentifier(value)) return pathIn(scope, scope.consts.get(value.text), depth + 1);
  if (ts.isNewExpression(value) && value.expression.getText(scope.file) === 'URL') {
    const [first, base] = value.arguments ?? [];
    const relativePath = literalText(first);
    const from = base === undefined ? undefined : pathIn(scope, base, depth + 1);
    if (relativePath === undefined || from === undefined) return undefined;
    return resolve(isDirectory(from) ? from : dirname(from), relativePath);
  }
  if (!ts.isCallExpression(value)) return undefined;
  const callee = unwrap(value.expression);
  const name = calleeName(value);
  const literals = (args: readonly ts.Expression[]): string[] | undefined => {
    const parts = args.map((arg) => literalText(arg));
    return parts.some((part) => part === undefined) ? undefined : (parts as string[]);
  };
  // `resolver.resolve('./runtime')`, `resolve('./runtime')` from the module's resolver.
  if (
    (ts.isPropertyAccessExpression(callee) && name === 'resolve' && ts.isIdentifier(callee.expression) && scope.resolvers.has(callee.expression.text)) ||
    (ts.isIdentifier(callee) && scope.resolveFns.has(callee.text))
  ) {
    const parts = literals(value.arguments);
    return parts === undefined ? undefined : resolve(scope.moduleDir, ...parts);
  }
  if (name === 'fileURLToPath' && value.arguments.length === 1) return pathIn(scope, value.arguments[0], depth + 1);
  if (name === 'dirname' && value.arguments.length === 1) {
    const of = pathIn(scope, value.arguments[0], depth + 1);
    return of === undefined ? undefined : dirname(of);
  }
  if (name === 'resolve' || name === 'join') {
    const [head, ...rest] = value.arguments;
    const from = pathIn(scope, head, depth + 1);
    const parts = literals(rest);
    if (from === undefined || parts === undefined) return undefined;
    return name === 'resolve' ? resolve(from, ...parts) : join(from, ...parts);
  }
  return undefined;
};

/** A directory list an import call is handed: one path, or a list of them. */
const pathsIn = (scope: PathScope, node: ts.Expression | undefined): string[] | undefined => {
  if (node === undefined) return undefined;
  const value = unwrap(node);
  const items = ts.isArrayLiteralExpression(value) ? [...value.elements] : [value];
  const paths = items.map((item) => (ts.isSpreadElement(item) ? undefined : pathIn(scope, item)));
  return paths.some((path) => path === undefined) ? undefined : (paths as string[]);
};

/** A path naming a script file, or a directory's index, with the endings a module specifier leaves off. */
const SCRIPT_ENDINGS = ['', '.ts', '.mts', '.js', '.mjs', '.vue', '/index.ts', '/index.mts', '/index.js', '/index.mjs'];

const scriptFileAt = (path: string): string | undefined => {
  for (const ending of SCRIPT_ENDINGS) {
    const candidate = `${path}${ending}`;
    if (isFile(candidate) && !candidate.endsWith('.d.ts')) return candidate;
  }
  return undefined;
};

/** A directory a scan list writes, and whether below it is scanned too: `composables`, `composables/**`. */
const scanned = (path: string): { absolute: string; nested: boolean } => {
  const glob = path.search(/[*?{[]/);
  return { absolute: (glob === -1 ? path : path.slice(0, glob)).replace(/[\\/]+$/, ''), nested: path.includes('**') };
};

/** Whether a call runs only when something holds: inside a branch of an `if`, a `switch`, `? :`, `&&`, `||` or `??`. */
const underCondition = (node: ts.Node): boolean => {
  for (let child = node, at = node.parent; at !== undefined; child = at, at = at.parent) {
    if (ts.isFunctionLike(at)) return false;
    if (ts.isIfStatement(at) && child !== at.expression) return true;
    if (ts.isConditionalExpression(at) && child !== at.condition) return true;
    if (ts.isCaseClause(at) || ts.isDefaultClause(at)) return true;
    if (
      ts.isBinaryExpression(at) &&
      child === at.right &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(at.operatorToken.kind)
    ) {
      return true;
    }
  }
  return false;
};

/** Reads one module file: what each call of the kit adds, and a row for each it cannot place. */
const readModuleFile = (root: string, absolute: string, app: NuxtLayout): ModuleReading => {
  let text: string;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch {
    text = '';
  }
  const file = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true, /\.[cm]?js$/.test(absolute) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const moduleFile = fromRepo(root, absolute);
  const scope = scopeOf(file, absolute, join(root, app.srcDir), root);
  const importDirs: ModuleImportDir[] = [];
  const serverImportDirs: ModuleImportDir[] = [];
  const imports: ModuleImport[] = [];
  const serverImports: ModuleImport[] = [];
  const handlers: ModuleHandler[] = [];
  const pages: ModulePage[] = [];
  const aliases: ModuleAlias[] = [];
  const componentDirs: string[] = [];
  const routeMiddleware: string[] = [];
  const notRead = new Set<string>();
  const conditional: string[] = [];
  const installs: Array<{ path: string } | { name: string }> = [];
  const rows: Unresolved[] = [];
  const lineOf = (node: ts.Node): number => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const unread = (node: ts.Node, call: string, what: string): void => {
    rows.push({
      file: moduleFile,
      line: lineOf(node),
      reason: 'framework-module-unread',
      symbol: call,
      message: `${call} in ${moduleFile} is handed ${what} that is written as code, or as a path relative to nothing the module's own file names, so what it adds is not read`,
      hint: "Build the path from the module's file - `createResolver(import.meta.url).resolve('./runtime')` - and write the rest as literals.",
      adapter: NUXT_ADAPTER,
      meta: { cause: 'framework-module-unread', why: 'addition', module: moduleFile, call },
    });
  };
  const dirsOf = (node: ts.CallExpression, call: string, into: ModuleImportDir[]): void => {
    const paths = pathsIn(scope, node.arguments[0]);
    if (paths === undefined) return unread(node, call, 'a directory');
    for (const path of paths) {
      const { absolute: dir, nested } = scanned(path);
      into.push({ dir: fromRepo(root, dir), nested });
    }
  };
  const namesOf = (node: ts.CallExpression, call: string, into: ModuleImport[]): void => {
    const [first] = node.arguments;
    const value = first === undefined ? undefined : unwrap(first);
    const items = value !== undefined && ts.isArrayLiteralExpression(value) ? [...value.elements] : value === undefined ? [] : [value];
    for (const item of items) {
      if (!ts.isObjectLiteralExpression(item)) return unread(node, call, 'an import');
      const name = literalText(propertyOf(item, 'name'));
      const as = propertyOf(item, 'as');
      const fromNode = propertyOf(item, 'from');
      const fromText = literalText(fromNode);
      // A name of a package: no file of the repository, as an installed module's.
      if (fromText !== undefined && !fromText.startsWith('.') && !/^(?:~~|@@|~|@)\//.test(fromText) && !isAbsolute(fromText)) continue;
      const from = pathIn(scope, fromNode);
      const target = from === undefined ? undefined : scriptFileAt(from);
      if (name === undefined || target === undefined || (as !== undefined && literalText(as) === undefined)) {
        unread(node, call, 'an import');
        continue;
      }
      into.push({ file: fromRepo(root, target), name: literalText(as) ?? name, export: name });
    }
  };
  const handlerOf = (node: ts.CallExpression): void => {
    const [first] = node.arguments;
    const value = first === undefined ? undefined : unwrap(first);
    if (value === undefined || !ts.isObjectLiteralExpression(value)) return unread(node, 'addServerHandler', 'a handler');
    const routeNode = propertyOf(value, 'route');
    const route = literalText(routeNode);
    const methodNode = propertyOf(value, 'method');
    const method = literalText(methodNode);
    const middlewareNode = propertyOf(value, 'middleware');
    const middleware = middlewareNode !== undefined && unwrap(middlewareNode).kind === ts.SyntaxKind.TrueKeyword;
    const handlerPath = pathIn(scope, propertyOf(value, 'handler'));
    const handler = handlerPath === undefined ? undefined : scriptFileAt(handlerPath);
    if (handler === undefined || (routeNode !== undefined && route === undefined) || (methodNode !== undefined && method === undefined)) {
      return unread(node, 'addServerHandler', 'a handler');
    }
    handlers.push({
      ...(route === undefined || middleware ? {} : { route }),
      method: method === undefined ? 'ALL' : method.toUpperCase(),
      handler: fromRepo(root, handler),
      file: moduleFile,
      line: lineOf(node),
      // A handler with no route stands in front of every route, as one marked so does.
      middleware: middleware || route === undefined,
    });
  };
  const pagesOf = (node: ts.CallExpression, fn: ts.Expression | undefined, call: string): void => {
    const value = fn === undefined ? undefined : unwrap(fn);
    if (value === undefined || !(ts.isArrowFunction(value) || ts.isFunctionExpression(value))) return unread(node, call, 'a function');
    const [param] = value.parameters;
    if (param === undefined || !ts.isIdentifier(param.name)) return unread(node, call, 'a function');
    const list = param.name.text;
    const visit = (inner: ts.Node): void => {
      if (ts.isCallExpression(inner)) {
        const callee = unwrap(inner.expression);
        if (ts.isPropertyAccessExpression(callee) && (callee.name.text === 'push' || callee.name.text === 'unshift') && callee.expression.getText(file) === list) {
          for (const arg of inner.arguments) {
            const page = unwrap(arg);
            const path = ts.isObjectLiteralExpression(page) ? literalText(propertyOf(page, 'path')) : undefined;
            const at = ts.isObjectLiteralExpression(page) ? pathIn(scope, propertyOf(page, 'file')) : undefined;
            const component = at === undefined ? undefined : scriptFileAt(at);
            if (path === undefined || component === undefined) unread(inner, call, 'a page');
            else pages.push({ path, file: fromRepo(root, component), line: lineOf(inner) });
          }
        }
      }
      ts.forEachChild(inner, visit);
    };
    visit(value.body);
  };
  const aliasOf = (node: ts.Node, key: string | undefined, target: ts.Expression, replaces: boolean): void => {
    const path = pathIn(scope, target);
    if (key === undefined || path === undefined) return unread(node, 'nuxt.options.alias', 'an alias');
    aliases.push({ key, target: fromRepo(root, path), replaces });
  };

  /** Strategy by the kit's own name: one row per call this reader knows. */
  const CALLS: ReadonlyMap<string, (node: ts.CallExpression) => void> = new Map([
    ['addImportsDir', (node: ts.CallExpression) => dirsOf(node, 'addImportsDir', importDirs)],
    ['addServerImportsDir', (node: ts.CallExpression) => dirsOf(node, 'addServerImportsDir', serverImportDirs)],
    ['addImports', (node: ts.CallExpression) => namesOf(node, 'addImports', imports)],
    ['addServerImports', (node: ts.CallExpression) => namesOf(node, 'addServerImports', serverImports)],
    ['addServerHandler', handlerOf],
    ['extendPages', (node: ts.CallExpression) => pagesOf(node, node.arguments[0], 'extendPages')],
    [
      'addComponentsDir',
      (node: ts.CallExpression) => {
        const [first] = node.arguments;
        const value = first === undefined ? undefined : unwrap(first);
        const path = value !== undefined && ts.isObjectLiteralExpression(value) ? pathIn(scope, propertyOf(value, 'path')) : pathIn(scope, value);
        if (path !== undefined) componentDirs.push(fromRepo(root, path));
      },
    ],
    [
      'addRouteMiddleware',
      (node: ts.CallExpression) => {
        const [first] = node.arguments;
        const value = first === undefined ? undefined : unwrap(first);
        const items = value !== undefined && ts.isArrayLiteralExpression(value) ? [...value.elements] : value === undefined ? [] : [value];
        for (const item of items) {
          const name = ts.isObjectLiteralExpression(item) ? literalText(propertyOf(item, 'name')) : undefined;
          if (name !== undefined) routeMiddleware.push(name);
        }
      },
    ],
    [
      'installModule',
      (node: ts.CallExpression) => {
        const [first] = node.arguments;
        const name = literalText(first);
        const path = pathIn(scope, first);
        if (path !== undefined) installs.push({ path });
        else if (name !== undefined && !name.startsWith('.')) installs.push({ name });
        else unread(node, 'installModule', 'a module');
      },
    ],
  ]);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      const read = name === undefined ? undefined : CALLS.get(name);
      if (read !== undefined) {
        read(node);
        if (underCondition(node)) conditional.push(`${name} (line ${lineOf(node)})`);
      }
      else if (name === 'hook' && literalText(node.arguments[0]) === 'pages:extend') pagesOf(node, node.arguments[1], "hook('pages:extend')");
      else if (name !== undefined && NOT_READ.has(name)) notRead.add(name);
      // `Object.assign(nuxt.options.alias, { '#x': path })`
      if (name === 'assign' && node.expression.getText(file) === 'Object.assign') {
        const [target, ...sources] = node.arguments;
        if (target !== undefined && /\.options\.alias$/.test(unwrap(target).getText(file))) {
          for (const source of sources) {
            const object = unwrap(source);
            if (!ts.isObjectLiteralExpression(object)) {
              unread(node, 'nuxt.options.alias', 'an alias');
              continue;
            }
            for (const property of object.properties) {
              const key = property.name !== undefined && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
              if (ts.isPropertyAssignment(property)) aliasOf(property, key, property.initializer, true);
            }
          }
        }
      }
    }
    // `nuxt.options.alias['#x'] = path`, `.alias.x ||= path`
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      const assigns =
        operator === ts.SyntaxKind.EqualsToken || operator === ts.SyntaxKind.BarBarEqualsToken || operator === ts.SyntaxKind.QuestionQuestionEqualsToken;
      const left = unwrap(node.left);
      if (assigns && (ts.isElementAccessExpression(left) || ts.isPropertyAccessExpression(left)) && /\.options\.alias$/.test(left.expression.getText(file))) {
        const key = ts.isPropertyAccessExpression(left) ? left.name.text : literalText(left.argumentExpression);
        aliasOf(node, key, node.right, operator === ts.SyntaxKind.EqualsToken);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return {
    additions: { importDirs, serverImportDirs, imports, serverImports, handlers, pages, aliases, componentDirs, routeMiddleware, notRead: [...notRead].sort(), conditional },
    installs,
    rows,
  };
};

// ---------------------------------------------------------------------------
// Which modules

/** Why a module a part names is not read. */
type UnreadModule = 'dynamic' | 'inline' | 'missing' | 'outside';

const UNREAD_MODULE: Readonly<Record<UnreadModule, { message: (text: string, file: string) => string; hint: string }>> = {
  dynamic: {
    message: (text, file) => `the modules ${file} lists are written as code (${text}), so which they are is not known and nothing they add is read`,
    hint: 'Write `modules` as a list of literal paths or package names.',
  },
  inline: {
    message: (text, file) => `${file} writes a module in place (${text}), and a module written in the configuration is not read`,
    hint: 'Move the module to a file of `modules/`, where it is read.',
  },
  missing: {
    message: (text) => `${text} names no module file, so nothing it adds is read`,
    hint: 'Correct the path in `modules`, or give the package a source entry (`src/module.ts`).',
  },
  outside: {
    message: (text) => `${text} is outside the repository and its workspace, so nothing it adds is read`,
    hint: 'Add the module to the workspace, or read it as a service of its own.',
  },
};

const unreadModuleRow = (layer: NuxtLayer, text: string, why: UnreadModule): Unresolved => ({
  file: layer.layout.configFile,
  line: 1,
  reason: 'framework-module-unread',
  symbol: text,
  message: UNREAD_MODULE[why].message(text, layer.layout.configFile),
  hint: UNREAD_MODULE[why].hint,
  adapter: NUXT_ADAPTER,
  meta: { cause: 'framework-module-unread', why, module: text },
});

/** A package's own module file: its manifest's entry where that is source, else the module builder's `src/module`. */
const packageModuleFile = (dir: string): string | undefined => {
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    // A directory without a manifest: only its own index.
  }
  const exported = manifest.exports;
  const dot = typeof exported === 'string' ? exported : typeof exported === 'object' && exported !== null ? (exported as Record<string, unknown>)['.'] : undefined;
  const conditions = typeof dot === 'string' ? [dot] : typeof dot === 'object' && dot !== null ? ['import', 'default', 'require'].map((key) => (dot as Record<string, unknown>)[key]) : [];
  const entries = [...conditions, manifest.module, manifest.main].filter((entry): entry is string => typeof entry === 'string');
  for (const entry of entries) {
    // A build's output is the module compiled; its source is what the repository holds.
    if (/^(?:\.\/)?(?:dist|build)\//.test(entry)) continue;
    const found = scriptFileAt(join(dir, entry));
    if (found !== undefined) return found;
  }
  return scriptFileAt(join(dir, 'src', 'module')) ?? scriptFileAt(join(dir, 'index'));
};

/** The files Nuxt registers by itself from a part's `modules/`: each script file, and each folder's `index`, by name. */
const ownModuleFiles = (root: string, layer: NuxtLayer): string[] => {
  const dir = join(root, layer.layout.dirs.modules);
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (isDirectory(path)) {
      const index = ['index.ts', 'index.mts', 'index.js', 'index.mjs'].map((name) => join(path, name)).find(isFile);
      return index === undefined ? [] : [index];
    }
    return /\.[cm]?[jt]s$/.test(entry) && !entry.endsWith('.d.ts') ? [path] : [];
  });
};

/**
 * Every module of a Nuxt application the repository holds, in the order of
 * its parts (P251), and the ones installed as packages.
 *
 * For each part, the entries of its own `modules` - a path from the part's
 * directory, or a package of the workspace by its name, read at its source
 * entry - then each file of its `modules/`. A module read once is not read
 * again; one a module installs (`installModule`) is read after it, as part of
 * the same part.
 */
export const nuxtModulesOf = (repoDir: string, layers: readonly NuxtLayer[], bounds: readonly string[]): NuxtModules => {
  const root = resolve(repoDir);
  const [application] = layers;
  const app = application?.layout;
  const modules: NuxtModule[] = [];
  const installed: InstalledModule[] = [];
  const rows: Unresolved[] = [];
  if (application === undefined || app === undefined) return { modules, installed, rows };
  const seen = new Set<string>();
  const named = new Set<string>();

  const take = (absolute: string, name: string, layer: NuxtLayer, dir: string): void => {
    const real = realOf(absolute);
    if (seen.has(real)) return;
    seen.add(real);
    const reading = readModuleFile(root, absolute, app);
    modules.push({ file: fromRepo(root, absolute), name, layer, rank: layers.indexOf(layer), dir, additions: reading.additions });
    rows.push(...reading.rows);
    for (const install of reading.installs) {
      if ('name' in install) byName(install.name, layer);
      else {
        const found = scriptFileAt(install.path);
        if (found !== undefined) take(found, fromRepo(root, found), layer, dirname(found));
      }
    }
  };
  const byName = (specifier: string, layer: NuxtLayer): void => {
    if (named.has(specifier)) return;
    named.add(specifier);
    const placed = nuxtPackageDir(root, layer.dir, specifier);
    if ('why' in placed) {
      if (READ_ELSEWHERE.has(specifier)) return;
      const adds = NUXT_KNOWN_MODULES.get(specifier);
      installed.push({ name: specifier, why: placed.why, ...(adds === undefined ? {} : { adds }), layer });
      return;
    }
    if (!bounds.some((bound) => isWithinDir(placed.dir, bound))) {
      rows.push(unreadModuleRow(layer, specifier, 'outside'));
      return;
    }
    const file = packageModuleFile(placed.dir);
    if (file === undefined) rows.push(unreadModuleRow(layer, specifier, 'missing'));
    else take(file, specifier, layer, placed.dir);
  };
  const byPath = (path: string, text: string, layer: NuxtLayer): void => {
    const file = isDirectory(path) ? (packageModuleFile(path) ?? scriptFileAt(path)) : scriptFileAt(path);
    if (file === undefined) return void rows.push(unreadModuleRow(layer, text, 'missing'));
    if (!bounds.some((bound) => isWithinDir(file, bound))) return void rows.push(unreadModuleRow(layer, text, 'outside'));
    take(file, text, layer, isDirectory(path) ? path : dirname(file));
  };

  for (const layer of layers) {
    const written = configValueAt(layer.layout.config?.value, 'modules');
    if (written instanceof NotLiteral) rows.push(unreadModuleRow(layer, written.text, 'dynamic'));
    for (const listed of Array.isArray(written) ? written : []) {
      // `['@nuxtjs/i18n', { ... }]`: the module and its options.
      const entry: unknown = Array.isArray(listed) ? listed[0] : listed;
      if (entry instanceof ConfigPath) byPath(entry.path, fromRepo(root, entry.path), layer);
      else if (typeof entry === 'string') {
        const alias = /^(~~|@@|~|@)\/(.*)$/.exec(entry);
        if (alias !== null) byPath(join(alias[1] === '~~' || alias[1] === '@@' ? root : join(root, app.srcDir), alias[2] ?? ''), entry, layer);
        else if (entry.startsWith('.') || isAbsolute(entry)) byPath(resolve(layer.dir, entry), entry, layer);
        else byName(entry, layer);
      } else if (entry instanceof NotLiteral) {
        rows.push(unreadModuleRow(layer, entry.text, /^\s*(?:defineNuxtModule\s*\(|\(|async\b|function\b)/.test(entry.text) ? 'inline' : 'dynamic'));
      } else if (typeof entry === 'object' && entry !== null) rows.push(unreadModuleRow(layer, 'an object', 'inline'));
    }
    for (const file of ownModuleFiles(root, layer)) take(file, fromRepo(root, file), layer, dirname(file));
  }
  return { modules, installed, rows };
};

// ---------------------------------------------------------------------------
// The rows

/** What one module adds, as the note says it. */
const additionsInWords = (module: NuxtModule): string => {
  const { additions: added } = module;
  const parts = [
    ...added.importDirs.map((dir) => `the names ${dir.dir}/ exports`),
    ...added.serverImportDirs.map((dir) => `the names ${dir.dir}/ exports to the server`),
    ...added.imports.map((name) => `${name.name} from ${name.file}`),
    ...added.serverImports.map((name) => `${name.name} from ${name.file} to the server`),
    ...added.handlers.map((handler) => (handler.middleware ? `${handler.handler} in front of every route` : `${handler.method} ${handler.route} served by ${handler.handler}`)),
    ...added.pages.map((page) => `the page ${page.path} (${page.file})`),
    ...added.aliases.map((alias) => `${alias.key} -> ${alias.target}`),
    ...added.componentDirs.map((dir) => `the components of ${dir}/ by name (not drawn)`),
    ...added.routeMiddleware.map((name) => `the route middleware ${name} (not drawn)`),
  ];
  const also = added.notRead.length === 0 ? '' : `; it also calls ${inWords(added.notRead)}, which add nothing a reader draws`;
  const when = added.conditional.length === 0 ? '' : `; ${inWords(added.conditional)} ${added.conditional.length === 1 ? 'is' : 'are'} written under a condition and read as made`;
  return `${module.file} adds ${parts.length === 0 ? 'nothing this reader reads' : inWords(parts)}${also}${when}`;
};

/** The note that says which modules of the repository were read, and what each adds. */
export const modulesReadRow = (app: NuxtLayout, modules: readonly NuxtModule[]): Unresolved => ({
  file: app.configFile,
  line: 1,
  reason: 'framework-module-read',
  level: 'info',
  symbol: modules[0]?.file ?? '',
  message: `${modules.length} Nuxt module${modules.length === 1 ? ' of the repository is' : 's of the repository are'} read for what ${modules.length === 1 ? 'it adds' : 'they add'} when the application builds: ${modules.map(additionsInWords).join('; ')}`,
  hint: "Nothing to do. An addition whose argument is code is a row of its own; components registered by name and route middleware are said here, not drawn.",
  adapter: NUXT_ADAPTER,
  meta: { cause: 'framework-module-read', modules: modules.map((module) => module.file) },
});

/** The note that names the modules installed as packages, and what the known ones add. */
export const modulesInstalledRow = (app: NuxtLayout, installed: readonly InstalledModule[]): Unresolved => {
  const known = installed.filter((module) => module.adds !== undefined);
  const unknown = installed.filter((module) => module.adds === undefined);
  const sentences = [
    ...(unknown.length === 0
      ? []
      : [`${inWords(unknown.map((module) => (module.why === 'not-installed' ? `${module.name} (not installed)` : module.name)))} add${unknown.length === 1 ? 's' : ''} at build time what is not read here: any alias, name, page or route ${unknown.length === 1 ? 'it adds is' : 'they add are'} not in the graph`]),
    ...known.map((module) => `${module.name} adds ${module.adds}, none of it the repository's code`),
  ];
  return {
    file: app.configFile,
    line: 1,
    reason: 'framework-module-installed',
    level: 'info',
    symbol: installed[0]?.name ?? '',
    message: `${installed.length} Nuxt module${installed.length === 1 ? ' is a package' : 's are packages'}, run when the application builds and not read as its code: ${sentences.join('; ')}`,
    hint: "Nothing to do for the ones whose additions are their own package's. For another, an alias, name or route it adds can be named in the tsconfig's paths or described.",
    adapter: NUXT_ADAPTER,
    meta: { cause: 'framework-module-installed', modules: installed.map((module) => module.name), unknown: unknown.map((module) => module.name) },
  };
};

/** A route a module serves, as the address Nitro answers on: `:id` and `**` as the file router writes them. */
export const moduleRouteOf = (handler: ModuleHandler): { path: string; rawPath: string } | undefined =>
  handler.route === undefined ? undefined : { path: normalizePath(handler.route), rawPath: handler.route };

/** A part's directory a module adds, repo-relative, as a scanned group writes it. */
export const moduleDirsOf = (modules: readonly NuxtModule[], pick: (added: NuxtModuleAdditions) => readonly ModuleImportDir[]): Array<ModuleImportDir & { rank: number }> =>
  modules.flatMap((module) => pick(module.additions).map((dir) => ({ ...dir, rank: module.rank })));
