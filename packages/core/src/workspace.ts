import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { readPackageJson, type PackageJson } from './package-json.js';

/**
 * What a monorepo says about itself, and what that makes a service.
 *
 * Until this module existed, a service was a directory with a manifest, and the
 * reading of it stopped at that directory's edge. Two measurements said the same
 * thing from opposite ends. Pointed at cal.com's `apps/web`, the tool found all
 * eighty-four of its routes and not one node outside `apps/web`, because the
 * bodies those routes call live in `packages/features` and `packages/lib` and
 * were opened only so that types would resolve; pointed at the monorepo root it
 * found four thousand nodes and no way in at all, because the root has no
 * application in it. There was no configuration that gave both, and the reason
 * is that the answer the tool had to "what is a service" was a directory, while
 * the answer the repository had was a workspace member plus the members it
 * depends on.
 *
 * So the answer here is: **a service is an application together with the
 * workspace packages it declares.** Its identity, its manifest, its tsconfig and
 * the directory every path in the graph is relative to all stay the application's
 * own — a node of `packages/lib` is reported as `../../packages/lib/…`, a file
 * belonging to another package that this service reads, which is what it is. What
 * changes is the extent: the code a reading is allowed to walk.
 *
 * Two things follow from writing it this way rather than as a new configuration
 * key. The extent is derived from what the repository already declares, so
 * nobody has to keep a second list of directories in step with `package.json`;
 * and it is a fact about a directory rather than a field on a context, so every
 * reader that needs it can ask for it without any of them having to be handed it.
 *
 * Nothing here knows the name of a framework. A workspace is a manifest fact.
 *
 * ## One discoverer
 *
 * Two of them were written at the same time on two branches, neither able to see
 * the other: this one, for a service's extent, and one beside the manifest
 * reader, for widening a member's dependency sections along the workspace it
 * belongs to. Both answered the same three questions - which globs a directory
 * declares, which directories they match, and which workspaces a directory is a
 * member of - from their own parser, their own glob compiler and their own walk.
 * They agreed the day they were written and would have disagreed the first time
 * either was touched, and the disagreement would have shown up as a service whose
 * extent and whose framework were read from different lists of members (R115).
 *
 * So the discovery is here, all of it, below the adapters and with nothing
 * framework-shaped in it; the widening stays beside the manifest reader, which is
 * a different question about the same files. Where the two implementations
 * differed this one keeps the more capable half: the workspace file is read with
 * the flow-sequence spelling and the comments the other reader handled, the walk
 * skips the build directories the other one walked into, and the depth a `**`
 * licenses is bounded per pattern rather than by one number for every pattern.
 *
 * Two questions are asked of the result and they are not the same question. *Is
 * this directory a package of that workspace* wants a manifest with a name in it,
 * because a name is what makes something importable; *does that workspace declare
 * this path* wants the glob alone, because a manifest chain governs the files
 * under a directory whether or not anybody can import it by name. Both are
 * computed from the one glob set by the one matcher, which is the whole of what
 * having one discoverer means.
 */

/** A package of a workspace: the name others import it by, and where it is. */
export interface WorkspacePackage {
  readonly name: string;
  /** Absolute path of the directory holding its manifest. */
  readonly dir: string;
}

/** Directories a workspace glob never means, however wide the glob. */
const NEVER_A_PACKAGE = new Set(['node_modules', 'dist', 'build', 'coverage', 'tmp']);

/** Strips the quotes a workspace file is allowed to put around a pattern. */
const unquote = (value: string): string => {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted === null ? trimmed : (quoted[2] ?? '');
};

/**
 * The `packages:` list out of a workspace file, and nothing else out of it.
 *
 * Deliberately not a parser for the whole format. The only thing wanted from that
 * file is one list of strings under one top-level key, and reading it by hand
 * keeps this package free of a dependency it would otherwise carry into every
 * build for four lines of data. Anything else in the file — overrides, patches,
 * install settings — is somebody else's business and is skipped by stopping at
 * the next top-level key.
 *
 * Both spellings of a list, because the format allows both and a repository that
 * chose the inline one has not declared fewer members.
 */
const globsInWorkspaceFile = (text: string): readonly string[] => {
  const found: string[] = [];
  let inside = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const key = /^packages\s*:(.*)$/.exec(line);
    if (key !== null) {
      const inline = /^\s*\[(.*)\]\s*$/.exec(key[1] ?? '');
      if (inline !== null) return (inline[1] ?? '').split(',').map(unquote).filter(Boolean);
      inside = true;
      continue;
    }
    if (!inside) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item !== null) {
      const value = unquote((item[1] ?? '').replace(/\s+#.*$/, ''));
      if (value !== '') found.push(value);
      continue;
    }
    // A blank line or a comment is still inside the list; a line that starts in
    // the first column is the next top-level key, which ends it.
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break;
  }
  return found;
};

/** The `workspaces` field, in both spellings the field has. */
const globsInManifest = (dir: string): readonly string[] => {
  const asList = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const declared = readPackageJson(dir)?.['workspaces'];
  if (Array.isArray(declared)) return asList(declared);
  return typeof declared === 'object' && declared !== null
    ? asList((declared as { packages?: unknown }).packages)
    : [];
};

/**
 * Where a workspace root can declare its members.
 *
 * A table rather than a run of branches: one entry per file that can carry the
 * declaration, and both are read when both exist, because a repository is
 * allowed to say it in either place — one moving between package managers
 * usually keeps both files for a while — and saying it in one does not make the
 * other a lie.
 */
const GLOB_SOURCES: ReadonlyArray<(dir: string) => readonly string[]> = [
  globsInManifest,
  (dir) => {
    try {
      return globsInWorkspaceFile(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'));
    } catch {
      return [];
    }
  },
];

/**
 * The globs a directory declares its workspace members with.
 *
 * An empty list means this directory is not the root of a workspace.
 */
export const workspaceGlobs = (dir: string): readonly string[] => {
  const root = resolve(dir);
  const declared = GLOB_SOURCES.flatMap((read) => read(root)).map((glob) =>
    glob.replace(/\\/g, '/').replace(/^\.\//, ''),
  );
  return [...new Set(declared)];
};

/** One member pattern as a test on a path relative to the root that declared it. */
const globTest = (glob: string): RegExp => {
  const source = glob
    .replace(/\/+$/, '')
    .split('/')
    .map((segment) =>
      segment === '**'
        ? '.*'
        : segment
            .split('*')
            .map((literal) => literal.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*'),
    )
    .join('/');
  return new RegExp(`^${source}$`);
};

/**
 * A root's globs, compiled: what they include, what they take back out, and how
 * deep a walk has to go to find everything they can name.
 *
 * The patterns themselves say how deep: `packages/*` cannot match anything three
 * levels down. A `**` has no depth of its own, so it is given a couple of levels
 * beyond the rest of its pattern rather than licence to walk a whole checkout.
 */
interface MemberPatterns {
  readonly include: readonly RegExp[];
  readonly exclude: readonly RegExp[];
  readonly depth: number;
}

const patternsByRoot = new Map<string, MemberPatterns | undefined>();

const declaredMembers = (root: string): MemberPatterns | undefined => {
  if (patternsByRoot.has(root)) return patternsByRoot.get(root);
  const globs = workspaceGlobs(root);
  const include = globs.filter((glob) => !glob.startsWith('!'));
  const patterns =
    globs.length === 0
      ? undefined
      : {
          include: include.map(globTest),
          exclude: globs
            .filter((glob) => glob.startsWith('!'))
            .map((glob) => globTest(glob.slice(1))),
          depth: include.reduce((deepest, glob) => {
            const segments = glob.split('/').length;
            return Math.max(deepest, glob.includes('**') ? segments + 2 : segments);
          }, 0),
        };
  patternsByRoot.set(root, patterns);
  return patterns;
};

/**
 * Whether a path relative to a root is one the root's globs name.
 *
 * The directories a glob never means are refused here rather than in the walk
 * below, because the walk is not the only thing that asks: a `**` names
 * `dist/web` as readily as `apps/web`, and a reader that skipped the built copy
 * while a reader that looked upwards accepted it is the disagreement having one
 * discoverer is for. A leading dot is the same case — tooling, not a member.
 */
const declares = (patterns: MemberPatterns, path: string): boolean => {
  const segments = path.split('/');
  if (segments.some((segment) => segment.startsWith('.') || NEVER_A_PACKAGE.has(segment))) {
    return false;
  }
  return (
    patterns.include.some((test) => test.test(path)) &&
    !patterns.exclude.some((test) => test.test(path))
  );
};

const childDirectories = (dir: string): readonly string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // An installed copy of a workspace package is not the package; a dot
      // directory and a build output are not source. All three are also where a
      // walk would otherwise spend most of its time.
      .filter((name) => !name.startsWith('.') && !NEVER_A_PACKAGE.has(name));
  } catch {
    return [];
  }
};

const memberDirsByRoot = new Map<string, readonly string[]>();

/**
 * Every directory under `root` that its globs name and that holds a manifest, as
 * absolute paths.
 *
 * Walked once per root and remembered, because every reader asks and the answer
 * cannot change during a build. A directory the globs match but that holds no
 * manifest is not a member: the globs say where to look and the manifest is what
 * makes a package.
 */
export const workspaceMemberDirs = (root: string): readonly string[] => {
  const base = resolve(root);
  const cached = memberDirsByRoot.get(base);
  if (cached !== undefined) return cached;
  const patterns = declaredMembers(base);
  const found: string[] = [];
  if (patterns !== undefined) {
    const visit = (path: string, depth: number): void => {
      for (const name of childDirectories(join(base, path))) {
        const child = path === '' ? name : `${path}/${name}`;
        if (declares(patterns, child) && readPackageJson(join(base, child)) !== undefined) {
          found.push(join(base, child));
        }
        if (depth < patterns.depth) visit(child, depth + 1);
      }
    };
    visit('', 1);
  }
  memberDirsByRoot.set(base, found);
  return found;
};

/**
 * The packages of the workspace rooted at `root`, or none when it is not one.
 *
 * A member whose manifest carries no name is a directory of source files and not
 * something anybody can import, so it is not a package here. It is still a member
 * of the workspace, which `workspaceMemberDirs` answers for, and what it declares
 * still governs the files inside it.
 */
export const workspacePackages = (root: string): readonly WorkspacePackage[] => {
  const found: WorkspacePackage[] = [];
  for (const dir of workspaceMemberDirs(root)) {
    const name = readPackageJson(dir)?.name;
    if (typeof name === 'string' && name !== '') found.push({ name, dir });
  }
  return found;
};

/**
 * The workspace roots that declare this directory, nearest first.
 *
 * All of them, because a workspace nested inside another means two roots have
 * something to say about the same files and both are saying it. Up to the top of
 * the file system: a checkout can sit at any depth, and an ancestor only counts
 * when it names this directory, which an unrelated one has no way to do by
 * accident.
 */
export const workspaceRootsAbove = (dir: string): readonly string[] => {
  const member = resolve(dir);
  const found: string[] = [];
  let at = dirname(member);
  for (;;) {
    const patterns = declaredMembers(at);
    if (patterns !== undefined && declares(patterns, relative(at, member).replace(/\\/g, '/'))) {
      found.push(at);
    }
    const parent = dirname(at);
    if (parent === at) return found;
    at = parent;
  }
};

/**
 * The workspace `dir` is a package of, when it is a package of one.
 *
 * The nearest root that lists it, so a workspace nested inside another —
 * PeerTube's `client`, which declares members of its own — answers for its own
 * members and the outer one answers for the rest. A directory that is itself the
 * root of a workspace is not a member of it, which is what keeps a monorepo read
 * as a whole from acquiring an extent: its globs already cover everything under
 * it.
 */
export const workspaceRootOf = (dir: string): string | undefined => {
  const member = resolve(dir);
  return workspaceRootsAbove(member).find((root) => workspaceMemberDirs(root).includes(member));
};


type DependencySection =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

/**
 * Which sections of a manifest take a workspace package into a service's
 * extent, by whose manifest it is (R143).
 *
 * The extent exists for one argument: a handler in `packages/features` that
 * calls `packages/lib` is one call, and both ends of it belong to the service
 * that reaches them. That is an argument about what runs, and the sections are
 * chosen by it - which is the same line the package manager draws, because it is
 * the package manager that decides what is there when the service runs.
 *
 * - **The service's own manifest: all four.** The service is the package being
 *   built, and its devDependencies are what its own build and its own tests pull
 *   in. An application that is bundled declares code it ships there, because
 *   the bundler inlines it; a server keeps its test helpers there, and they call
 *   into the same packages its handlers do. Either way it is this service's
 *   code, and an installer installs a package's devDependencies exactly when
 *   that package is the one being worked on.
 * - **A member's manifest: everything but devDependencies.** A member's
 *   devDependencies are what that member needs to be built or tested on its
 *   own - a preview tool, a command-line companion, a test harness - and an
 *   installer never installs them for anybody who depends on the member. None of
 *   it is reachable from the service at run time, so none of it is the service.
 *   Following them anyway is how a command-line tool's browser interface, two
 *   devDependencies away, was read into a server as two hundred components.
 *
 * `peerDependencies` stay on both sides: a peer is a package the member expects
 * whoever uses it to supply, and it runs in the same process as the member. So
 * does `optionalDependencies`, which is `dependencies` that may fail to install.
 */
const EXTENT_SECTIONS: Readonly<Record<'service' | 'member', readonly DependencySection[]>> = {
  service: ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'],
  member: ['dependencies', 'peerDependencies', 'optionalDependencies'],
};

/**
 * What one manifest declares, read the way the extent reads it.
 *
 * The one place `EXTENT_SECTIONS` is applied. The extent's walk asks it of every
 * manifest it reaches, and so does the widening in `adapters/manifest.ts` when it
 * folds a member's dependencies into what the service can import: a member's
 * devDependencies were never installed for the service, so they neither take a
 * package into its extent nor switch an adapter on for it, and both of those are
 * this one function (R145).
 */
export const extentDeclared = (
  pkg: PackageJson | undefined,
  role: 'service' | 'member',
): PackageJson => {
  const kept: PackageJson = {};
  for (const section of EXTENT_SECTIONS[role]) {
    const declared = pkg?.[section];
    if (declared !== undefined) kept[section] = declared;
  }
  return kept;
};

/** One package of a service's extent, and the packages of it that it declares. */
export interface ExtentPackage {
  /** Absolute directory of the package. */
  readonly dir: string;
  /** `service` for the package being read, `member` for everything it reaches. */
  readonly role: 'service' | 'member';
  /** The directories of the other packages of the extent its manifest declares. */
  readonly declares: readonly string[];
}

/** Answers already worked out, so every reader that asks pays for one walk. */
const extentByService = new Map<string, readonly ExtentPackage[]>();

/**
 * The packages a service is made of, each with the members it declares.
 *
 * The walk behind {@link serviceSourceDirs}, kept with its edges because one
 * question needs them: a peer dependency is supplied by whoever depends on the
 * package, so which of a service's packages run a framework depends on who
 * declares whom (see `suppliedWith` in `adapters/manifest.ts`). Unlike the list
 * of directories, this includes a member nested inside the service's own
 * directory, because it is still a package with a manifest of its own.
 */
export const serviceExtent = (repoDir: string): readonly ExtentPackage[] => {
  const own = resolve(repoDir);
  const cached = extentByService.get(own);
  if (cached !== undefined) return cached;

  const root = workspaceRootOf(own);
  const found: ExtentPackage[] = [];
  if (root === undefined) {
    found.push({ dir: own, role: 'service', declares: [] });
  } else {
    const byName = new Map(workspacePackages(root).map((pkg) => [pkg.name, pkg.dir]));
    const seen = new Set<string>([own]);
    const queue = [own];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      const role = at === own ? 'service' : 'member';
      const declares: string[] = [];
      for (const name of Object.keys(allDeclared(extentDeclared(readPackageJson(at), role)))) {
        const dir = byName.get(name);
        // A package the service is inside of would bring the whole repository
        // with it, and the answer to "what is this service" would be "all of it".
        if (dir === undefined || own === dir || own.startsWith(`${dir}/`)) continue;
        declares.push(dir);
        if (seen.has(dir)) continue;
        seen.add(dir);
        queue.push(dir);
      }
      found.push({ dir: at, role, declares });
    }
  }
  extentByService.set(own, found);
  return found;
};

/** Every name one manifest declares, in whichever of its sections. */
const allDeclared = (pkg: PackageJson): Record<string, string> =>
  Object.assign({}, ...Object.values(pkg)) as Record<string, string>;

/**
 * The directories one service's code lives in: its own, then what it declares.
 *
 * The first entry is always the service's own directory, and it is the one every
 * path in its graph is relative to. The rest are the workspace packages its
 * manifest names, and the packages those name in turn, because a handler in
 * `packages/features` that calls `packages/lib` is one call and both ends of it
 * belong to the service that reaches them. Which sections of each manifest are
 * followed is `EXTENT_SECTIONS`, and the service's own manifest is read more
 * widely than a member's.
 *
 * Three things are left out on purpose. A package that is not a member of the
 * workspace is left to the module resolver, which is what installed packages are
 * for. A member that contains the service — a root that somehow depends on its
 * own child — is left out, because taking it in would quietly turn one service
 * into the whole repository. And a directory that is not a workspace member gets
 * nothing but itself, so pointing the tool at a bare directory, or at a monorepo
 * root, reads exactly what it read before. A member nested inside the service's
 * own directory adds no directory, because its files are already under the first
 * one, though what it declares still belongs to the service.
 */
export const serviceSourceDirs = (repoDir: string): readonly string[] => {
  const [own, ...members] = serviceExtent(repoDir).map((pkg) => pkg.dir) as [string, ...string[]];
  return [own, ...members.filter((dir) => !dir.startsWith(`${own}/`)).sort()];
};


/** Whether a file belongs to one of a service's own directories. */
export const isServiceSource = (file: string, repoDir: string): boolean => {
  const path = file.replace(/\\/g, '/');
  if (path.includes('/node_modules/')) return false;
  return serviceSourceDirs(repoDir).some((dir) => path.startsWith(`${dir}/`));
};
