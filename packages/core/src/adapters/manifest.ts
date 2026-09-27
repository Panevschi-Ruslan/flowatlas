import { serviceSourceDirs, workspaceMemberDirs, workspaceRootsAbove } from '../workspace.js';
import { readPackageJson, type PackageJson } from '../package-json.js';

/**
 * Manifests, and the two different questions asked of them.
 *
 * *What does this package say it is* is answered by its own manifest and by
 * nothing else: its name, and the framework it is built on. That is
 * `readPackageJson`, which lives one level down with the file format it reads.
 *
 * *What can the code in this directory import* is a wider question, because a
 * package inside a workspace can import what the workspace declared. That is
 * `readResolvedPackageJson`, and it is the one adapter detection asks: every
 * adapter gates on it, so it is answered once, here, and no adapter has to know
 * that a repository might be a package inside a larger tree.
 *
 * Keeping them apart matters in both directions. Asking the narrow question
 * where the wide one belongs switches every adapter off on a workspace member
 * whose leaf manifest is a name and a version. Asking the wide one where the
 * narrow belongs makes a server package look like whatever framework the
 * monorepo around it happens to have in its tooling.
 *
 * Which directories are in the workspace is not decided here. It is one question
 * with one answer for the whole tool and `../workspace.js` holds it; this module
 * asks it and does the widening, which is the part that is about dependencies
 * rather than about layout (R115).
 */

export { readPackageJson } from '../package-json.js';
export type { PackageJson } from '../package-json.js';

/**
 * The sections a declaration can sit in, as one list.
 *
 * Which section a name is in says how the package manager should install it and
 * nothing about whether the code imports it, so every reader below walks the
 * same list rather than naming the four sections again.
 */
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

/** Every declared dependency, regardless of which section it sits in. */
export const allDependencies = (pkg: PackageJson): Record<string, string> => {
  const declared: Record<string, string> = {};
  for (const section of DEPENDENCY_SECTIONS) Object.assign(declared, pkg[section]);
  return declared;
};

export const hasDependency = (pkg: PackageJson, name: string): boolean =>
  Object.hasOwn(allDependencies(pkg), name);

/** True when any of the names is a declared dependency. */
export const hasAnyDependency = (pkg: PackageJson, names: readonly string[]): boolean => {
  const deps = allDependencies(pkg);
  return names.some((name) => Object.hasOwn(deps, name));
};

// ------------------------------------------------------------------ the chain

/**
 * Every manifest that governs what the code in a directory may import, nearest
 * to the directory last.
 *
 * Two directions, one fact: a dependency declared anywhere in the workspace a
 * directory belongs to is a dependency the code being read can use.
 *
 * Upwards, because a package inside a workspace resolves what the root declared:
 * a leaf manifest that is a name, a version and an exports map is the normal
 * shape of a workspace member, not the shape of a package that depends on
 * nothing, and reading only that leaf is how a repository with hundreds of
 * routes and a hundred tables comes back empty.
 *
 * Downwards, because when the directory handed to this tool is itself a
 * workspace root, the source files of its members are inside it and are read as
 * part of it. What they declare is therefore part of what this read depends on -
 * a monorepo root whose own manifest carries nothing but tooling is otherwise
 * read as a repository with no framework in it at all.
 *
 * And sideways, which is the same sentence and was the missing third of it. A
 * service's extent is no longer its own directory: since R96 it is its own
 * directory plus every workspace member it declares, transitively, and the
 * source files of those members are read and walked exactly like its own. So a
 * library declared by one of them is a library whose calls are in this graph,
 * and an adapter that gated on the narrow manifest was switched off while its
 * own framework's code was being read - which is how three quarters of one real
 * repository's ways in came to be served by a package the detection could not
 * see. `serviceSourceDirs` is the one answer to "what is read as part of this",
 * and this asks it rather than compiling a second set of globs: that seam is the
 * one R115 closed, and reopening it here would be reopening it.
 *
 * It is narrower than taking the whole workspace, and deliberately: a monorepo
 * has hundreds of members and a service declares a dozen. What a member nobody
 * here depends on installs is not something this code can import, and folding it
 * in would make every service in a large repository look like every framework
 * anybody in it uses.
 */
const manifestChain = (dir: string, sideways: boolean): readonly PackageJson[] => {
  const above = [...workspaceRootsAbove(dir)].reverse();
  return [...above, ...workspaceMemberDirs(dir), ...(sideways ? serviceSourceDirs(dir) : [])]
    .map(readPackageJson)
    .filter((pkg): pkg is PackageJson => pkg !== undefined);
};

/**
 * The same manifest, with its dependency sections widened to everything the
 * workspace around the directory declares.
 *
 * The directory's own declaration wins, so a version pinned here still reads as
 * pinned here, and everything else about the manifest - the name above all -
 * belongs to this package alone and is left as it was.
 *
 * A directory with no manifest of its own still returns nothing, rather than the
 * workspace's dependencies under no name: callers use that to mean there is no
 * package here, which is a different question and still has the same answer.
 *
 * `sideways: false` leaves out the members the service reaches, and answers
 * what the workspace above and below the directory declares and nothing more.
 * Detection never asks that: it is how `build` tells which adapters were found
 * only through a sibling, so it can say so (R123). On the eight measured
 * targets that difference is where both the gains and the misreadings of the
 * sideways rule are - a service's procedures found in the package that declares
 * them, but also a browser framework switched on for a server because a library
 * it depends on renders e-mail with it - and it is the one list that tells a
 * reader which of a service's frameworks are its own.
 */
export const readResolvedPackageJson = (
  dir: string,
  { sideways = true }: { sideways?: boolean } = {},
): PackageJson | undefined => {
  const own = readPackageJson(dir);
  if (own === undefined) return undefined;
  const chain = manifestChain(dir, sideways);
  if (chain.length === 0) return own;
  const widened: Partial<Record<DependencySection, Record<string, string>>> = {};
  for (const section of DEPENDENCY_SECTIONS) {
    const merged: Record<string, string> = {};
    for (const pkg of chain) Object.assign(merged, pkg[section]);
    Object.assign(merged, own[section]);
    if (Object.keys(merged).length > 0) widened[section] = merged;
  }
  return { ...own, ...widened };
};
