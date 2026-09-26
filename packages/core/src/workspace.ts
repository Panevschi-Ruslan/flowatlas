import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readPackageJson, type PackageJson } from './adapters/context.js';

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
 * ## One discoverer, not two
 *
 * A sibling change widens a manifest's dependency sections along the same chain,
 * so that a member which declares nothing can still be asked what its code may
 * import. It needs the same three answers this module computes — which globs a
 * directory declares, which directories they match, and which workspace a
 * directory is a member of — and it was written at the same time as this, on
 * another branch, because neither could see the other. Whichever address the two
 * end up sharing, they must end up sharing one: two discoverers would agree
 * today and disagree the first time either was touched, and the disagreement
 * would show up as a service whose extent and whose type were read from
 * different lists of members. The discovery belongs here, below the adapters and
 * with nothing framework-shaped in it; what belongs beside the manifest reader is
 * the widening, which is a different question about the same files.
 */

/** A package of a workspace: the name others import it by, and where it is. */
export interface WorkspacePackage {
  readonly name: string;
  /** Absolute path of the directory holding its manifest. */
  readonly dir: string;
}

/** The file pnpm declares a workspace in, when the manifest does not. */
const PNPM_WORKSPACE = 'pnpm-workspace.yaml';

/** Directories a workspace glob never means, however wide the glob. */
const NEVER_A_PACKAGE = new Set(['node_modules', 'dist', 'build', 'coverage', 'tmp']);

/** How deep `**` is followed. Deeper than any workspace measured, and bounded. */
const DEEP_LIMIT = 6;

/**
 * The `packages:` list of a `pnpm-workspace.yaml`, read without a YAML parser.
 *
 * The whole of what is wanted from that file is one sequence of strings at the
 * top level, and a dependency that can parse anchors, block scalars and merge
 * keys buys nothing for it. What is read is exactly a `packages:` key followed
 * by `- item` lines; the first line that is neither ends the sequence, so the
 * rest of the file — and every other key in it — is not read at all and cannot
 * be misread.
 */
const pnpmWorkspaceGlobs = (file: string): string[] => {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const globs: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (/^packages\s*:/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    const item = /^\s+-\s*(.+?)\s*$/.exec(line);
    if (item === null) {
      // A blank line inside a sequence is still inside it; anything else is the
      // next key, and the sequence is over.
      if (line.trim() === '') continue;
      break;
    }
    globs.push(item[1]?.replace(/^['"]|['"]$/g, '') ?? '');
  }
  return globs.filter((glob) => glob !== '');
};

/** The `workspaces` field, in both spellings the field has. */
const manifestGlobs = (pkg: PackageJson | undefined): string[] => {
  const declared = (pkg as { workspaces?: unknown } | undefined)?.workspaces;
  if (Array.isArray(declared)) return declared.filter((glob): glob is string => typeof glob === 'string');
  const nested = (declared as { packages?: unknown } | undefined)?.packages;
  return Array.isArray(nested) ? nested.filter((glob): glob is string => typeof glob === 'string') : [];
};

/**
 * The globs a directory declares its workspace members with, in both files.
 *
 * Both, and joined rather than chosen between, because a repository that has
 * moved from one package manager to the other usually keeps both files for a
 * while and they are meant to say the same thing. An empty list means this
 * directory is not the root of a workspace.
 */
export const workspaceGlobs = (dir: string): readonly string[] => {
  const root = resolve(dir);
  const fromManifest = manifestGlobs(readPackageJson(root));
  const pnpm = join(root, PNPM_WORKSPACE);
  const fromPnpm = existsSync(pnpm) ? pnpmWorkspaceGlobs(pnpm) : [];
  return [...new Set([...fromManifest, ...fromPnpm])];
};

/** A workspace glob as a test against a member's path relative to the root. */
const globTest = (glob: string): RegExp => {
  const pattern = glob
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .split('/')
    .map((segment) =>
      segment === '**'
        ? '.*'
        : segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'),
    )
    .join('/');
  return new RegExp(`^${pattern}$`);
};

/** A glob, split into what it excludes and what it includes. */
const splitGlobs = (globs: readonly string[]) => ({
  include: globs.filter((glob) => !glob.startsWith('!')).map(globTest),
  exclude: globs.filter((glob) => glob.startsWith('!')).map((glob) => globTest(glob.slice(1))),
});

/** How many path segments a set of globs can reach, `**` counting as the limit. */
const depthOf = (globs: readonly string[]): number =>
  globs.reduce((deepest, glob) => {
    const segments = glob.replace(/^!/, '').split('/');
    const depth = segments.includes('**') ? DEEP_LIMIT : segments.length;
    return Math.max(deepest, depth);
  }, 1);

/**
 * Every directory under `root` that could be a member, to the depth the globs
 * can reach.
 *
 * Walked rather than expanded glob by glob, because one walk answers every glob
 * at once and the bound on it is the same either way. `node_modules` is not
 * entered: an installed copy of a workspace package is not the package.
 */
const candidateDirs = (root: string, limit: number): string[] => {
  const found: string[] = [];
  const walk = (relative: string, depth: number): void => {
    if (depth > limit) return;
    let entries;
    try {
      entries = readdirSync(join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || NEVER_A_PACKAGE.has(entry.name)) continue;
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      found.push(path);
      walk(path, depth + 1);
    }
  };
  walk('', 1);
  return found;
};

/** Answers already worked out, so a build asks the file system once per root. */
const packagesByRoot = new Map<string, readonly WorkspacePackage[]>();

/**
 * The packages of the workspace rooted at `root`, or none when it is not one.
 *
 * A directory the globs match but that holds no manifest is not a member: the
 * globs say where to look and the manifest is what makes a package.
 */
export const workspacePackages = (root: string): readonly WorkspacePackage[] => {
  const base = resolve(root);
  const cached = packagesByRoot.get(base);
  if (cached !== undefined) return cached;

  const globs = workspaceGlobs(base);
  const found: WorkspacePackage[] = [];
  if (globs.length > 0) {
    const { include, exclude } = splitGlobs(globs);
    for (const path of candidateDirs(base, depthOf(globs))) {
      if (!include.some((test) => test.test(path))) continue;
      if (exclude.some((test) => test.test(path))) continue;
      const dir = join(base, path);
      const pkg = readPackageJson(dir);
      const name = typeof pkg?.name === 'string' ? pkg.name : undefined;
      if (name === undefined) continue;
      found.push({ name, dir });
    }
  }
  packagesByRoot.set(base, found);
  return found;
};

/**
 * The workspace `dir` is a member of, when it is a member of one.
 *
 * The nearest ancestor that lists it, so a workspace nested inside another —
 * PeerTube's `client`, which declares members of its own — answers for its own
 * members and the outer one answers for the rest. A directory that is itself the
 * root of a workspace is not a member of it, which is what keeps a monorepo read
 * as a whole from acquiring an extent: its globs already cover everything under
 * it.
 */
export const workspaceRootOf = (dir: string): string | undefined => {
  const member = resolve(dir);
  let at = dirname(member);
  for (;;) {
    if (workspacePackages(at).some((pkg) => pkg.dir === member)) return at;
    const parent = dirname(at);
    if (parent === at) return undefined;
    at = parent;
  }
};

/** Answers already worked out, so every reader that asks pays for one walk. */
const dirsByService = new Map<string, readonly string[]>();

/**
 * The directories one service's code lives in: its own, then what it declares.
 *
 * The first entry is always the service's own directory, and it is the one every
 * path in its graph is relative to. The rest are the workspace packages its
 * manifest names, and the packages those name in turn, because a handler in
 * `packages/features` that calls `packages/lib` is one call and both ends of it
 * belong to the service that reaches them.
 *
 * Three things are left out on purpose. A package that is not a member of the
 * workspace is left to the module resolver, which is what installed packages are
 * for. A member that contains the service — a root that somehow depends on its
 * own child — is left out, because taking it in would quietly turn one service
 * into the whole repository. And a directory that is not a workspace member gets
 * nothing but itself, so pointing the tool at a bare directory, or at a monorepo
 * root, reads exactly what it read before.
 */
export const serviceSourceDirs = (repoDir: string): readonly string[] => {
  const own = resolve(repoDir);
  const cached = dirsByService.get(own);
  if (cached !== undefined) return cached;

  const root = workspaceRootOf(own);
  const dirs: string[] = [own];
  if (root !== undefined) {
    const byName = new Map(workspacePackages(root).map((pkg) => [pkg.name, pkg.dir]));
    const seen = new Set<string>([own]);
    const queue = [own];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      const pkg = readPackageJson(at);
      const declared = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
        ...pkg?.optionalDependencies,
      };
      for (const name of Object.keys(declared)) {
        const dir = byName.get(name);
        if (dir === undefined || seen.has(dir)) continue;
        // A package the service is inside of would bring the whole repository
        // with it, and the answer to "what is this service" would be "all of it".
        if (own === dir || own.startsWith(`${dir}/`)) continue;
        seen.add(dir);
        // Nested inside the service already: nothing to add, but its own
        // dependencies still belong to the service.
        if (!dir.startsWith(`${own}/`)) dirs.push(dir);
        queue.push(dir);
      }
    }
  }
  const answer = [dirs[0] as string, ...dirs.slice(1).sort()];
  dirsByService.set(own, answer);
  return answer;
};

/** Whether a file belongs to one of a service's own directories. */
export const isServiceSource = (file: string, repoDir: string): boolean => {
  const path = file.replace(/\\/g, '/');
  if (path.includes('/node_modules/')) return false;
  return serviceSourceDirs(repoDir).some((dir) => path.startsWith(`${dir}/`));
};
