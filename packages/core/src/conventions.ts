import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import type { Project, SourceFile } from 'ts-morph';
import { ts } from 'ts-morph';
import type { GraphBuilder } from './builder.js';
import { bindingNames, exportedNamesOf, parseSyntax } from './config-literal.js';
import { isWithinDir, toPosixPath } from './ids.js';
import { readResolvedPackageJson, type PackageJson } from './adapters/manifest.js';
import type { AdapterRegistry } from './adapters/registry.js';
import type { FlowatlasConfig } from './config.js';
import type { Unresolved } from './model/graph.js';
import { widenServiceExtent } from './workspace.js';

/**
 * What a framework's own build writes for the compiler, said by a reader for a
 * clone that has not run it (P240).
 *
 * Some frameworks resolve imports the compiler has never heard of. An alias
 * such as `~/composables/orders` is the framework's, and the tsconfig that
 * names it is one the framework writes into a directory of its own when it
 * prepares the project - a directory a fresh clone does not have. A name used
 * with no import at all is the framework's too: it adds the import when it
 * builds the file. Read without that build, both resolve to nothing, and
 * every call through them is lost.
 *
 * So a reader that knows such a framework states what the build would have
 * written - the aliases, and which names each file may use unimported, from
 * which file - and the project is opened with that said. What the repository
 * says itself always wins: a `paths` key the tsconfig names is never
 * replaced, an import a file writes is never doubled, and where the
 * framework's own generated tsconfig is there, its aliases are the ones read.
 * Each such reading is said once per repository, as a row.
 *
 * The core names no framework: every fact here is the reader's, handed over
 * as data.
 */

/** One file whose exports some files use with no import, and the names they use them by. */
export interface ImplicitImportSource {
  /** Repo-relative POSIX path. */
  readonly file: string;
  /** Each name a file may use, and the export it is: its own name, or `default`. */
  readonly names: ReadonlyArray<{ readonly name: string; readonly export: string }>;
  /**
   * Where the file stands when another gives the same name (P243): the lowest
   * rank is the one imported, and each one below it is said as a note. Two
   * files of the one rank giving a name are ambiguous. `0` when unsaid.
   */
  readonly rank?: number;
}

/** Names the files of some directories use with no import, and where each is from. */
export interface ImplicitImports {
  /** What those files are, for a row: `the application`, `the server`. */
  readonly label: string;
  /** Repo-relative directories whose files may use the names; `''` is the whole repository. */
  readonly within: readonly string[];
  /** Directories inside those whose files may not. */
  readonly except?: readonly string[];
  /** Where the names come from, as a row says it: `composables/`, `utils/`. */
  readonly from: readonly string[];
  readonly sources: readonly ImplicitImportSource[];
}

/** A module the framework provides by a name that is no file: `<prefix>` or `<prefix>/...`. */
export interface FrameworkModule {
  readonly name: string;
  /** The package that provides it when installed. */
  readonly package: string;
}

/** What one framework's build would have written for the compiler, as its reader states it. */
export interface ProjectConventions {
  /** The framework, as a row names it. */
  readonly by: string;
  /** The adapter that states it. */
  readonly adapter: string;
  /** Repo-relative file the rows point at: the framework's configuration, when it has one. */
  readonly file: string;
  /**
   * The tsconfigs the framework writes, repo-relative, the first of them its
   * main one, and the command that writes them. When one is there, its
   * `paths` stand in for {@link paths}: it is the framework's own answer.
   * Without, the aliases are the convention's (`aliases-from-convention`);
   * with no generated file at all, they are read from the framework's
   * configuration (`aliases-from-config`).
   */
  readonly generated?: { readonly tsconfigs: readonly string[]; readonly command: string };
  /** Aliases as `paths` keys, each to targets relative to the root. */
  readonly paths?: Readonly<Record<string, readonly string[]>>;
  /** The names files use unimported, by group of files; a file is in the first group that holds it. */
  readonly implicit?: readonly ImplicitImports[];
  /**
   * A module made of a group's names, by the specifier files import it by
   * (`#imports`), and the index of the group in {@link implicit}. Made up
   * when the generated tsconfig is not there - where it is, that tsconfig
   * names the module the framework wrote - and held in memory under
   * `node_modules`, as a package's shape is, so no reader takes it for a
   * file of the repository.
   */
  readonly modules?: ReadonlyArray<{ readonly specifier: string; readonly implicit: number }>;
  /** Modules the framework provides that are no file of the repository. */
  readonly frameworkModules?: readonly FrameworkModule[];
  /** What the reader could not read of the framework's configuration, said as rows. */
  readonly rows?: readonly Unresolved[];
  /** Repo-relative files the conventions were read from: a change to one changes every file's reading. */
  readonly files?: readonly string[];
  /**
   * Absolute directories outside the root that the framework builds into the
   * application as its own code (P243): read as part of the service, as a
   * workspace package it declares is (`widenServiceExtent`).
   */
  readonly extent?: readonly string[];
  /**
   * How the reader ranks the files that give one name, as a row says it
   * (P243): `the order of its layers: the application, layers/base`.
   */
  readonly precedence?: string;
}

/** How a reader states a framework's conventions for one repository, or says it has none. */
export type ConventionsOf = (repoDir: string, pkg: PackageJson) => ProjectConventions | undefined;

/**
 * The conventions the adapters that apply to a repository state, asked the
 * way detection asks them: of the resolved manifest, under the
 * configuration's `force`. None without a registry to ask.
 */
export const conventionsFor = (
  registry: AdapterRegistry | undefined,
  rootDir: string,
  config?: FlowatlasConfig,
): ProjectConventions[] => {
  if (registry === undefined) return [];
  const pkg = readResolvedPackageJson(rootDir) ?? {};
  const stated = registry.conventions(pkg, rootDir, config?.adapters.auto === true ? config.adapters.force : {}, config);
  // Before anything asks what the service is (P243).
  widenServiceExtent(rootDir, stated.flatMap((convention) => convention.extent ?? []));
  return stated;
};

// ---------------------------------------------------------------------------
// Aliases

/** Where the aliases a project was opened with came from, for the rows. */
type AliasSource = 'convention' | 'generated' | 'config';

interface SuppliedAliases {
  readonly by: string;
  readonly adapter: string | undefined;
  readonly file: string;
  readonly source: AliasSource;
  /** The generated tsconfig that was not there, and the command that writes it. */
  readonly missing?: { readonly tsconfig: string; readonly command: string };
  /** Keys supplied, each to its targets relative to the root. */
  readonly paths: Readonly<Record<string, readonly string[]>>;
}

/** The `paths` one tsconfig states, every target made absolute, or nothing when it names none. */
const absolutePathsOf = (configPath: string): Record<string, string[]> | undefined => {
  const read = ts.readConfigFile(toPosixPath(configPath), ts.sys.readFile);
  if (read.error !== undefined) return undefined;
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: () => [],
    },
    dirname(configPath),
    undefined,
    configPath,
  );
  const { paths, baseUrl, pathsBasePath } = parsed.options;
  if (paths === undefined || Object.keys(paths).length === 0) return undefined;
  const base = typeof pathsBasePath === 'string' ? pathsBasePath : (baseUrl ?? dirname(configPath));
  return Object.fromEntries(Object.entries(paths).map(([key, targets]) => [key, targets.map((target) => toPosixPath(resolve(base, target)))]));
};

/**
 * The tsconfigs a tsconfig refers its code to (`references`), as paths that
 * are there. A solution tsconfig - `files: []` and a list of references - says
 * nothing about aliases itself: its projects do.
 */
const referencedTsconfigs = (configPath: string): string[] => {
  const read = ts.readConfigFile(toPosixPath(configPath), ts.sys.readFile);
  const references = (read.config as { references?: unknown } | undefined)?.references;
  if (!Array.isArray(references)) return [];
  return references.flatMap((reference) => {
    const path = (reference as { path?: unknown }).path;
    if (typeof path !== 'string') return [];
    const target = resolve(dirname(configPath), path);
    const file = existsSync(target) && statSync(target).isDirectory() ? join(target, 'tsconfig.json') : target;
    return existsSync(file) ? [file] : [];
  });
};

/** A target as a row shows it: repo-relative, `.` for the root and `./*` for everything in it. */
const relativeTarget = (rootDir: string, target: string): string => {
  const rel = toPosixPath(relative(rootDir, target));
  return rel === '' ? '.' : rel.startsWith('*') ? `./${rel}` : rel;
};

/** Where a module of names is held in memory: under the root's `node_modules`, named by its adapter and specifier. */
const madeUpModulePath = (rootDir: string, convention: ProjectConventions, specifier: string): string =>
  posix.join(toPosixPath(rootDir), 'node_modules', '.flowatlas', convention.adapter, `${specifier.replace(/[^\w.-]+/g, '_')}.d.ts`);

/** The keys of `paths` that `taken` does not name, as `paths`. */
const missingFrom = (
  paths: Readonly<Record<string, readonly string[]>>,
  taken: ReadonlySet<string>,
): Record<string, string[]> => Object.fromEntries(Object.entries(paths).filter(([key]) => !taken.has(key)).map(([key, targets]) => [key, [...targets]]));

/** The aliases a project is opened with beyond its tsconfig's own, and where each set came from. */
export interface ConventionAliases {
  /** Absolute targets, merged under the tsconfig's own keys. */
  readonly paths: Readonly<Record<string, string[]>>;
  readonly supplied: readonly SuppliedAliases[];
  /** The modules of names to make up, at the absolute paths {@link paths} sends their specifiers to. */
  readonly modules: ReadonlyArray<{ readonly path: string; readonly convention: ProjectConventions; readonly implicit: number }>;
}

/**
 * The aliases to open a project with beyond those its tsconfig names, in the
 * order they win: the projects a solution tsconfig refers to, then each
 * framework's - its generated tsconfig where it is there, its convention
 * where it is not.
 */
export const conventionAliases = (
  rootDir: string,
  tsconfig: string | undefined,
  own: Readonly<Record<string, readonly string[]>> | undefined,
  conventions: readonly ProjectConventions[],
): ConventionAliases => {
  const taken = new Set(Object.keys(own ?? {}));
  const paths: Record<string, string[]> = {};
  const supplied: SuppliedAliases[] = [];
  const modules: Array<{ path: string; convention: ProjectConventions; implicit: number }> = [];
  const take = (found: Record<string, string[]>, source: Omit<SuppliedAliases, 'paths'>): void => {
    const added = missingFrom(found, taken);
    if (Object.keys(added).length === 0) return;
    for (const [key, targets] of Object.entries(added)) {
      taken.add(key);
      paths[key] = targets;
    }
    supplied.push({
      ...source,
      paths: Object.fromEntries(Object.entries(added).map(([key, targets]) => [key, targets.map((target) => relativeTarget(rootDir, target))])),
    });
  };
  if (tsconfig !== undefined) {
    for (const referenced of referencedTsconfigs(tsconfig)) {
      const found = absolutePathsOf(referenced);
      if (found !== undefined) take(found, { by: relativeTarget(rootDir, referenced), adapter: undefined, file: relativeTarget(rootDir, tsconfig), source: 'config' });
    }
  }
  for (const convention of conventions) {
    const generated = convention.generated?.tsconfigs.map((file) => join(rootDir, file)).find((file) => existsSync(file));
    if (generated !== undefined) {
      const found = absolutePathsOf(generated);
      if (found !== undefined) take(found, { by: convention.by, adapter: convention.adapter, file: relativeTarget(rootDir, generated), source: 'generated' });
      continue;
    }
    // A module of names is no alias a reader of the row would look for: it is
    // sent to where it is held, and the row about the names says it.
    for (const module of convention.modules ?? []) {
      if (convention.implicit?.[module.implicit] === undefined || taken.has(module.specifier)) continue;
      const path = madeUpModulePath(rootDir, convention, module.specifier);
      modules.push({ path, convention, implicit: module.implicit });
      taken.add(module.specifier);
      paths[module.specifier] = [path.replace(/\.d\.ts$/, '')];
    }
    if (convention.paths === undefined) continue;
    const absolute = Object.fromEntries(
      Object.entries(convention.paths).map(([key, targets]) => [key, targets.map((target) => toPosixPath(resolve(rootDir, target)))]),
    );
    const main = convention.generated?.tsconfigs[0];
    take(absolute, {
      by: convention.by,
      adapter: convention.adapter,
      // The tsconfig that would have named them, or the configuration that does.
      file: tsconfig === undefined || main === undefined ? convention.file : relativeTarget(rootDir, tsconfig),
      source: main === undefined ? 'config' : 'convention',
      ...(main === undefined || convention.generated === undefined ? {} : { missing: { tsconfig: main, command: convention.generated.command } }),
    });
  }
  return { paths, supplied, modules };
};

// ---------------------------------------------------------------------------
// Names used with no import

const SCRIPT_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;

/**
 * The script files of a directory a framework scans for names, repo-relative:
 * its own files and each folder's `index`, or every file below it when
 * `nested`. A directory that is not there holds none.
 */
export const scriptFilesIn = (rootDir: string, dir: string, nested = false): string[] => {
  const at = join(rootDir, dir);
  const out: string[] = [];
  const walk = (absolute: string, depth: number): void => {
    let entries: string[];
    try {
      entries = readdirSync(absolute).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const path = join(absolute, entry);
      let directory: boolean;
      try {
        directory = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (directory) {
        if (nested) walk(path, depth + 1);
        else if (depth === 0) {
          const index = ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.mts'].find((name) => existsSync(join(path, name)));
          if (index !== undefined) out.push(toPosixPath(relative(rootDir, join(path, index))));
        }
        continue;
      }
      if (SCRIPT_EXTENSIONS.test(entry) && !entry.endsWith('.d.ts')) out.push(toPosixPath(relative(rootDir, path)));
    }
  };
  walk(at, 0);
  return out;
};

/**
 * The names each file gives by exporting them, for a group of implicit
 * imports: its named exports, and its default export by the name the
 * framework gives it (`defaultName`).
 */
export const implicitSourcesOf = (
  rootDir: string,
  files: readonly string[],
  defaultName: (file: string) => string | undefined,
): ImplicitImportSource[] =>
  files.flatMap((file) => {
    let text: string;
    try {
      text = readFileSync(join(rootDir, file), 'utf8');
    } catch {
      return [];
    }
    const exported = exportedNamesOf(text, file);
    const fallback = exported.hasDefault ? defaultName(file) : undefined;
    const names = [
      ...exported.named.map((name) => ({ name, export: name })),
      ...(fallback === undefined ? [] : [{ name: fallback, export: 'default' }]),
    ];
    return names.length === 0 ? [] : [{ file, names }];
  });

/** The names a file declares at its top level, which an implicit import must not shadow or double. */
const declaredAtTop = (file: ts.SourceFile): Set<string> => {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      if (ts.isImportEqualsDeclaration(statement)) {
        names.add(statement.name.text);
        continue;
      }
      const clause = statement.importClause;
      if (clause?.name !== undefined) names.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
      if (bindings !== undefined && ts.isNamedImports(bindings)) for (const element of bindings.elements) names.add(element.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) for (const name of bindingNames(declaration.name)) names.add(name);
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name !== undefined &&
      ts.isIdentifier(statement.name)
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
};

/** Whether an identifier is a name a declaration or a member gives, rather than a use of a variable. */
const isNotAUse = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (parent === undefined) return true;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isQualifiedName(parent)) return parent.right === node;
  if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) return parent.name === node;
  if (ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent)) return parent.name === node;
  if (ts.isBindingElement(parent)) return parent.name === node || parent.propertyName === node;
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isTypeParameterDeclaration(parent) ||
    ts.isModuleDeclaration(parent)
  ) {
    return (parent as { name?: ts.Node }).name === node;
  }
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent)) return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  if (ts.isJsxAttribute(parent)) return parent.name === node;
  return false;
};

const escapeName = (name: string): string => name.replace(/[$]/g, '\\$');

/**
 * The names of `candidates` a file's text uses without declaring them at its
 * top level, as the framework decides which imports to add: a name declared
 * in an inner scope still has the outer import it would have had.
 */
export const implicitNamesUsed = (
  text: string,
  fileName: string,
  candidates: ReadonlySet<string>,
  alsoUsed: readonly string[] = [],
): string[] => {
  if (candidates.size === 0) return [];
  const any = new RegExp(`(?<![\\w$])(?:${[...candidates].map(escapeName).join('|')})(?![\\w$])`);
  const marked = alsoUsed.filter((name) => candidates.has(name));
  if (!any.test(text) && marked.length === 0) return [];
  const file = parseSyntax(text, fileName);
  const declared = declaredAtTop(file);
  const used = new Set(marked);
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (candidates.has(node.text) && !isNotAUse(node)) used.add(node.text);
      return;
    }
    // `{ name }` is a use of the variable `name` as well as the key.
    if (ts.isShorthandPropertyAssignment(node) && candidates.has(node.name.text)) used.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...used].filter((name) => !declared.has(name)).sort();
};

/** A file that gives a name, the export it is, and where the file stands among the others that give it. */
interface ImplicitGiver {
  readonly file: string;
  readonly export: string;
  readonly rank: number;
}

/** One group, with each name to every file that gives it, best ranked first. */
interface ImplicitTable {
  readonly group: ImplicitImports;
  readonly convention: ProjectConventions;
  readonly names: ReadonlyMap<string, readonly ImplicitGiver[]>;
}

const tableOf = (convention: ProjectConventions, group: ImplicitImports): ImplicitTable => {
  const names = new Map<string, ImplicitGiver[]>();
  for (const source of group.sources) {
    for (const each of source.names) {
      const known = names.get(each.name) ?? [];
      if (!known.some((other) => other.file === source.file)) known.push({ file: source.file, export: each.export, rank: source.rank ?? 0 });
      names.set(each.name, known);
    }
  }
  // Stable, so files of one rank keep the order the reader gave them.
  for (const givers of names.values()) givers.sort((a, b) => a.rank - b.rank);
  return { group, convention, names };
};

/**
 * Which file a name is imported from (P243): the one of the best rank, when
 * one file holds it, with the files it is preferred to; none when two of the
 * best rank give it.
 */
const chosenGiver = (
  givers: readonly ImplicitGiver[],
): { readonly chosen?: ImplicitGiver; readonly over: readonly ImplicitGiver[]; readonly ambiguous: boolean } => {
  const [best] = givers;
  if (best === undefined) return { over: [], ambiguous: false };
  const tied = givers.filter((giver) => giver.rank === best.rank);
  if (tied.length > 1) return { over: [], ambiguous: true };
  return { chosen: best, over: givers.slice(1), ambiguous: false };
};

const isUnder = (file: string, dir: string): boolean => dir === '' || dir === '.' || file === dir || file.startsWith(`${dir.replace(/\/+$/, '')}/`);

/** What one project was opened with, kept for the files made up later and for the rows. */
interface ConventionState {
  readonly rootDir: string;
  readonly tables: readonly ImplicitTable[];
  readonly aliases: readonly SuppliedAliases[];
  readonly conventions: readonly ProjectConventions[];
  /** File -> the names an import was added for. */
  readonly injected: Map<string, readonly string[]>;
  /** Name -> the first place that used it unimported, where more than one file gives it. */
  readonly ambiguous: Map<string, { readonly file: string; readonly line: number; readonly table: ImplicitTable }>;
  /** Name -> the file imported and those it was preferred to, where files of more than one rank give it (P243). */
  readonly overridden: Map<string, { readonly table: ImplicitTable; readonly chosen: ImplicitGiver; readonly over: readonly ImplicitGiver[] }>;
  /** Absolute directories outside the root whose files are the application's (P243). */
  readonly extent: readonly string[];
}

const STATE = new WeakMap<Project, ConventionState>();

/** The modules of names each project holds in memory, by the path they are held at. */
const MODULES = new WeakMap<Project, ReadonlySet<string>>();

/** Whether a file is a module of names made up in memory, and no file of the repository. */
export const isConventionModule = (project: Project, filePath: string): boolean =>
  MODULES.get(project)?.has(toPosixPath(filePath)) === true;

/**
 * The repo-relative path of an absolute one, or undefined outside the root and
 * every directory the framework builds into it (P243).
 */
const insideRoot = (rootDir: string, path: string, extent: readonly string[] = []): string | undefined => {
  const rel = toPosixPath(relative(rootDir, path));
  if (rel === '') return undefined;
  if (!rel.startsWith('..')) return rel;
  return extent.some((dir) => isWithinDir(path, dir)) ? rel : undefined;
};

const tableFor = (state: ConventionState, file: string): ImplicitTable | undefined =>
  state.tables.find(({ group }) => group.within.some((dir) => isUnder(file, dir)) && !(group.except ?? []).some((dir) => isUnder(file, dir)));

/** A module specifier for a repository file, absolute, without the ending the compiler adds back. */
const specifierOf = (rootDir: string, file: string): string => toPosixPath(join(rootDir, file)).replace(/\.(?:tsx?|[cm]ts)$/, '');

/** The 1-based line a name is first written on, or the first line when it is only in markup. */
const lineOfName = (text: string, name: string): number => {
  const at = new RegExp(`(?<![\\w$])${escapeName(name)}(?![\\w$])`).exec(text)?.index;
  return at === undefined ? 1 : text.slice(0, at).split('\n').length;
};

/** Whether a file of the repository is one the project reads, so an import of it resolves. */
const isOpened = (project: Project, rootDir: string, file: string): boolean => project.getSourceFile(join(rootDir, file)) !== undefined;

/**
 * The import lines a file needs for the names it uses unimported, written
 * after its last line so no position of its own moves, or `''` when it needs
 * none. `file` is repo-relative; `text` is what the checker is given of it.
 */
export const implicitImportsFor = (project: Project, file: string, text: string, alsoUsed: readonly string[] = []): string => {
  const state = STATE.get(project);
  if (state === undefined) return '';
  const table = tableFor(state, file);
  if (table === undefined) return '';
  const used = implicitNamesUsed(text, file, new Set(table.names.keys()), alsoUsed);
  const bySource = new Map<string, string[]>();
  const names: string[] = [];
  for (const name of used) {
    const { chosen: source, over, ambiguous } = chosenGiver(table.names.get(name) ?? []);
    if (ambiguous) {
      if (!state.ambiguous.has(name)) state.ambiguous.set(name, { file, line: lineOfName(text, name), table });
      continue;
    }
    if (source === undefined || source.file === file || !isOpened(project, state.rootDir, source.file)) continue;
    if (over.length > 0 && !state.overridden.has(name)) state.overridden.set(name, { table, chosen: source, over });
    const specifier = specifierOf(state.rootDir, source.file);
    bySource.set(specifier, [...(bySource.get(specifier) ?? []), source.export === name ? name : `${source.export} as ${name}`]);
    names.push(name);
  }
  if (names.length === 0) return '';
  state.injected.set(file, names);
  return `\n${[...bySource].map(([specifier, imported]) => `import { ${imported.join(', ')} } from ${JSON.stringify(specifier)};`).join('\n')}\n`;
};

/** Adds the implicit imports one opened file needs, after its last line. */
export const addImplicitImports = (project: Project, sourceFile: SourceFile): void => {
  const state = STATE.get(project);
  if (state === undefined) return;
  const file = insideRoot(state.rootDir, sourceFile.getFilePath(), state.extent);
  if (file === undefined) return;
  const added = implicitImportsFor(project, file, sourceFile.getFullText());
  if (added !== '') sourceFile.insertText(sourceFile.getEnd(), added);
};

/** The text of a module made of a group's names: one re-export per file. */
const moduleText = (rootDir: string, table: ImplicitTable): string => {
  const bySource = new Map<string, string[]>();
  for (const [name, sources] of [...table.names].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const { chosen: source } = chosenGiver(sources);
    if (source === undefined) continue;
    const specifier = specifierOf(rootDir, source.file);
    bySource.set(specifier, [...(bySource.get(specifier) ?? []), source.export === name ? name : `${source.export} as ${name}`]);
  }
  return [...bySource].map(([specifier, names]) => `export { ${names.join(', ')} } from ${JSON.stringify(specifier)};`).join('\n');
};

/**
 * Opens a project with the conventions its readers stated: records them for
 * the files made up later, makes up each module of names that is not there,
 * and adds to every opened file the imports the framework would have added.
 */
export const installConventions = (
  project: Project,
  rootDir: string,
  conventions: readonly ProjectConventions[],
  aliases: ConventionAliases,
  opened: readonly SourceFile[],
): void => {
  if (conventions.length === 0 && aliases.supplied.length === 0) return;
  const tables = conventions.flatMap((convention) => (convention.implicit ?? []).map((group) => tableOf(convention, group)));
  const extent = conventions.flatMap((convention) => convention.extent ?? []).map((dir) => toPosixPath(resolve(dir)));
  STATE.set(project, { rootDir, tables, aliases: aliases.supplied, conventions, injected: new Map(), ambiguous: new Map(), overridden: new Map(), extent });
  const modules = new Set<string>();
  for (const made of aliases.modules) {
    const group = made.convention.implicit?.[made.implicit];
    if (group === undefined || project.getSourceFile(made.path) !== undefined) continue;
    project.createSourceFile(made.path, moduleText(rootDir, tableOf(made.convention, group)), { overwrite: true });
    modules.add(made.path);
  }
  MODULES.set(project, modules);
  for (const sourceFile of opened) addImplicitImports(project, sourceFile);
};

/** The conventions a project was opened with. */
export const conventionsOf = (project: Project): readonly ProjectConventions[] => STATE.get(project)?.conventions ?? [];

/**
 * The directories outside the root a project's framework builds into it
 * (P243), absolute and POSIX: a file in one is the application's own, though
 * its repo-relative path climbs out.
 */
export const conventionExtentOf = (project: Project): readonly string[] => STATE.get(project)?.extent ?? [];

/**
 * The package that provides a module a framework names and no file is, when
 * a framework says one is: `$app/navigation` is no package of its own name.
 */
export const frameworkModuleOf = (project: Project, specifier: string): string | undefined => {
  for (const convention of conventionsOf(project)) {
    for (const module of convention.frameworkModules ?? []) {
      if (specifier === module.name || specifier.startsWith(`${module.name.replace(/\/+$/, '')}/`)) return module.package;
    }
  }
  return undefined;
};

/**
 * Repo-relative files the conventions were read from - each framework's
 * configuration and every file whose exports are used unimported. A change
 * to any of them can change how every other file reads.
 */
export const conventionFiles = (project: Project): string[] => {
  const state = STATE.get(project);
  if (state === undefined) return [];
  return [
    ...new Set([
      ...state.conventions.flatMap((convention) => convention.files ?? []),
      ...state.tables.flatMap((table) => table.group.sources.map((source) => source.file)),
    ]),
  ].sort();
};

// ---------------------------------------------------------------------------
// Rows

export const ALIASES_FROM_CONVENTION_REASON = 'aliases-from-convention';
export const ALIASES_FROM_CONFIG_REASON = 'aliases-from-config';
export const IMPLICIT_IMPORTS_REASON = 'implicit-imports-from-convention';
export const IMPLICIT_IMPORT_AMBIGUOUS_REASON = 'implicit-import-ambiguous';
export const IMPLICIT_IMPORT_OVERRIDDEN_REASON = 'implicit-import-overridden';

/** `~ -> app, ~~ -> .`: the keys that are not a wildcard of another, with their first target. */
const aliasList = (paths: Readonly<Record<string, readonly string[]>>): string =>
  Object.entries(paths)
    .filter(([key]) => !key.endsWith('/*') || paths[key.slice(0, -2)] === undefined)
    .map(([key, targets]) => `${key} -> ${targets[0] ?? '?'}`)
    .join(', ');

/** A list in a sentence: `a`, `a and b`, `a, b and c`. */
const inWords = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export interface ConventionContext {
  readonly project: Project;
  readonly builder: GraphBuilder;
}

/**
 * Says once per repository how the conventions were read (P240): the aliases
 * supplied, the names used unimported and joined to their files, each name
 * two files give and a file used unimported, and whatever the reader could
 * not read of the framework's configuration.
 */
export const reportConventions = (context: ConventionContext): void => {
  const state = STATE.get(context.project);
  if (state === undefined) return;
  const { builder } = context;
  // One row per reason, every source of it in the one sentence: a row below
  // `action` is folded to one per reason anyway, and a second source would
  // be counted and never named.
  const assumed = state.aliases.filter((aliases) => aliases.source === 'convention');
  const [first] = assumed;
  if (first !== undefined) {
    builder.addUnresolved({
      file: first.file,
      line: 1,
      reason: ALIASES_FROM_CONVENTION_REASON,
      level: 'info',
      symbol: first.missing?.tsconfig ?? first.by,
      message: assumed
        .map((aliases) => `${aliases.missing?.tsconfig ?? aliases.by} is not there (\`${aliases.missing?.command ?? ''}\` writes it), so ${aliasList(aliases.paths)} resolve as ${aliases.by} documents them`)
        .join('; '),
      hint: `Nothing to do. Run ${inWords(assumed.map((aliases) => `\`${aliases.missing?.command ?? ''}\``))} before building to read the aliases the framework writes, which win over these.`,
      ...(first.adapter === undefined ? {} : { adapter: first.adapter }),
      meta: {
        cause: ALIASES_FROM_CONVENTION_REASON,
        by: assumed.map((aliases) => aliases.by),
        aliases: Object.assign({}, ...assumed.map((aliases) => aliases.paths)),
      },
    });
  }
  const read = state.aliases.filter((aliases) => aliases.source === 'config');
  const [from] = read;
  if (from !== undefined) {
    builder.addUnresolved({
      file: from.file,
      line: 1,
      reason: ALIASES_FROM_CONFIG_REASON,
      level: 'info',
      symbol: from.by,
      message: `${read.map((aliases) => `${aliasList(aliases.paths)} resolve as ${aliases.by} says`).join('; ')}, and the tsconfig read names none of them`,
      hint: 'Nothing to do. Name the aliases in the tsconfig to have the compiler and this reading agree on them.',
      ...(from.adapter === undefined ? {} : { adapter: from.adapter }),
      meta: {
        cause: ALIASES_FROM_CONFIG_REASON,
        by: read.map((aliases) => aliases.by),
        aliases: Object.assign({}, ...read.map((aliases) => aliases.paths)),
      },
    });
  }
  for (const convention of state.conventions) {
    const tables = state.tables.filter((table) => table.convention === convention);
    const files = [...state.injected.keys()].filter((file) => tables.includes(tableFor(state, file) as ImplicitTable)).sort();
    if (files.length > 0) {
      const names = new Set(files.flatMap((file) => state.injected.get(file) ?? []));
      const groups = tables.filter((table) => files.some((file) => tableFor(state, file) === table));
      builder.addUnresolved({
        file: convention.file,
        line: 1,
        reason: IMPLICIT_IMPORTS_REASON,
        level: 'info',
        symbol: convention.by,
        message: `${names.size} name${names.size === 1 ? '' : 's'} used with no import in ${files.length} file${files.length === 1 ? '' : 's'} were read as ${convention.by} imports them: ${inWords(groups.map((table) => `${table.group.label}'s from ${inWords(table.group.from)}`))}`,
        hint: `Nothing to do. These are the imports ${convention.by} adds when it builds; a name it gives two ways is a row of its own.`,
        adapter: convention.adapter,
        meta: { cause: IMPLICIT_IMPORTS_REASON, names: [...names].sort(), files: files.length },
      });
    }
    // Names more than one file gives, one of them ranked first (P243): one
    // note, every name in it.
    const preferred = [...state.overridden]
      .filter(([, { table }]) => table.convention === convention)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const [firstPreferred] = preferred;
    if (firstPreferred !== undefined) {
      builder.addUnresolved({
        file: convention.file,
        line: 1,
        reason: IMPLICIT_IMPORT_OVERRIDDEN_REASON,
        level: 'info',
        symbol: firstPreferred[0],
        message: `${preferred
          .map(([name, { chosen, over }]) => `${name} is imported from ${chosen.file}, not ${inWords(over.map((giver) => giver.file))}`)
          .join('; ')}, by ${convention.precedence ?? `the order ${convention.by} gives them`}`,
        hint: `Nothing to do. This is the file ${convention.by} imports; rename the other to use both.`,
        adapter: convention.adapter,
        meta: {
          cause: IMPLICIT_IMPORT_OVERRIDDEN_REASON,
          names: preferred.map(([name]) => name),
          chosen: Object.fromEntries(preferred.map(([name, { chosen }]) => [name, chosen.file])),
        },
      });
    }
    for (const row of convention.rows ?? []) builder.addUnresolved(row);
  }
  for (const [name, { file, line, table }] of [...state.ambiguous].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const all = table.names.get(name) ?? [];
    // Only the files of the best rank: one below them is no part of the choice.
    const givers = all.filter((source) => source.rank === all[0]?.rank).map((source) => source.file);
    builder.addUnresolved({
      file,
      line,
      reason: IMPLICIT_IMPORT_AMBIGUOUS_REASON,
      symbol: name,
      message: `${name} is used with no import, and ${inWords(givers)} both export it, so a call to it is not joined to either`,
      hint: `Rename one of them, or import ${name} from the file meant.`,
      adapter: table.convention.adapter,
      meta: { cause: IMPLICIT_IMPORT_AMBIGUOUS_REASON, candidates: givers },
    });
  }
};
