import { basename, dirname, isAbsolute, join } from 'node:path';
import { compileGlob, readDocument, type Glob } from '@flowatlas/core';
import type { FileSystemHost, SourceFile } from 'ts-morph';
import { ts } from 'ts-morph';

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
  readonly kind: 'extends' | 'module';
  readonly scopes: readonly Scope[];
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
}

/** What one directory's configuration says, with what it names read into it (P323). */
interface LinterConfig {
  readonly dir: string;
  readonly declared: readonly Declared[];
  readonly root: boolean;
  readonly ignored: readonly Glob[];
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

/** The module a `require('x')` names, read through a member taken off it (`require('x').default`). */
const requiredIn = (node: ts.Node): string | undefined => {
  let at = node;
  while (ts.isPropertyAccessExpression(at)) at = at.expression;
  if (!ts.isCallExpression(at) || !ts.isIdentifier(at.expression) || at.expression.text !== 'require') return undefined;
  const [specifier] = at.arguments;
  return specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : undefined;
};

/**
 * The names a configuration script takes in from other modules, and the
 * module each names (P323): `import base from './base.js'`, `import * as
 * shared from 'x'`, `import { browser } from 'x'`, `const base =
 * require('./base')` and the names destructured out of a `require`.
 */
const importedNames = (source: ts.SourceFile): ReadonlyMap<string, string> => {
  const names = new Map<string, string>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const from = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name !== undefined) names.set(clause.name.text, from);
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.set(bindings.name.text, from);
      else if (bindings !== undefined) for (const element of bindings.elements) names.set(element.name.text, from);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const from = declaration.initializer === undefined ? undefined : requiredIn(declaration.initializer);
      if (from === undefined) continue;
      if (ts.isIdentifier(declaration.name)) names.set(declaration.name.text, from);
      else if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) if (ts.isIdentifier(element.name)) names.set(element.name.text, from);
      }
    }
  }
  return names;
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
    ts.isVariableDeclaration(parent) && parent.name === name
  ) {
    return false;
  }
  let top: ts.Node = name;
  while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) top = top.parent;
  return !(ts.isCallExpression(top.parent) && top.parent.expression === top);
};

/** Whether a `require` call, or a member taken off it, is what a declaration holds: read where the name it is kept under is. */
const declaredFrom = (call: ts.Node): boolean => {
  let top = call;
  while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) top = top.parent;
  return ts.isVariableDeclaration(top.parent);
};

/** Whether an object of a flat configuration writes `ignores` and nothing else but a name: the files no object is for (P323). */
const ignoresOnly = (written: ReadonlyMap<string, ts.Expression>, properties: number): boolean =>
  written.has('ignores') && properties === written.size && [...written.keys()].every((key) => key === 'ignores' || key === 'name');

/**
 * What a configuration written as a script or as JSON says: the globals under
 * `globals` or an environment turned on, wherever they are written, each
 * under the `files` of every object it is written in (P317), and `root`
 * written outside any of those. Also what it names to be read with it (P323):
 * a cascading `extends`, a module it imports or requires read as a value; and
 * a flat configuration's objects writing `ignores` alone, the files it reads
 * for nothing, where an object writing `ignores` beside anything else is for
 * every file but those.
 */
const scriptConfig = (text: string, json: boolean, manifest: boolean, flat: boolean): ConfigReading => {
  const declared: Declared[] = [];
  const references: Reference[] = [];
  const ignored: string[] = [];
  let root = false;
  const source = ts.createSourceFile('config.js', json ? `(${text})` : text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imported = json ? new Map<string, string>() : importedNames(source);
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
      if (files !== undefined || (flat && excluded !== undefined)) {
        const scope = scopeOf(files === undefined ? [] : writtenStrings(files), excluded === undefined ? [] : writtenStrings(excluded), flat);
        node.properties.forEach((child) => visit(child, within, [...scopes, scope]));
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
      // A cascading configuration's `extends` names files and shareable
      // configurations; a flat one's names a plugin's by text, and a module by a name.
      if (key === 'extends' && !flat) for (const specifier of writtenStrings(node.initializer)) references.push({ specifier, kind: 'extends', scopes });
    }
    if (within && !json) {
      const from = ts.isIdentifier(node) ? (readAsValue(node) ? imported.get(node.text) : undefined) : ts.isCallExpression(node) && !declaredFrom(node) ? requiredIn(node) : undefined;
      if (from !== undefined) references.push({ specifier: from, kind: 'module', scopes });
    }
    ts.forEachChild(node, (child) => visit(child, within, scopes));
  };
  visit(source, !manifest, []);
  return { declared, root, references, ignored };
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
    for (const specifier of stringsOf(record['extends'])) references.push({ specifier, kind: 'extends', scopes });
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
const configText = (path: string, text: string, flat: boolean): ConfigReading => {
  const name = basename(path);
  if (/\.ya?ml$/.test(name)) return yamlConfig(text);
  return scriptConfig(text, name === '.eslintrc' || name.endsWith('.json'), name === 'package.json', flat);
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
 * subpath, or the entry its manifest names.
 */
const installedFile = (fs: FileSystemHost, from: string, name: string, subpath: string, endings: readonly string[]): string | undefined => {
  for (let at = from; ; at = dirname(at)) {
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
 * The file a configuration names from a directory, where it can be found: a
 * path from that directory, or an installed package. The linter's own
 * configurations (`eslint:recommended`) and a plugin's (`plugin:x/y`) are
 * none a client's globals are read from.
 */
const referencedFile = (fs: FileSystemHost, from: string, reference: Reference): string | undefined => {
  const { specifier, kind } = reference;
  const endings = kind === 'extends' ? EXTENDS_ENDINGS : MODULE_ENDINGS;
  if (specifier.startsWith('.') || isAbsolute(specifier)) return firstFile(fs, isAbsolute(specifier) ? specifier : join(from, specifier), endings);
  if (kind === 'extends' && /^(?:eslint|plugin):/.test(specifier)) return undefined;
  if (kind === 'module' && UNREAD_MODULES.test(specifier)) return undefined;
  const { name, subpath } = packageOf(kind === 'extends' ? shareableName(specifier) : specifier);
  return installedFile(fs, from, name, subpath, endings);
};

/**
 * One configuration with every configuration it names read into it (P323):
 * the globals each declares under the scopes it is named in and its own, and
 * a flat module's ignores for every object. A file is read once, and so many
 * and so deep at most.
 */
const withReferences = (fs: FileSystemHost, path: string, reading: ConfigReading): Omit<LinterConfig, 'dir' | 'root'> => {
  const declared = [...reading.declared];
  const ignored = [...reading.ignored];
  const seen = new Set<string>([path]);
  let reads = 0;
  const follow = (references: readonly Reference[], from: string, depth: number): void => {
    for (const reference of references) {
      if (depth >= REFERENCE_DEPTH || reads >= REFERENCE_READS) return;
      const file = referencedFile(fs, from, reference);
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      reads += 1;
      const text = textAt(fs, file);
      if (text === undefined || text.length > REFERENCE_SIZE) continue;
      const inner = configText(file, text, reference.kind === 'module');
      for (const each of inner.declared) declared.push({ names: each.names, scopes: [...reference.scopes, ...each.scopes] });
      if (reference.scopes.length === 0) ignored.push(...inner.ignored);
      follow(inner.references.map((each) => ({ ...each, scopes: [...reference.scopes, ...each.scopes] })), dirname(file), depth + 1);
    }
  };
  follow(reading.references, dirname(path), 0);
  return { declared, ignored: globsOf(ignored.map((pattern) => pattern.replace(/\/+$/, ''))) };
};

/**
 * The configuration one directory holds, where it holds one: its flat
 * configuration, which no configuration above it adds to, or the first of
 * the cascading configuration's files the linter takes (P317), with what it
 * names read into it (P323).
 */
const configIn = (fs: FileSystemHost, dir: string): LinterConfig | undefined => {
  for (const name of FLAT_CONFIGS) {
    const path = join(dir, name);
    const text = textAt(fs, path);
    if (text !== undefined) return { dir, ...withReferences(fs, path, scriptConfig(text, false, false, true)), root: true };
  }
  for (const name of CASCADING_CONFIGS) {
    const path = join(dir, name);
    const text = textAt(fs, path);
    if (text === undefined) continue;
    // A manifest is a configuration only where it writes one.
    if (name === 'package.json' && !/"eslintConfig"\s*:/.test(text)) continue;
    const read = configText(path, text, false);
    return { dir, ...withReferences(fs, path, read), root: read.root };
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
export const linterGlobals = (fs: FileSystemHost, repoDir: string): ((file: SourceFile) => ReadonlySet<string>) => {
  const root = repoDir.length > 1 ? repoDir.replace(/[\\/]+$/, '') : repoDir;
  const inside = (dir: string): boolean => dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`);
  const byDirectory = new Map<string, readonly LinterConfig[]>();
  // The configurations a script in a directory is read under, nearest first.
  const configured = (dir: string): readonly LinterConfig[] => {
    const known = byDirectory.get(dir);
    if (known !== undefined) return known;
    const own = configIn(fs, dir);
    const parent = dirname(dir);
    const above = own?.root === true || dir === root || parent === dir || !inside(parent) ? NO_CONFIGS : configured(parent);
    const all = own === undefined ? above : [own, ...above];
    byDirectory.set(dir, all);
    return all;
  };
  const byFile = new WeakMap<SourceFile, ReadonlySet<string>>();
  return (file) => {
    const known = byFile.get(file);
    if (known !== undefined) return known;
    const comment = declaredGlobals(file);
    const path = file.getFilePath();
    const dir = dirname(path);
    const names = new Set(comment);
    for (const config of inside(dir) ? configured(dir) : NO_CONFIGS) {
      const relative = path.slice(config.dir === '/' ? 1 : config.dir.length + 1);
      // A file the flat configuration ignores for every object is not linted, and declares nothing (P323).
      if (isIgnored(config, relative)) continue;
      for (const declared of config.declared) {
        if (declared.scopes.every((scope) => inScope(scope, relative))) for (const name of declared.names) names.add(name);
      }
    }
    const all = names.size === comment.size ? comment : names;
    byFile.set(file, all);
    return all;
  };
};
