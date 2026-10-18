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
import { createHash } from 'node:crypto';
import { join, posix, relative, sep } from 'node:path';
import { Node, Project, type FileSystemHost, type RuntimeDirEntry, type SourceFile, type ts } from 'ts-morph';
import { z } from 'zod';
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
import { isWithinDir, normalizeFilePath, pathKey, toPosixPath } from './ids.js';
import type { Unresolved } from './model/graph.js';
import { readResolvedPackageJson } from './adapters/manifest.js';
import {
  packageIndexOf,
  rangeIncludes,
  serviceDirOf,
  type PackageIndex,
  type PackageSource,
} from './package-index.js';
import {
  packageSourcesFor,
  patternFilesFor,
  shapesFor,
  type FlowatlasConfig,
  type PackageSourcesSetting,
  type ServiceConfig,
} from './config.js';
import { readFileSync } from 'node:fs';
import { startLineOf } from './line-numbers.js';
import { WORK_COUNTS } from './work-counts.js';

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
  /**
   * What the build worked out once for every service (P82), read instead of
   * indexing and parsing again. Ignored when it was made for another
   * configuration directory or does not name this service: the reading then
   * works it out itself, as a lone `flowatlas extract` always does.
   */
  readonly given?: StandInsOfBuild;
}

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** Which search of the package index a setting asks for; none when package sources are off. */
type IndexSearch = 'services' | 'folders';

const searchOf = (setting: PackageSourcesSetting): IndexSearch | undefined =>
  setting === false ? undefined : setting === true ? 'folders' : 'services';

/** The package index one search makes, for this configuration. */
const indexFor = (config: FlowatlasConfig | undefined, configDir: string, search: IndexSearch): PackageIndex =>
  packageIndexOf({
    services: (config?.services ?? [])
      .filter((each) => each.document === undefined)
      .map((each) => ({ name: each.name, dir: serviceDirOf(configDir, each.repo) })),
    ...(search === 'folders' ? { folders: configDir } : {}),
  });

/** Whether a service speaks for the project's own shape list: the first repository the configuration names. */
const speaksForProject = (config: FlowatlasConfig | undefined, service: ServiceConfig | undefined): boolean => {
  const first = (config?.services ?? []).find((each) => each.document === undefined);
  return service === undefined || first === undefined || first.name === service.name;
};

/**
 * What one service's reading stands in for its missing packages, from the
 * configuration (P78). Nothing without a configuration's directory to resolve
 * against: a repository read on its own has no project around it.
 *
 * With the build's own answer (`given`, P82) nothing is indexed or parsed: the
 * index and the shape readings are the build's, the service's lists are the
 * build's, and the request is the one working it out here would have made.
 */
export const standInsFor = (options: StandInsForOptions): StandInRequest | undefined => {
  const { config, service, configDir } = options;
  if (configDir === undefined) return undefined;
  const setting = packageSourcesFor(config, service);
  const search = searchOf(setting);
  const given = options.given === undefined ? undefined : requestFromBuild(options.given, configDir, service, search);
  if (given !== undefined) return { ...given, speaksForProject: speaksForProject(config, service) };
  const index = search === undefined ? undefined : indexFor(config, configDir, search);
  const files = shapesFor(config, service, configDir);
  const own = shapesFor(undefined, service, configDir);
  return {
    packages: index === undefined ? [] : [...index.sources.values()],
    ambiguous: index?.ambiguous ?? new Map(),
    shapeFiles: files.map((path) => readShapeFile(path, readText(path))),
    ownShapeFiles: own,
    speaksForProject: speaksForProject(config, service),
  };
};

/* ── Worked out once a build, handed to every reader (P82) ── */

/**
 * The version of {@link StandInsOfBuild}'s file. A reader handed a file of any
 * other version works everything out itself rather than trust a shape it may
 * be reading wrongly.
 */
export const STAND_INS_FORMAT_VERSION = 1;

/** Where a build keeps its stand-ins, in its output directory. */
export const STAND_INS_FILENAME = 'stand-ins.json';

/** A package index as JSON holds it: the order of both lists is the index's own. */
export interface PackageIndexRecord {
  readonly sources: readonly PackageSource[];
  readonly ambiguous: ReadonlyArray<readonly [string, readonly PackageSource[]]>;
}

/**
 * What a build works out once about stand-ins and hands to every reader
 * (P82): the package index for each search a service of the build asks, every
 * listed shape file read once, and which of those files each service lists.
 * Build-internal (I11): no other command reads it, and it is versioned on its
 * own (`standInsFormatVersion`).
 */
export interface StandInsOfBuild {
  readonly standInsFormatVersion: typeof STAND_INS_FORMAT_VERSION;
  /** The configuration's directory everything here was resolved against. */
  readonly configDir: string;
  /** One index per search asked: the configured repositories alone, or the folders under the configuration too. */
  readonly indexes: Readonly<Partial<Record<IndexSearch, PackageIndexRecord>>>;
  /** Every shape file some service lists, each read once, sorted by path. */
  readonly shapeFiles: readonly ShapeFileReading[];
  /** Per service, the shape files it reads (`files`) and those its own entry lists (`own`), as absolute paths. */
  readonly perService: Readonly<
    Record<string, { readonly files: readonly string[]; readonly own: readonly string[]; readonly patterns?: readonly string[] }>
  >;
}

const recordOf = (index: PackageIndex): PackageIndexRecord => ({
  sources: [...index.sources.values()],
  ambiguous: [...index.ambiguous],
});

/**
 * The stand-ins of every repository a build reads, worked out once (P82).
 *
 * An index is made only for a search some service asks (none when package
 * sources are off everywhere), and a shape file two services list is read once.
 */
export const standInsOfBuild = (config: FlowatlasConfig, configDir: string): StandInsOfBuild => {
  const read = config.services.filter((service) => service.document === undefined);
  const searches = new Set(read.flatMap((service) => searchOf(packageSourcesFor(config, service)) ?? []));
  const indexes: Partial<Record<IndexSearch, PackageIndexRecord>> = {};
  for (const search of (['services', 'folders'] as const).filter((each) => searches.has(each))) {
    indexes[search] = recordOf(indexFor(config, configDir, search));
  }
  const perService: Record<string, { files: string[]; own: string[]; patterns?: string[] }> = {};
  const paths = new Set<string>();
  for (const service of read) {
    const files = shapesFor(config, service, configDir);
    // The pattern files it lists, which its fingerprint hashes (P121).
    const patterns = patternFilesFor(config, service, configDir);
    perService[service.name] = { files, own: shapesFor(undefined, service, configDir), ...(patterns.length === 0 ? {} : { patterns }) };
    for (const path of files) paths.add(path);
  }
  return {
    standInsFormatVersion: STAND_INS_FORMAT_VERSION,
    configDir,
    indexes,
    shapeFiles: [...paths].sort().map((path) => readShapeFile(path, readText(path))),
    perService,
  };
};

const sourceSchema = z
  .object({
    name: z.string(),
    dir: z.string(),
    version: z.string().optional(),
    manifest: z.record(z.string(), z.unknown()),
    service: z.string().optional(),
    origin: z.enum(['service', 'member', 'folder']),
  })
  .strict();

const indexSchema = z
  .object({
    sources: z.array(sourceSchema),
    ambiguous: z.array(z.tuple([z.string(), z.array(sourceSchema)])),
  })
  .strict();

const shapeSchema = z
  .object({ package: z.string(), declarations: z.string(), origin: z.string().optional() })
  .strict();

const standInsSchema = z
  .object({
    standInsFormatVersion: z.literal(STAND_INS_FORMAT_VERSION),
    configDir: z.string(),
    indexes: z.object({ services: indexSchema.optional(), folders: indexSchema.optional() }).strict(),
    shapeFiles: z.array(
      z.object({ path: z.string(), shapes: z.array(shapeSchema), problem: z.string().optional() }).strict(),
    ),
    perService: z.record(
      z.string(),
      z.object({ files: z.array(z.string()), own: z.array(z.string()), patterns: z.array(z.string()).optional() }).strict(),
    ),
  })
  .strict();

/** The build's stand-ins read back, or why they cannot be. */
export type StandInsRead = { readonly given: StandInsOfBuild } | { readonly problem: string };

/**
 * The file a build wrote its stand-ins to, read back by a reader it started
 * (P82). Anything but a file of this version, whole, is a problem the reader
 * says once and works around by working everything out itself.
 */
export const readStandInsOfBuild = (path: string): StandInsRead => {
  const text = readText(path);
  if (text === undefined) return { problem: `${path} cannot be read` };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problem: `${path} is not JSON` };
  }
  const version = (json as { standInsFormatVersion?: unknown } | null)?.standInsFormatVersion;
  if (version !== STAND_INS_FORMAT_VERSION) {
    return { problem: `${path} is of stand-ins format ${String(version)}, and this reader reads ${STAND_INS_FORMAT_VERSION}` };
  }
  const parsed = standInsSchema.safeParse(json);
  if (!parsed.success) return { problem: `${path} is not a stand-ins file this reader can read` };
  return { given: parsed.data as StandInsOfBuild };
};

const INDEX_OF_RECORD = new WeakMap<PackageIndexRecord, PackageIndex>();

/** A recorded index as the maps the reading asks, made once per record. */
const indexOfRecord = (record: PackageIndexRecord): PackageIndex => {
  let index = INDEX_OF_RECORD.get(record);
  if (index === undefined) {
    index = {
      sources: new Map(record.sources.map((source) => [source.name, source])),
      ambiguous: new Map(record.ambiguous),
    };
    INDEX_OF_RECORD.set(record, index);
  }
  return index;
};

/**
 * One service's request out of the build's stand-ins, when they answer for it:
 * made against the same configuration directory, naming the service, holding
 * the index its setting asks and every shape file it lists. Undefined
 * otherwise, and the caller works it out.
 */
const requestFromBuild = (
  given: StandInsOfBuild,
  configDir: string,
  service: ServiceConfig | undefined,
  search: IndexSearch | undefined,
): Omit<StandInRequest, 'speaksForProject'> | undefined => {
  if (given.standInsFormatVersion !== STAND_INS_FORMAT_VERSION || given.configDir !== configDir) return undefined;
  if (service === undefined || !Object.hasOwn(given.perService, service.name)) return undefined;
  const listed = given.perService[service.name];
  const record = search === undefined ? undefined : given.indexes[search];
  if (listed === undefined || (search !== undefined && record === undefined)) return undefined;
  const readings = new Map(given.shapeFiles.map((reading) => [reading.path, reading]));
  const shapeFiles = listed.files.map((path) => readings.get(path));
  if (shapeFiles.some((reading) => reading === undefined)) return undefined;
  const index = record === undefined ? undefined : indexOfRecord(record);
  return {
    packages: index === undefined ? [] : [...index.sources.values()],
    ambiguous: index?.ambiguous ?? new Map(),
    shapeFiles: shapeFiles as ShapeFileReading[],
    ownShapeFiles: [...listed.own],
  };
};

/* ── The source, mounted where an installed copy would be ── */

/** One package's source, held at the path an install would have put it. */
export interface Mount {
  readonly source: PackageSource;
  /** `<root>/node_modules/<name>`, where nothing is on disk. */
  readonly virtual: string;
}

/**
 * Every mount of a reading, by the path it is held at (P82).
 *
 * A mount's virtual root is `<root>/node_modules/<name>` by construction, so
 * which mount a path is under is a function of the path: the `node_modules/`
 * segment it sits under and the one name after it (two segments for a scoped
 * name). The file system the compiler reads through asks this of every path it
 * touches, which is why it is a lookup and not a scan of the mounts.
 */
export interface MountTable {
  readonly mounts: readonly Mount[];
  /** The mount of a package, by the name it is imported by. */
  readonly byName: ReadonlyMap<string, Mount>;
  /** The mount at each virtual root. */
  readonly byVirtual: ReadonlyMap<string, Mount>;
}

const NODE_MODULES = '/node_modules/';

/** A path as mounts are looked up by: forward slashes, the drive letter in one case (P83). */
const keyOf = (path: string): string => pathKey(toPosixPath(path));

/**
 * Where an install of a package would put it under a root: `<root>/node_modules/<name>`,
 * spelled with forward slashes whatever the OS (P83). The compiler hands the
 * file system forward-slash paths on Windows too, so a mount spelled with the
 * OS's own separator would match nothing it is asked, silently.
 */
export const virtualRootOf = (root: string, name: string): string =>
  posix.join(toPosixPath(root), 'node_modules', name);

/** Where it was first written; it now lives beside the other path helpers (P199). */
export { isWithinDir };

/** Builds the table; a mount whose virtual root is not `<dir>/node_modules/<name>` is a caller's mistake. */
export const mountTableOf = (mounts: readonly Mount[]): MountTable => {
  for (const mount of mounts) {
    if (!toPosixPath(mount.virtual).endsWith(`${NODE_MODULES}${mount.source.name}`)) {
      throw new Error(`a mount is held at <root>/node_modules/<name>, not at ${mount.virtual}`);
    }
  }
  return {
    mounts,
    byName: new Map(mounts.map((mount) => [mount.source.name, mount])),
    byVirtual: new Map(mounts.map((mount) => [keyOf(mount.virtual), mount])),
  };
};

/**
 * The mount a path is at or under, if any.
 *
 * Each `node_modules/` segment of the path is tried, the last first: a
 * package installed inside a mounted package's own directory is its own
 * package, and only when no mount is held there does the segment before it
 * decide. A path under no mount falls through to the real file system.
 *
 * The path may be spelled with either separator and its drive letter in
 * either case (P83); it is asked as the table holds every virtual root.
 */
export const mountOfPath = (table: MountTable, asked: string): Mount | undefined => {
  if (table.byVirtual.size === 0) return undefined;
  const path = keyOf(asked);
  for (let at = path.lastIndexOf(NODE_MODULES); at >= 0; at = at === 0 ? -1 : path.lastIndexOf(NODE_MODULES, at - 1)) {
    const start = at + NODE_MODULES.length;
    let end = path.indexOf('/', start);
    if (path.startsWith('@', start) && end >= 0) end = path.indexOf('/', end + 1);
    const mount = table.byVirtual.get(end < 0 ? path : path.slice(0, end));
    if (mount !== undefined) return mount;
  }
  return undefined;
};

let realHost: FileSystemHost | undefined;

/** The real file system, as the parser's own host reads it. */
const realFileSystem = (): FileSystemHost => {
  realHost ??= new Project({ skipLoadingLibFiles: true }).getFileSystem();
  return realHost;
};

/**
 * The path on disk a path under a mount is really at: the rest of the virtual
 * path after the mount's root, under the source's directory, joined the way
 * the OS joins paths (P83). Undefined for a path under no mount.
 */
export const realPathOf = (table: MountTable, path: string): string | undefined => {
  const mount = mountOfPath(table, path);
  if (mount === undefined) return undefined;
  const rest = toPosixPath(path).slice(toPosixPath(mount.virtual).length);
  return rest === '' ? mount.source.dir : join(mount.source.dir, rest);
};

/**
 * The real file system with each mount's source showing through at its
 * virtual path, read-only. A path under a mount is read from the directory the
 * source is really in and keeps its virtual name, so the checker never learns
 * the other one; the directories above a mount exist so a walk up from a file
 * finds it, as it would an install.
 *
 * Every path asked is compared with forward slashes (P83, D3): normalised
 * once, here at the edge, and handed to the real file system in the OS's own
 * form only where the read goes to a source's directory. `base` is the real
 * file system unless a test hands another.
 */
export const mountedFileSystem = (mounts: readonly Mount[], base: FileSystemHost = realFileSystem()): FileSystemHost => {
  const table = mountTableOf(mounts);
  const real = (path: string): string => realPathOf(table, path) ?? path;
  const mounted = (path: string): boolean => mountOfPath(table, path) !== undefined;
  // Every directory above a mount, to the names of what is mounted below it.
  const above = new Map<string, Set<string>>();
  for (const mount of table.mounts) {
    const parts = keyOf(mount.virtual).split('/');
    for (let at = parts.length - 1; at > 0; at -= 1) {
      const dir = parts.slice(0, at).join('/');
      if (!dir.includes('/node_modules')) break;
      const children = above.get(dir) ?? new Set<string>();
      children.add(parts.slice(0, at + 1).join('/'));
      above.set(dir, children);
    }
  }
  const isAbove = (path: string): boolean => above.has(keyOf(path));
  const refuse = (path: string): never => {
    throw new Error(`read-only: ${path} is a package source held in memory`);
  };
  const host: FileSystemHost = {
    isCaseSensitive: () => base.isCaseSensitive(),
    delete: async (path) => (mounted(path) ? refuse(path) : base.delete(path)),
    deleteSync: (path) => (mounted(path) ? refuse(path) : base.deleteSync(path)),
    readDirSync: (dirPath): RuntimeDirEntry[] => {
      const children = above.get(keyOf(dirPath));
      if (children === undefined) {
        if (!mounted(dirPath)) return base.readDirSync(dirPath);
        // Each entry is named at its virtual path: the directory asked, then
        // what follows the source's directory in the name the disk gave.
        const at = toPosixPath(dirPath).replace(/\/+$/, '');
        const from = toPosixPath(real(dirPath)).replace(/\/+$/, '');
        return base
          .readDirSync(real(dirPath))
          .map((entry) => ({ ...entry, name: at + toPosixPath(entry.name).slice(from.length) }));
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
    directoryExists: async (dirPath) => isAbove(dirPath) || base.directoryExists(real(dirPath)),
    directoryExistsSync: (dirPath) => isAbove(dirPath) || base.directoryExistsSync(real(dirPath)),
    // The virtual name is the name: the checker resolves a symlinked install
    // to where it really is, and here that would be the source's own path.
    realpathSync: (path) => (mounted(path) || isAbove(path) ? path : base.realpathSync(path)),
    getCurrentDirectory: () => base.getCurrentDirectory(),
    glob: (patterns) => base.glob(patterns),
    globSync: (patterns) => base.globSync(patterns),
  };
  return host;
};

/* ── What a project stood in, asked after the program is built ── */

interface StandInState {
  readonly rootDir: string;
  /**
   * Every package the request's index answers and every name it found
   * ambiguous, before this service's own installs and members are taken out:
   * what the cache's fingerprint asks of a wanted name (P83).
   */
  readonly index: PackageIndex;
  readonly mounts: readonly Mount[];
  /** The same mounts, for asking of a path or a name (P82). */
  readonly table: MountTable;
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
export const recordStandIns = (project: Project, state: Omit<StandInState, 'table'>): void => {
  STATE.set(project, { ...state, table: mountTableOf(state.mounts) });
};

/** The mounts a project was opened with. */
export const mountsOf = (project: Project): readonly Mount[] => STATE.get(project)?.mounts ?? [];

/** The mount a file is held under, when it is one of a package source's. */
const mountOf = (project: Project, filePath: string): Mount | undefined => {
  const table = STATE.get(project)?.table;
  return table === undefined ? undefined : mountOfPath(table, filePath);
};

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

const FILES_READ = new WeakMap<ts.Program, ReadonlyMap<Mount, readonly string[]>>();

/**
 * The mounted files the program read, by their virtual path: walked once per
 * program (P82), because the cache's list and the rows both ask it, and a
 * program is what decides which files were read.
 */
const mountedFilesRead = (project: Project): ReadonlyMap<Mount, readonly string[]> => {
  const table = STATE.get(project)?.table;
  if (table === undefined || table.mounts.length === 0) return new Map();
  const program = project.getProgram().compilerObject;
  const known = FILES_READ.get(program);
  if (known !== undefined) return known;
  WORK_COUNTS.mountedFileWalks += 1;
  const out = new Map<Mount, string[]>();
  for (const file of program.getSourceFiles()) {
    const mount = mountOfPath(table, file.fileName);
    if (mount === undefined) continue;
    const files = out.get(mount);
    if (files === undefined) out.set(mount, [file.fileName]);
    else files.push(file.fileName);
  }
  FILES_READ.set(program, out);
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
    for (const file of files) out.add(normalizeFilePath(realPathOf(state.table, file) ?? file, rootDir));
  }
  for (const reading of state.shapeFiles) out.add(normalizeFilePath(reading.path, rootDir));
  return [...out].sort();
};

/* ── What a reading's stand-ins answered, for the cache to compare (P83) ── */

/**
 * The packages a reading wanted something to stand in for, by name, sorted.
 *
 * Every bare import of the repository's own files, and of the package sources
 * it read, whose answer is not a real install: an import nothing resolves (a
 * missing package, or one two directories claim), one a package source
 * answers, and one a shape file answers, the project's or a reader's built-in.
 * Those are the names whose answer a directory appearing, moving or going
 * away can change (D1); an installed package, an alias of the service's own
 * and a member of its workspace win over every stand-in, so a new directory
 * says nothing about them.
 */
export const standInWants = (project: Project): string[] => {
  const state = STATE.get(project);
  if (state === undefined) return [];
  const out = new Set<string>();
  const standsIn = (path: string): boolean =>
    mountOfPath(state.table, path) !== undefined || isDeclarationShape(project, path);
  for (const file of project.getSourceFiles()) {
    const path = file.getFilePath();
    const mount = mountOfPath(state.table, path);
    if (mount === undefined && (path.includes('/node_modules/') || isDeclarationShape(project, path))) continue;
    for (const declaration of [...file.getImportDeclarations(), ...file.getExportDeclarations()]) {
      const specifier = declaration.getModuleSpecifierValue();
      const name = specifier === undefined ? undefined : packageOfSpecifier(specifier);
      if (name === undefined || name === mount?.source.name) continue;
      const target = declaration.getModuleSpecifierSourceFile();
      if (target === undefined || standsIn(target.getFilePath())) out.add(name);
    }
  }
  return [...out].sort();
};

/** What the package index answers for one wanted name. */
export type PackageAnswer =
  /** One directory is the package: where, relative to the configuration, and a hash of its manifest. */
  | { dir: string; manifestHash: string }
  /** More than one claims it, so none is read: the directories, relative to the configuration. */
  | { ambiguous: string[] };

/**
 * What stood in for a reading, as the build cache compares it (P83).
 *
 * `shapes` is every shape file the service lists, the globs expanded, each
 * with a hash of its content: a file added under a glob, removed or edited
 * all change it (D2). `packages` is, for every name the reading wanted
 * ({@link standInWants}), what the package index answers: one directory, more
 * than one, or nothing (`null`).
 */
export interface StandInsFingerprint {
  shapes: Record<string, string>;
  packages: Record<string, PackageAnswer | null>;
  /**
   * Every pattern file listed for the service (P121), relative to the
   * configuration, to its content hash. Absent where none is listed, so a
   * reading with no patterns records what it always did.
   */
  patterns?: Record<string, string>;
}

export interface StandInsFingerprintInput {
  /** The names the reading wanted, from {@link standInWants}. */
  readonly wants: readonly string[];
  /** The index the reading was or will be given; none when package sources are off for it. */
  readonly index: PackageIndex | undefined;
  /** Every shape file listed for the service, as absolute paths. */
  readonly shapeFiles: readonly string[];
  /** The configuration's directory, which every path recorded is relative to. */
  readonly configDir: string;
  /** Every pattern file listed for the service, as absolute paths (P121). */
  readonly patternFiles?: readonly string[];
  /** How a shape file is hashed; {@link hashShapeFile} unless a caller shares one per build. */
  readonly hashOf?: (path: string) => string;
}

const sha1 = (text: string): string => `sha1:${createHash('sha1').update(text).digest('hex')}`;

/** A shape file's content hash, or `missing` when it cannot be read. */
export const hashShapeFile = (path: string): string => {
  const text = readText(path);
  return text === undefined ? 'missing' : sha1(text);
};

/**
 * The fingerprint of a reading's stand-ins: the same input, the same object,
 * keys sorted, so two of them compare by their JSON. Paths are relative to the
 * configuration and POSIX, so a project that moved as a whole is unchanged.
 */
export const standInsFingerprint = (input: StandInsFingerprintInput): StandInsFingerprint => {
  const { index, configDir } = input;
  const hashOf = input.hashOf ?? hashShapeFile;
  const rel = (dir: string): string => normalizeFilePath(dir, configDir) || '.';
  const shapes: Record<string, string> = {};
  for (const path of [...input.shapeFiles].sort()) shapes[rel(path)] = hashOf(path);
  const packages: Record<string, PackageAnswer | null> = {};
  if (index !== undefined) {
    for (const name of [...new Set(input.wants)].sort()) {
      const source = index.sources.get(name);
      const claimed = index.ambiguous.get(name);
      packages[name] =
        source !== undefined
          ? { dir: rel(source.dir), manifestHash: sha1(JSON.stringify(source.manifest)) }
          : claimed !== undefined
            ? { ambiguous: claimed.map((each) => rel(each.dir)).sort() }
            : null;
    }
  }
  // A pattern file is configuration the readers compile (P121): a new file
  // under a glob, an edited one and a removed one each change what the same
  // sources produce, the way a shape file does.
  const patterns: Record<string, string> = {};
  for (const path of [...(input.patternFiles ?? [])].sort()) patterns[rel(path)] = hashOf(path);
  return { shapes, packages, ...(Object.keys(patterns).length === 0 ? {} : { patterns }) };
};

/**
 * The fingerprint of what stood in for this project's reading, from what it
 * was opened with: the index it was given and the shape files it lists. What a
 * reading on its own leaves in its cache entry; a build asks the names of it
 * and answers them from its own index.
 */
export const standInsFingerprintOf = (
  project: Project,
  configDir: string,
  patternFiles: readonly string[] = [],
): StandInsFingerprint | undefined => {
  const state = STATE.get(project);
  if (state === undefined) return undefined;
  return standInsFingerprint({
    wants: standInWants(project),
    index: state.index,
    shapeFiles: state.shapeFiles.map((reading) => reading.path),
    configDir,
    patternFiles,
  });
};

/**
 * The fingerprint a build's stand-ins (P82) give one service for these wanted
 * names: the index its `packageSources` setting asks, and the shape files it
 * lists. Undefined when nothing can stand in for it - package sources off and
 * no shape file listed - or the build's stand-ins do not name it.
 */
export const standInsFingerprintOfBuild = (options: {
  readonly given: StandInsOfBuild;
  readonly config: FlowatlasConfig | undefined;
  readonly service: ServiceConfig;
  readonly wants: readonly string[];
  readonly hashOf?: (path: string) => string;
}): StandInsFingerprint | undefined => {
  const { given, service } = options;
  if (!Object.hasOwn(given.perService, service.name)) return undefined;
  const listed = given.perService[service.name];
  const search = searchOf(packageSourcesFor(options.config, service));
  const record = search === undefined ? undefined : given.indexes[search];
  const patternFiles = listed?.patterns ?? [];
  if (listed === undefined || (record === undefined && listed.files.length === 0 && patternFiles.length === 0)) return undefined;
  return standInsFingerprint({
    wants: options.wants,
    index: record === undefined ? undefined : indexOfRecord(record),
    shapeFiles: listed.files,
    configDir: given.configDir,
    patternFiles,
    ...(options.hashOf === undefined ? {} : { hashOf: options.hashOf }),
  });
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
 * The three that say what was read rather than what was missed - the source,
 * the version that differs from the one asked for, the shape nothing needed -
 * are notes (row-kind.ts, P81) at `info`, so no count of what the reader could
 * not follow includes them; they once sat at `nothing` for that reason alone.
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
      // Nothing was missed: the package was read, from its source. A note
      // (row-kind.ts, P81), so `info` no longer counts it among the places the
      // reader could not follow, and `nothing` keeps meaning no edge to draw.
      level: 'info',
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
      const source = state.table.byName.get(shape.package);
      const mounted = source !== undefined && read.has(source);
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
        // Nothing was missed either: the package is read, from somewhere
        // stronger. A note, like the row above.
        level: 'info',
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
  // What a call's declarations say, asked once per call (P82): edges drawn at
  // one line share its calls, and the checker's answer for a node is the same
  // each time it is asked.
  const standInOfCall = new Map<Node, StandInOfFile | undefined>();
  const askCall = (call: Node): StandInOfFile | undefined => {
    if (standInOfCall.has(call)) return standInOfCall.get(call);
    let found: StandInOfFile | undefined;
    for (const path of declarationFiles(call)) {
      found = standInOfFile(project, path);
      if (found !== undefined) break;
    }
    standInOfCall.set(call, found);
    return found;
  };
  for (const edge of builder.edges) {
    if (edge.file === undefined || edge.line === undefined) continue;
    // An edge into the repository's own code was drawn through its own
    // declarations; only one into what a call reaches outside it - a query, a
    // publish, a request - can owe its shape to a package's types.
    if (!REACHED_THROUGH_TYPES.has(builder.getNode(edge.to)?.type ?? '')) continue;
    let found: StandInOfFile | undefined;
    for (const call of callsAt(edge.file, edge.line)) {
      found = askCall(call);
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
  const table = STATE.get(project)?.table;
  if (table === undefined || table.mounts.length === 0) return;
  // A row's file is relative to the repository; its mount is asked of the
  // path it stands for, the way every other question of a mount is (P82).
  builder.withdrawUnresolved((row) => {
    if (!row.file.includes('node_modules/')) return false;
    const path = toPosixPath(join(repoDir, row.file));
    const mount = mountOfPath(table, path);
    return mount !== undefined && mount.source.service !== undefined && path !== toPosixPath(mount.virtual);
  });
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
    // Asked of the disk as it is now (P125): the MCP server that asks this
    // lives longer than any one build, and a package added since it started
    // is what a rebuild would read.
    const index = packageIndexOf(
      {
        services: config.services
          .filter((each) => each.document === undefined)
          .map((each) => ({ name: each.name, dir: serviceDirOf(configDir, each.repo) })),
        ...(setting === true ? { folders: configDir } : {}),
      },
      { remember: false },
    );
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
