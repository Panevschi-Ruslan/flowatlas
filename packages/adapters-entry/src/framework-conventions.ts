import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  ConfigPath,
  NotLiteral,
  configValueAt,
  hasDependency,
  implicitSourcesOf,
  isWithinDir,
  readConfigLiteral,
  scriptFilesIn,
  toPosixPath,
  workspaceGlobs,
  workspacePackages,
  workspaceRootsAbove,
  type ConfigLiteral,
  type ConventionsOf,
  type ImplicitImports,
  type ImplicitImportSource,
  type PackageJson,
  type ProjectConventions,
  type Unresolved,
} from '@flowatlas/core';

/**
 * What Nuxt and SvelteKit write for the compiler before anything is built
 * (P240), stated for a clone that has not run them.
 *
 * Both frameworks resolve imports through aliases of their own - Nuxt's `~`,
 * `@`, `~~`, `@@` and `#shared`, SvelteKit's `$lib` and `kit.alias` - and
 * name them for the compiler in a tsconfig they generate on `nuxi prepare` /
 * `svelte-kit sync` into `.nuxt/` / `.svelte-kit/`, which no repository
 * commits. Nuxt also imports some names for a file that uses them without an
 * import line: what `composables/` and `utils/` export, a store of
 * `@pinia/nuxt`'s `stores/`, and on the server what `server/utils/` exports.
 *
 * Each is read here as each framework documents it, from what the
 * configuration file says in literals (`srcDir`, `alias`, `imports.dirs`,
 * `kit.files.lib`, `kit.alias`) and the directory layout of the version
 * declared. A setting written as code is a row naming it, and the default is
 * read in its place.
 *
 * A Nuxt application is also every layer it is built with (P243): each
 * directory of `layers/` and each `extends` entry the repository holds, with
 * the layers those extend in turn. Their pages, routes, composables and
 * aliases are the application's, ranked as Nuxt ranks them; a layer fetched
 * from elsewhere, or named in code, is a row.
 */

const NUXT_CONFIGS = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.mts', 'nuxt.config.cjs'];
const SVELTE_CONFIGS = ['svelte.config.js', 'svelte.config.mjs', 'svelte.config.ts', 'svelte.config.cjs'];

/** A repo-relative directory below another, `''` being the root. */
const under = (dir: string, sub: string): string => (dir === '' ? sub : `${dir}/${sub}`);

/** A path as the conventions write it: repo-relative and POSIX, `''` for the root, `undefined` outside it. */
const repoRelative = (repoDir: string, path: string): string | undefined => {
  const rel = toPosixPath(relative(repoDir, resolve(repoDir, path)));
  return rel.startsWith('..') ? undefined : rel;
};

/** An absolute path as the graph names a file: relative to the repository, climbing out with `..` where it is outside. */
const fromRepo = (repoDir: string, path: string): string => toPosixPath(relative(repoDir, path));

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** A row about a setting the framework's configuration writes as code. */
const settingRow = (file: string, adapter: string, by: string, key: string, assumed: string): Unresolved => ({
  file,
  line: 1,
  reason: 'framework-setting-dynamic',
  symbol: key,
  message: `${key} in ${file} is not written as a literal, so ${by}'s default is read in its place: ${assumed}`,
  hint: `Write ${key} as a literal, or name what it sets in the tsconfig's paths.`,
  adapter,
  meta: { cause: 'framework-setting-dynamic', key },
});

/** `use-orders` and `useOrders` as the one name a framework gives a default export. */
const camelCase = (name: string): string =>
  name
    .split(/[-_.\s]+/)
    .filter((part) => part !== '')
    .map((part, index) => (index === 0 ? part.charAt(0).toLowerCase() + part.slice(1) : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');

/** The name a default export is imported by: its file's, or its folder's for an `index`. */
const defaultNameOf = (file: string): string | undefined => {
  const parts = file.replace(/\.[cm]?[jt]sx?$/, '').split('/');
  const base = parts[parts.length - 1] === 'index' ? parts[parts.length - 2] : parts[parts.length - 1];
  const name = base === undefined ? '' : camelCase(base);
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : undefined;
};

/** A directory a list of scanned directories names, and whether below it is scanned too: `stores`, `composables/**`. */
const scannedDir = (entry: string): { dir: string; nested: boolean } => {
  const glob = entry.search(/[*?{[]/);
  const dir = (glob === -1 ? entry : entry.slice(0, glob)).replace(/\/+$/, '');
  return { dir, nested: entry.includes('**') };
};

/** A list in a sentence: `a`, `a and b`, `a, b and c`. */
const inWords = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// ---------------------------------------------------------------------------
// Nuxt

/** Where a Nuxt application, or one of its layers, keeps its code, as its version and configuration say. */
export interface NuxtLayout {
  /** The code, repo-relative; `''` is the root, `../ui-layer` a layer beside it. */
  readonly srcDir: string;
  /** The server's code, repo-relative. */
  readonly serverDir: string;
  /** 4 for the `app/` layout, 3 for the one before it: the application's, for each of its layers too. */
  readonly version: 3 | 4;
  readonly config: ConfigLiteral | undefined;
  /** Repo-relative path of the configuration, or `package.json` without one. */
  readonly configFile: string;
  /** Settings written as code, as rows. */
  readonly rows: readonly Unresolved[];
}

const NUXT_ADAPTER = 'nitro-routes';

/** The major version a dependency range starts at, or undefined when it names none. */
const majorOf = (range: string | undefined): number | undefined => {
  const found = range === undefined ? null : /(\d+)/.exec(range.replace(/^(?:npm:[^@]+@)/, ''));
  return found === null ? undefined : Number(found[1]);
};

const rangeOf = (pkg: PackageJson, name: string): string | undefined =>
  [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]
    .map((section) => section?.[name])
    .find((range): range is string => typeof range === 'string');

/**
 * A directory a setting of the configuration in `dir` names, repo-relative, or
 * undefined when it names none the reader can place inside that directory.
 */
const settingDir = (repoDir: string, dir: string, value: unknown): string | undefined => {
  const path = value instanceof ConfigPath ? value.path : typeof value === 'string' ? resolve(dir, value) : undefined;
  if (path === undefined || !isWithinDir(path, dir)) return undefined;
  return fromRepo(repoDir, path).replace(/\/+$/, '');
};

/** The configuration a Nuxt directory holds, and the path the rows name it by. */
const nuxtConfigAt = (repoDir: string, dir: string): { config: ConfigLiteral | undefined; configFile: string } => {
  const config = readConfigLiteral(dir, NUXT_CONFIGS);
  const at = fromRepo(repoDir, dir);
  return { config, configFile: config === undefined ? under(at, 'package.json') : fromRepo(repoDir, config.file) };
};

/** The layout of the version the application declares: 4 from `nuxt` 4 or `future.compatibilityVersion: 4`. */
const nuxtVersionOf = (pkg: PackageJson, config: ConfigLiteral | undefined): 3 | 4 => {
  const compatibility = configValueAt(config?.value, 'future.compatibilityVersion');
  return (typeof compatibility === 'number' && compatibility >= 4) || (majorOf(rangeOf(pkg, 'nuxt')) ?? 3) >= 4 ? 4 : 3;
};

/** Where the code of a Nuxt directory - the application or a layer - is, under the application's version. */
const layoutAt = (repoDir: string, dir: string, version: 3 | 4): NuxtLayout => {
  const { config, configFile } = nuxtConfigAt(repoDir, dir);
  const at = fromRepo(repoDir, dir);
  const value = config?.value;
  const rows: Unresolved[] = [];
  const fallbackSrc = version === 4 && isDirectory(join(dir, 'app')) ? under(at, 'app') : at;
  const writtenSrc = configValueAt(value, 'srcDir');
  if (writtenSrc instanceof NotLiteral) rows.push(settingRow(configFile, NUXT_ADAPTER, 'Nuxt', 'srcDir', `${fallbackSrc || 'the root'}`));
  const srcDir = settingDir(repoDir, dir, writtenSrc) ?? fallbackSrc;
  const fallbackServer = version === 4 ? under(at, 'server') : under(srcDir, 'server');
  const writtenServer = configValueAt(value, 'serverDir');
  if (writtenServer instanceof NotLiteral) rows.push(settingRow(configFile, NUXT_ADAPTER, 'Nuxt', 'serverDir', fallbackServer));
  const serverDir = settingDir(repoDir, dir, writtenServer) ?? fallbackServer;
  return { srcDir: srcDir === '.' ? '' : srcDir, serverDir, version, config, configFile, rows };
};

/**
 * Where a Nuxt application's code is (P240): `srcDir` when the configuration
 * writes one, else `app/` from version 4 on (or with
 * `future.compatibilityVersion: 4`) when that directory is there, else the
 * root. The server is beside `app/` from version 4, inside `srcDir` before.
 */
export const nuxtLayoutOf = (repoDir: string, pkg: PackageJson = {}): NuxtLayout =>
  layoutAt(repoDir, repoDir, nuxtVersionOf(pkg, readConfigLiteral(repoDir, NUXT_CONFIGS)));

/** One part of a Nuxt application (P243): the application itself, or a layer it is built with. */
export interface NuxtLayer {
  /** Absolute directory. */
  readonly dir: string;
  /** Repo-relative and POSIX: `''` for the application, `layers/base`, `../ui-layer`. */
  readonly at: string;
  /** As a row names it: `the application`, the directory of `layers/`, the entry `extends` writes. */
  readonly name: string;
  /** The layer that extends this one, by its `at`, when it is not the application. */
  readonly extendedBy?: string;
  readonly layout: NuxtLayout;
}

/** Every part of a Nuxt application, first to last as Nuxt ranks them, and what was not read. */
export interface NuxtLayers {
  /**
   * The application first; then each directory of its `layers/`, from Z to A;
   * then each `extends` entry, followed by the layers that one extends. An
   * earlier one wins a page, a route or a name a later one also gives.
   */
  readonly layers: readonly NuxtLayer[];
  /** A layer that is not read and why, and the settings of a layer written as code. */
  readonly rows: readonly Unresolved[];
}

/** Why a layer `extends` names is not read. */
type UnreadLayer = 'remote' | 'dynamic' | 'not-installed' | 'installed' | 'missing' | 'outside' | 'holds-application';

const UNREAD_LAYER: Readonly<Record<UnreadLayer, { message: (text: string, file: string) => string; hint: string }>> = {
  remote: {
    message: (text) => `${text} is a Nuxt layer the application downloads when it builds, so nothing of it is read: its pages, routes, composables and aliases are not in the graph`,
    hint: 'Check the layer out beside the application and extend it by its path, or read it as a service of its own.',
  },
  dynamic: {
    message: (text, file) => `the layers ${file} extends are written as code (${text}), so which they are is not known and nothing of them is read`,
    hint: 'Write `extends` as a list of literal paths or package names.',
  },
  'not-installed': {
    message: (text) => `${text} is a Nuxt layer from a package that is neither installed nor a package of the workspace, so nothing of it is read`,
    hint: 'Install the dependencies, or extend the layer by its path in the repository.',
  },
  installed: {
    message: (text) => `${text} is a Nuxt layer installed from a registry, whose code is no file of this repository, so nothing of it is read`,
    hint: "Nothing to do, or read the layer's own repository as a service of its own.",
  },
  missing: {
    message: (text) => `${text} names no directory, so no layer is read for it`,
    hint: 'Correct the path in `extends`.',
  },
  outside: {
    message: (text) => `${text} is outside the repository and its workspace, so nothing of it is read`,
    hint: 'Add the layer to the workspace, or read it as a service of its own.',
  },
  'holds-application': {
    message: (text) => `${text} is a directory the application is inside of, and is not read as a layer of it`,
    hint: 'Extend the layer by a path that names its own directory.',
  },
};

const unreadRow = (from: NuxtLayer, text: string, why: UnreadLayer): Unresolved => ({
  file: from.layout.configFile,
  line: 1,
  reason: 'framework-layer-unread',
  symbol: text,
  message: UNREAD_LAYER[why].message(text, from.layout.configFile),
  hint: UNREAD_LAYER[why].hint,
  adapter: NUXT_ADAPTER,
  meta: { cause: 'framework-layer-unread', layer: text, why },
});

/** A layer fetched when the application builds: a git host's shorthand or a URL. */
const REMOTE_LAYER = /^(?:github|gh|gitlab|bitbucket|sourcehut|git\+[a-z]+|git|https?):/i;

const realOf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** The directory holding `.git` at or above a directory, which is the repository the application is in. */
const repositoryTopOf = (dir: string): string | undefined => {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) return at;
    if (dirname(at) === at) return undefined;
  }
};

/** A package name and the path inside it an entry names: `@shop/base/layer` is `@shop/base` and `layer`. */
const packageOf = (specifier: string): { name: string; subpath: string } => {
  const parts = specifier.split('/');
  const width = specifier.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, width).join('/'), subpath: parts.slice(width).join('/') };
};

/**
 * The directory of a layer named as a package (P243): a package of the
 * workspace by that name, or what `node_modules` links it to when the link
 * leads out of every `node_modules` - a workspace package installed. One
 * installed from a registry is no code of the repository.
 */
const packageLayer = (root: string, from: string, specifier: string): { dir: string } | { why: UnreadLayer } => {
  const { name, subpath } = packageOf(specifier.replace(/^npm:/, ''));
  const workspaces = [...(workspaceGlobs(root).length > 0 ? [root] : []), ...workspaceRootsAbove(root)];
  for (const workspace of workspaces) {
    const member = workspacePackages(workspace).find((pkg) => pkg.name === name);
    if (member !== undefined) return { dir: join(member.dir, subpath) };
  }
  for (let at = from; ; at = dirname(at)) {
    const linked = join(at, 'node_modules', name);
    if (existsSync(linked)) {
      const real = toPosixPath(realOf(linked));
      return real.includes('/node_modules/') ? { why: 'installed' } : { dir: join(real, subpath) };
    }
    if (dirname(at) === at) return { why: 'not-installed' };
  }
};

/** The directory one `extends` entry names, or why it is not read. */
const placeLayer = (
  root: string,
  from: NuxtLayer,
  entry: unknown,
  bounds: readonly string[],
): { dir: string; name: string } | { text: string; why: UnreadLayer } => {
  if (entry instanceof NotLiteral) return { text: entry.text, why: 'dynamic' };
  if (!(entry instanceof ConfigPath) && typeof entry !== 'string') return { text: JSON.stringify(entry) ?? String(entry), why: 'dynamic' };
  const text = entry instanceof ConfigPath ? fromRepo(root, entry.path) : entry;
  if (typeof entry === 'string' && REMOTE_LAYER.test(entry)) return { text, why: 'remote' };
  let dir: string;
  // A path is absolute as the OS spells one, so a drive letter on Windows is a path, not a package name.
  if (entry instanceof ConfigPath || entry.startsWith('.') || isAbsolute(entry)) {
    dir = entry instanceof ConfigPath ? entry.path : resolve(from.dir, entry);
  } else {
    const placed = packageLayer(root, from.dir, entry);
    if ('why' in placed) return { text, why: placed.why };
    dir = placed.dir;
  }
  // A layer written as its configuration file is the directory holding it.
  if (!isDirectory(dir)) dir = existsSync(dir) || NUXT_CONFIGS.some((name) => existsSync(`${dir}${extname(name)}`)) ? dirname(dir) : '';
  if (dir === '') return { text, why: 'missing' };
  if (toPosixPath(dir).includes('/node_modules/')) return { text, why: 'installed' };
  if (isWithinDir(root, dir) && resolve(dir) !== resolve(root)) return { text, why: 'holds-application' };
  if (!bounds.some((bound) => isWithinDir(dir, bound))) return { text, why: 'outside' };
  return { dir: resolve(dir), name: text };
};

/** The directories of `layers/`, as Nuxt ranks them: a later name above an earlier one. */
const localLayerNames = (root: string): string[] => {
  try {
    return readdirSync(join(root, 'layers'))
      .filter((entry) => !entry.startsWith('.') && isDirectory(join(root, 'layers', entry)))
      .sort()
      .reverse();
  } catch {
    return [];
  }
};

/**
 * Every part of a Nuxt application, ranked as Nuxt ranks them (P243).
 *
 * The application first; then the directories of its `layers/`, which Nuxt
 * registers by themselves from 3.12 and ranks from Z to A; then its `extends`
 * entries in the order written, each followed by the layers it extends in
 * turn, as the configuration loader flattens them. A layer is local when its
 * directory is in the repository or the workspace the application is in -
 * written as a path, or as a package the workspace has - and every one of
 * those is read under the application's version; a layer read once is not read
 * again, so a cycle ends where it started.
 */
export const nuxtLayersOf = (repoDir: string, pkg: PackageJson = {}): NuxtLayers => {
  const root = resolve(repoDir);
  const app = nuxtLayoutOf(root, pkg);
  const application: NuxtLayer = { dir: root, at: '', name: 'the application', layout: app };
  const layers: NuxtLayer[] = [application];
  const rows: Unresolved[] = [];
  const seen = new Set<string>([realOf(root)]);
  const top = repositoryTopOf(root);
  const bounds = [root, ...workspaceRootsAbove(root), ...(top === undefined ? [] : [top])];

  const follow = (layer: NuxtLayer): void => {
    const written = configValueAt(layer.layout.config?.value, 'extends');
    if (written === undefined) return;
    if (written instanceof NotLiteral) {
      rows.push(unreadRow(layer, written.text, 'dynamic'));
      return;
    }
    for (const entry of Array.isArray(written) ? written : [written]) {
      // `['./theme', { meta }]`: the layer and its options.
      const placed = placeLayer(root, layer, Array.isArray(entry) ? entry[0] : entry, bounds);
      if ('why' in placed) rows.push(unreadRow(layer, placed.text, placed.why));
      else take(placed.dir, placed.name, layer);
    }
  };
  const take = (dir: string, name: string, by: NuxtLayer): void => {
    const real = realOf(dir);
    if (seen.has(real)) return;
    seen.add(real);
    const layout = layoutAt(root, dir, app.version);
    const layer: NuxtLayer = { dir, at: fromRepo(root, dir), name, ...(by === application ? {} : { extendedBy: by.at }), layout };
    layers.push(layer);
    rows.push(...layout.rows);
    follow(layer);
  };

  for (const name of localLayerNames(root)) take(join(root, 'layers', name), `layers/${name}`, application);
  follow(application);
  return { layers, rows };
};

/** The part of the application a repo-relative file is in: the layer whose directory holds it most nearly. */
export const nuxtLayerOf = (layers: readonly NuxtLayer[], file: string): NuxtLayer | undefined =>
  layers
    .filter((layer) => layer.at === '' || file === layer.at || file.startsWith(`${layer.at}/`))
    .reduce<NuxtLayer | undefined>((best, layer) => (best === undefined || layer.at.length > best.at.length ? layer : best), undefined);

/** A repo-relative path as its layer names it. */
export const withinLayer = (layer: NuxtLayer, path: string): string =>
  layer.at === '' ? path : path === layer.at ? '' : path.startsWith(`${layer.at}/`) ? path.slice(layer.at.length + 1) : path;

/** A page or a route one part of the application gives, by the key two parts would give it under. */
export interface LayerClaim {
  readonly key: string;
  /** As a row says it: `/orders`, `GET /api/orders`. */
  readonly label: string;
  /** Repo-relative file that gives it. */
  readonly file: string;
  /** The part it is in; none for Nitro on its own. */
  readonly layer: NuxtLayer | undefined;
  /** Where that part is ranked, the application `0`. */
  readonly rank: number;
}

const partName = (layer: NuxtLayer | undefined): string => (layer === undefined || layer.at === '' ? 'the application' : layer.at);

/**
 * The claims the application keeps (P243): of the parts that give one key,
 * every claim of the one Nuxt ranks first. Each claim of a part below it is
 * left out, and said as a note naming the file that wins; two files of one
 * part giving one key are both kept, as they were before layers were read.
 */
export const keptByLayer = <T extends LayerClaim>(claims: readonly T[], does: 'shows' | 'serves'): { kept: T[]; rows: Unresolved[] } => {
  const best = new Map<string, T>();
  for (const claim of claims) {
    const before = best.get(claim.key);
    if (before === undefined || claim.rank < before.rank) best.set(claim.key, claim);
  }
  const kept: T[] = [];
  const rows: Unresolved[] = [];
  for (const claim of claims) {
    const winner = best.get(claim.key) as T;
    if (claim.rank === winner.rank) {
      kept.push(claim);
      continue;
    }
    rows.push({
      file: claim.file,
      line: 1,
      reason: 'framework-layer-overridden',
      level: 'info',
      symbol: claim.label,
      message: `${claim.file} ${does === 'shows' ? 'would be shown at' : 'would serve'} ${claim.label}, and Nuxt ${does} ${winner.file} there instead: ${partName(winner.layer)} ranks above ${partName(claim.layer)} among its layers`,
      hint: `Nothing to do. Rename or remove the ${does === 'shows' ? 'page' : 'route'} of the lower layer to have it ${does === 'shows' ? 'shown' : 'served'}.`,
      adapter: NUXT_ADAPTER,
      meta: { cause: 'framework-layer-overridden', key: claim.label, chosen: winner.file, layer: claim.layer?.at ?? '' },
    });
  }
  return { kept, rows };
};

/** What one of Nuxt's own aliases, or a path written with one, names: repo-relative. */
const throughNuxtAlias = (layout: NuxtLayout, path: string): string | undefined => {
  const match = /^(~~|@@|~|@)(?:\/(.*))?$/.exec(path);
  if (match === null) return undefined;
  const base = match[1] === '~~' || match[1] === '@@' ? '' : layout.srcDir;
  return match[2] === undefined || match[2] === '' ? base || '.' : under(base, match[2]);
};

/** A `paths` entry for an alias to a target: the key itself, and its `/*` too when the target is a directory. */
const aliasEntries = (repoDir: string, key: string, target: string): Array<[string, string[]]> => {
  if (key.endsWith('/*')) return [[key, [target.endsWith('/*') ? target : `${target}/*`]]];
  const plain = target.replace(/\/\*$/, '');
  const directory = isDirectory(join(repoDir, plain)) || (!existsSync(join(repoDir, plain)) && extname(plain) === '');
  return directory ? [[key, [plain]], [`${key}/*`, [`${plain}/*`]]] : [[key, [plain]]];
};

/**
 * The aliases `alias` adds in one configuration, as `paths`, and a row for
 * each written as code. A path built from the configuration's own file is
 * that file's; one written with `~` or `@`, or as a plain relative path, is
 * the application's, in a layer too, as Nuxt resolves every alias against
 * the application it builds.
 */
const nuxtWrittenAliases = (repoDir: string, app: NuxtLayout, layout: NuxtLayout, rows: Unresolved[]): Record<string, string[]> => {
  const written = configValueAt(layout.config?.value, 'alias');
  if (written instanceof NotLiteral) {
    rows.push(settingRow(layout.configFile, NUXT_ADAPTER, 'Nuxt', 'alias', 'no alias of its own'));
    return {};
  }
  if (typeof written !== 'object' || written === null || Array.isArray(written)) return {};
  const paths: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(written as Record<string, unknown>)) {
    const target =
      value instanceof ConfigPath
        ? fromRepo(repoDir, value.path)
        : typeof value === 'string'
          ? (throughNuxtAlias(app, value) ?? repoRelative(repoDir, value.replace(/^\.\//, '')))
          : undefined;
    if (target === undefined) {
      if (value instanceof NotLiteral) rows.push(settingRow(layout.configFile, NUXT_ADAPTER, 'Nuxt', `alias['${key}']`, 'nothing for it'));
      continue;
    }
    for (const [name, targets] of aliasEntries(repoDir, key, target || '.')) paths[name] = targets;
  }
  return paths;
};

/** Whether a configuration's `modules` names a module, alone or with its options. */
const hasModule = (value: unknown, name: string): boolean => {
  const modules = configValueAt(value, 'modules');
  return Array.isArray(modules) && modules.some((entry) => entry === name || (Array.isArray(entry) && entry[0] === name));
};

/** A setting as the merged configuration has it: the first part of the application that writes it (P243). */
const mergedSetting = (layers: readonly NuxtLayer[], key: string): unknown => {
  for (const layer of layers) {
    const value = configValueAt(layer.layout.config?.value, key);
    if (value !== undefined) return value;
  }
  return undefined;
};

/** One scanned directory, repo-relative, whether below it is scanned too, and the rank of the part it is in. */
interface ScannedDir {
  readonly dir: string;
  readonly nested: boolean;
  readonly rank: number;
}

/** Directories as a scanned list writes them, each repo-relative and whether it is scanned below. */
const listedDirs = (
  repoDir: string,
  layout: NuxtLayout,
  key: string,
  base: string,
  rows: Unresolved[],
): Array<{ dir: string; nested: boolean }> => {
  const listed = configValueAt(layout.config?.value, key);
  if (listed instanceof NotLiteral) {
    rows.push(settingRow(layout.configFile, NUXT_ADAPTER, 'Nuxt', key, 'only the directories it scans by default'));
    return [];
  }
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((entry) => {
    if (entry instanceof ConfigPath) return [{ dir: fromRepo(repoDir, entry.path), nested: false }];
    if (typeof entry !== 'string') {
      if (entry instanceof NotLiteral) rows.push(settingRow(layout.configFile, NUXT_ADAPTER, 'Nuxt', key, 'only the directories it scans by default'));
      return [];
    }
    const { dir, nested } = scannedDir(entry);
    const placed = throughNuxtAlias(layout, dir) ?? under(base, dir.replace(/^\.\//, ''));
    return [{ dir: placed === '.' ? '' : placed, nested }];
  });
};

/**
 * One group of names used unimported, from the script files of its
 * directories, each file ranked by the part of the application it is in. A
 * file two directories name is the first one's.
 */
const groupOf = (repoDir: string, label: string, within: string[], except: string[], dirs: readonly ScannedDir[]): ImplicitImports => {
  const ranked = new Map<string, number>();
  for (const { dir, nested, rank } of dirs) {
    for (const file of scriptFilesIn(repoDir, dir, nested)) if (!ranked.has(file)) ranked.set(file, rank);
  }
  const sources: ImplicitImportSource[] = implicitSourcesOf(repoDir, [...ranked.keys()], defaultNameOf).map((source) => {
    const rank = ranked.get(source.file) ?? 0;
    return rank === 0 ? source : { ...source, rank };
  });
  return {
    label,
    within,
    except,
    // Only the directories that are there, for the row that names them.
    from: [...new Set(dirs.filter(({ dir }) => isDirectory(join(repoDir, dir))).map(({ dir }) => `${dir}/`))],
    sources,
  };
};

const LAYER_FILE = /\.(?:[cm]?[jt]sx?|vue)$/;

/** The script and component files of a layer, repo-relative: what it holds of the application's code. */
const layerFiles = (repoDir: string, layer: NuxtLayer): string[] => {
  const out: string[] = [];
  const walk = (at: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(at).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
      const path = join(at, entry);
      if (isDirectory(path)) {
        // A layer of its own inside this one is read as itself.
        if (entry === 'layers' && at === layer.dir) continue;
        walk(path);
      } else if (LAYER_FILE.test(entry) && !entry.endsWith('.d.ts')) out.push(fromRepo(repoDir, path));
    }
  };
  walk(layer.dir);
  return out;
};

/** An import specifier written with `~` or `@`, where it is in a file. */
const ROOT_ALIAS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([~@]\/[^'"\n]+)\1/g;

const RESOLVED_ENDINGS = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.vue', '/index.ts', '/index.js', '/index.vue'];

/** Whether a path names a file the way a module specifier does: as written, with an ending, or as a folder's index. */
const namesAFile = (path: string): boolean =>
  RESOLVED_ENDINGS.some((ending) => {
    try {
      return statSync(`${path}${ending}`).isFile();
    } catch {
      return false;
    }
  });

/**
 * An import a layer's file writes with `~` or `@` that resolves to nothing,
 * where its own code has the file (P243): Nuxt resolves both against the
 * application in every layer, so the import names the application's code and
 * not the layer's, and is not joined.
 */
const layerAliasRows = (repoDir: string, app: NuxtLayout, layer: NuxtLayer, files: readonly string[]): Unresolved[] => {
  const rows: Unresolved[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(repoDir, file), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(ROOT_ALIAS_IMPORT)) {
      const specifier = match[2] as string;
      const rest = specifier.slice(2);
      if (namesAFile(join(repoDir, app.srcDir, rest))) continue;
      const own = under(layer.layout.srcDir, rest);
      if (!namesAFile(join(repoDir, own))) continue;
      const line = text.slice(0, match.index).split('\n').length;
      const named = layer.name.startsWith('layers/') ? ` or through \`#${layer.name}/${withinLayer(layer, own)}\`` : '';
      rows.push({
        file,
        line,
        reason: 'framework-layer-alias',
        symbol: specifier,
        message: `${specifier} in ${file} names the application's code, as \`~\` and \`@\` do in every Nuxt layer, and the application has no such file; the layer's own ${own} is not what it resolves to, so the import is not joined`,
        hint: `Import it with a relative path${named}.`,
        adapter: NUXT_ADAPTER,
        meta: { cause: 'framework-layer-alias', layer: layer.at, specifier, layerFile: own },
      });
    }
  }
  return rows;
};

/** The note that says which layers were read as part of the application. */
const layersReadRow = (app: NuxtLayout, layers: readonly NuxtLayer[]): Unresolved => {
  const read = layers.slice(1);
  const named = read.map((layer) => {
    const where = layer.name === layer.at ? layer.at : `${layer.name} (${layer.at})`;
    return layer.extendedBy === undefined ? where : `${where}, extended by ${layer.extendedBy}`;
  });
  return {
    file: app.configFile,
    line: 1,
    reason: 'framework-layer-read',
    level: 'info',
    symbol: read[0]?.at ?? '',
    message: `${read.length} Nuxt layer${read.length === 1 ? ' is' : 's are'} read as part of the application, ranked after it as Nuxt ranks them: ${named.join('; ')}`,
    hint: "Nothing to do. A page, route or name the application and a layer both give is the higher one's, said as a row of its own.",
    adapter: NUXT_ADAPTER,
    meta: { cause: 'framework-layer-read', layers: read.map((layer) => layer.at) },
  };
};

/** Nuxt's conventions for one repository (P240, P243), or none where Nuxt is not declared. */
export const nuxtConventions: ConventionsOf = (repoDir, pkg): ProjectConventions | undefined => {
  if (!hasDependency(pkg, 'nuxt')) return undefined;
  const { layers, rows: layerRows } = nuxtLayersOf(repoDir, pkg);
  const [application] = layers as [NuxtLayer, ...NuxtLayer[]];
  const layout = application.layout;
  const rows: Unresolved[] = [...layout.rows, ...layerRows];
  const src = layout.srcDir || '.';
  const paths: Record<string, string[]> = {
    '~': [src],
    '~/*': [`${src}/*`],
    '@': [src],
    '@/*': [`${src}/*`],
    '~~': ['.'],
    '~~/*': ['./*'],
    '@@': ['.'],
    '@@/*': ['./*'],
    '#shared': ['shared'],
    '#shared/*': ['shared/*'],
    '#app': ['node_modules/nuxt/dist/app'],
    '#app/*': ['node_modules/nuxt/dist/app/*'],
    // A directory of `layers/` by its name (P243).
    ...Object.fromEntries(
      layers
        .filter((layer) => layer.name.startsWith('layers/'))
        .flatMap((layer) => [
          [`#${layer.name}`, [layer.at]],
          [`#${layer.name}/*`, [`${layer.at}/*`]],
        ]),
    ),
    ...nuxtWrittenAliases(repoDir, layout, layout, rows),
  };
  // A layer's own aliases are the application's too, under the ones it already has.
  for (const layer of layers.slice(1)) {
    for (const [key, targets] of Object.entries(nuxtWrittenAliases(repoDir, layout, layer.layout, rows))) {
      if (paths[key] === undefined) paths[key] = targets;
    }
  }

  const autoImport = mergedSetting(layers, 'imports.autoImport') !== false;
  const scan = mergedSetting(layers, 'imports.scan') !== false;
  const sharedOf = (layer: NuxtLayer, rank: number): ScannedDir[] =>
    layout.version === 4
      ? [
          { dir: under(layer.at, 'shared/utils'), nested: false, rank },
          { dir: under(layer.at, 'shared/types'), nested: false, rank },
        ]
      : [];
  // `@pinia/nuxt` scans `stores/` of each part unless `storesDirs` names others, from the root.
  const pinia = layers.some((layer) => hasModule(layer.layout.config?.value, '@pinia/nuxt'));
  const storesDirs = configValueAt(layout.config?.value, 'pinia.storesDirs');
  const storesOf = (layer: NuxtLayer, rank: number): ScannedDir[] =>
    !pinia
      ? []
      : storesDirs === undefined
        ? [{ dir: under(layer.layout.srcDir, 'stores'), nested: false, rank }]
        : rank === 0
          ? listedDirs(repoDir, layout, 'pinia.storesDirs', '', rows).map((dir) => ({ ...dir, rank }))
          : [];
  const serverDirs = layers.map((layer) => layer.layout.serverDir);
  const implicit: ImplicitImports[] =
    !autoImport || !scan
      ? []
      : [
          groupOf(
            repoDir,
            'the application',
            [''],
            [...serverDirs, 'node_modules', '.nuxt', '.output'],
            layers.flatMap((layer, rank) => [
              { dir: under(layer.layout.srcDir, 'composables'), nested: false, rank },
              { dir: under(layer.layout.srcDir, 'utils'), nested: false, rank },
              ...storesOf(layer, rank),
              ...listedDirs(repoDir, layer.layout, 'imports.dirs', layer.layout.srcDir, rows).map((dir) => ({ ...dir, rank })),
              ...sharedOf(layer, rank),
            ]),
          ),
          groupOf(
            repoDir,
            'the server',
            serverDirs,
            [],
            layers.flatMap((layer, rank) => [{ dir: under(layer.layout.serverDir, 'utils'), nested: false, rank }, ...sharedOf(layer, rank)]),
          ),
        ];
  for (const layer of layers) {
    if (configValueAt(layer.layout.config?.value, 'imports') instanceof NotLiteral) {
      rows.push(settingRow(layer.layout.configFile, NUXT_ADAPTER, 'Nuxt', 'imports', 'only the directories it scans by default'));
    }
  }

  // What each layer holds, for the imports it writes with `~` or `@`, and
  // for the build to see a change to a layer outside the repository's own files.
  const held = new Map(layers.slice(1).map((layer) => [layer, layerFiles(repoDir, layer)]));
  for (const [layer, files] of held) rows.push(...layerAliasRows(repoDir, layout, layer, files));
  if (layers.length > 1) rows.push(layersReadRow(layout, layers));
  const outside = layers.filter((layer) => layer.at.startsWith('..'));

  return {
    by: 'Nuxt',
    adapter: NUXT_ADAPTER,
    file: layout.configFile,
    generated: { tsconfigs: ['.nuxt/tsconfig.json', '.nuxt/tsconfig.app.json'], command: 'nuxi prepare' },
    paths,
    implicit,
    ...(implicit.length === 0 ? {} : { modules: [{ specifier: '#imports', implicit: 0 }] }),
    frameworkModules: ['#app', '#build', '#components', '#head', '#imports', '#internal', '#vue-router'].map((name) => ({ name, package: 'nuxt' })),
    rows,
    files: [
      ...new Set([
        ...layers.flatMap((layer) => (layer.layout.config === undefined ? [] : [layer.layout.configFile])),
        ...outside.flatMap((layer) => held.get(layer) ?? []),
      ]),
    ],
    ...(outside.length === 0 ? {} : { extent: outside.map((layer) => layer.dir) }),
    ...(layers.length === 1 ? {} : { precedence: `the order of Nuxt's layers: ${inWords(layers.map((layer) => (layer.at === '' ? 'the application' : layer.at)))}` }),
  };
};

// ---------------------------------------------------------------------------
// SvelteKit

const SVELTEKIT_ADAPTER = 'sveltekit-routes';

/** SvelteKit's conventions for one repository (P240), or none where SvelteKit is not declared. */
export const sveltekitConventions: ConventionsOf = (repoDir, pkg): ProjectConventions | undefined => {
  if (!hasDependency(pkg, '@sveltejs/kit')) return undefined;
  const config = readConfigLiteral(repoDir, SVELTE_CONFIGS);
  const configFile = config === undefined ? 'package.json' : (repoRelative(repoDir, config.file) ?? 'package.json');
  const rows: Unresolved[] = [];
  const writtenLib = configValueAt(config?.value, 'kit.files.lib');
  if (writtenLib instanceof NotLiteral) rows.push(settingRow(configFile, SVELTEKIT_ADAPTER, 'SvelteKit', 'kit.files.lib', 'src/lib'));
  const lib = settingDir(repoDir, repoDir, writtenLib) ?? 'src/lib';
  const paths: Record<string, string[]> = {};
  // Only where the directory is there, as `svelte-kit sync` writes it.
  if (isDirectory(join(repoDir, lib))) Object.assign(paths, { $lib: [lib], '$lib/*': [`${lib}/*`] });
  const written = configValueAt(config?.value, 'kit.alias');
  if (written instanceof NotLiteral) rows.push(settingRow(configFile, SVELTEKIT_ADAPTER, 'SvelteKit', 'kit.alias', 'no alias of its own'));
  else if (typeof written === 'object' && written !== null && !Array.isArray(written)) {
    for (const [key, value] of Object.entries(written as Record<string, unknown>)) {
      const target = value instanceof ConfigPath ? repoRelative(repoDir, value.path) : typeof value === 'string' ? repoRelative(repoDir, value.replace(/^\.\//, '')) : undefined;
      if (target === undefined) {
        if (value instanceof NotLiteral) rows.push(settingRow(configFile, SVELTEKIT_ADAPTER, 'SvelteKit', `kit.alias['${key}']`, 'nothing for it'));
        continue;
      }
      for (const [name, targets] of aliasEntries(repoDir, key, target || '.')) paths[name] = targets;
    }
  }
  return {
    by: 'SvelteKit',
    adapter: SVELTEKIT_ADAPTER,
    file: configFile,
    generated: { tsconfigs: ['.svelte-kit/tsconfig.json'], command: 'svelte-kit sync' },
    paths,
    frameworkModules: ['$app', '$env', '$service-worker'].map((name) => ({ name, package: '@sveltejs/kit' })),
    rows,
    files: config === undefined ? [] : [configFile],
  };
};
