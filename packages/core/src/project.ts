import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  Project,
  ts,
  type DiagnosticWithLocation,
  type DiagnosticMessageChain,
  type Program,
  type ResolutionHostFactory,
  type SourceFile,
} from 'ts-morph';
import type { GraphBuilder } from './builder.js';
import { normalizeFilePath } from './ids.js';
import type { Unresolved } from './model/graph.js';
import { readPackageJson } from './package-json.js';
import { isTestDirectory, isTestFile } from './test-files.js';
import {
  serviceSourceDirs,
  workspaceGlobs,
  workspacePackages,
  workspaceRootsAbove,
} from './workspace.js';

export interface CreateProjectOptions {
  /** Absolute path to the repository root. */
  rootDir: string;
  /** Path to a tsconfig, absolute or relative to the root. */
  tsconfig?: string;
  /** Extra globs to add, relative to the root. */
  include?: string[];
}

/** Directories that never hold sources worth reading. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);

/**
 * The extensions a TypeScript repository keeps its code in.
 *
 * Both of them, and not because every reader wants both. A reader that wants
 * fewer says so through `include`, which is what makes the set of files a
 * property of the reader rather than of this module. What this constant fixes
 * is the default, and the default has to be every kind of source a repository
 * has, because the alternative was read for a long time as a statement about
 * the repository: globbing `.ts` alone meant a directory that is a browser and
 * a server at once could only ever be half read, and the half that was missing
 * was decided here rather than by anyone who could see the consequence.
 *
 * The suffix carries no meaning beyond "this file may hold markup". A route
 * handler that answers with an image is written in `.tsx` for that reason
 * alone, and it is a route handler.
 */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

/**
 * Files that are compiled but say nothing about the shape of the system: a
 * declaration file, and a test ({@link isTestFile}, the one definition the
 * coverage harness counts by too, R157).
 */
const DECLARATION_SUFFIX = '.d.ts';

const isSkippedFile = (name: string): boolean =>
  name.endsWith(DECLARATION_SUFFIX) || isTestFile(name);

/** Tried in order when the caller does not name one. */
export const TSCONFIG_CANDIDATES = [
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.app.json',
] as const;

/**
 * What the compiler is told when the repository tells it nothing.
 *
 * A repository with no tsconfig is not an exotic case: it is what `extract`
 * meets whenever it is pointed at a bare directory, and since
 * {@link SOURCE_EXTENSIONS} names both kinds of source, every reader meets it
 * with `.tsx` files in hand.
 *
 * `jsx` is here because without it the compiler answers `Cannot use JSX unless
 * the '--jsx' flag is provided` on every file of markup in such a repository.
 * Measured, that is a semantic complaint and not a parse failure — the file is
 * still parsed as markup, because the extension is what decides that, and the
 * two readers recognise a component from the syntax rather than from its type,
 * so the graph of the fixture beside this comment is the same either way. What
 * the setting fixes is the claim: a project configured to reject the only kind
 * of file half its globs match is describing a repository nobody has, and
 * anything that ever asks the checker about markup — a component's own return
 * type, a prop's shape — would be asking an error type. `Preserve` is the one
 * setting that asks for parsing and nothing else; the others each name a
 * runtime whose types would then have to resolve.
 *
 * `strict` is off because this reads other people's code and a shape that does
 * not typecheck is still a shape worth reading; `allowJs` is off because a
 * repository's compiled output is not its source.
 */
const FALLBACK_COMPILER_OPTIONS = {
  allowJs: false,
  strict: false,
  jsx: ts.JsxEmit.Preserve,
} as const;

/**
 * The source files of one directory, relative to it and in a settled order.
 *
 * The one enumeration, used both to open a directory and to answer "has anything
 * in it changed" — two questions that must have the same answer, and used to be
 * asked by a glob on one side and a walk on the other with a fixture standing
 * between them to check that the two lists had not drifted.
 */
const sourceFilesUnder = (dir: string): string[] => {
  const sourceRoot = existsSync(join(dir, 'src')) ? 'src' : '.';
  const out: string[] = [];

  const walk = (at: string): void => {
    let entries;
    try {
      entries = readdirSync(join(dir, at), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = at === '' ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
        if (isTestDirectory(entry.name)) continue;
        walk(path);
        continue;
      }
      if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      if (isSkippedFile(entry.name)) continue;
      out.push(path);
    }
  };

  walk(sourceRoot === '.' ? '' : sourceRoot);
  return out.sort();
};

export const findTsconfig = (rootDir: string, tsconfig?: string): string | undefined => {
  if (tsconfig !== undefined) {
    const path = tsconfig.startsWith('/') ? tsconfig : join(rootDir, tsconfig);
    return existsSync(path) ? path : undefined;
  }
  for (const candidate of TSCONFIG_CANDIDATES) {
    const path = join(rootDir, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
};

/**
 * The path aliases one package of a service's extent declares for its own files.
 *
 * `base` is the directory its patterns are written relative to, which is the
 * directory of the tsconfig that wrote them — or of the one it extends — unless
 * that tsconfig names a `baseUrl`.
 */
interface PackageAliases {
  /** Absolute path of the package, as the extent spells it. */
  readonly dir: string;
  readonly paths: ts.MapLike<string[]>;
  readonly base: string;
  readonly baseUrl: string | undefined;
}

/**
 * The `paths` a package's own tsconfig gives it, or nothing when it gives none.
 *
 * Only the aliases, not the rest of that configuration. A package's other
 * settings — which files it allows, how it resolves a bare name — would change
 * how every one of its imports lands, and nothing the service reads needs that;
 * its aliases are the one setting whose absence leaves an import resolving to
 * nothing at all. The directory listing is stubbed empty because the question is
 * about the options and not about which files the package compiles: asked of a
 * real tsconfig, the compiler would otherwise walk the whole package to answer
 * something nobody asked.
 */
const aliasesOf = (dir: string): PackageAliases | undefined => {
  const configPath = findTsconfig(dir);
  if (configPath === undefined) return undefined;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
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
  return { dir, paths, base, baseUrl };
};

/** Whether one `paths` key names a specifier: exactly, or around its one `*`. */
const aliasMatches = (pattern: string, specifier: string): boolean => {
  const star = pattern.indexOf('*');
  if (star === -1) return pattern === specifier;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return (
    specifier.length >= prefix.length + suffix.length &&
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix)
  );
};

/**
 * The resolution mode of one import, the way the compiler would have asked it.
 *
 * The hook below is handed names rather than the literals they were written as,
 * and in a module system with two kinds of import the kind is part of the
 * question. The literal is found again by its text among the file's imports,
 * which the compiler keeps on the file without declaring; where it is not there
 * the file's own format is the answer the compiler would give most imports.
 */
const modeOf = (
  file: ts.SourceFile | undefined,
  name: string,
  options: ts.CompilerOptions,
): ts.ResolutionMode => {
  if (file === undefined) return undefined;
  const imports = (file as { imports?: readonly ts.StringLiteralLike[] }).imports;
  const literal = imports?.find((usage) => usage.text === name);
  return literal === undefined
    ? file.impliedNodeFormat
    : ts.getModeForUsageLocation(file, literal, options);
};

/**
 * A package of the workspace a bare name can reach without an install (R152).
 *
 * `manifest` is kept because the way in is written there: its `exports` map, or
 * the older fields a package without one is entered through.
 */
interface NamedMember {
  /** Absolute path of the package. */
  readonly dir: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

/**
 * The workspace packages of a service's extent, by the name each is imported by.
 *
 * Which packages is not a second answer to "which files are the repository's".
 * It is the extent {@link serviceSourceDirs} gives, the same list that decides
 * which files are opened (R96, R115): a named package whose directory is one of
 * those directories, or inside one, and no other. A service read at the root of
 * a workspace has the whole workspace in its extent, so every member is here; a
 * member read as a service has itself and what it declares. A package of the
 * workspace the service does not declare stays unresolved by name, exactly as
 * its files stay unopened.
 *
 * Nearest workspace first, so a nested workspace answers for its own names; a
 * name two members share is the first one's.
 */
const namedMembersOf = (rootDir: string): ReadonlyMap<string, NamedMember> => {
  const extent = serviceSourceDirs(rootDir);
  const own = extent[0] as string;
  const roots = [...(workspaceGlobs(own).length > 0 ? [own] : []), ...workspaceRootsAbove(own)];
  const inExtent = (dir: string): boolean =>
    extent.some((at) => dir === at || dir.startsWith(`${at}/`));
  const found = new Map<string, NamedMember>();
  for (const root of roots) {
    for (const { name, dir } of workspacePackages(root)) {
      if (found.has(name) || !inExtent(dir)) continue;
      found.set(name, { dir, manifest: readPackageJson(dir) ?? {} });
    }
  }
  return found;
};

/** A bare specifier split into the package it names and the subpath inside it. */
const splitSpecifier = (specifier: string): { name: string; subpath: string } | undefined => {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes('\\')) {
    return undefined;
  }
  const parts = specifier.split('/');
  const width = specifier.startsWith('@') ? 2 : 1;
  if (parts.length < width || parts.slice(0, width).some((part) => part === '')) return undefined;
  const rest = parts.slice(width).join('/');
  return { name: parts.slice(0, width).join('/'), subpath: rest === '' ? '.' : `./${rest}` };
};

/**
 * Every path a target of an `exports` map names, in the order the map names them.
 *
 * Under every condition rather than the one set a runtime would pick: the
 * question is which of the package's own files the specifier means, and on a
 * clone with nothing built the condition a runtime takes usually names an output
 * that is not there while the one beside it names the source. The first path
 * that is a file wins, so the map's own order still decides between two that
 * both are.
 */
const exportTargets = (target: unknown, star: string | undefined): string[] => {
  if (typeof target === 'string') {
    return [star === undefined ? target : target.split('*').join(star)];
  }
  if (Array.isArray(target)) return target.flatMap((item) => exportTargets(item, star));
  if (typeof target === 'object' && target !== null) {
    return Object.values(target).flatMap((item) => exportTargets(item, star));
  }
  return [];
};

/**
 * What a package's manifest says one of its subpaths is, as paths relative to it.
 *
 * The `exports` map when there is one, and then it is the whole answer: a
 * subpath the map does not name is not importable. Its keys either all name
 * subpaths or none do, in which case the object is the conditions of `.`. A
 * pattern key has one `*`, and of the patterns that match, the one with the
 * longest literal start wins, which is how a runtime reads the map too. Without
 * a map, `.` is the package's declared entry and anything else is a path inside
 * it.
 */
const manifestTargets = (manifest: Readonly<Record<string, unknown>>, subpath: string): string[] => {
  const map = manifest['exports'];
  if (map === undefined || map === null) {
    if (subpath !== '.') return [subpath];
    const entries = ['types', 'typings', 'module', 'main']
      .map((field) => manifest[field])
      .filter((value): value is string => typeof value === 'string');
    return [...entries, './index'];
  }
  if (typeof map !== 'object' || Array.isArray(map)) {
    return subpath === '.' ? exportTargets(map, undefined) : [];
  }
  const entries = map as Record<string, unknown>;
  const keys = Object.keys(entries);
  if (!keys.every((key) => key.startsWith('.'))) {
    return subpath === '.' ? exportTargets(entries, undefined) : [];
  }
  if (Object.hasOwn(entries, subpath)) return exportTargets(entries[subpath], undefined);
  let best: { key: string; star: string } | undefined;
  for (const key of keys) {
    const at = key.indexOf('*');
    if (at === -1 || !aliasMatches(key, subpath)) continue;
    if (best !== undefined && best.key.indexOf('*') >= at) continue;
    best = { key, star: subpath.slice(at, subpath.length - (key.length - at - 1)) };
  }
  return best === undefined ? [] : exportTargets(entries[best.key], best.star);
};

/**
 * The files one written path may stand for, source first.
 *
 * A manifest names what a runtime loads, which is usually the compiled `.js`
 * of a source file sitting beside it under another extension; the compiler
 * makes the same substitution for a relative import, and this is that
 * substitution for a path a manifest wrote. A path with no extension is tried
 * as a file and then as a directory's index.
 */
const STAND_INS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\.(ts|tsx|mts|cts)$/, ['']],
  [/\.js$/, ['.ts', '.tsx', '.d.ts']],
  [/\.jsx$/, ['.tsx', '.d.ts']],
  [/\.mjs$/, ['.mts', '.d.mts']],
  [/\.cjs$/, ['.cts', '.d.cts']],
];

/** The compiler's name for a file's kind; declaration suffixes before the rest. */
const EXTENSIONS: ReadonlyArray<readonly [string, ts.Extension]> = [
  ['.d.ts', ts.Extension.Dts],
  ['.d.mts', ts.Extension.Dmts],
  ['.d.cts', ts.Extension.Dcts],
  ['.tsx', ts.Extension.Tsx],
  ['.mts', ts.Extension.Mts],
  ['.cts', ts.Extension.Cts],
  ['.ts', ts.Extension.Ts],
];

const extensionOf = (file: string): ts.Extension =>
  EXTENSIONS.find(([suffix]) => file.endsWith(suffix))?.[1] ?? ts.Extension.Ts;

const candidateFiles = (path: string): string[] => {
  const standIn = STAND_INS.find(([pattern]) => pattern.test(path));
  if (standIn !== undefined) {
    const [pattern, replacements] = standIn;
    return replacements.map((ext) => (ext === '' ? path : path.replace(pattern, ext)));
  }
  if (/\.[cm]?jsx?$|\.json$/.test(path)) return [];
  return [
    ...SOURCE_EXTENSIONS.map((ext) => `${path}${ext}`),
    `${path}.d.ts`,
    ...SOURCE_EXTENSIONS.map((ext) => join(path, `index${ext}`)),
    join(path, 'index.d.ts'),
  ];
};

/**
 * A workspace package's file, reached by the name the package is imported by,
 * when nothing is installed (R152).
 *
 * Inside a workspace, one package importing another by its name is resolved
 * through the link the package manager puts under `node_modules`. A clone with
 * nothing installed has no such link, and unless a tsconfig happens to alias
 * that exact name the import resolves to nothing and every call through it is
 * lost. The repository has already said everything the link would: the member
 * is named in its manifest, and the manifest's `exports` map says which of its
 * files each subpath is.
 *
 * Three things keep this from reaching further than that.
 *
 * - It is asked last. Whatever the service's configuration resolves (an
 *   installed package, a `paths` alias, a package's own alias) wins, so a clone
 *   with dependencies installed reads what it read before.
 * - Only a package of the service's extent can be named ({@link namedMembersOf}),
 *   so the answer to which files are the repository's stays one answer.
 * - The file must be inside the package whose manifest named it and under no
 *   `node_modules`. A target written as `../elsewhere` is refused, not followed.
 *
 * One answer per specifier, remembered: it depends on the manifest and the file
 * system and on nothing about the file that asked.
 */
const workspaceMemberResolution = (
  members: ReadonlyMap<string, NamedMember>,
  fileExists: (path: string) => boolean,
): ((specifier: string) => ts.ResolvedModuleFull | undefined) => {
  const answers = new Map<string, ts.ResolvedModuleFull | undefined>();
  const answer = (specifier: string): ts.ResolvedModuleFull | undefined => {
    const split = splitSpecifier(specifier);
    const member = split === undefined ? undefined : members.get(split.name);
    if (split === undefined || member === undefined) return undefined;
    for (const target of manifestTargets(member.manifest, split.subpath)) {
      const path = resolve(member.dir, target);
      const inside = relative(member.dir, path);
      const segments = inside.split(sep);
      if (segments[0] === '..' || segments.includes('node_modules')) continue;
      const file = candidateFiles(path).find(fileExists);
      if (file === undefined) continue;
      return {
        resolvedFileName: file,
        extension: extensionOf(file),
        isExternalLibraryImport: false,
      };
    }
    return undefined;
  };
  return (specifier) => {
    if (!answers.has(specifier)) answers.set(specifier, answer(specifier));
    return answers.get(specifier);
  };
};

/**
 * Module resolution for a service whose extent holds packages with aliases of
 * their own (R141), or packages it imports by name (R152).
 *
 * A service is its own directory and the workspace packages it declares, and the
 * project is compiled with the service's tsconfig. A package that imports its own
 * code as `@repositories` — an alias only its own tsconfig defines — asked the
 * service's configuration where that is, and the service's configuration had
 * never heard of it: the import resolved to nothing and the class behind it was
 * never reached.
 *
 * So an import written in a package's file is asked of that package's aliases
 * first, and of the service's configuration otherwise. The first half is narrow
 * on purpose: only a specifier one of the package's own `paths` keys names is
 * asked differently, and when the package's aliases lead nowhere it falls back
 * to the answer it had before. Everything else — every relative import, every
 * installed package, every file of the service itself — is resolved exactly as
 * the service's configuration resolved it, through one cache per configuration
 * so that taking over the hook costs no more than the compiler's own did.
 *
 * Which packages have a say is not decided here. It is the extent
 * {@link serviceSourceDirs} answers, the same list that decides which files are
 * opened below: a package whose files a reader may open is a package whose
 * aliases are honoured, and no other (R115). A package of the workspace the
 * service does not declare has no files in the project and no aliases in it.
 *
 * What neither configuration resolves is then asked of the workspace itself, by
 * the name a package of the extent is imported by
 * ({@link workspaceMemberResolution}). Last, so it only ever answers what would
 * otherwise have been nothing.
 */
const workspaceResolution = (
  packages: readonly PackageAliases[],
  members: ReadonlyMap<string, NamedMember>,
): ResolutionHostFactory => (host) => {
  const canonical = ts.sys.useCaseSensitiveFileNames
    ? (path: string) => path
    : (path: string) => path.toLowerCase();
  const cwd = host.getCurrentDirectory?.() ?? process.cwd();
  // One cache of package manifests for every configuration, because they are
  // the same files on disk whoever is asking about them.
  const packageJsonCache = ts.createModuleResolutionCache(cwd, canonical).getPackageJsonInfoCache();
  const configured = new Map<PackageAliases | undefined, { options: ts.CompilerOptions; cache: ts.ModuleResolutionCache }>();
  const configurationFor = (owner: PackageAliases | undefined, service: ts.CompilerOptions) => {
    let found = configured.get(owner);
    if (found === undefined) {
      // The service's `baseUrl` goes with its `paths`: both are the service's
      // spelling of where a bare name lives, and neither is the package's.
      const { baseUrl: _serviceBase, ...rest } = service;
      const options: ts.CompilerOptions =
        owner === undefined
          ? service
          : {
              ...rest,
              paths: owner.paths,
              pathsBasePath: owner.base,
              ...(owner.baseUrl === undefined ? {} : { baseUrl: owner.baseUrl }),
            };
      found = { options, cache: ts.createModuleResolutionCache(cwd, canonical, options, packageJsonCache) };
      configured.set(owner, found);
    }
    return found;
  };
  // Longest first, so a package nested inside another answers for its own files.
  const byDepth = [...packages].sort((a, b) => b.dir.length - a.dir.length);
  const ownerOf = (file: string): PackageAliases | undefined =>
    byDepth.find((pkg) => file.startsWith(`${pkg.dir}/`));
  const byName = workspaceMemberResolution(members, (path) => host.fileExists(path));

  return {
    resolveModuleNames: (names, containingFile, _reused, redirected, options, containingSourceFile) => {
      const owner = ownerOf(containingFile);
      const resolve = (name: string, config: ReturnType<typeof configurationFor>) =>
        ts.resolveModuleName(
          name,
          containingFile,
          config.options,
          host,
          config.cache,
          redirected,
          modeOf(containingSourceFile, name, config.options),
        ).resolvedModule;
      const service = configurationFor(undefined, options);
      const own = owner === undefined ? undefined : configurationFor(owner, options);
      return names.map((name) => {
        const claimed =
          own !== undefined &&
          owner !== undefined &&
          Object.keys(owner.paths).some((pattern) => aliasMatches(pattern, name));
        return (
          (claimed ? resolve(name, own) : undefined) ?? resolve(name, service) ?? byName(name)
        );
      });
    },
  };
};

/**
 * Loads a repository for analysis.
 *
 * Files are added by glob rather than from the tsconfig, because a repository
 * usually compiles its tests and build output too and reading those doubles the
 * work for nothing. The tsconfig is still honoured for compiler options and
 * path mappings, which is what type resolution depends on — and a declared
 * package's own path mappings are honoured for that package's own files, and a
 * package of the extent imported by its name is found without an install, which
 * is what {@link workspaceResolution} is about.
 */
export const createProject = (options: CreateProjectOptions): Project => {
  const { rootDir, tsconfig, include } = options;
  const tsConfigFilePath = findTsconfig(rootDir, tsconfig);
  const packages = serviceSourceDirs(rootDir).slice(1);
  const aliases = packages.flatMap((dir) => aliasesOf(dir) ?? []);
  const members = namedMembersOf(rootDir);

  const project = new Project({
    ...(tsConfigFilePath === undefined ? {} : { tsConfigFilePath }),
    skipAddingFilesFromTsConfig: true,
    ...(tsConfigFilePath === undefined ? { compilerOptions: FALLBACK_COMPILER_OPTIONS } : {}),
    // Only inside a workspace. A service with no package of its own to alias and
    // none to import by name, which is every service outside a workspace, keeps
    // the compiler's own resolution untouched rather than an imitation of it.
    ...(aliases.length === 0 && members.size === 0
      ? {}
      : { resolutionHost: workspaceResolution(aliases, members) }),
  });

  const sourceRoot = existsSync(join(rootDir, 'src')) ? 'src' : '.';
  const globs = include ?? SOURCE_EXTENSIONS.map((ext) => `${sourceRoot}/**/*${ext}`);
  project.addSourceFilesAtPaths([
    ...globs.map((glob) => join(rootDir, glob)),
    ...[...SKIPPED_DIRECTORIES].map((dir) => `!${join(rootDir, `**/${dir}/**`)}`),
    `!${join(rootDir, `**/*${DECLARATION_SUFFIX}`)}`,
  ]);
  // A test is told by the shape of its name, which a glob cannot spell, so the
  // files the globs matched are asked the same question the walk below asks.
  // Relative to the root, because a test is a test of the tree being read and
  // the directories above the root are the machine's business.
  for (const file of project.getSourceFiles()) {
    if (isTestFile(relative(rootDir, file.getFilePath()))) project.removeSourceFile(file);
  }

  // Then every other directory this service's code is in. A workspace member
  // whose handlers live in a sibling package used to have those files opened
  // anyway — the checker resolved into them, so they were in the project — and
  // then excluded from every walk, which is how a repository came to have all of
  // its routes and none of their bodies. Opening them here as well as resolving
  // them is what lets a clone with nothing installed read the same code as one
  // with everything installed.
  //
  // Listed rather than globbed, and that is not a style choice. A glob makes the
  // parser walk the directory tree under it, and the tree it walks is the one it
  // already holds — which includes any directory the tsconfig named. cal.com's
  // `apps/web` compiles a declaration file from a package that was deleted, so
  // `packages/app-store` holds a child that exists only in the tsconfig, and a
  // glob over that package walked into it and stopped the whole reading with
  // "Directory not found". The list comes from the file system and holds only
  // files that are there.
  for (const dir of packages) {
    for (const file of sourceFilesUnder(dir)) project.addSourceFileAtPath(join(dir, file));
  }
  return project;
};

/**
 * The reason written on a file the parser could not read.
 *
 * Exported because the advice catalogue in the command keys on it, and a reason
 * spelled in two places is a reason that will one day be spelled two ways.
 */
export const UNREADABLE_FILE_REASON = 'file-not-parsed';

/**
 * The shape {@link reportUnreadableSources} needs from whoever is reading.
 *
 * Deliberately narrower than the extraction context every reader already holds,
 * which satisfies it: this function has no business with the configuration, the
 * manifest or the adapters, and a parameter that named the whole context would
 * let it grow one.
 */
export interface UnreadableSourceContext {
  readonly project: Project;
  readonly repoDir: string;
  readonly builder: GraphBuilder;
}

/** The first sentence of a diagnostic, which may arrive as a chain of them. */
const firstSentence = (text: string | DiagnosticMessageChain): string =>
  typeof text === 'string' ? text : (text.getMessageText() ?? '');

/**
 * The parser's first complaint about a file, when it has one.
 *
 * Written once because two things ask it — the rows below and the counts beside
 * them — and a file that is unreadable for the report but readable for the
 * count would be the arithmetic this whole shape exists to remove.
 */
const firstSyntaxError = (program: Program, file: SourceFile): DiagnosticWithLocation | undefined =>
  program.getSyntacticDiagnostics(file)[0];

/**
 * How many source files a reading opened, and how many of them it could read.
 *
 * Every reader answers these three the same way, because the question is about
 * the files and not about what any reader makes of them. It used to be one
 * number per reader, named `files`, and it counted everything opened; a file
 * the parser gave up on was in it, so the only figure that said anything about
 * that file said it had been read. The difference is written out rather than
 * left to be worked out, because a reader who does not know to subtract reads
 * the first number as the second.
 */
export interface SourceCounts {
  /** Source files the reader opened. */
  readonly files: number;
  /** Of those, the ones the parser read. */
  readonly filesRead: number;
  /** The rest, each of which has a row of its own naming it. */
  readonly filesUnreadable: number;
}

/**
 * What every reader records about the repository it read.
 *
 * The part of a reader's counts that is not about that reader. A reader adds
 * what only it counts by extending this, so a count that is everyone's is
 * declared once and cannot be spelled three ways.
 */
export interface RepoStats extends SourceCounts {
  /**
   * Calls whose receiver is declared in an installed package, counted per
   * package. They are not edges and not unresolved rows: they are what a
   * reading decided not to follow, and counting them keeps that decision
   * visible instead of silent.
   */
  skippedExternalCalls: Record<string, number>;
}

/**
 * Counts the sources of a parsed project, readable and not.
 *
 * Takes the project rather than the whole reading context, because that is all
 * the question needs: a half of a reading that shares a project with another
 * half gets the same answer without either half having to ask the other.
 */
export const countSources = (project: Project): SourceCounts => {
  const program = project.getProgram();
  const files = project.getSourceFiles();
  const unreadable = files.filter((file) => firstSyntaxError(program, file) !== undefined);
  return {
    files: files.length,
    filesRead: files.length - unreadable.length,
    filesUnreadable: unreadable.length,
  };
};

/**
 * Records every file the parser could not read, as a row naming it.
 *
 * This is one function rather than one per reader on purpose. Every reader
 * opens its repository through {@link createProject} and every reader has a
 * builder to write into, so the question "could this file be parsed at all" is
 * the same question in all three and its answer should be worded once. Asked
 * three times it would drift: three reasons, three levels, three sentences, and
 * a report that groups by reason would show the same hole under three headings.
 *
 * The question asked is syntactic and nothing more. `getPreEmitDiagnostics`
 * over a project answers a much larger one — every unresolved import in every
 * repository whose dependencies are not installed — and that answer is noise
 * here, because a file whose types do not resolve is still read and still
 * produces nodes and edges. A file with a syntax error produces nothing at all.
 *
 * The row is left at the default level, which is `action`. A file that did not
 * parse is not the tool describing its own limits; it is a hole in the graph
 * with a cause somebody can go and fix. The other place the evidence survives
 * is {@link SourceCounts}, which since R75 says how many files were opened and
 * how many were read rather than leaving the two to be told apart by hand.
 *
 * One row per file, not one per diagnostic. A single missing brace produces a
 * cascade of complaints that are all the same event, and the first of them is
 * the one that points at where the reading came apart.
 */
export const reportUnreadableSources = (
  context: UnreadableSourceContext,
): readonly Unresolved[] => {
  const { project, repoDir, builder } = context;
  const program = project.getProgram();
  const rows: Unresolved[] = [];
  for (const file of project.getSourceFiles()) {
    const first = firstSyntaxError(program, file);
    if (first === undefined) continue;
    const row: Unresolved = {
      file: normalizeFilePath(file.getFilePath(), repoDir),
      line: first.getLineNumber(),
      reason: UNREADABLE_FILE_REASON,
      message: 'the parser could not read this file, so nothing in it is in the graph',
      // The compiler's own complaint goes in the advice rather than in the
      // message, because the report prints one sentence beside a place and that
      // sentence is this one. What the parser choked on is the only thing that
      // tells a reader where to start, and saying it twice in one row would
      // only make the row longer.
      hint: `${firstSentence(first.getMessageText())} Fix the syntax, or keep the file out of the globs the reader is given.`,
    };
    rows.push(builder.addUnresolved(row));
  }
  return rows;
};

/**
 * The files {@link createProject} would add, listed without parsing any of them.
 *
 * What a build needs to answer "did anything change here" before deciding to
 * read a repository at all. The two must agree, which `sources.test.ts` checks
 * against a fixture rather than trusting the two lists to stay in step. They now
 * agree by construction for every directory but the service's own, which is
 * still globbed there and walked here; the check earns its keep on that one.
 */
export const listRepoSources = (rootDir: string): string[] => {
  // One walk per directory the service's code is in, so that a change in a
  // workspace package the service reads is a change to the service. Without
  // that, editing a handler body in a sibling package would leave the graph of
  // the service that calls it on disk unchanged and out of date.
  const out = serviceSourceDirs(rootDir).flatMap((dir) => {
    const prefix = relative(rootDir, dir).split(sep).join('/');
    const files = sourceFilesUnder(dir);
    return prefix === '' ? files : files.map((file) => `${prefix}/${file}`);
  });
  return out.sort();
};
