/**
 * What is read in place of a package that is not installed (P78).
 *
 * Two stand-ins beside the built-in shapes of P70, strongest first: the source
 * of the package, when a repository the project reads is that package; and a
 * shape file the project keeps, when none is. Both are read the way an
 * installed copy would be, at the path an installed copy would have under the
 * service's `node_modules`, so every reader that tells "a package's" from "the
 * repository's own" by that path tells them apart here too: the package's files
 * are types and nothing else, and no node is minted for them in the service
 * that imports it (D2). Nothing is written on disk; the source is mounted in
 * memory over the directory it is really in.
 *
 * The order is fixed (D3): an installed package wins over its source, which
 * wins over a shape file, which wins over a built-in shape.
 */
import { join, relative, sep } from 'node:path';
import { Node, Project, type FileSystemHost, type RuntimeDirEntry, type SourceFile } from 'ts-morph';
import type { GraphBuilder } from './builder.js';
import { callIndexOf } from './call-shape.js';
import { causeMeta } from './cant-follow.js';
import {
  isDeclarationShape,
  readShapeFile,
  shapeFileOf,
  shapeFilesOf,
  type ShapeFileReading,
} from './declaration-shapes.js';
import { normalizeFilePath } from './ids.js';
import type { Unresolved } from './model/graph.js';
import { readResolvedPackageJson } from './adapters/manifest.js';
import { packageIndexOf, rangeIncludes, serviceDirOf, type PackageSource } from './package-index.js';
import { packageSourcesFor, shapesFor, type FlowatlasConfig, type ServiceConfig } from './config.js';
import { readFileSync } from 'node:fs';
import { startLineOf } from './line-numbers.js';

/** What a reading is asked to stand in for its missing packages, besides a reader's built-in shapes. */
export interface StandInRequest {
  /** Packages whose source is on disk, by name; the reading keeps those it neither installs nor holds itself. */
  readonly packages: readonly PackageSource[];
  /** Names more than one directory claims: neither is read, and an import of one says so. */
  readonly ambiguous: ReadonlyMap<string, readonly PackageSource[]>;
  /** Every shape file listed for the service, read or not. */
  readonly shapeFiles: readonly ShapeFileReading[];
  /** The files listed at the service's own entry, whose shapes it alone is expected to import. */
  readonly ownShapeFiles: readonly string[];
  /**
   * Whether this service speaks for the project's own list: the first
   * repository the configuration names. A project-wide file that cannot be
   * read is said once, by it, rather than once per service.
   */
  readonly speaksForProject: boolean;
}

export interface StandInsForOptions {
  readonly config: FlowatlasConfig | undefined;
  readonly service: ServiceConfig | undefined;
  /** The configuration's directory, which every listed path is relative to. */
  readonly configDir: string | undefined;
}

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * What one service's reading stands in for its missing packages, from the
 * configuration (P78). Nothing without a configuration's directory to resolve
 * against: a repository read on its own has no project around it.
 */
export const standInsFor = (options: StandInsForOptions): StandInRequest | undefined => {
  const { config, service, configDir } = options;
  if (configDir === undefined) return undefined;
  const setting = packageSourcesFor(config, service);
  const index =
    setting === false
      ? undefined
      : packageIndexOf({
          services: (config?.services ?? [])
            .filter((each) => each.document === undefined)
            .map((each) => ({ name: each.name, dir: serviceDirOf(configDir, each.repo) })),
          ...(setting === true ? { folders: configDir } : {}),
        });
  const files = shapesFor(config, service, configDir);
  const own = shapesFor(undefined, service, configDir);
  const first = (config?.services ?? []).find((each) => each.document === undefined);
  return {
    packages: index === undefined ? [] : [...index.sources.values()],
    ambiguous: index?.ambiguous ?? new Map(),
    shapeFiles: files.map((path) => readShapeFile(path, readText(path))),
    ownShapeFiles: own,
    speaksForProject: service === undefined || first === undefined || first.name === service.name,
  };
};

/* ── The source, mounted where an installed copy would be ── */

/** One package's source, held at the path an install would have put it. */
export interface Mount {
  readonly source: PackageSource;
  /** `<root>/node_modules/<name>`, where nothing is on disk. */
  readonly virtual: string;
}

const within = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

let realHost: FileSystemHost | undefined;

/** The real file system, as the parser's own host reads it. */
const realFileSystem = (): FileSystemHost => {
  realHost ??= new Project({ skipLoadingLibFiles: true }).getFileSystem();
  return realHost;
};

/**
 * The real file system with each mount's source showing through at its
 * virtual path, read-only. A path under a mount is read from the directory the
 * source is really in and keeps its virtual name, so the checker never learns
 * the other one; the directories above a mount exist so a walk up from a file
 * finds it, as it would an install.
 */
export const mountedFileSystem = (mounts: readonly Mount[]): FileSystemHost => {
  const base = realFileSystem();
  const real = (path: string): string => {
    for (const mount of mounts) {
      if (within(path, mount.virtual)) return mount.source.dir + path.slice(mount.virtual.length);
    }
    return path;
  };
  const mounted = (path: string): boolean => mounts.some((mount) => within(path, mount.virtual));
  // Every directory above a mount, to the names of what is mounted below it.
  const above = new Map<string, Set<string>>();
  for (const mount of mounts) {
    const parts = mount.virtual.split('/');
    for (let at = parts.length - 1; at > 0; at -= 1) {
      const dir = parts.slice(0, at).join('/');
      if (!dir.includes('/node_modules')) break;
      const children = above.get(dir) ?? new Set<string>();
      children.add(parts.slice(0, at + 1).join('/'));
      above.set(dir, children);
    }
  }
  const refuse = (path: string): never => {
    throw new Error(`read-only: ${path} is a package source held in memory`);
  };
  const host: FileSystemHost = {
    isCaseSensitive: () => base.isCaseSensitive(),
    delete: async (path) => (mounted(path) ? refuse(path) : base.delete(path)),
    deleteSync: (path) => (mounted(path) ? refuse(path) : base.deleteSync(path)),
    readDirSync: (dirPath): RuntimeDirEntry[] => {
      const children = above.get(dirPath);
      if (children === undefined) {
        return base.readDirSync(real(dirPath)).map((entry) =>
          mounted(dirPath) ? { ...entry, name: dirPath + entry.name.slice(real(dirPath).length) } : entry,
        );
      }
      let entries: RuntimeDirEntry[] = [];
      try {
        entries = base.readDirSync(dirPath);
      } catch {
        entries = [];
      }
      const named = new Set(entries.map((entry) => entry.name));
      for (const child of children) {
        if (!named.has(child)) entries.push({ name: child, isFile: false, isDirectory: true, isSymlink: false });
      }
      return entries;
    },
    readFile: (filePath, encoding) => base.readFile(real(filePath), encoding),
    readFileSync: (filePath, encoding) => base.readFileSync(real(filePath), encoding),
    writeFile: async (filePath, text) => (mounted(filePath) ? refuse(filePath) : base.writeFile(filePath, text)),
    writeFileSync: (filePath, text) => (mounted(filePath) ? refuse(filePath) : base.writeFileSync(filePath, text)),
    mkdir: async (dirPath) => (mounted(dirPath) ? refuse(dirPath) : base.mkdir(dirPath)),
    mkdirSync: (dirPath) => (mounted(dirPath) ? refuse(dirPath) : base.mkdirSync(dirPath)),
    move: async (from, to) => (mounted(from) || mounted(to) ? refuse(from) : base.move(from, to)),
    moveSync: (from, to) => (mounted(from) || mounted(to) ? refuse(from) : base.moveSync(from, to)),
    copy: async (from, to) => (mounted(to) ? refuse(to) : base.copy(real(from), to)),
    copySync: (from, to) => (mounted(to) ? refuse(to) : base.copySync(real(from), to)),
    fileExists: (filePath) => base.fileExists(real(filePath)),
    fileExistsSync: (filePath) => base.fileExistsSync(real(filePath)),
    directoryExists: async (dirPath) => above.has(dirPath) || base.directoryExists(real(dirPath)),
    directoryExistsSync: (dirPath) => above.has(dirPath) || base.directoryExistsSync(real(dirPath)),
    // The virtual name is the name: the checker resolves a symlinked install
    // to where it really is, and here that would be the source's own path.
    realpathSync: (path) => (mounted(path) || above.has(path) ? path : base.realpathSync(path)),
    getCurrentDirectory: () => base.getCurrentDirectory(),
    glob: (patterns) => base.glob(patterns),
    globSync: (patterns) => base.globSync(patterns),
  };
  return host;
};

/* ── What a project stood in, asked after the program is built ── */

interface StandInState {
  readonly rootDir: string;
  readonly mounts: readonly Mount[];
  /** Ambiguous names this service has not installed. */
  readonly ambiguous: ReadonlyMap<string, readonly PackageSource[]>;
  readonly shapeFiles: readonly ShapeFileReading[];
  readonly ownShapeFiles: readonly string[];
  readonly speaksForProject: boolean;
  /** Packages a shape file declares that the service has installed, so the shape is not read. */
  readonly installed: ReadonlySet<string>;
}

const STATE = new WeakMap<Project, StandInState>();

/** Recorded by `createProject` once it has decided what stands in for what. */
export const recordStandIns = (project: Project, state: StandInState): void => {
  STATE.set(project, state);
};

/** The mounts a project was opened with. */
export const mountsOf = (project: Project): readonly Mount[] => STATE.get(project)?.mounts ?? [];

/** The mount a file is held under, when it is one of a package source's. */
const mountOf = (project: Project, filePath: string): Mount | undefined =>
  mountsOf(project).find((mount) => within(filePath, mount.virtual));

/** How a declaration in a file came to be readable, when a stand-in of P78 is why. */
export interface StandInOfFile {
  readonly via: 'package-from-repo' | 'shape-file';
  readonly package: string;
}

/** Whether a file of the program is a package source's or a shape file's, and whose. */
export const standInOfFile = (project: Project, filePath: string): StandInOfFile | undefined => {
  const mount = mountOf(project, filePath);
  if (mount !== undefined) return { via: 'package-from-repo', package: mount.source.name };
  const shape = shapeFileOf(project, filePath);
  return shape === undefined ? undefined : { via: 'shape-file', package: shape.package };
};

/** The mounted files the program read, by their virtual path. */
const mountedFilesRead = (project: Project): Map<Mount, string[]> => {
  const out = new Map<Mount, string[]>();
  const mounts = mountsOf(project);
  if (mounts.length === 0) return out;
  for (const file of project.getProgram().compilerObject.getSourceFiles()) {
    const mount = mounts.find((each) => within(file.fileName, each.virtual));
    if (mount === undefined) continue;
    out.set(mount, [...(out.get(mount) ?? []), file.fileName]);
  }
  return out;
};

/**
 * The files on disk a reading's stand-ins depend on, relative to the root and
 * sorted: every file of a package source the program read, at its real path,
 * the manifest that said where to enter it, and every listed shape file. What
 * the build cache records beside the files out of installed packages, so that
 * editing any of them reads the importer again (R92's rule).
 */
export const standInFiles = (project: Project, rootDir: string): string[] => {
  const state = STATE.get(project);
  if (state === undefined) return [];
  const out = new Set<string>();
  for (const [mount, files] of mountedFilesRead(project)) {
    out.add(normalizeFilePath(join(mount.source.dir, 'package.json'), rootDir));
    for (const file of files) {
      out.add(normalizeFilePath(mount.source.dir + file.slice(mount.virtual.length), rootDir));
    }
  }
  for (const reading of state.shapeFiles) out.add(normalizeFilePath(reading.path, rootDir));
  return [...out].sort();
};

/* ── The rows that say so ── */

/** A bare specifier's package: `@scope/name` or `name`. */
const packageOfSpecifier = (specifier: string): string | undefined => {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return undefined;
  const parts = specifier.split('/');
  const width = specifier.startsWith('@') ? 2 : 1;
  if (parts.length < width) return undefined;
  return parts.slice(0, width).join('/');
};

interface ImportSite {
  readonly file: string;
  readonly line: number;
  readonly count: number;
  readonly resolved: boolean;
}

/** Where each package is first imported in the repository's own files, and how often. */
const importSites = (project: Project, repoDir: string): Map<string, ImportSite> => {
  const out = new Map<string, ImportSite>();
  const files = project
    .getSourceFiles()
    .filter((file) => !file.getFilePath().includes('/node_modules/') && !isDeclarationShape(project, file.getFilePath()))
    .sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : a.getFilePath() > b.getFilePath() ? 1 : 0));
  for (const file of files) {
    for (const declaration of [...file.getImportDeclarations(), ...file.getExportDeclarations()]) {
      const specifier = declaration.getModuleSpecifierValue();
      const name = specifier === undefined ? undefined : packageOfSpecifier(specifier);
      if (name === undefined) continue;
      const seen = out.get(name);
      if (seen !== undefined) {
        out.set(name, { ...seen, count: seen.count + 1 });
        continue;
      }
      out.set(name, {
        file: normalizeFilePath(file.getFilePath(), repoDir),
        line: startLineOf(declaration),
        count: 1,
        resolved: declaration.getModuleSpecifierSourceFile() !== undefined,
      });
    }
  }
  return out;
};

export interface StandInContext {
  readonly project: Project;
  readonly repoDir: string;
  readonly builder: GraphBuilder;
}

/** A directory as the row names it: relative to the repository, POSIX. */
const relativeDir = (dir: string, repoDir: string): string => {
  const rel = relative(repoDir, dir).split(sep).join('/');
  return rel === '' ? '.' : rel;
};

/** Where a source was found, in words. */
const whose = (source: PackageSource): string =>
  source.service !== undefined
    ? source.origin === 'service'
      ? `the repository of ${source.service}`
      : `a workspace member of ${source.service}`
    : 'a directory beside the configuration';

/**
 * Records what stood in for this repository's missing packages, and what could
 * not (P78): one `package-from-repo` row per package whose source answered,
 * `package-version-differs` beside it where the manifest asked for another
 * version, `package-source-ambiguous` for an import two sources claim,
 * `shape-file-unread` for a listed file that gave nothing, and
 * `shape-file-unmatched` for a shape nothing here reads.
 *
 * The two that say what was read rather than what was missed sit at
 * `nothing`, so no count of what the reader could not follow includes them;
 * the version that differs is `info`, since the types read may be wrong.
 */
export const reportStandIns = (context: StandInContext): readonly Unresolved[] => {
  const { project, repoDir, builder } = context;
  const state = STATE.get(project);
  if (state === undefined) return [];
  const rows: Unresolved[] = [];
  const add = (row: Unresolved): void => {
    rows.push(builder.addUnresolved(row));
  };
  const sites = importSites(project, repoDir);
  const manifest = readResolvedPackageJson(repoDir) ?? {};
  const rangeOf = (name: string): string | undefined =>
    [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies, manifest.optionalDependencies]
      .map((section) => section?.[name])
      .find((range): range is string => typeof range === 'string');

  const read = mountedFilesRead(project);
  for (const mount of [...read.keys()].sort((a, b) => (a.source.name < b.source.name ? -1 : 1))) {
    const { source } = mount;
    const site = sites.get(source.name);
    const at = site ?? { file: normalizeFilePath(mount.virtual, repoDir), line: 1 };
    const from = relativeDir(source.dir, repoDir);
    add({
      file: at.file,
      line: at.line,
      reason: 'package-from-repo',
      // Nothing was missed: the package was read, from its source, and a row
      // at `info` would count it among the places the reader could not follow.
      level: 'nothing',
      symbol: source.name,
      message: `${source.name} is not installed here; its types are read from its source in ${from}, ${whose(source)}`,
      hint: 'Nothing to do. The source may not be the version this service runs: an installed copy is read instead once the dependencies are installed, and packageSources: false reads nothing in its place.',
      meta: { ...causeMeta({ cause: 'package-from-repo', package: source.name }).meta, from },
    });
    const range = rangeOf(source.name);
    if (range !== undefined && source.version !== undefined && rangeIncludes(range, source.version) === false) {
      add({
        file: at.file,
        line: at.line,
        reason: 'package-version-differs',
        level: 'info',
        symbol: source.name,
        message: `this service asks for ${source.name}@${range}, and the source read in its place, in ${from}, is ${source.version}`,
        hint: 'The types read may not be the ones this service runs. Install the dependencies to read the version it asks for.',
        meta: { ...causeMeta({ cause: 'package-version-differs', package: source.name }).meta, range, version: source.version },
      });
    }
  }

  for (const [name, candidates] of [...state.ambiguous].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const site = sites.get(name);
    if (site === undefined || site.resolved) continue;
    const where = candidates.map((candidate) => relativeDir(candidate.dir, repoDir));
    add({
      file: site.file,
      line: site.line,
      reason: 'package-source-ambiguous',
      symbol: name,
      message: `${name} is not installed, and ${where.length} directories of the project are named ${name} (${where.join(', ')}), so neither is read in its place`,
      hint: 'Rename one of them in its package.json, leave one out of the configuration, or install the dependencies.',
      meta: { ...causeMeta({ cause: 'package-source-ambiguous', package: name }).meta, candidates: where },
    });
  }

  const used = shapeFilesOf(project);
  for (const reading of state.shapeFiles) {
    const file = normalizeFilePath(reading.path, repoDir);
    const own = state.ownShapeFiles.includes(reading.path);
    if (reading.problem !== undefined) {
      if (!own && !state.speaksForProject) continue;
      add({
        file,
        line: 1,
        reason: 'shape-file-unread',
        symbol: file,
        message: `the shape file ${file} is listed under shapes and was not read: ${reading.problem}`,
        hint: "Fix the path or the glob under shapes in flowatlas.config.json, or the file: it holds `declare module '<package>' { ... }` blocks.",
      });
      continue;
    }
    for (const shape of reading.shapes) {
      if (used.get(shape.package) === reading.path) continue;
      const site = sites.get(shape.package);
      const mounted = state.mounts.some((mount) => mount.source.name === shape.package && read.has(mount));
      const installed = state.installed.has(shape.package);
      // A project-wide shape this service never imports is somebody else's;
      // only one listed for this service is expected to be read here.
      if (site === undefined && !own) continue;
      const why =
        site === undefined
          ? 'nothing in this service imports it'
          : mounted
            ? 'its source is read instead'
            : installed
              ? 'it is installed, and the installed copy is read instead'
              : 'another shape file declares it first';
      add({
        file,
        line: 1,
        reason: 'shape-file-unmatched',
        // Nothing was missed either: the package is read, from somewhere stronger.
        level: 'nothing',
        symbol: shape.package,
        message: `the shape of ${shape.package} in ${file} is not read: ${why}`,
        hint: 'Nothing to do while the package is installed or its source is read; remove the block once it is no longer needed.',
        meta: { ...causeMeta({ cause: 'shape-file-unmatched', package: shape.package }).meta },
      });
    }
  }
  return rows;
};

/* ── Edges whose receiver's type a stand-in supplied ── */

/** The declarations the callee of a call and its receiver come from. */
const declarationFiles = (call: Node): string[] => {
  const callee = Node.isCallExpression(call) || Node.isNewExpression(call) ? call.getExpression() : call;
  const nodes: Node[] = Node.isPropertyAccessExpression(callee) ? [callee.getNameNode(), callee.getExpression()] : [callee];
  const files: string[] = [];
  for (const node of nodes) {
    try {
      const symbol = node.getSymbol();
      const target = symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol;
      for (const declaration of target?.getDeclarations() ?? []) files.push(declaration.getSourceFile().getFilePath());
      for (const declaration of node.getType().getSymbol()?.getDeclarations() ?? []) {
        files.push(declaration.getSourceFile().getFilePath());
      }
    } catch {
      // A node the checker cannot answer for says nothing about where it came from.
    }
  }
  return files;
};

/** The nodes a call reaches by what its receiver's type says, rather than by a declaration of the repository's. */
const REACHED_THROUGH_TYPES: ReadonlySet<string> = new Set([
  'db_query',
  'table',
  'cache_op',
  'channel',
  'producer',
  'consumer',
  'http_out',
  'external_api',
  'config_key',
]);

/**
 * Marks every edge drawn at a call whose callee or receiver is declared by a
 * stand-in (I4): the source at the package's head, or a shape the project
 * wrote, may not be what the importer runs, so a `static` edge drawn through
 * one is `heuristic`, and says why in `because` and whose types in `typedBy`.
 */
export const markStandInEdges = (context: StandInContext): void => {
  const { project, repoDir, builder } = context;
  const state = STATE.get(project);
  if (state === undefined) return;
  if (mountsOf(project).length === 0 && shapeFilesOf(project).size === 0) return;
  // The calls on a line come from the index the call-shape pass reads too
  // (P79): the file is walked once, not once per pass or per edge. Calls come
  // before `new` expressions on a line, each kind in source order.
  const sources = new Map<string, SourceFile | undefined>();
  const callsAt = (file: string, line: number): Node[] => {
    if (!sources.has(file)) sources.set(file, project.getSourceFile(join(repoDir, file)));
    const source = sources.get(file);
    if (source === undefined) return [];
    const index = callIndexOf(source);
    return [...index.calls(line), ...index.news(line)];
  };
  for (const edge of builder.edges) {
    if (edge.file === undefined || edge.line === undefined) continue;
    // An edge into the repository's own code was drawn through its own
    // declarations; only one into what a call reaches outside it - a query, a
    // publish, a request - can owe its shape to a package's types.
    if (!REACHED_THROUGH_TYPES.has(builder.getNode(edge.to)?.type ?? '')) continue;
    let found: StandInOfFile | undefined;
    for (const call of callsAt(edge.file, edge.line)) {
      for (const path of declarationFiles(call)) {
        found = standInOfFile(project, path);
        if (found !== undefined) break;
      }
      if (found !== undefined) break;
    }
    if (found === undefined) continue;
    if (edge.confidence === 'static') edge.confidence = 'heuristic';
    const said = Array.isArray(edge.meta?.['because']) ? (edge.meta?.['because'] as string[]) : [];
    edge.meta = {
      ...edge.meta,
      because: said.includes(found.via) ? said : [...said, found.via],
      typedBy: found.package,
    };
  }
};

/**
 * Takes back the rows a reading wrote about a package source's own files (P78).
 *
 * The types a service reads from a package source reach into the package's own
 * declarations, and what the checker cannot resolve there - a type of a
 * dependency the package has and the service has not installed - would be
 * written as a row at a path under `node_modules`, once for every service that
 * imports the package. A configured repository that is the package says those
 * once, at its own paths, when it is read itself (D2); a directory nobody
 * configured is read by nobody else, so its rows are kept.
 */
export const withdrawPackageSourceRows = (context: StandInContext): void => {
  const { project, repoDir, builder } = context;
  const prefixes = mountsOf(project)
    .filter((mount) => mount.source.service !== undefined)
    .map((mount) => `${normalizeFilePath(mount.virtual, repoDir)}/`);
  if (prefixes.length === 0) return;
  builder.withdrawUnresolved((row) => prefixes.some((prefix) => row.file.startsWith(prefix)));
};

/** Everything a reading does once its passes are done about what stood in (P78). */
export const closeStandIns = (context: StandInContext): void => {
  withdrawPackageSourceRows(context);
  markStandInEdges(context);
};

/* ── What the configuration would cover, asked without reading anything ── */

/** A package something on disk would stand in for, and what. */
export interface PackageCover {
  readonly by: 'repo' | 'shape';
  /** The source's directory, or the shape file, relative to the configuration. */
  readonly from: string;
}

/**
 * Which packages the configuration as it stands would read in place of an
 * install (P78): those a repository's source is, and those a listed shape file
 * declares, the source first (D3). What `shapes --suggest` and the MCP server
 * mark a missing package with, so a reader knows a rebuild is all it needs.
 */
export const packageCoverage = (
  config: FlowatlasConfig,
  configDir: string,
): ReadonlyMap<string, PackageCover> => {
  const out = new Map<string, PackageCover>();
  const rel = (path: string): string => {
    const at = relative(configDir, path).split(sep).join('/');
    return at === '' ? '.' : at;
  };
  const setting = packageSourcesFor(config, undefined);
  if (setting !== false) {
    const index = packageIndexOf({
      services: config.services
        .filter((each) => each.document === undefined)
        .map((each) => ({ name: each.name, dir: serviceDirOf(configDir, each.repo) })),
      ...(setting === true ? { folders: configDir } : {}),
    });
    for (const [name, source] of index.sources) out.set(name, { by: 'repo', from: rel(source.dir) });
  }
  const files = new Set<string>([
    ...shapesFor(config, undefined, configDir),
    ...config.services.flatMap((service) => shapesFor(undefined, service, configDir)),
  ]);
  for (const path of [...files].sort()) {
    for (const shape of readShapeFile(path, readText(path)).shapes) {
      if (!out.has(shape.package)) out.set(shape.package, { by: 'shape', from: rel(path) });
    }
  }
  return out;
};
