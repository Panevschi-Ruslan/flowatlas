import { readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { extentDeclared, serviceExtent, workspaceMemberDirs, workspaceRootsAbove } from '../workspace.js';
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

// ------------------------------------------------------------- below the root

/** Directories that hold no manifest of the repository's own. */
const NOT_THE_REPOSITORYS = new Set(['node_modules', 'dist', 'build', 'coverage', 'tmp']);

/** How deep below the root a manifest is looked for, and how many directories at most. */
const DEEPEST = 4;
const MOST_DIRECTORIES = 2000;

/**
 * Every manifest inside a directory other than its own, nearest first.
 *
 * A repository of functions is one program with a manifest per function: each
 * function's directory declares the clients that function uses and the root
 * declares none of them, or has no manifest at all. That is not a workspace -
 * nothing at the root lists the directories - so the chain above never reads
 * them, and a reader that asks only the root is switched off on exactly the
 * repositories written this way.
 *
 * This is offered to the adapter that needs it rather than folded into what
 * every adapter is asked, and on purpose: in a repository that is not written
 * this way, a manifest below the root is as often an example, a fixture or a
 * tool's own package, and widening every adapter's answer with it would make
 * a service look like everything its repository happens to keep. An adapter
 * that asks has decided its own package is evidence wherever it is declared.
 *
 * Hidden directories and the ones that hold installed or built output are not
 * walked, and the walk is bounded in depth and in size, so a repository that is
 * mostly something else costs little.
 */
export const manifestsWithin = (dir: string): PackageJson[] => {
  const found: PackageJson[] = [];
  let level = [dir];
  let visited = 0;
  for (let depth = 0; depth < DEEPEST && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const parent of level) {
      let entries: Dirent[];
      try {
        entries = readdirSync(parent, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || NOT_THE_REPOSITORYS.has(entry.name)) continue;
        visited += 1;
        if (visited > MOST_DIRECTORIES) return found;
        const child = join(parent, entry.name);
        const manifest = readPackageJson(child);
        if (manifest !== undefined) found.push(manifest);
        next.push(child);
      }
    }
    level = next;
  }
  return found;
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
 * see. `serviceExtent` is the one answer to "what is read as part of this",
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
  const around = [...above, ...workspaceMemberDirs(dir)]
    .map(readPackageJson)
    .filter((pkg): pkg is PackageJson => pkg !== undefined);
  if (!sideways) return around;
  // A member is read the way the extent reads it, and by the same function: what
  // it declares only for its own build and tests is never installed for the
  // service, so it can no more switch an adapter on here than take a package
  // into the extent there (R143, R145). The service's own manifest is not in
  // this list; it is folded in last, whole, by the caller.
  const members = serviceExtent(dir)
    .filter((pkg) => pkg.role === 'member')
    .map((pkg) => extentDeclared(readPackageJson(pkg.dir), 'member'));
  return [...around, ...members];
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

// ------------------------------------------------------------ what a file runs

/**
 * Which files of a service a framework is supplied to (R145).
 *
 * Detection answers whether a framework is anywhere in what a service can
 * import, and on a server whose library renders e-mail with a browser framework
 * the answer is yes. That is true and it is not enough to read by: a reader
 * handed the whole service then reads a request made from a request handler as
 * one made from a page, and a provider written for somebody else's application
 * as one of this service's components. What decides it is a fact about the
 * package a file is in, which the manifests already state: **a file is read as
 * the framework's code when the framework is supplied to the package that holds
 * it.** Three ways a package is supplied, one rule:
 *
 * - **The service supplies it**, when the service's own manifest or its
 *   workspace declares the framework - the list `readResolvedPackageJson` gives
 *   with `sideways: false`, the one R123 already uses to tell a service's own
 *   frameworks from those found at arm's length. Then every file the service
 *   reads is supplied: an application bundles what it reaches, and a helper in a
 *   member it depends on runs in the same page as the screen that calls it.
 * - **A member supplies it to itself**, when the framework is in a section the
 *   extent follows for a member (`EXTENT_SECTIONS`) and that is not a peer. It
 *   supplies nothing to what it depends on in turn: a template library that
 *   calls a transport package does not make the transport a page.
 * - **A peer is supplied by whoever depends on the package.** That is what a
 *   peer dependency says: the package works with the framework that its
 *   dependent brings. So a member whose framework is only a peer is supplied
 *   when a package of the extent that declares it is supplied, and not when the
 *   one depending on it is a server that brings none.
 *
 * A devDependency supplies nothing, for the reason the extent gives: it is never
 * installed for anybody who depends on the member. The owner of a file is the
 * nearest package of the extent that contains it, so a member nested inside the
 * service's directory answers for its own files.
 *
 * A directory with no manifest of its own is not divided at all, because there is
 * no package to ask: every file is read, as it always was.
 *
 * `declares` is the adapter's own detection, asked of a manifest cut down to the
 * sections in question, so the framework is described once, by its adapter, and
 * nothing here names it.
 */
export const suppliedWith = (
  dir: string,
  declares: (pkg: PackageJson) => boolean,
): ((file: string) => boolean) => {
  // A directory with no manifest of its own has no packages to tell apart: the
  // reader was chosen for it by configuration rather than by what it declares,
  // and it reads what it was pointed at.
  const narrow = readResolvedPackageJson(dir, { sideways: false });
  if (narrow === undefined || declares(narrow)) return () => true;

  const extent = serviceExtent(dir);
  const manifests = new Map(extent.map((pkg) => [pkg.dir, readPackageJson(pkg.dir)]));
  const brings = (at: string): boolean => {
    const own = { ...extentDeclared(manifests.get(at), 'member') };
    delete own.peerDependencies;
    return declares(own);
  };
  const expects = (at: string): boolean => {
    const peers = extentDeclared(manifests.get(at), 'member').peerDependencies;
    return peers !== undefined && declares({ peerDependencies: peers });
  };

  const supplied = new Set(
    extent.filter((pkg) => pkg.role === 'member' && brings(pkg.dir)).map((pkg) => pkg.dir),
  );
  // A peer is satisfied by a dependent that is itself supplied, and a package
  // supplied that way can satisfy a peer of its own in turn, so this runs until
  // nothing more is supplied.
  for (let grew = true; grew; ) {
    grew = false;
    for (const pkg of extent) {
      if (pkg.role !== 'member' || supplied.has(pkg.dir) || !expects(pkg.dir)) continue;
      if (extent.some((other) => supplied.has(other.dir) && other.declares.includes(pkg.dir))) {
        supplied.add(pkg.dir);
        grew = true;
      }
    }
  }

  const nearestFirst = extent.map((pkg) => pkg.dir).sort((a, b) => b.length - a.length);
  return (file) => {
    const path = file.replace(/\\/g, '/');
    const owner = nearestFirst.find((at) => path.startsWith(`${at}/`));
    return owner !== undefined && supplied.has(owner);
  };
};
