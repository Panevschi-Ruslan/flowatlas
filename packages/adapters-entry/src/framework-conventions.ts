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
  workspaceRootsAbove,
  type ConfigLiteral,
  type ConventionsOf,
  type ImplicitImports,
  type ImplicitImportSource,
  type PackageJson,
  type ProjectConventions,
  type Unresolved,
} from '@flowatlas/core';
import { modulesInstalledRow, modulesReadRow, moduleDirsOf, nuxtModulesOf, nuxtPackageDir, type NuxtModules } from './nuxt-modules.js';

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
 *
 * And it is what its build still decides (P251): what the modules of the
 * repository add (`nuxt-modules.ts`), the directories `dir` moves in every
 * part, and the configuration as the production build reads it, with every
 * other environment's build compared to it. SvelteKit's routes are where
 * `kit.files.routes` puts them.
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

/**
 * The directories one part of a Nuxt application keeps by kind (P251), each
 * repo-relative: what `dir` writes, else Nuxt's default.
 */
export interface NuxtDirs {
  /** Its pages, under `srcDir`: `dir.pages`, else `pages`. */
  readonly pages: string;
  /** Its layouts, under `srcDir`: `dir.layouts`, else `layouts`. */
  readonly layouts: string;
  /** Its route middleware, under `srcDir`: `dir.middleware`, else `middleware`. */
  readonly middleware: string;
  /** What both halves share, under its root: `dir.shared`, else `shared`. */
  readonly shared: string;
  /** The modules Nuxt registers by itself: `dir.modules`, else `modules`, under its root from 4 and under `srcDir` before. */
  readonly modules: string;
}

/** The build a configuration is read for (P251): `production`, `development`, or a name `$env` writes. */
export type NuxtEnvironment = string;

/** Where a Nuxt application, or one of its layers, keeps its code, as its version and configuration say. */
export interface NuxtLayout {
  /** The code, repo-relative; `''` is the root, `../ui-layer` a layer beside it. */
  readonly srcDir: string;
  /** The server's code, repo-relative. */
  readonly serverDir: string;
  /** Its directories by kind (P251). */
  readonly dirs: NuxtDirs;
  /** 4 for the `app/` layout, 3 for the one before it: the application's, for each of its layers too. */
  readonly version: 3 | 4;
  /** The configuration as the build of {@link environment} reads it: its overrides merged in. */
  readonly config: ConfigLiteral | undefined;
  /** Repo-relative path of the configuration, or `package.json` without one. */
  readonly configFile: string;
  /** The build this layout was read for (P251). */
  readonly environment: NuxtEnvironment;
  /** Every build the configuration writes an override for (`$development`, `$production`, each of `$env`). */
  readonly environments: readonly NuxtEnvironment[];
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

/** The build Nuxt reads when nothing else is said, and the one the graph is of (P251). */
export const NUXT_PRODUCTION: NuxtEnvironment = 'production';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof ConfigPath) && !(value instanceof NotLiteral);

/**
 * One configuration value merged over another as `defu` merges them, which
 * is how an environment's overrides are laid over the rest: objects key by
 * key, two lists into one with the override's first, and anything else the
 * override's where it writes one.
 */
const mergedOver = (override: unknown, base: unknown): unknown => {
  if (override === undefined || override === null) return base;
  if (Array.isArray(override) && Array.isArray(base)) return [...override, ...base];
  if (isPlainObject(override) && isPlainObject(base)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) out[key] = mergedOver(value, base[key]);
    return out;
  }
  return override;
};

/** The builds a configuration writes overrides for: `$development`, `$production`, and each name of `$env`. */
const environmentsIn = (value: unknown): NuxtEnvironment[] => {
  if (!isPlainObject(value)) return [];
  const named = isPlainObject(value.$env) ? Object.keys(value.$env) : [];
  return [...new Set([...['development', 'production'].filter((name) => value[`$${name}`] !== undefined), ...named])];
};

/**
 * A configuration as the build of one environment reads it (P251): what
 * `$<environment>` and `$env.<environment>` write, laid over the rest, as the
 * configuration loader lays them. A override written as code is a row, and
 * the rest is read without it.
 */
const forEnvironment = (config: ConfigLiteral, configFile: string, environment: NuxtEnvironment, rows: Unresolved[]): ConfigLiteral => {
  const value = config.value;
  if (!isPlainObject(value)) return config;
  for (const key of ['$production', '$development', '$env']) {
    if (value[key] instanceof NotLiteral) rows.push(settingRow(configFile, NUXT_ADAPTER, 'Nuxt', key, 'the configuration without it'));
  }
  const own = value[`$${environment}`];
  const named = configValueAt(value, `$env.${environment}`);
  if (named instanceof NotLiteral) rows.push(settingRow(configFile, NUXT_ADAPTER, 'Nuxt', `$env.${environment}`, 'the configuration without it'));
  const override = { ...(isPlainObject(own) ? own : {}), ...(isPlainObject(named) ? named : {}) };
  return Object.keys(override).length === 0 ? config : { file: config.file, value: mergedOver(override, value) };
};

/** The configuration a Nuxt directory holds as one environment's build reads it, and the path the rows name it by. */
const nuxtConfigAt = (
  repoDir: string,
  dir: string,
  environment: NuxtEnvironment,
  rows: Unresolved[],
): { config: ConfigLiteral | undefined; configFile: string; environments: NuxtEnvironment[] } => {
  const written = readConfigLiteral(dir, NUXT_CONFIGS);
  const at = fromRepo(repoDir, dir);
  const configFile = written === undefined ? under(at, 'package.json') : fromRepo(repoDir, written.file);
  return {
    config: written === undefined ? undefined : forEnvironment(written, configFile, environment, rows),
    configFile,
    environments: environmentsIn(written?.value),
  };
};

/** The layout of the version the application declares: 4 from `nuxt` 4 or `future.compatibilityVersion: 4`. */
const nuxtVersionOf = (pkg: PackageJson, config: ConfigLiteral | undefined): 3 | 4 => {
  const compatibility = configValueAt(config?.value, 'future.compatibilityVersion');
  return (typeof compatibility === 'number' && compatibility >= 4) || (majorOf(rangeOf(pkg, 'nuxt')) ?? 3) >= 4 ? 4 : 3;
};

/**
 * One of a part's directories by kind (P251): what `dir.<key>` writes, under
 * `base`, else the default there; written as code, a row and the default.
 */
const kindDir = (repoDir: string, layout: { value: unknown; configFile: string; rows: Unresolved[] }, key: keyof NuxtDirs, base: string): string => {
  const fallback = under(base, key);
  const written = configValueAt(layout.value, `dir.${key}`);
  if (written instanceof NotLiteral) {
    layout.rows.push(settingRow(layout.configFile, NUXT_ADAPTER, 'Nuxt', `dir.${key}`, fallback));
    return fallback;
  }
  return settingDir(repoDir, join(repoDir, base), written) ?? fallback;
};

/** Where the code of a Nuxt directory - the application or a layer - is, under the application's version. */
const layoutAt = (repoDir: string, dir: string, version: 3 | 4, environment: NuxtEnvironment = NUXT_PRODUCTION): NuxtLayout => {
  const rows: Unresolved[] = [];
  const { config, configFile, environments } = nuxtConfigAt(repoDir, dir, environment, rows);
  const at = fromRepo(repoDir, dir);
  const value = config?.value;
  const fallbackSrc = version === 4 && isDirectory(join(dir, 'app')) ? under(at, 'app') : at;
  const writtenSrc = configValueAt(value, 'srcDir');
  if (writtenSrc instanceof NotLiteral) rows.push(settingRow(configFile, NUXT_ADAPTER, 'Nuxt', 'srcDir', `${fallbackSrc || 'the root'}`));
  const placedSrc = settingDir(repoDir, dir, writtenSrc) ?? fallbackSrc;
  const srcDir = placedSrc === '.' ? '' : placedSrc;
  const fallbackServer = version === 4 ? under(at, 'server') : under(srcDir, 'server');
  const writtenServer = configValueAt(value, 'serverDir');
  if (writtenServer instanceof NotLiteral) rows.push(settingRow(configFile, NUXT_ADAPTER, 'Nuxt', 'serverDir', fallbackServer));
  const serverDir = settingDir(repoDir, dir, writtenServer) ?? fallbackServer;
  if (configValueAt(value, 'dir') instanceof NotLiteral) rows.push(settingRow(configFile, NUXT_ADAPTER, 'Nuxt', 'dir', "Nuxt's own directories"));
  const reading = { value, configFile, rows };
  const dirs: NuxtDirs = {
    pages: kindDir(repoDir, reading, 'pages', srcDir),
    layouts: kindDir(repoDir, reading, 'layouts', srcDir),
    middleware: kindDir(repoDir, reading, 'middleware', srcDir),
    shared: kindDir(repoDir, reading, 'shared', at),
    modules: kindDir(repoDir, reading, 'modules', version === 4 ? at : srcDir),
  };
  return { srcDir, serverDir, dirs, version, config, configFile, environment, environments, rows };
};

/**
 * Where a Nuxt application's code is (P240): `srcDir` when the configuration
 * writes one, else `app/` from version 4 on (or with
 * `future.compatibilityVersion: 4`) when that directory is there, else the
 * root. The server is beside `app/` from version 4, inside `srcDir` before.
 * Read for the production build unless another is named (P251).
 */
export const nuxtLayoutOf = (repoDir: string, pkg: PackageJson = {}, environment: NuxtEnvironment = NUXT_PRODUCTION): NuxtLayout => {
  const scratch: Unresolved[] = [];
  const { config } = nuxtConfigAt(repoDir, repoDir, environment, scratch);
  return layoutAt(repoDir, repoDir, nuxtVersionOf(pkg, config), environment);
};

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
  /** Absolute directories a local part, or a module, must be inside: the application, its workspace, its repository. */
  readonly bounds: readonly string[];
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
    const placed = nuxtPackageDir(root, from.dir, entry);
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
 * again, so a cycle ends where it started. Every configuration is read as the
 * build of `environment` reads it, production unless another is named (P251).
 */
export const nuxtLayersOf = (repoDir: string, pkg: PackageJson = {}, environment: NuxtEnvironment = NUXT_PRODUCTION): NuxtLayers => {
  const root = resolve(repoDir);
  const app = nuxtLayoutOf(root, pkg, environment);
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
    const layout = layoutAt(root, dir, app.version, environment);
    const layer: NuxtLayer = { dir, at: fromRepo(root, dir), name, ...(by === application ? {} : { extendedBy: by.at }), layout };
    layers.push(layer);
    rows.push(...layout.rows);
    follow(layer);
  };

  for (const name of localLayerNames(root)) take(join(root, 'layers', name), `layers/${name}`, application);
  follow(application);
  return { layers, rows, bounds };
};

/** A Nuxt application's parts, and the modules of the repository they are built with (P251). */
export interface NuxtApplication extends NuxtLayers {
  readonly modules: NuxtModules;
}

/**
 * Every part of a Nuxt application and every module of the repository it is
 * built with (P251), as the build of `environment` reads them: the one answer
 * the conventions, the pages and the routes each ask.
 */
export const nuxtApplicationOf = (repoDir: string, pkg: PackageJson = {}, environment: NuxtEnvironment = NUXT_PRODUCTION): NuxtApplication => {
  const read = nuxtLayersOf(repoDir, pkg, environment);
  return { ...read, modules: nuxtModulesOf(repoDir, read.layers, read.bounds) };
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
const groupOf = (
  repoDir: string,
  label: string,
  within: string[],
  except: string[],
  dirs: readonly ScannedDir[],
  named: readonly ImplicitImportSource[] = [],
): ImplicitImports => {
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
    from: [...new Set([...dirs.filter(({ dir }) => isDirectory(join(repoDir, dir))).map(({ dir }) => `${dir}/`), ...named.map((source) => source.file)])],
    // One name a module adds from one file (P251), beside what the directories give.
    sources: [...sources, ...named],
  };
};

const LAYER_FILE = /\.(?:[cm]?[jt]sx?|vue)$/;

/** The script and component files of a directory a part or a module is built in from, repo-relative. */
const heldFiles = (repoDir: string, dir: string): string[] => {
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
        if (entry === 'layers' && at === dir) continue;
        walk(path);
      } else if (LAYER_FILE.test(entry) && !entry.endsWith('.d.ts')) out.push(fromRepo(repoDir, path));
    }
  };
  walk(dir);
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

/** What one reading of a Nuxt application is built with, keyed for comparing two environments' readings (P251). */
interface BuiltWith {
  /** Parts and modules, as a row names them: `../dev-layer as a layer`, `the module modules/x.ts`. */
  readonly present: ReadonlySet<string>;
  /** Each part's settings, by part and then by setting as a row names it, with the value read. */
  readonly settings: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

const builtWith = (application: NuxtApplication): BuiltWith => {
  const present = new Set<string>();
  const settings = new Map<string, Map<string, string>>();
  for (const layer of application.layers) {
    if (layer.at !== '') present.add(`${layer.at} as a layer`);
    const { layout } = layer;
    const own = new Map<string, string>([
      ['code', layout.srcDir || 'the root'],
      ['server', layout.serverDir],
      ...Object.entries(layout.dirs).map(([key, dir]): [string, string] => [key, dir]),
      ...['alias', 'imports'].map((key): [string, string] => [`\`${key}\``, JSON.stringify(configValueAt(layout.config?.value, key)) ?? '']),
    ]);
    settings.set(layer.at === '' ? 'the application' : layer.at, own);
  }
  for (const module of application.modules.modules) present.add(`the module ${module.file}`);
  for (const module of application.modules.installed) present.add(`the module ${module.name}`);
  return { present, settings };
};

/** How one environment's build differs from production's (P251). */
interface EnvironmentDifference {
  readonly environment: NuxtEnvironment;
  /** Parts and modules only it builds with. */
  readonly only: readonly string[];
  /** Parts and modules only production builds with. */
  readonly without: readonly string[];
  /** Settings of a part both have that it reads otherwise. */
  readonly changed: readonly string[];
}

/**
 * What one environment's build of the application has that production's
 * does not, and the other way round, or none when the two are built alike.
 * A part only one of them has is said as that part; a setting is compared
 * only for a part both have.
 */
const differenceOf = (environment: NuxtEnvironment, production: BuiltWith, other: BuiltWith): EnvironmentDifference | undefined => {
  const only = [...other.present].filter((fact) => !production.present.has(fact));
  const without = [...production.present].filter((fact) => !other.present.has(fact));
  const changed: string[] = [];
  for (const [part, settings] of other.settings) {
    const before = production.settings.get(part);
    if (before === undefined) continue;
    for (const [key, value] of settings) {
      const was = before.get(key) ?? '';
      if (value === was) continue;
      changed.push(key.startsWith('`') ? `a different ${key} in ${part}` : `${part}'s ${key} in ${value} (${was} in production)`);
    }
  }
  return only.length === 0 && without.length === 0 && changed.length === 0 ? undefined : { environment, only, without, changed };
};

/** The note that says how every other environment's build differs from production's, which is the one read (P251). */
const environmentsRow = (app: NuxtLayout, differences: readonly EnvironmentDifference[]): Unresolved => {
  const sentences = differences.map(({ environment, only, without, changed }) => {
    const differs = [
      ...(only.length === 0 ? [] : [`with ${inWords(only)}`]),
      ...(without.length === 0 ? [] : [`without ${inWords(without)}`]),
      ...(changed.length === 0 ? [] : [`with ${inWords(changed)}`]),
    ];
    return `for ${environment}, Nuxt builds the application ${differs.join(', and ')}`;
  });
  return {
    file: app.configFile,
    line: 1,
    reason: 'framework-environment-differs',
    level: 'info',
    symbol: inWords(differences.map((difference) => difference.environment)),
    message: `The configuration overrides settings by environment, and the graph is the production build's: ${sentences.join('; ')}. What only another environment builds is not read`,
    hint: 'Nothing to do. Write what every build shares outside `$development`, `$production` and `$env`, so each reads it.',
    adapter: NUXT_ADAPTER,
    meta: { cause: 'framework-environment-differs', environments: differences.map((difference) => ({ ...difference })) },
  };
};

/** The builds the configurations of an application write overrides for, beside production (P251). */
const otherEnvironments = (layers: readonly NuxtLayer[]): NuxtEnvironment[] => {
  const written = new Set(layers.flatMap((layer) => layer.layout.environments));
  // An override for production is a difference from development, which is the build Nuxt makes beside it.
  if (written.has(NUXT_PRODUCTION)) written.add('development');
  written.delete(NUXT_PRODUCTION);
  return [...written].sort((a, b) => (a === 'development' ? -1 : b === 'development' ? 1 : a < b ? -1 : a > b ? 1 : 0));
};

/** The aliases a module sets (P251), as `paths` laid over the ones there: `=` replaces, `||=` only fills in. */
const moduleAliases = (repoDir: string, modules: NuxtModules, paths: Record<string, string[]>): void => {
  for (const module of modules.modules) {
    for (const alias of module.additions.aliases) {
      for (const [key, targets] of aliasEntries(repoDir, alias.key, alias.target || '.')) {
        if (alias.replaces || paths[key] === undefined) paths[key] = targets;
      }
    }
  }
};

/** Nuxt's conventions for one repository (P240, P243, P251), or none where Nuxt is not declared. */
export const nuxtConventions: ConventionsOf = (repoDir, pkg): ProjectConventions | undefined => {
  if (!hasDependency(pkg, 'nuxt')) return undefined;
  const application = nuxtApplicationOf(repoDir, pkg);
  const { layers, rows: layerRows, modules } = application;
  const [first] = layers as [NuxtLayer, ...NuxtLayer[]];
  const layout = first.layout;
  const rows: Unresolved[] = [...layout.rows, ...layerRows];
  const src = layout.srcDir || '.';
  const shared = layout.dirs.shared || '.';
  const paths: Record<string, string[]> = {
    '~': [src],
    '~/*': [`${src}/*`],
    '@': [src],
    '@/*': [`${src}/*`],
    '~~': ['.'],
    '~~/*': ['./*'],
    '@@': ['.'],
    '@@/*': ['./*'],
    '#shared': [shared],
    '#shared/*': [`${shared}/*`],
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
  // A module runs after the configuration is merged, so its aliases are laid over all of it.
  moduleAliases(repoDir, modules, paths);

  const autoImport = mergedSetting(layers, 'imports.autoImport') !== false;
  const scan = mergedSetting(layers, 'imports.scan') !== false;
  const sharedOf = (layer: NuxtLayer, rank: number): ScannedDir[] =>
    layout.version === 4
      ? [
          { dir: under(layer.layout.dirs.shared, 'utils'), nested: false, rank },
          { dir: under(layer.layout.dirs.shared, 'types'), nested: false, rank },
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
  // A handler a module serves is the server's code wherever it is (P251).
  const handlerDirs = [...new Set(modules.modules.flatMap((module) => module.additions.handlers.map((handler) => dirname(handler.handler))))];
  const serverDirs = [...layers.map((layer) => layer.layout.serverDir), ...handlerDirs];
  const namedBy = (pick: (module: NuxtModules['modules'][number]) => ReadonlyArray<{ file: string; name: string; export: string }>): ImplicitImportSource[] =>
    modules.modules.flatMap((module) =>
      pick(module).map((named) => ({ file: named.file, names: [{ name: named.name, export: named.export }], ...(module.rank === 0 ? {} : { rank: module.rank }) })),
    );
  const implicit: ImplicitImports[] =
    !autoImport || !scan
      ? []
      : [
          groupOf(
            repoDir,
            'the application',
            [''],
            [...serverDirs, 'node_modules', '.nuxt', '.output'],
            [
              ...layers.flatMap((layer, rank) => [
                { dir: under(layer.layout.srcDir, 'composables'), nested: false, rank },
                { dir: under(layer.layout.srcDir, 'utils'), nested: false, rank },
                ...storesOf(layer, rank),
                ...listedDirs(repoDir, layer.layout, 'imports.dirs', layer.layout.srcDir, rows).map((dir) => ({ ...dir, rank })),
                ...sharedOf(layer, rank),
              ]),
              ...moduleDirsOf(modules.modules, (added) => added.importDirs),
            ],
            namedBy((module) => module.additions.imports),
          ),
          groupOf(
            repoDir,
            'the server',
            serverDirs,
            [],
            [
              ...layers.flatMap((layer, rank) => [{ dir: under(layer.layout.serverDir, 'utils'), nested: false, rank }, ...sharedOf(layer, rank)]),
              ...moduleDirsOf(modules.modules, (added) => added.serverImportDirs),
            ],
            namedBy((module) => module.additions.serverImports),
          ),
        ];
  for (const layer of layers) {
    if (configValueAt(layer.layout.config?.value, 'imports') instanceof NotLiteral) {
      rows.push(settingRow(layer.layout.configFile, NUXT_ADAPTER, 'Nuxt', 'imports', 'only the directories it scans by default'));
    }
  }

  // What each layer holds, for the imports it writes with `~` or `@`, and
  // for the build to see a change to a layer outside the repository's own files.
  const held = new Map(layers.slice(1).map((layer) => [layer, heldFiles(repoDir, layer.dir)]));
  for (const [layer, files] of held) rows.push(...layerAliasRows(repoDir, layout, layer, files));
  if (layers.length > 1) rows.push(layersReadRow(layout, layers));
  const outside = layers.filter((layer) => layer.at.startsWith('..'));

  // The modules (P251): what was not read, what was, and what is a package's.
  rows.push(...modules.rows);
  if (modules.modules.length > 0) rows.push(modulesReadRow(layout, modules.modules));
  if (modules.installed.length > 0) rows.push(modulesInstalledRow(layout, modules.installed));
  const outsideModules = modules.modules.filter((module) => fromRepo(repoDir, module.dir).startsWith('..') && !outside.some((layer) => isWithinDir(module.dir, layer.dir)));

  // Each other build the configurations write overrides for, against production's (P251).
  const production = builtWith(application);
  const differences = otherEnvironments(layers).flatMap((environment) => differenceOf(environment, production, builtWith(nuxtApplicationOf(repoDir, pkg, environment))) ?? []);
  if (differences.length > 0) rows.push(environmentsRow(layout, differences));

  const extent = [...outside.map((layer) => layer.dir), ...outsideModules.map((module) => module.dir)];
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
        // A module's file is the build's own: a change to one changes what every file is given.
        ...modules.modules.map((module) => module.file),
        ...outsideModules.flatMap((module) => heldFiles(repoDir, module.dir)),
      ]),
    ],
    ...(extent.length === 0 ? {} : { extent }),
    ...(layers.length === 1 ? {} : { precedence: `the order of Nuxt's layers: ${inWords(layers.map((layer) => (layer.at === '' ? 'the application' : layer.at)))}` }),
  };
};


// ---------------------------------------------------------------------------
// SvelteKit

const SVELTEKIT_ADAPTER = 'sveltekit-routes';

/** Where SvelteKit's routes are when nothing moves them. */
export const SVELTEKIT_ROUTES_DIR = 'src/routes';

/**
 * Where a SvelteKit application keeps its routes and pages (P251):
 * `kit.files.routes` written as a literal, relative to the root, else
 * `src/routes`. Written as code, the default, and a row from the conventions.
 */
export const sveltekitRoutesOf = (repoDir: string): string => {
  const config = readConfigLiteral(repoDir, SVELTE_CONFIGS);
  const placed = settingDir(repoDir, repoDir, configValueAt(config?.value, 'kit.files.routes'));
  return placed === undefined || placed === '' ? SVELTEKIT_ROUTES_DIR : placed;
};

/** SvelteKit's conventions for one repository (P240), or none where SvelteKit is not declared. */
export const sveltekitConventions: ConventionsOf = (repoDir, pkg): ProjectConventions | undefined => {
  if (!hasDependency(pkg, '@sveltejs/kit')) return undefined;
  const config = readConfigLiteral(repoDir, SVELTE_CONFIGS);
  const configFile = config === undefined ? 'package.json' : (repoRelative(repoDir, config.file) ?? 'package.json');
  const rows: Unresolved[] = [];
  const writtenLib = configValueAt(config?.value, 'kit.files.lib');
  if (writtenLib instanceof NotLiteral) rows.push(settingRow(configFile, SVELTEKIT_ADAPTER, 'SvelteKit', 'kit.files.lib', 'src/lib'));
  const lib = settingDir(repoDir, repoDir, writtenLib) ?? 'src/lib';
  if (configValueAt(config?.value, 'kit.files.routes') instanceof NotLiteral) {
    rows.push(settingRow(configFile, SVELTEKIT_ADAPTER, 'SvelteKit', 'kit.files.routes', SVELTEKIT_ROUTES_DIR));
  }
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
