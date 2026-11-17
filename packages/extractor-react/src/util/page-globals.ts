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

/** What one configuration file says: the globals it declares, and whether no configuration above it is read. */
interface LinterConfig {
  readonly dir: string;
  readonly declared: readonly Declared[];
  readonly root: boolean;
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
 * What a configuration written as a script or as JSON says: the globals under
 * `globals` or an environment turned on, wherever they are written, each
 * under the `files` of every object it is written in (P317), and `root`
 * written outside any of those.
 */
const scriptConfig = (text: string, json: boolean, manifest: boolean, flat: boolean): Omit<LinterConfig, 'dir'> => {
  const declared: Declared[] = [];
  let root = false;
  const source = ts.createSourceFile('config.js', json ? `(${text})` : text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const visit = (node: ts.Node, within: boolean, scopes: readonly Scope[]): void => {
    if (within && ts.isObjectLiteralExpression(node)) {
      const written = new Map<string, ts.Expression>();
      for (const property of node.properties) {
        const key = ts.isPropertyAssignment(property) ? keyOf(property.name) : undefined;
        if (key !== undefined && ts.isPropertyAssignment(property)) written.set(key, property.initializer);
      }
      const files = written.get('files');
      if (files !== undefined) {
        const excluded = written.get(flat ? 'ignores' : 'excludedFiles');
        const scope = scopeOf(writtenStrings(files), excluded === undefined ? [] : writtenStrings(excluded), flat);
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
    }
    ts.forEachChild(node, (child) => visit(child, within, scopes));
  };
  visit(source, !manifest, []);
  return { declared, root };
};

/** What a configuration written as YAML says, read as the cascading configuration's keys are: `root`, `globals`, `env` and `overrides`. */
const yamlConfig = (text: string): Omit<LinterConfig, 'dir'> => {
  let value: unknown;
  try {
    value = readDocument(text, 'yaml').value;
  } catch {
    return { declared: [], root: false };
  }
  const declared: Declared[] = [];
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
    const overrides = record['overrides'];
    for (const entry of Array.isArray(overrides) ? overrides : []) {
      if (entry === null || typeof entry !== 'object') continue;
      const each = entry as Record<string, unknown>;
      read(each, [...scopes, scopeOf(stringsOf(each['files']), stringsOf(each['excludedFiles']), false)]);
    }
  };
  read(value, []);
  const root = value !== null && typeof value === 'object' && (value as Record<string, unknown>)['root'] === true;
  return { declared, root };
};

/** The text of a file, where the project's file system holds it. */
const textAt = (fs: FileSystemHost, path: string): string | undefined => {
  try {
    return fs.fileExistsSync(path) ? fs.readFileSync(path, 'utf8') : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The configuration one directory holds, where it holds one: its flat
 * configuration, which no configuration above it adds to, or the first of
 * the cascading configuration's files the linter takes (P317).
 */
const configIn = (fs: FileSystemHost, dir: string): LinterConfig | undefined => {
  for (const name of FLAT_CONFIGS) {
    const text = textAt(fs, join(dir, name));
    if (text !== undefined) return { dir, ...scriptConfig(text, false, false, true), root: true };
  }
  for (const name of CASCADING_CONFIGS) {
    const text = textAt(fs, join(dir, name));
    if (text === undefined) continue;
    // A manifest is a configuration only where it writes one.
    if (name === 'package.json' && !/"eslintConfig"\s*:/.test(text)) continue;
    const read = /\.ya?ml$/.test(name) ? yamlConfig(text) : scriptConfig(text, name === '.eslintrc' || name.endsWith('.json'), name === 'package.json', false);
    return { dir, ...read };
  }
  return undefined;
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
 * globals for the files it names alone (P317). Read through the project's own
 * file system, lazily and once per directory.
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
      for (const declared of config.declared) {
        if (declared.scopes.every((scope) => inScope(scope, relative))) for (const name of declared.names) names.add(name);
      }
    }
    const all = names.size === comment.size ? comment : names;
    byFile.set(file, all);
    return all;
  };
};
