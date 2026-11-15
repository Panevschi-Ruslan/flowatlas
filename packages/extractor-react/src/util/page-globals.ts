import { basename, dirname, isAbsolute, join } from 'node:path';
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
 * The linter's configuration files one directory may hold (P311), each read
 * for the globals it declares: the flat configuration, the older cascading
 * one in every spelling, and a manifest's `eslintConfig`.
 */
const LINTER_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintrc.json',
  '.eslintrc',
  'package.json',
];

/**
 * The globals an environment the linter is told of declares, of the ones a
 * client is loaded as (P311): `env: { jquery: true }`, or the `globals`
 * package's `globals.jquery` spread into a flat configuration.
 */
const ENVIRONMENTS: Readonly<Record<string, readonly string[]>> = { jquery: ['$', 'jQuery'] };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const keyOf = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name.text : undefined;

/** The globals one `globals` value declares: its keys but those turned `off`, and an environment's spread in. */
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

/** The globals a configuration written as a script or as JSON declares, under `globals` or an `env` turned on, anywhere in it. */
const scriptConfigGlobals = (text: string, json: boolean, manifest: boolean): Set<string> => {
  const names = new Set<string>();
  const source = ts.createSourceFile('config.js', json ? `(${text})` : text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const visit = (node: ts.Node, within: boolean): void => {
    if (ts.isPropertyAssignment(node)) {
      const key = keyOf(node.name);
      // A manifest's own keys are not the linter's; only its `eslintConfig` is.
      if (!within) {
        visit(node.initializer, key === 'eslintConfig');
        return;
      }
      if (key === 'globals') {
        globalsIn(node.initializer, names);
        return;
      }
      if (key === 'env' && ts.isObjectLiteralExpression(node.initializer)) {
        for (const property of node.initializer.properties) {
          if (!ts.isPropertyAssignment(property) || property.initializer.kind !== ts.SyntaxKind.TrueKeyword) continue;
          for (const name of ENVIRONMENTS[keyOf(property.name) ?? ''] ?? []) names.add(name);
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, within));
  };
  visit(source, !manifest);
  return names;
};

/** The globals a configuration written as YAML declares: the keys under `globals:` and the environments turned on under `env:`. */
const yamlConfigGlobals = (text: string): Set<string> => {
  const names = new Set<string>();
  let block: 'globals' | 'env' | undefined;
  let indent = -1;
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\s*)(?:-\s+)?["']?([\w$-]+)["']?\s*:\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (match === null) continue;
    const depth = (match[1] ?? '').length;
    const key = match[2] ?? '';
    const value = (match[3] ?? '').replace(/^["']|["']$/g, '');
    if (block !== undefined && depth > indent) {
      if (block === 'globals' && IDENTIFIER.test(key) && value !== 'off') names.add(key);
      if (block === 'env' && value === 'true') for (const name of ENVIRONMENTS[key] ?? []) names.add(name);
      continue;
    }
    block = (key === 'globals' || key === 'env') && value === '' ? key : undefined;
    indent = depth;
  }
  return names;
};

/** The globals the linter's configuration files in one directory declare. */
const configGlobalsIn = (fs: FileSystemHost, dir: string): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const name of LINTER_CONFIGS) {
    const path = join(dir, name);
    let text: string;
    try {
      if (!fs.fileExistsSync(path)) continue;
      text = fs.readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const found = /\.ya?ml$/.test(name)
      ? yamlConfigGlobals(text)
      : scriptConfigGlobals(text, name === '.eslintrc' || name.endsWith('.json'), name === 'package.json');
    for (const each of found) names.add(each);
  }
  return names;
};

const NO_GLOBALS: ReadonlySet<string> = new Set();

/**
 * The globals a script declares for its linter (P311): its own `/* global *\/`
 * comment, and what the linter's configuration declares - `globals` in an
 * `.eslintrc*`, `languageOptions.globals` in an `eslint.config.*`, an
 * environment turned on - in the script's directory or any above it up to the
 * repository's root. Read through the project's own file system, lazily and
 * once per directory.
 */
export const linterGlobals = (fs: FileSystemHost, repoDir: string): ((file: SourceFile) => ReadonlySet<string>) => {
  const root = repoDir.length > 1 ? repoDir.replace(/[\\/]+$/, '') : repoDir;
  const inside = (dir: string): boolean => dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`);
  const byDirectory = new Map<string, ReadonlySet<string>>();
  const configured = (dir: string): ReadonlySet<string> => {
    const known = byDirectory.get(dir);
    if (known !== undefined) return known;
    const own = configGlobalsIn(fs, dir);
    const parent = dirname(dir);
    const above = dir === root || parent === dir || !inside(parent) ? NO_GLOBALS : configured(parent);
    const all = own.size === 0 ? above : above.size === 0 ? own : new Set([...above, ...own]);
    byDirectory.set(dir, all);
    return all;
  };
  const byFile = new WeakMap<SourceFile, ReadonlySet<string>>();
  return (file) => {
    const known = byFile.get(file);
    if (known !== undefined) return known;
    const comment = declaredGlobals(file);
    const dir = dirname(file.getFilePath());
    const config = inside(dir) ? configured(dir) : NO_GLOBALS;
    const all = config.size === 0 ? comment : comment.size === 0 ? config : new Set([...comment, ...config]);
    byFile.set(file, all);
    return all;
  };
};
