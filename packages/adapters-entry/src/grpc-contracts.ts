import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { parseProto, protoTypes, sameMethodName, toPosixPath, type ProtoFile, type ProtoMethod, type ProtoService, type ProtoTypes } from '@flowatlas/core';
import type { FileSystemHost } from 'ts-morph';

/**
 * The gRPC contracts a service can see (P274): every `.proto` file of the
 * repository it is in.
 *
 * A contract is not kept beside the code that implements it. It is shared by
 * every service that speaks it, server and clients alike, so a repository of
 * several services keeps it once - a `proto/` or `pb/` directory at the top -
 * and each service's build copies it in or generates code from it. A service
 * that loads `demo.proto` names a file its own directory does not hold. So
 * the files are looked for in the whole repository the service is in: from
 * the service's directory up to the directory that holds `.git` or the
 * project's configuration, whichever is nearer, and every directory below
 * that except a dependency's or a hidden one.
 *
 * That is a reading of a statement, not of a service: a contract declares
 * what a service *would* answer, and is drawn as a way in only where code
 * here implements it (the server reader) or where the configuration declares
 * a service by the file (a declared service). A client reads it to name what
 * it calls, whoever answers.
 */

/** One file, and where it is. */
export interface Contract {
  /** Absolute, POSIX. */
  readonly path: string;
  readonly file: ProtoFile;
}

/** A service, and the file that declares it. */
export interface ContractService {
  readonly contract: Contract;
  readonly service: ProtoService;
}

export interface Contracts {
  readonly all: readonly Contract[];
  /** The service of this full name, `shop.CartService`. */
  byFullName(name: string): ContractService | undefined;
  /**
   * The services of this short name, `CartService`, narrowed by a hint where
   * several files declare one: the services of a file whose name the hint
   * names (`shop` for `shop.proto`, the generated module `./gen/shop_pb`).
   */
  byShortName(name: string, hint?: string): readonly ContractService[];
  /**
   * The file a loader is handed, `demo.proto` or `../proto/shop.proto`,
   * resolved from a directory, then from the service's, then as the end of a
   * path of any contract here, where only one ends so.
   */
  file(spec: string, fromDir: string): Contract | undefined;
  /** A contract's path as a node records it: relative to the service's directory. */
  pathOf(contract: Contract): string;
  /** The messages of every contract here as payload types, registered under a repository (P287). */
  types(repo: string): ProtoTypes;
}

/** Directories no contract of the repository's own is kept in. */
const NOT_WALKED = new Set(['node_modules', 'dist', 'build', 'target', 'bin', 'obj', 'vendor', 'coverage']);

/** How many directories a repository is searched through before the search stops. */
const MAX_DIRECTORIES = 5000;

/** How far up a service's directory the top of its repository is looked for. */
const MAX_ASCENT = 12;

/** The configuration's file name, which marks the top of a project as `.git` marks a repository's. */
const PROJECT_MARK = 'flowatlas.config.json';

const cache = new WeakMap<FileSystemHost, Map<string, readonly Contract[]>>();

/** The payload types of one set of contracts, per repository they are registered under. */
const typesCache = new WeakMap<readonly Contract[], Map<string, ProtoTypes>>();

const exists = (fs: FileSystemHost, path: string): boolean => {
  try {
    return fs.fileExistsSync(path) || fs.directoryExistsSync(path);
  } catch {
    return false;
  }
};

/** The top of the repository a directory is in, or the directory itself where none is marked. */
const searchRootOf = (fs: FileSystemHost, dir: string): string => {
  let at = dir;
  for (let depth = 0; depth < MAX_ASCENT; depth += 1) {
    if (exists(fs, join(at, '.git')) || exists(fs, join(at, PROJECT_MARK))) return at;
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return dir;
};

const contractsUnder = (fs: FileSystemHost, root: string): readonly Contract[] => {
  const found: Contract[] = [];
  const queue = [root];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_DIRECTORIES) {
    const dir = queue.shift() as string;
    visited += 1;
    let entries;
    try {
      entries = fs.readDirSync(dir);
    } catch {
      continue;
    }
    const names = entries
      .map((entry) => ({ ...entry, base: basename(entry.name) }))
      .sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0));
    for (const entry of names) {
      const path = join(dir, entry.base);
      if (entry.isDirectory) {
        if (entry.base.startsWith('.') || NOT_WALKED.has(entry.base)) continue;
        queue.push(path);
        continue;
      }
      if (!entry.base.endsWith('.proto')) continue;
      try {
        found.push({ path: toPosixPath(path), file: parseProto(fs.readFileSync(path)) });
      } catch {
        // A file that cannot be read declares nothing here.
      }
    }
  }
  return found;
};

/** The contracts a service whose directory is this one can see. */
export const contractsOf = (fs: FileSystemHost, repoDir: string): Contracts => {
  const root = searchRootOf(fs, repoDir);
  const byRoot = cache.get(fs) ?? new Map<string, readonly Contract[]>();
  cache.set(fs, byRoot);
  const all = byRoot.get(root) ?? contractsUnder(fs, root);
  byRoot.set(root, all);

  const services = all.flatMap((contract) => contract.file.services.map((service) => ({ contract, service })));
  const byFull = new Map<string, ContractService>();
  for (const each of services) if (!byFull.has(each.service.fullName)) byFull.set(each.service.fullName, each);

  const stem = (path: string): string => basename(path).replace(/\.proto$/, '');
  const hinted = (hint: string): string =>
    basename(hint)
      .replace(/\.(?:[cm]?[jt]sx?|proto)$/, '')
      .replace(/(?:_grpc_pb|_pb|\.grpc-client|\.grpc-server|_grpc|\.client|\.pb)$/, '');

  const ending = (spec: string): Contract[] => {
    const tail = `/${toPosixPath(spec).replace(/^(?:\.\.?\/)+/, '')}`;
    return all.filter((contract) => contract.path.endsWith(tail));
  };

  return {
    all,
    byFullName: (name) => byFull.get(name.replace(/^\./, '')),
    byShortName: (name, hint) => {
      const matching = services.filter((each) => each.service.name === name);
      if (matching.length <= 1 || hint === undefined) return matching;
      const narrowed = matching.filter((each) => stem(each.contract.path) === hinted(hint));
      return narrowed.length > 0 ? narrowed : matching;
    },
    file: (spec, fromDir) => {
      const candidates = isAbsolute(spec) ? [spec] : [join(fromDir, spec), join(repoDir, spec), join(root, spec)];
      for (const candidate of candidates) {
        const posix = toPosixPath(candidate);
        const known = all.find((contract) => contract.path === posix);
        if (known !== undefined) return known;
      }
      const ends = ending(spec);
      return ends.length === 1 ? ends[0] : undefined;
    },
    pathOf: (contract) => toPosixPath(relative(repoDir, contract.path)),
    types: (repo) => {
      const byRepo = typesCache.get(all) ?? new Map<string, ProtoTypes>();
      typesCache.set(all, byRepo);
      const found = byRepo.get(repo) ?? protoTypes(all.map((contract) => ({ path: toPosixPath(relative(repoDir, contract.path)), file: contract.file })), repo);
      byRepo.set(repo, found);
      return found;
    },
  };
};

/** The method of a service a name written in code stands for. */
export const methodNamed = (service: ProtoService, written: string): ProtoMethod | undefined =>
  service.methods.find((method) => method.name === written) ?? service.methods.find((method) => sameMethodName(written, method.name));

/** A method's name as the protocol spells it, where no contract says: the first letter raised. */
export const declaredSpelling = (written: string): string => `${written.charAt(0).toUpperCase()}${written.slice(1)}`;
