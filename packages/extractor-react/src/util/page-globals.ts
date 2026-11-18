import { basename, isAbsolute } from 'node:path';
import { compileGlob, isWithinDir, pathsOf, readDocument, scanCeilingOf, type Glob } from '@flowatlas/core';
import type { FileSystemHost, SourceFile } from 'ts-morph';
import { ts } from 'ts-morph';

/** `dirname` and `join` as the path is spelled: a project's POSIX paths stay POSIX on Windows. */
const dirname = (path: string): string => pathsOf(path).dirname(path);
const join = (path: string, ...rest: string[]): string => pathsOf(path).join(path, ...rest);

/**
 * The installed clients a plain page loads by a script tag (P310).
 *
 * A page without a bundler loads its client the way the client's own
 * documentation shows - `<script src="https://cdn.example.test/npm/axios/dist/axios.min.js">`,
 * or a copy kept beside the page's own scripts - and the client is then the
 * global its browser build leaves on `window`: `axios.get(url)` with no import
 * and nothing installed. The name is the client's where a page of the
 * repository loads a script the client's package names, or where the script
 * calling it declares the global for its linter (`/* global axios *\/`, or
 * the linter's configuration, P311); a name the repository declares is its
 * own, whatever it is called. The same for every client with a browser build
 * (P311): jQuery's `$`, superagent, ky, the `unfetch` ponyfill.
 */

/** The directories a page is never looked for in: installed packages, and a build's own copies. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'coverage']);

/** How many pages are read at most, so a repository of generated documentation is not read whole. */
const PAGE_LIMIT = 200;

/** How many directories are entered at most. */
const DIRECTORY_LIMIT = 5000;

/**
 * Every page of a repository: its `.html` files, wherever they are kept.
 * Read through the project's own file system, which is the disk for a
 * repository and memory for a project made up in a test.
 */
const pagesOf = (fs: FileSystemHost, repoDir: string): string[] => {
  const found: string[] = [];
  let entered = 0;
  const walk = (dir: string): void => {
    if (found.length >= PAGE_LIMIT || entered >= DIRECTORY_LIMIT) return;
    entered += 1;
    let entries;
    try {
      entries = fs.readDirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= PAGE_LIMIT) return;
      // One host names an entry by its path, another by its name alone.
      const path = isAbsolute(entry.name) ? entry.name : join(dir, entry.name);
      const name = basename(path);
      if (entry.isDirectory) {
        if (!SKIPPED.has(name) && !name.startsWith('.')) walk(path);
      } else if (entry.isFile && /\.html?$/i.test(name)) found.push(path);
    }
  };
  walk(repoDir);
  return found;
};

/** Whether a script's address names a package's browser build: a folder of the package's name, or a file of it. */
export const namesPackage = (src: string, module: string): boolean => {
  const parts = src.replace(/[?#].*$/, '').split(/[\\/]/).filter((part) => part !== '');
  const file = parts.at(-1) ?? '';
  const escaped = module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `axios.min.js`, `jquery-3.7.1.min.js`, `unfetch.umd.js` (P311); never a
  // slim build, which leaves the requests out (jQuery's).
  if (/\.slim\b/i.test(file)) return false;
  if (new RegExp(`^${escaped}(?:[.-]\\d[\\w.-]*)?(?:\\.(?:umd|browser|bundle|global|iife))?(?:\\.min)?\\.js$`, 'i').test(file)) return true;
  return parts.slice(0, -1).some((part) => part === module || part.startsWith(`${module}@`));
};

/** The address of every `<script src>` a page writes. */
const scriptSources = (html: string): string[] =>
  [...html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');

/** The packages a page of the repository loads by a script tag, of those asked about (`modules`). */
export const pageLoadedPackages = (fs: FileSystemHost, repoDir: string, modules: readonly string[]): ReadonlySet<string> => {
  const loaded = new Set<string>();
  if (modules.length === 0) return loaded;
  for (const page of pagesOf(fs, repoDir)) {
    let html: string;
    try {
      html = fs.readFileSync(page, 'utf8');
    } catch {
      continue;
    }
    for (const src of scriptSources(html)) for (const module of modules) if (namesPackage(src, module)) loaded.add(module);
  }
  return loaded;
};

const declaredIn = new WeakMap<SourceFile, ReadonlySet<string>>();

/** The globals a script declares for its linter: `/* global axios, Vue: readonly *\/`. */
export const declaredGlobals = (file: SourceFile): ReadonlySet<string> => {
  const known = declaredIn.get(file);
  if (known !== undefined) return known;
  const names = new Set<string>();
  for (const match of file.getFullText().matchAll(/\/\*\s*globals?\s+([^*]*)\*\//g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().split(/[\s:]/)[0];
      if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  declaredIn.set(file, names);
  return names;
};
/**
 * The linter's flat configuration files (P311), of which the nearest one to a
 * script is the whole of its configuration: a flat configuration does not
 * cascade, so none above it is read (P317).
 */
const FLAT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts'];

/**
 * The older cascading configuration's files in the order the linter takes
 * them (P311): the first one a directory holds is its configuration, and the
 * others beside it are not read (P317); a manifest only where it writes an
 * `eslintConfig`.
 */
const CASCADING_CONFIGS = ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc.json', '.eslintrc', 'package.json'];

/**
 * The globals an environment the linter is told of declares, of the ones a
 * client is loaded as (P311): `env: { jquery: true }`, or the `globals`
 * package's `globals.jquery` spread into a flat configuration.
 */
const ENVIRONMENTS: Readonly<Record<string, readonly string[]>> = { jquery: ['$', 'jQuery'] };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The files a part of a configuration is for (P317): an `overrides` entry's
 * `files` (and `excludedFiles`), a flat configuration's `files` (and
 * `ignores`), relative to the directory the configuration is in. A pattern
 * of the cascading configuration without a slash names a file by its name
 * anywhere below; a flat configuration's names it in that directory alone.
 */
interface Scope {
  readonly files: readonly Glob[];
  readonly excluded: readonly Glob[];
  readonly byName: boolean;
}

/** One set of globals a configuration declares, under every scope it is written in. */
interface Declared {
  readonly names: readonly string[];
  readonly scopes: readonly Scope[];
}

/**
 * A configuration another one names to be read with it (P323): a cascading
 * configuration's `extends` - a file by its path, or a shareable
 * configuration installed under `node_modules` by its short name - and a
 * module a flat configuration takes in by a name it imports or requires
 * (`...shared`, `[base, { … }]`, `tseslint.config(base, …)`), each read for
 * the globals it declares under the scopes it is named in.
 */
interface Reference {
  readonly specifier: string;
  readonly kind: 'extends' | 'module' | 'plugin';
  readonly scopes: readonly Scope[];
  /** The one export a module is read for (P334): `import { base } from './shared.js'` reads `base` alone. */
  readonly exported?: string;
  /**
   * The members taken off the export, or off the module where no export is
   * named (P341): `lib.configs.browser` is the module `lib` names, read for
   * its `configs.browser` alone.
   */
  readonly path?: readonly string[];
  /** The text the configuration names it by, said where it cannot be followed (P341). */
  readonly named?: string;
  /**
   * A plugin's configuration by its name (P334): `plugin:shop/recommended` in a
   * cascading `extends` (`flat` false), `'shop/recommended'` in a flat
   * object's `extends` (`flat` true), read from the plugin's `configs`.
   */
  readonly config?: { readonly name: string; readonly flat: boolean };
}

/**
 * What one configuration file says: the globals it declares, whether no
 * configuration above it is read, the configurations it names (P323), and the
 * files a flat configuration ignores for every object (P323): an object
 * writing `ignores` and nothing else beside a name.
 */
interface ConfigReading {
  readonly declared: readonly Declared[];
  readonly root: boolean;
  readonly references: readonly Reference[];
  readonly ignored: readonly string[];
  /**
   * What the configuration names that cannot be followed where it is written
   * (P341): a configuration taken off a name nothing imports or requires
   * (`[lib.configs.browser]` with `lib` a global).
   */
  readonly unknown?: readonly Unfollowed[];
  /** Why the value asked of the file (an export, a member, a plugin's configuration) was not found in it (P341). */
  readonly missed?: string;
}

/**
 * A configuration a linter's configuration names and that was not followed
 * (P341), said in the row of a client's global nothing declares: what names
 * it, by what, and why it was not read.
 */
interface Unfollowed {
  readonly file: string;
  readonly named: string;
  readonly why: string;
  readonly scopes: readonly Scope[];
}

/** What one directory's configuration says, with what it names read into it (P323). */
interface LinterConfig {
  readonly dir: string;
  readonly declared: readonly Declared[];
  readonly root: boolean;
  readonly ignored: readonly Glob[];
  readonly unfollowed: readonly Unfollowed[];
}

/** A pattern with its `{a,b}` alternatives spelled out, the way the linter's glob reads them. */
const expandBraces = (pattern: string): string[] => {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (match === null) return [pattern];
  const head = pattern.slice(0, match.index);
  const tail = pattern.slice(match.index + match[0].length);
  return (match[1] ?? '').split(',').flatMap((choice) => expandBraces(`${head}${choice}${tail}`));
};

/** The globs a list of patterns names, `!` patterns left out. */
const globsOf = (patterns: readonly string[]): Glob[] =>
  patterns
    .filter((pattern) => pattern !== '' && !pattern.startsWith('!'))
    .flatMap(expandBraces)
    .map((pattern) => compileGlob(pattern.replace(/^\.\//, '')));

/** Whether a path, relative to a configuration's directory, is in a scope. */
const inScope = (scope: Scope, path: string): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const matches = (glob: Glob): boolean => glob.test(path) || (scope.byName && !glob.pattern.includes('/') && glob.test(name));
  return (scope.files.length === 0 || scope.files.some(matches)) && !scope.excluded.some(matches);
};

/** The strings a value of a configuration names: one string, or a list of them (a flat configuration's nested lists flattened). */
const stringsOf = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap((each) => stringsOf(each)) : [];

const keyOf = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name.text : undefined;

/** The strings an expression written in a configuration names: a string, or a list of them. */
const writtenStrings = (node: ts.Expression): string[] => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  return ts.isArrayLiteralExpression(node) ? node.elements.flatMap((each) => writtenStrings(each)) : [];
};

/** The globals one `globals` value written as a script declares: its keys but those turned `off`, and an environment's spread in. */
const globalsIn = (value: ts.Expression, names: Set<string>): void => {
  const environment = (expression: ts.Expression): void => {
    if (ts.isPropertyAccessExpression(expression)) for (const name of ENVIRONMENTS[expression.name.text] ?? []) names.add(name);
  };
  if (!ts.isObjectLiteralExpression(value)) {
    environment(value);
    return;
  }
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) environment(property.expression);
    else if (ts.isShorthandPropertyAssignment(property)) names.add(property.name.text);
    else if (ts.isPropertyAssignment(property)) {
      const key = keyOf(property.name);
      const off = ts.isStringLiteral(property.initializer) && property.initializer.text === 'off';
      if (key !== undefined && IDENTIFIER.test(key) && !off) names.add(key);
    }
  }
};

/** A scope an object written in a configuration opens, where it writes `files`. */
const scopeOf = (files: readonly string[], excluded: readonly string[], flat: boolean): Scope => ({ files: globsOf(files), excluded: globsOf(excluded), byName: !flat });

/**
 * A module a configuration takes a name in from, the one export it takes
 * (P334) - none for the whole module, which is what its default export is
 * read as - and the members taken off that (P341): `lib.configs.browser` is
 * `lib`'s module and `configs`, `browser`.
 */
interface Imported {
  readonly from: string;
  readonly exported?: string;
  readonly path?: readonly string[];
}

/** Whether a value read out of a configuration is a module it takes in rather than an expression it writes. */
const isImported = (value: ts.Expression | Imported): value is Imported => !('kind' in value);

/** The members a module's value is taken by, its export first: `default` where it names none. */
const membersOf = (module: Imported): string[] => [module.exported ?? 'default', ...(module.path ?? [])];

/** A module with members taken off it (P341): the first its export (`default` the module), the rest a path into that. */
const takenFrom = (from: string, members: readonly string[]): Imported => {
  const [first, ...rest] = members;
  const taken: Imported = first === undefined || first === 'default' ? { from } : { from, exported: first };
  return rest.length === 0 ? taken : { ...taken, path: rest };
};

/** The export an import or a re-export takes: none for a default, which is the module. */
const takenExport = (from: string, name: string): Imported => takenFrom(from, [name]);

/** A module's value with more members taken off it (P341). */
const deeper = (module: Imported, members: readonly string[]): Imported => (members.length === 0 ? module : takenFrom(module.from, [...membersOf(module), ...members]));

/** An expression with what only wraps it taken off: parentheses, a type said of it, an `await`. */
const unwrapped = (node: ts.Expression): ts.Expression => {
  let at = node;
  while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isNonNullExpression(at) || ts.isAwaitExpression(at)) at = at.expression;
  return at;
};

/** The member a property access, or an element access by a string, takes. */
const memberName = (node: ts.Node): string | undefined => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (!ts.isElementAccessExpression(node)) return undefined;
  const key = node.argumentExpression;
  return ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key) ? key.text : undefined;
};

/** What an expression takes members off, and the members (P341): `lib.configs['browser']` is `lib` and `configs`, `browser`. */
const chainOf = (node: ts.Expression): { readonly base: ts.Expression; readonly members: readonly string[] } => {
  const members: string[] = [];
  let at = unwrapped(node);
  for (let name = memberName(at); name !== undefined; name = memberName(at)) {
    members.unshift(name);
    at = unwrapped((at as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression);
  }
  return { base: at, members };
};

/** Whether a node only wraps the expression it holds: parentheses, a type said of it, an `await`. */
const wraps = (node: ts.Node): boolean =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node);

/** The outermost of the members taken off a node, and of what only wraps them: `(lib.configs).browser` for `lib`. */
const chainTop = (node: ts.Node): ts.Node => {
  let at = node;
  for (let parent = at.parent; parent !== undefined; parent = at.parent) {
    const takes = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === at && memberName(parent) !== undefined;
    if (!takes && !wraps(parent)) return at;
    at = parent;
  }
  return at;
};

/**
 * The module a `require('x')` or an `import('x')` names, read through the
 * members taken off it: `require('x').base` takes `base` alone (P334),
 * `require('x').default` the module, `require('x').configs.browser` the
 * `browser` of its `configs` (P341).
 */
const requiredIn = (node: ts.Expression): Imported | undefined => {
  const { base, members } = chainOf(node);
  if (!ts.isCallExpression(base)) return undefined;
  const callee = base.expression;
  if (!(ts.isIdentifier(callee) && callee.text === 'require') && callee.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
  const [specifier] = base.arguments;
  if (specifier === undefined || !(ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier))) return undefined;
  return takenFrom(specifier.text, members);
};

/**
 * The names a configuration script takes in from other modules, the module
 * each names and the export it takes (P323, P334): `import base from
 * './base.js'` and `import * as shared from 'x'` the whole module, `import {
 * browser } from 'x'` its `browser` alone; `const base = require('./base')`,
 * and the names destructured out of a `require` each its own export. A name
 * kept for members taken off one of those (P341) - `const browser =
 * lib.configs.browser`, `const { configs } = require('x')`, `const lib =
 * await import('x')` - is that module's, read for those members.
 */
const importedNames = (source: ts.SourceFile): ReadonlyMap<string, Imported> => {
  const names = new Map<string, Imported>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const from = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name !== undefined) names.set(clause.name.text, { from });
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.set(bindings.name.text, { from });
      else if (bindings !== undefined) for (const element of bindings.elements) names.set(element.name.text, takenExport(from, (element.propertyName ?? element.name).text));
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const written = declaration.initializer;
      if (written === undefined) continue;
      let module = requiredIn(written);
      if (module === undefined) {
        const { base, members } = chainOf(written);
        const root = ts.isIdentifier(base) ? names.get(base.text) : undefined;
        module = root === undefined ? undefined : deeper(root, members);
      }
      if (module === undefined) continue;
      if (ts.isIdentifier(declaration.name)) names.set(declaration.name.text, module);
      else if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const taken = element.propertyName === undefined ? element.name.text : keyOf(element.propertyName);
          names.set(element.name.text, taken === undefined ? module : deeper(module, [taken]));
        }
      }
    }
  }
  return names;
};

/** What a top-level `const name = …` of a module holds. */
const localValue = (source: ts.SourceFile, name: string): ts.Expression | undefined => statementsValue(source.statements, name);

/** What a `const name = …` among some statements holds. */
const statementsValue = (statements: readonly ts.Statement[], name: string): ts.Expression | undefined => {
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer;
    }
  }
  return undefined;
};

/**
 * What a name holds where it is written (P349): the `const` of the block
 * around it that declares it - a function building a plugin's
 * configurations keeps them under a name of its own - else the module's.
 */
const scopedValue = (source: ts.SourceFile, name: ts.Identifier): ts.Expression | undefined => {
  for (let at: ts.Node | undefined = name.parent; at !== undefined && !ts.isSourceFile(at); at = at.parent) {
    if (!ts.isBlock(at)) continue;
    const found = statementsValue(at.statements, name.text);
    if (found !== undefined) return found;
  }
  return localValue(source, name.text);
};

/** How many returns of one function are tried for a member a call of it builds. */
const MOST_RETURNS = 8;

/**
 * What a call of a function the module declares hands back (P349):
 * `configs: makeConfigs()` - each value its returns write, an arrow's body,
 * of a function declared at the top, a `const` holding one, or written in
 * place. Nothing for a function of another module, or one the module does
 * not declare.
 */
const returnedFrom = (source: ts.SourceFile, call: ts.CallExpression): ts.Expression[] => {
  const callee = unwrapped(call.expression);
  let fn: ts.Node | undefined = ts.isArrowFunction(callee) || ts.isFunctionExpression(callee) ? callee : undefined;
  if (fn === undefined && ts.isIdentifier(callee)) {
    fn = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === callee.text);
    const held = fn === undefined ? localValue(source, callee.text) : undefined;
    if (held !== undefined && (ts.isArrowFunction(unwrapped(held)) || ts.isFunctionExpression(unwrapped(held)))) fn = unwrapped(held);
  }
  if (fn === undefined || !(ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || fn.body === undefined) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (found.length >= MOST_RETURNS || ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) found.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return found;
};

/** Whether an expression is a CommonJS module's exports: `module.exports` or `exports`. */
const isExportsObject = (node: ts.Expression): boolean =>
  (ts.isIdentifier(node) && node.text === 'exports') ||
  (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'module' && node.name.text === 'exports');

/** The value an object written in place gives a key: its property's, or the name a shorthand writes. */
const propertyValue = (object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && keyOf(property.name) === name) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) return property.name;
  }
  return undefined;
};

/**
 * What a module exports by a name (P334), as it writes it: `export const base
 * = …`, `export { local as base }`, `export { base } from './x'`, `export
 * default …` for `default`; `exports.base = …`, `module.exports.base = …`, a
 * key of the object `module.exports` is, or `module.exports` itself for
 * `default`. Nothing where the module writes it some other way.
 */
const exportedValue = (source: ts.SourceFile, name: string): ts.Expression | Imported | undefined => {
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      if (name === 'default') return statement.expression;
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (ts.isVariableStatement(statement) && modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer;
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== name) continue;
        const local = element.propertyName ?? element.name;
        if (statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) return takenExport(statement.moduleSpecifier.text, local.text);
        return ts.isIdentifier(local) ? local : undefined;
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue;
    const { left, operatorToken, right } = statement.expression;
    if (operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    if (ts.isPropertyAccessExpression(left) && left.name.text === name && isExportsObject(left.expression)) return right;
    if (isExportsObject(left)) {
      if (name === 'default') return right;
      const object = ts.isObjectLiteralExpression(right) ? right : undefined;
      const found = object === undefined ? undefined : propertyValue(object, name);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

/** Whether a call is `Object.assign(…)`. */
const isObjectAssign = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === 'assign' &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === 'Object';

/**
 * A write a module makes to the members of a name it keeps (P341):
 * `plugin.configs.browser = { … }`, `plugin.configs = { … }`,
 * `Object.assign(plugin.configs, { … })` - the values written, the last
 * one first, since a later key wins.
 */
interface MemberWrite {
  readonly root: string;
  readonly members: readonly string[];
  readonly values: readonly ts.Expression[];
}

const writesIn = new WeakMap<ts.SourceFile, readonly MemberWrite[]>();

/** Every write a module makes to the members of a name, in the order it writes them (P341). */
const memberWrites = (source: ts.SourceFile): readonly MemberWrite[] => {
  const known = writesIn.get(source);
  if (known !== undefined) return known;
  const writes: MemberWrite[] = [];
  const target = (node: ts.Expression): { root: string; members: readonly string[] } | undefined => {
    const { base, members } = chainOf(node);
    if (!ts.isIdentifier(base)) return undefined;
    // `module.exports.configs.x = …` and `exports.configs.x = …`: a write to the module's own value (P349).
    if (base.text === 'module' && members[0] === 'exports') return { root: EXPORTS, members: members.slice(1) };
    if (base.text === 'exports') return { root: EXPORTS, members };
    return { root: base.text, members };
  };
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const at = target(node.left);
      if (at !== undefined && at.members.length > 0) writes.push({ ...at, values: [node.right] });
    } else if (isObjectAssign(node)) {
      const [first, ...rest] = node.arguments;
      const at = first === undefined ? undefined : target(first);
      if (at !== undefined && rest.length > 0) writes.push({ ...at, values: [...rest].reverse() });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  writesIn.set(source, writes);
  return writes;
};

/** How many names and members one value of a module is followed through at most. */
const MEMBER_HOPS = 16;

/** The root a write through `module.exports` or `exports` is kept under: no name a script can declare (P349). */
const EXPORTS = 'module.exports';

/**
 * The value a module last writes to the members `wanted` of a name, read
 * for the members left after them (P341): `plugin.configs.browser = …`,
 * `Object.assign(plugin.configs, …)`, `module.exports.configs.x = …`.
 */
const writtenTo = (
  source: ts.SourceFile,
  root: string,
  wanted: readonly string[],
  imported: ReadonlyMap<string, Imported>,
  hops: number,
): ts.Expression | Imported | undefined => {
  let written: ts.Expression | Imported | undefined;
  for (const write of memberWrites(source)) {
    if (write.root !== root || write.members.length > wanted.length || write.members.some((member, at) => wanted[at] !== member)) continue;
    const rest = wanted.slice(write.members.length);
    for (const value of write.values) {
      const found = memberValue(source, value, rest, imported, hops + 1);
      if (found === undefined) continue;
      written = found;
      break;
    }
  }
  return written;
};

/**
 * What an expression of a module stands for with members taken off it (P334,
 * P341): the expression a name of the module holds, or the last value the
 * module writes to that member of it (`plugin.configs.browser = …`,
 * `Object.assign(plugin.configs, …)`); a key of an object written in place,
 * or of an object it spreads (`{ ...base, recommended: … }`), the last
 * writing it winning, or of an object `Object.assign` builds; the module and
 * export a name it takes in, or a `require`, names, with the members left to
 * take off it there. Nothing where a step is written some other way (a call
 * building the value, a member nothing writes).
 */
const memberValue = (
  source: ts.SourceFile,
  start: ts.Expression | Imported | undefined,
  path: readonly string[],
  imported: ReadonlyMap<string, Imported>,
  hops = 0,
): ts.Expression | Imported | undefined => {
  if (start === undefined || hops > MEMBER_HOPS) return undefined;
  if (isImported(start)) return deeper(start, path);
  const required = requiredIn(start);
  if (required !== undefined) return deeper(required, path);
  const { base, members } = chainOf(start);
  const wanted = [...members, ...path];
  if (ts.isIdentifier(base)) {
    const written = writtenTo(source, base.text, wanted, imported, hops);
    if (written !== undefined) return written;
    const held = imported.get(base.text) ?? scopedValue(source, base);
    return held === undefined ? undefined : memberValue(source, held, wanted, imported, hops + 1);
  }
  // `configs: makeConfigs()`: what the function the module declares hands back (P349).
  if (ts.isCallExpression(base) && !isObjectAssign(base)) {
    for (const returned of returnedFrom(source, base).reverse()) {
      const found = memberValue(source, returned, wanted, imported, hops + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (wanted.length === 0) return base;
  const [key, ...rest] = wanted;
  if (ts.isObjectLiteralExpression(base)) {
    for (const property of [...base.properties].reverse()) {
      if (ts.isPropertyAssignment(property) && keyOf(property.name) === key) return memberValue(source, property.initializer, rest, imported, hops + 1);
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) return memberValue(source, property.name, rest, imported, hops + 1);
      if (ts.isSpreadAssignment(property)) {
        const found = memberValue(source, property.expression, wanted, imported, hops + 1);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
  if (isObjectAssign(base)) {
    for (const argument of [...base.arguments].reverse()) {
      const found = memberValue(source, argument, wanted, imported, hops + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

/**
 * A module's value by the members another takes off it (P341): off the
 * export named, else off the module - its default export, or the named
 * export the first member is, the way `import * as lib` reads `lib.configs`.
 */
const moduleMember = (source: ts.SourceFile, imported: ReadonlyMap<string, Imported>, exported: string | undefined, path: readonly string[]): ts.Expression | Imported | undefined => {
  // A member written through `module.exports` or `exports` itself (P349), the last such write winning.
  const throughExports = writtenTo(source, EXPORTS, exported === undefined || exported === 'default' ? path : [exported, ...path], imported, 0);
  if (throughExports !== undefined && (exported !== undefined || path.length > 0)) return throughExports;
  if (exported !== undefined) return memberValue(source, exportedValue(source, exported), path, imported);
  const whole = memberValue(source, exportedValue(source, 'default'), path, imported);
  if (whole !== undefined || path.length === 0) return whole;
  const [first, ...rest] = path;
  return memberValue(source, exportedValue(source, first as string), rest, imported);
};

/**
 * Whether a name is read as a value where it is written, rather than declared
 * there, named as a key or a member, or called (`tseslint.config(…)`, whose
 * module is the helper and not a configuration).
 */
const readAsValue = (name: ts.Identifier): boolean => {
  const parent = name.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === name) return false;
  if (
    ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isBindingElement(parent) ||
    ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isPropertyAssignment(parent) && parent.name === name ||
    ts.isVariableDeclaration(parent) && parent.name === name || ts.isExportSpecifier(parent)
  ) {
    return false;
  }
  const top = chainTop(name);
  return !(ts.isCallExpression(top.parent) && top.parent.expression === top);
};

/**
 * Whether a module taken in, or members taken off it, is what a declaration
 * at the top of the configuration holds, which keeps it under a name
 * ({@link importedNames}): read where that name is.
 */
const declaredFrom = (node: ts.Node): boolean => {
  const holder = chainTop(node).parent;
  if (holder === undefined || !ts.isVariableDeclaration(holder)) return false;
  const statement = holder.parent.parent;
  if (!ts.isVariableStatement(statement) || !ts.isSourceFile(statement.parent)) return false;
  // An exported name is read where it is written, as a module read whole is.
  return !(ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
};

/** Whether an object of a flat configuration writes `ignores` and nothing else but a name: the files no object is for (P323). */
const ignoresOnly = (written: ReadonlyMap<string, ts.Expression>, properties: number): boolean =>
  written.has('ignores') && properties === written.size && [...written.keys()].every((key) => key === 'ignores' || key === 'name');

/**
 * Keys of a configuration whose values are no configuration: a plugin, a
 * parser, a processor (P334). A plugin's own configurations are read only
 * where one is named (`plugin:x/y`, a flat object's `extends`), never all of
 * them for being handed over.
 */
const NOT_CONFIGURATION = new Set(['plugins', 'parser', 'processor']);

/**
 * The plugin a short name stands for, as the linter spells it out (P334):
 * `shop` is `eslint-plugin-shop`, `@acme` is `@acme/eslint-plugin`,
 * `@acme/web` is `@acme/eslint-plugin-web`.
 */
const pluginPackage = (name: string): string => {
  if (name.startsWith('@')) {
    const [scope, ...rest] = name.split('/');
    const tail = rest.join('/');
    if (tail === '') return `${scope}/eslint-plugin`;
    return tail.startsWith('eslint-plugin') ? name : `${scope}/eslint-plugin-${tail}`;
  }
  return name.startsWith('eslint-plugin-') || name === 'eslint-plugin' ? name : `eslint-plugin-${name}`;
};

/**
 * What one entry of a cascading `extends` names (P323, P334): a file or a
 * shareable configuration, or a plugin's configuration - `plugin:shop/browser`
 * is `eslint-plugin-shop`'s `configs.browser`, the plugin's name being what
 * comes before the last slash.
 */
const extendsReference = (specifier: string, scopes: readonly Scope[]): Reference => {
  const plugin = /^plugin:(.+)\/([^/]+)$/.exec(specifier);
  if (plugin === null) return { specifier, kind: 'extends', scopes };
  return { specifier: pluginPackage(plugin[1] as string), kind: 'plugin', scopes, config: { name: plugin[2] as string, flat: false }, named: specifier };
};

/** The plugins a flat object hands over by namespace, and the module each is (P334): `plugins: { shop: shopPlugin }`. */
const pluginsOf = (value: ts.Expression | undefined, imported: ReadonlyMap<string, Imported>): ReadonlyMap<string, string> => {
  const plugins = new Map<string, string>();
  if (value === undefined || !ts.isObjectLiteralExpression(value)) return plugins;
  for (const property of value.properties) {
    let namespace: string | undefined;
    let written: ts.Expression | undefined;
    if (ts.isPropertyAssignment(property)) [namespace, written] = [keyOf(property.name), property.initializer];
    else if (ts.isShorthandPropertyAssignment(property)) [namespace, written] = [property.name.text, property.name];
    if (namespace === undefined || written === undefined) continue;
    const module = ts.isIdentifier(written) ? imported.get(written.text) : requiredIn(written);
    if (module !== undefined) plugins.set(namespace, module.from);
  }
  return plugins;
};

/**
 * What one text entry of a flat object's `extends` names (P334): a plugin's
 * configuration, `'shop/recommended'`, by the namespace the object's
 * `plugins` hands the plugin under, else by the plugin's package name.
 */
const flatExtendsReference = (text: string, plugins: ReadonlyMap<string, string>, scopes: readonly Scope[]): Reference | undefined => {
  const namespace = [...plugins.keys()].filter((key) => text.startsWith(`${key}/`)).sort((a, b) => b.length - a.length)[0];
  if (namespace !== undefined) {
    return { specifier: plugins.get(namespace) as string, kind: 'plugin', scopes, config: { name: text.slice(namespace.length + 1), flat: true }, named: text };
  }
  const slash = text.lastIndexOf('/');
  if (slash <= 0) return undefined;
  return { specifier: pluginPackage(text.slice(0, slash)), kind: 'plugin', scopes, config: { name: text.slice(slash + 1), flat: true }, named: text };
};

const NOTHING_READ: ConfigReading = { declared: [], root: false, references: [], ignored: [] };

/** A reference to a module taken in, read for the export and the members taken off it (P334, P341). */
const moduleReference = (module: Imported, kind: Reference['kind'], scopes: readonly Scope[], named?: string): Reference => ({
  specifier: module.from,
  kind,
  scopes,
  ...(module.exported === undefined ? {} : { exported: module.exported }),
  ...(module.path === undefined ? {} : { path: module.path }),
  ...(named === undefined ? {} : { named }),
});

/** A configuration that is a module another names, read from that module (P334). */
const readingOfModule = (module: Imported, flat: boolean): ConfigReading => ({
  ...NOTHING_READ,
  references: [moduleReference(module, flat ? 'module' : 'extends', [])],
});

/**
 * What a configuration written as a script or as JSON says, from a node of it
 * on: the globals under `globals` or an environment turned on, wherever they
 * are written, each under the `files` of every object it is written in
 * (P317), and `root` written outside any of those. Also what it names to be
 * read with it (P323): a cascading `extends`, a module it imports or requires
 * read as a value; and a flat configuration's objects writing `ignores`
 * alone, the files it reads for nothing, where an object writing `ignores`
 * beside anything else is for every file but those. A plugin's
 * configurations named in a cascading or a flat `extends` are read too, and
 * what a key holding a plugin or a parser hands over is not (P334).
 */
const readConfigNode = (start: ts.Node, imported: ReadonlyMap<string, Imported>, within: boolean, json: boolean, flat: boolean): ConfigReading => {
  const declared: Declared[] = [];
  const references: Reference[] = [];
  const ignored: string[] = [];
  const unknown: Unfollowed[] = [];
  let root = false;
  const visit = (node: ts.Node, within: boolean, scopes: readonly Scope[]): void => {
    if (within && ts.isObjectLiteralExpression(node)) {
      const written = new Map<string, ts.Expression>();
      for (const property of node.properties) {
        const key = ts.isPropertyAssignment(property) ? keyOf(property.name) : undefined;
        if (key !== undefined && ts.isPropertyAssignment(property)) written.set(key, property.initializer);
      }
      const files = written.get('files');
      const excluded = written.get(flat ? 'ignores' : 'excludedFiles');
      if (flat && files === undefined && excluded !== undefined && ignoresOnly(written, node.properties.length)) {
        if (scopes.length === 0) ignored.push(...writtenStrings(excluded));
        return;
      }
      const scoped = files !== undefined || (flat && excluded !== undefined);
      const inner = scoped ? [...scopes, scopeOf(files === undefined ? [] : writtenStrings(files), excluded === undefined ? [] : writtenStrings(excluded), flat)] : scopes;
      // A flat object's `extends` names a plugin's configuration by text (P334); its other entries are values read below.
      const extended = flat ? written.get('extends') : undefined;
      if (extended !== undefined) {
        const plugins = pluginsOf(written.get('plugins'), imported);
        for (const text of writtenStrings(extended)) {
          const reference = flatExtendsReference(text, plugins, inner);
          if (reference !== undefined) references.push(reference);
        }
      }
      if (scoped) {
        node.properties.forEach((child) => visit(child, within, inner));
        return;
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const key = keyOf(node.name);
      // A manifest's own keys are not the linter's; only its `eslintConfig` is.
      if (!within) {
        visit(node.initializer, key === 'eslintConfig', scopes);
        return;
      }
      if (key !== undefined && NOT_CONFIGURATION.has(key)) return;
      if (key === 'root' && scopes.length === 0 && node.initializer.kind === ts.SyntaxKind.TrueKeyword) root = true;
      if (key === 'globals') {
        const names = new Set<string>();
        globalsIn(node.initializer, names);
        if (names.size > 0) declared.push({ names: [...names], scopes });
        return;
      }
      if (key === 'env' && ts.isObjectLiteralExpression(node.initializer)) {
        const names = node.initializer.properties.flatMap((property) =>
          ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.TrueKeyword ? (ENVIRONMENTS[keyOf(property.name) ?? ''] ?? []) : [],
        );
        if (names.length > 0) declared.push({ names, scopes });
        return;
      }
      // A cascading configuration's `extends` names files, shareable
      // configurations and plugins' configurations; a flat one's are read above.
      if (key === 'extends' && !flat) for (const specifier of writtenStrings(node.initializer)) references.push(extendsReference(specifier, scopes));
    }
    if (within && !json) {
      let from: Imported | undefined;
      let top: ts.Node = node;
      if (ts.isIdentifier(node) && readAsValue(node)) {
        top = chainTop(node);
        const { members } = chainOf(top as ts.Expression);
        const held = imported.get(node.text);
        // Members taken off a name kept at the top are read where the name is (P341).
        if (held !== undefined && !declaredFrom(node)) from = deeper(held, members);
        else if (held === undefined && members.length > 0 && holdsConfiguration(top) && !namesDeclared(node.getSourceFile()).has(node.text)) {
          unknown.push({ file: '', named: top.getText().slice(0, 80), why: `${node.text} is neither imported nor required`, scopes });
        }
      } else if (ts.isCallExpression(node) && !declaredFrom(node)) {
        top = chainTop(node);
        from = requiredIn(top as ts.Expression);
      }
      if (from !== undefined) references.push(moduleReference(from, 'module', scopes, top.getText().slice(0, 80)));
    }
    ts.forEachChild(node, (child) => visit(child, within, scopes));
  };
  visit(start, within, []);
  return { declared, root, references, ignored, unknown };
};

/**
 * Whether an expression stands where a flat configuration takes a
 * configuration (P341): an entry of a list (the configuration's own, an
 * `extends`), an object spread in, or the value a module exports.
 */
const holdsConfiguration = (node: ts.Node): boolean => {
  const parent = node.parent;
  return parent !== undefined && (ts.isArrayLiteralExpression(parent) || ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent) || ts.isExportAssignment(parent));
};

const namesIn = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

/** Every name a module declares anywhere: its variables, functions, classes, parameters and imports. */
const namesDeclared = (source: ts.SourceFile): ReadonlySet<string> => {
  const known = namesIn.get(source);
  if (known !== undefined) return known;
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
        ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  namesIn.set(source, names);
  return names;
};

/**
 * What a configuration written as a script or as JSON says ({@link
 * readConfigNode}): the whole of it, or the one export another configuration
 * takes from it (P334) and the members taken off that (P341) - the whole
 * where the module writes them in a way not read, said as missed.
 */
const scriptConfig = (text: string, json: boolean, manifest: boolean, flat: boolean, exported?: string, path: readonly string[] = []): ConfigReading => {
  const source = ts.createSourceFile('config.js', json ? `(${text})` : text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imported = json ? new Map<string, Imported>() : importedNames(source);
  if ((exported !== undefined || path.length > 0) && !manifest) {
    const statement = source.statements[0];
    // A JSON file is its one value: what is taken off it is a key of that.
    const value = json
      ? statement !== undefined && ts.isExpressionStatement(statement) ? memberValue(source, statement.expression, exported === undefined ? path : [exported, ...path], imported) : undefined
      : moduleMember(source, imported, exported, path);
    if (value !== undefined) return isImported(value) ? readingOfModule(value, flat) : readConfigNode(value, imported, true, json, flat);
    const whole = readConfigNode(source, imported, true, json, flat);
    return { ...whole, missed: `${[exported ?? 'default', ...path].join('.')} is written in a way not read, so the whole module was read` };
  }
  return readConfigNode(source, imported, !manifest, json, flat);
};

/**
 * The configuration a plugin's module keeps by a name (P334): the entry of a
 * `configs` object it exports - `{ configs: { browser: { … } } }`,
 * `plugin.configs = { … }` - followed through the names and the modules it is
 * kept under, and built from others (P341): `configs: { ...base, browser }`,
 * `Object.assign(plugin.configs, { browser })`, `plugin.configs.browser =
 * { … }`, the last write winning. Where the plugin's export cannot be
 * followed (a call builds it), the first `configs` the module writes
 * anywhere that keeps the name.
 */
const pluginConfigValue = (source: ts.SourceFile, name: string, imported: ReadonlyMap<string, Imported>): ts.Expression | Imported | undefined => {
  const exported = moduleMember(source, imported, undefined, ['configs', name]);
  if (exported !== undefined) return exported;
  let found: ts.Expression | Imported | undefined;
  const take = (configs: ts.Expression): void => {
    found = memberValue(source, configs, [name], imported);
  };
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isPropertyAssignment(node) && keyOf(node.name) === 'configs') take(node.initializer);
    else if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'configs') take(node.name);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && memberName(node.left) === 'configs') take(node.left);
    else if (isObjectAssign(node) && node.arguments[0] !== undefined && memberName(node.arguments[0]) === 'configs') take(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

/** What a plugin's configuration by a name says (P334), read as a flat configuration or a cascading one as it was named in. */
const pluginConfig = (text: string, name: string, flat: boolean): ConfigReading => {
  const source = ts.createSourceFile('plugin.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imported = importedNames(source);
  const value = pluginConfigValue(source, name, imported);
  if (value === undefined) return { ...NOTHING_READ, missed: `the plugin keeps no configs.${name} written in a way read` };
  return isImported(value) ? readingOfModule(value, flat) : readConfigNode(value, imported, true, false, flat);
};

/** What a configuration written as YAML says, read as the cascading configuration's keys are: `root`, `globals`, `env`, `extends` and `overrides`. */
const yamlConfig = (text: string): ConfigReading => {
  let value: unknown;
  try {
    value = readDocument(text, 'yaml').value;
  } catch {
    return { declared: [], root: false, references: [], ignored: [] };
  }
  const declared: Declared[] = [];
  const references: Reference[] = [];
  const read = (config: unknown, scopes: readonly Scope[]): void => {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) return;
    const record = config as Record<string, unknown>;
    const globals = record['globals'];
    if (globals !== null && typeof globals === 'object' && !Array.isArray(globals)) {
      const names = Object.entries(globals).flatMap(([name, setting]) => (IDENTIFIER.test(name) && setting !== 'off' ? [name] : []));
      if (names.length > 0) declared.push({ names, scopes });
    }
    const env = record['env'];
    if (env !== null && typeof env === 'object' && !Array.isArray(env)) {
      const names = Object.entries(env).flatMap(([name, on]) => (on === true ? (ENVIRONMENTS[name] ?? []) : []));
      if (names.length > 0) declared.push({ names, scopes });
    }
    for (const specifier of stringsOf(record['extends'])) references.push(extendsReference(specifier, scopes));
    const overrides = record['overrides'];
    for (const entry of Array.isArray(overrides) ? overrides : []) {
      if (entry === null || typeof entry !== 'object') continue;
      const each = entry as Record<string, unknown>;
      read(each, [...scopes, scopeOf(stringsOf(each['files']), stringsOf(each['excludedFiles']), false)]);
    }
  };
  read(value, []);
  const root = value !== null && typeof value === 'object' && (value as Record<string, unknown>)['root'] === true;
  return { declared, root, references, ignored: [] };
};

/** The text of a file, where the project's file system holds it. */
const textAt = (fs: FileSystemHost, path: string): string | undefined => {
  try {
    return fs.fileExistsSync(path) ? fs.readFileSync(path, 'utf8') : undefined;
  } catch {
    return undefined;
  }
};

/** What a configuration file says, read by its kind: YAML, JSON (`.eslintrc` included), a manifest's `eslintConfig`, or a script. */
const configText = (path: string, text: string, flat: boolean, exported?: string, members: readonly string[] = []): ConfigReading => {
  const name = basename(path);
  if (/\.ya?ml$/.test(name)) return yamlConfig(text);
  return scriptConfig(text, name === '.eslintrc' || name.endsWith('.json'), name === 'package.json', flat, exported, members);
};

/** How many configurations named by others one directory's reading follows, and how deep. */
const REFERENCE_READS = 24;
const REFERENCE_DEPTH = 4;

/** How large a file named by a configuration may be to be read: a bundle of a package is no configuration. */
const REFERENCE_SIZE = 256 * 1024;

/**
 * Modules whose names a configuration takes in that declare no globals of a
 * client: the `globals` package, read as its environments are, and the
 * platform's own.
 */
const UNREAD_MODULES = /^(?:node:|globals$|eslint$|@eslint\/js$)/;

/** The first of a path's spellings the file system holds. */
const firstFile = (fs: FileSystemHost, path: string, endings: readonly string[]): string | undefined =>
  endings.map((ending) => `${path}${ending}`).find((each) => {
    try {
      return fs.fileExistsSync(each);
    } catch {
      return false;
    }
  });

const MODULE_ENDINGS = ['', '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.json', '/index.js', '/index.mjs', '/index.cjs', '/index.ts'];
const EXTENDS_ENDINGS = ['', '.js', '.cjs', '.json', '.yaml', '.yml', '/index.js', '/index.json'];

/** The entry a manifest names: `exports`' `.` (its `require`, `import` or `default`), else `main`, else `index`. */
const entryOf = (manifest: string | undefined): string => {
  let parsed: unknown;
  try {
    parsed = manifest === undefined ? undefined : JSON.parse(manifest);
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return 'index';
  const record = parsed as Record<string, unknown>;
  const exported = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const conditions = value as Record<string, unknown>;
    for (const key of ['.', 'require', 'import', 'node', 'default']) {
      const found = key in conditions ? exported(conditions[key]) : undefined;
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return exported(record['exports']) ?? (typeof record['main'] === 'string' ? record['main'] : 'index');
};

/**
 * The file an installed package's name leads to from a directory, as Node
 * finds it: `node_modules/<name>` in the directory or any above it, then the
 * subpath, or the entry its manifest names. Up to the repository's root
 * (`ceiling`) and no further (P334): Node would go on to the file system's
 * root, and read a package installed outside the repository.
 */
const installedFile = (fs: FileSystemHost, from: string, name: string, subpath: string, endings: readonly string[], ceiling: string): string | undefined => {
  for (let at = from; ; at = dirname(at)) {
    if (!isWithinDir(at, ceiling)) return undefined;
    const dir = join(at, 'node_modules', name);
    const manifest = textAt(fs, join(dir, 'package.json'));
    if (manifest !== undefined || fs.directoryExistsSync(dir)) {
      return subpath === '' ? firstFile(fs, join(dir, entryOf(manifest).replace(/^\.\//, '')), endings) : firstFile(fs, join(dir, subpath), endings);
    }
    if (dirname(at) === at) return undefined;
  }
};

/** A package name and the path after it: `@scope/name/sub` is `@scope/name` and `sub`. */
const packageOf = (specifier: string): { name: string; subpath: string } => {
  const parts = specifier.split('/');
  const count = specifier.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, count).join('/'), subpath: parts.slice(count).join('/') };
};

/**
 * The package a cascading `extends` names by its short name, as the linter
 * spells it out: `shop` is `eslint-config-shop`, `@acme` is
 * `@acme/eslint-config`, `@acme/web` is `@acme/eslint-config-web`.
 */
const shareableName = (specifier: string): string => {
  if (specifier.startsWith('@')) {
    const [scope, rest] = [specifier.split('/')[0] as string, specifier.split('/').slice(1).join('/')];
    if (rest === '') return `${scope}/eslint-config`;
    return rest.startsWith('eslint-config') ? specifier : `${scope}/eslint-config-${rest}`;
  }
  return specifier.startsWith('eslint-config-') || specifier === 'eslint-config' || specifier.startsWith('eslint-config/') ? specifier : `eslint-config-${specifier}`;
};

/**
 * Where a configuration's reference leads (P341): the file to read, or why
 * none is read; nothing for the linter's own configurations
 * (`eslint:recommended`) and the platform's modules, none of which a
 * client's globals are read from.
 */
type Lead = { readonly file: string } | { readonly why: string } | undefined;

/**
 * The file a configuration names from a directory, where it can be found: a
 * path from that directory, or an installed package, inside the repository
 * (`ceiling`, P334): a path leading out of it is not read.
 */
const referencedFile = (fs: FileSystemHost, from: string, reference: Reference, ceiling: string): Lead => {
  const { specifier, kind } = reference;
  const endings = kind === 'extends' ? EXTENDS_ENDINGS : MODULE_ENDINGS;
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    const found = firstFile(fs, isAbsolute(specifier) ? specifier : join(from, specifier), endings);
    if (found === undefined) return { why: 'no such file' };
    return isWithinDir(found, ceiling) ? { file: found } : { why: 'outside the repository' };
  }
  if (kind === 'extends' && /^(?:eslint|plugin):/.test(specifier)) return undefined;
  if (kind !== 'extends' && UNREAD_MODULES.test(specifier)) return undefined;
  const { name, subpath } = packageOf(kind === 'extends' ? shareableName(specifier) : specifier);
  const found = installedFile(fs, from, name, subpath, endings, ceiling);
  return found === undefined ? { why: `${name} is not installed inside the repository` } : { file: found };
};

/** The text a reference is said by where it is not followed (P341). */
const namedBy = (reference: Reference): string => {
  if (reference.named !== undefined) return reference.named;
  if (reference.config !== undefined) return `${reference.specifier} configs.${reference.config.name}`;
  const members = [...(reference.exported === undefined ? [] : [reference.exported]), ...(reference.path ?? [])];
  return members.length === 0 ? reference.specifier : `${reference.specifier} ${members.join('.')}`;
};

/**
 * One configuration with every configuration it names read into it (P323):
 * the globals each declares under the scopes it is named in and its own, and
 * a flat module's ignores for every object. A file is read once, and so many
 * and so deep at most. What is named and not followed - not found, outside
 * the repository, past those limits, or a value its file writes in a way not
 * read - is kept with why, under the scopes it is named in (P341).
 */
const withReferences = (fs: FileSystemHost, path: string, reading: ConfigReading, ceiling: string): Omit<LinterConfig, 'dir' | 'root'> => {
  const declared = [...reading.declared];
  const ignored = [...reading.ignored];
  const unfollowed: Unfollowed[] = (reading.unknown ?? []).map((each) => ({ ...each, file: path }));
  // A file is read once for each export, members and plugin's configuration taken from it.
  const seen = new Set<string>([path]);
  let reads = 0;
  const follow = (references: readonly Reference[], from: string, namedIn: string, depth: number): void => {
    for (const reference of references) {
      const missed = (why: string): void => {
        unfollowed.push({ file: namedIn, named: namedBy(reference), why, scopes: reference.scopes });
      };
      if (depth >= REFERENCE_DEPTH || reads >= REFERENCE_READS) {
        if (referencedFile(fs, from, reference, ceiling) !== undefined) missed('past how many configurations are followed');
        continue;
      }
      const lead = referencedFile(fs, from, reference, ceiling);
      if (lead === undefined) continue;
      if ('why' in lead) {
        missed(lead.why);
        continue;
      }
      const { file } = lead;
      const members = [...(reference.exported === undefined ? [] : [reference.exported]), ...(reference.path ?? [])];
      const key = reference.config !== undefined ? `${file}#configs.${reference.config.name}` : members.length > 0 ? `${file}#${members.join('.')}` : file;
      if (seen.has(key)) continue;
      seen.add(key);
      reads += 1;
      const text = textAt(fs, file);
      if (text === undefined || text.length > REFERENCE_SIZE) {
        missed(text === undefined ? 'unreadable' : 'too large to be a configuration');
        continue;
      }
      const inner =
        reference.config !== undefined
          ? pluginConfig(text, reference.config.name, reference.config.flat)
          : configText(file, text, reference.kind === 'module', reference.exported, reference.path);
      if (inner.missed !== undefined) missed(inner.missed);
      for (const each of inner.declared) declared.push({ names: each.names, scopes: [...reference.scopes, ...each.scopes] });
      for (const each of inner.unknown ?? []) unfollowed.push({ ...each, file, scopes: [...reference.scopes, ...each.scopes] });
      if (reference.scopes.length === 0) ignored.push(...inner.ignored);
      follow(inner.references.map((each) => ({ ...each, scopes: [...reference.scopes, ...each.scopes] })), dirname(file), file, depth + 1);
    }
  };
  follow(reading.references, dirname(path), path, 0);
  return { declared, ignored: globsOf(ignored.map((pattern) => pattern.replace(/\/+$/, ''))), unfollowed };
};

/**
 * The configuration one directory holds, where it holds one: its flat
 * configuration, which no configuration above it adds to, or the first of
 * the cascading configuration's files the linter takes (P317), with what it
 * names read into it (P323).
 */
const configIn = (fs: FileSystemHost, dir: string, ceiling: string): LinterConfig | undefined => {
  for (const name of FLAT_CONFIGS) {
    const path = join(dir, name);
    const text = textAt(fs, path);
    if (text !== undefined) return { dir, ...withReferences(fs, path, scriptConfig(text, false, false, true), ceiling), root: true };
  }
  for (const name of CASCADING_CONFIGS) {
    const path = join(dir, name);
    const text = textAt(fs, path);
    if (text === undefined) continue;
    // A manifest is a configuration only where it writes one.
    if (name === 'package.json' && !/"eslintConfig"\s*:/.test(text)) continue;
    const read = configText(path, text, false);
    return { dir, ...withReferences(fs, path, read, ceiling), root: read.root };
  }
  return undefined;
};

/**
 * Whether a flat configuration ignores a file for every object (P323): a
 * pattern naming it, or a directory it is in.
 */
const isIgnored = (config: LinterConfig, path: string): boolean => {
  if (config.ignored.length === 0) return false;
  const parts = path.split('/');
  return parts.some((_, index) => {
    const prefix = parts.slice(0, index + 1).join('/');
    return config.ignored.some((glob) => glob.test(prefix));
  });
};

const NO_CONFIGS: readonly LinterConfig[] = [];

/** The repository's root an upward walk stops at: the workspace declaring it, else the root itself (P334). */
const readCeiling = (root: string): string => {
  try {
    return scanCeilingOf(root);
  } catch {
    return root;
  }
};

/**
 * The globals a script declares for its linter (P311): its own `/* global *\/`
 * comment, and what the linter's configuration declares - `globals` in an
 * `.eslintrc*`, `languageOptions.globals` in an `eslint.config.*`, an
 * environment turned on - in the script's directory or any above it up to the
 * repository's root. The walk up stops at a configuration saying `root: true`
 * and at a flat configuration, and a part of one written for some files - an
 * `overrides` entry, a flat configuration's object with `files` - declares its
 * globals for the files it names alone (P317). What a configuration names to
 * be read with it counts as its own (P323): a cascading `extends`, a file's
 * path or a shareable configuration installed, and a module a flat
 * configuration takes in; and a flat configuration's object writing `ignores`
 * alone leaves the files it names unlinted, declaring nothing. Read through
 * the project's own file system, lazily and once per directory.
 */
/**
 * What the linter's configuration declares for a script, and what it names
 * for the script that was not followed (P341), each said as `file: named
 * (why)` with the file relative to the repository's root.
 */
export interface LinterGlobals {
  (file: SourceFile): ReadonlySet<string>;
  unfollowed(file: SourceFile): readonly string[];
}

export const linterGlobals = (fs: FileSystemHost, repoDir: string): LinterGlobals => {
  const root = repoDir.length > 1 ? repoDir.replace(/[\\/]+$/, '') : repoDir;
  const inside = (dir: string): boolean => dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`);
  // What a configuration names is looked for inside the repository alone (P334):
  // its root, or the workspace that declares it as a member.
  let ceiling: string | undefined;
  const ceilingOf = (): string => (ceiling ??= readCeiling(root));
  const byDirectory = new Map<string, readonly LinterConfig[]>();
  // The configurations a script in a directory is read under, nearest first.
  const configured = (dir: string): readonly LinterConfig[] => {
    const known = byDirectory.get(dir);
    if (known !== undefined) return known;
    const own = configIn(fs, dir, ceilingOf());
    const parent = dirname(dir);
    const above = own?.root === true || dir === root || parent === dir || !inside(parent) ? NO_CONFIGS : configured(parent);
    const all = own === undefined ? above : [own, ...above];
    byDirectory.set(dir, all);
    return all;
  };
  // The configurations a script is linted under, each with the script's path relative to it.
  const linting = (file: SourceFile): { config: LinterConfig; relative: string }[] => {
    const path = file.getFilePath();
    const dir = dirname(path);
    return (inside(dir) ? configured(dir) : NO_CONFIGS).flatMap((config) => {
      const relative = path.slice(config.dir === '/' ? 1 : config.dir.length + 1);
      // A file the flat configuration ignores for every object is not linted, and declares nothing (P323).
      return isIgnored(config, relative) ? [] : [{ config, relative }];
    });
  };
  const byFile = new WeakMap<SourceFile, ReadonlySet<string>>();
  const declaredFor = (file: SourceFile): ReadonlySet<string> => {
    const known = byFile.get(file);
    if (known !== undefined) return known;
    const comment = declaredGlobals(file);
    const names = new Set(comment);
    for (const { config, relative } of linting(file)) {
      for (const declared of config.declared) {
        if (declared.scopes.every((scope) => inScope(scope, relative))) for (const name of declared.names) names.add(name);
      }
    }
    const all = names.size === comment.size ? comment : names;
    byFile.set(file, all);
    return all;
  };
  const shown = (path: string): string => {
    if (inside(path)) return path.slice(root === '/' ? 1 : root.length + 1);
    const top = ceilingOf();
    return isWithinDir(path, top) ? path.slice(top.length + 1) : basename(path);
  };
  const unfollowed = (file: SourceFile): readonly string[] => {
    const said = new Set<string>();
    for (const { config, relative } of linting(file)) {
      for (const each of config.unfollowed) {
        if (each.scopes.every((scope) => inScope(scope, relative))) said.add(`${shown(each.file)}: ${each.named} (${each.why})`);
      }
    }
    return [...said];
  };
  return Object.assign(declaredFor, { unfollowed });
};
