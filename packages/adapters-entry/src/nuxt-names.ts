import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { ConfigPath, NotLiteral, configValueAt, toPosixPath, type PackageJson, type Unresolved } from '@flowatlas/core';
import {
  keptByLayer,
  nuxtApplicationOf,
  settingRow,
  throughNuxtAlias,
  type LayerClaim,
  type NuxtApplication,
  type NuxtLayer,
} from './framework-conventions.js';
import { NUXT_MODULE_COMPONENTS } from './nuxt-modules.js';

/**
 * What a Nuxt application registers by name (P255): the components a
 * template uses with no import, the layouts a page names, the route
 * middleware a page names or that runs in front of every page.
 *
 * None of it is written where it is used: `<CartBadge />` names a file of
 * `components/` by its path, `definePageMeta({ layout: 'admin' })` a file of
 * `layouts/`, `middleware: ['auth']` a file of `middleware/`. Nuxt makes each
 * name from the file's path when the application builds, in every part of
 * the application, the higher part's where two give one, and from every
 * directory or file a module of the repository adds. The names are made here
 * the way Nuxt makes them, so the browser reader joins a tag, a layout and a
 * middleware to the file Nuxt would, `static`.
 */

const NUXT_ADAPTER = 'nitro-routes';

const fromRepo = (repoDir: string, path: string): string => toPosixPath(relative(repoDir, path));

const under = (dir: string, sub: string): string => (dir === '' || dir === '.' ? sub : `${dir}/${sub}`);

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Names, as Nuxt makes them (its `scule` and `resolveComponentNameSegments`)

const SPLITTERS = new Set(['-', '_', '/', '.']);

const isUpper = (char: string): boolean | undefined => (/\d/.test(char) ? undefined : char !== char.toLowerCase());

/** `CartBadge`, `cart-badge`, `base/foo` as their words: `Cart`, `Badge`; `cart`, `badge`; `base`, `foo`. */
export const splitByCase = (text: string): string[] => {
  const parts: string[] = [];
  if (text === '') return parts;
  let buffer = '';
  let previousUpper: boolean | undefined;
  let previousSplitter: boolean | undefined;
  for (const char of text) {
    const splitter = SPLITTERS.has(char);
    if (splitter) {
      parts.push(buffer);
      buffer = '';
      previousUpper = undefined;
      continue;
    }
    const upper = isUpper(char);
    if (previousSplitter === false) {
      if (previousUpper === false && upper === true) {
        parts.push(buffer);
        buffer = char;
        previousUpper = upper;
        continue;
      }
      if (previousUpper === true && upper === false && buffer.length > 1) {
        const last = buffer.slice(-1);
        parts.push(buffer.slice(0, -1));
        buffer = last + char;
        previousUpper = upper;
        continue;
      }
    }
    buffer += char;
    previousUpper = upper;
    previousSplitter = splitter;
  }
  parts.push(buffer);
  return parts;
};

const upperFirst = (word: string): string => (word === '' ? '' : `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`);

export const pascalCase = (words: readonly string[]): string => words.map(upperFirst).join('');

export const kebabCase = (words: readonly string[]): string => words.map((word) => word.toLowerCase()).join('-');

/**
 * The words of a name from a file's name and the folders above it, the
 * folders' words left out where the file's name already says them:
 * `base/BaseButton.vue` is `BaseButton`, not `BaseBaseButton`.
 */
const nameSegments = (fileName: string, prefixParts: readonly string[]): string[] => {
  const fileNameParts = splitByCase(fileName);
  const content = fileNameParts.join('/').toLowerCase();
  const nameParts = prefixParts.flatMap((part) => splitByCase(part));
  const matched: string[] = [];
  for (let index = prefixParts.length - 1; index >= 0; index -= 1) {
    const part = prefixParts[index] as string;
    matched.unshift(...splitByCase(part).map((word) => word.toLowerCase()));
    const suffix = matched.join('/');
    if (content === suffix || content.startsWith(`${suffix}/`) || (part.toLowerCase() === content && prefixParts[index + 1] !== undefined && part === prefixParts[index + 1])) {
      nameParts.length = index;
    }
  }
  return [...nameParts, ...fileNameParts];
};

/** Where a component runs: on both sides, or only one (`.client.vue`, `.server.vue`, an island). */
export type NuxtComponentMode = 'all' | 'client' | 'server';

/** A directory Nuxt registers the components of by name. */
interface ComponentsDir {
  /** Repo-relative. */
  readonly dir: string;
  readonly prefix?: string;
  readonly pathPrefix: boolean;
  /** `components/islands`, or `island: true`: each a server component. */
  readonly island: boolean;
}

/**
 * The name Nuxt registers a component file under, and where it runs: its
 * folders below the directory (unless `pathPrefix: false`) and its own name,
 * in PascalCase, after the directory's `prefix`; `.client`, `.server`,
 * `.global` and `.island` are not part of it; an `index` is its folder's.
 */
export const nuxtComponentNameOf = (file: string, dir: { dir: string; prefix?: string; pathPrefix: boolean; island?: boolean }): { name: string; mode: NuxtComponentMode } => {
  const folder = relative(dir.dir, dirname(file)).split('\\').join('/');
  const prefixParts = [...(dir.prefix === undefined ? [] : splitByCase(dir.prefix)), ...(dir.pathPrefix ? splitByCase(folder) : [])];
  let fileName = basename(file, extname(file));
  const island = /\.island(?:\.global)?$/.test(fileName) || dir.island === true;
  const mode = island ? 'server' : ((/(?<=\.)(client|server)(?:\.global|\.island)*$/.exec(fileName)?.[1] as NuxtComponentMode | undefined) ?? 'all');
  fileName = fileName.replace(/(?:\.(?:client|server))?(?:\.global|\.island)*$/, '');
  if (fileName.toLowerCase() === 'index') fileName = dir.pathPrefix ? '' : basename(dirname(file));
  return { name: pascalCase(nameSegments(fileName.replace(/["']/g, ''), prefixParts).filter((word) => word !== '')), mode };
};

/** The name Nuxt gives a layout or a route middleware: its path below its directory, in kebab-case (`admin/panel.vue` is `admin-panel`). */
export const nuxtNameFromPath = (file: string, dir: string): string => {
  const within = relative(dir, file).split('\\').join('/');
  const fileName = basename(within, extname(within));
  const prefixParts = splitByCase(dirname(within));
  return kebabCase(nameSegments(fileName.toLowerCase() === 'index' ? '' : fileName, prefixParts).filter((word) => word !== '')).replace(/["']/g, '');
};

/**
 * The components Nuxt itself registers, and the head components it gives
 * every template: tags that name none of the repository's files, and no row.
 */
export const NUXT_BUILT_IN_COMPONENTS: ReadonlySet<string> = new Set([
  'NuxtPage',
  'NuxtLayout',
  'NuxtLink',
  'NuxtLoadingIndicator',
  'NuxtErrorBoundary',
  'NuxtWelcome',
  'NuxtIsland',
  'NuxtRouteAnnouncer',
  'NuxtClientFallback',
  'NuxtTime',
  'ClientOnly',
  'DevOnly',
  'ServerPlaceholder',
  'Head',
  'Title',
  'Meta',
  'Link',
  'Style',
  'Base',
  'NoScript',
  'Html',
  'Body',
]);

// ---------------------------------------------------------------------------
// The files

/** The files a component directory holds, as Nuxt globs them: scripts and components, not declarations or mixins. */
const COMPONENT_FILE = /\.(?:vue|[cm]?[jt]sx?)$/;
const NOT_A_COMPONENT = /(?:\.d\.[cm]?ts|[-.]?[Mm]ixin\.[jt]sx?)$/;

const filesIn = (root: string, dir: string, nested: boolean, accept: RegExp): string[] => {
  const out: string[] = [];
  const walk = (at: string, depth: number): void => {
    let entries: string[];
    try {
      entries = readdirSync(at).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const path = join(at, entry);
      if (isDirectory(path)) {
        if (nested) walk(path, depth + 1);
        // A route middleware's folder holds its `index`.
        else if (depth === 0) {
          const index = readdirSyncSafe(path).find((name) => /^index\.[cm]?[jt]s$/.test(name));
          if (index !== undefined) out.push(join(path, index));
        }
      } else if (accept.test(entry) && !NOT_A_COMPONENT.test(entry)) out.push(path);
    }
  };
  walk(join(root, dir), 0);
  return out;
};

const readdirSyncSafe = (path: string): string[] => {
  try {
    return readdirSync(path).sort();
  } catch {
    return [];
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof ConfigPath) && !(value instanceof NotLiteral);

/**
 * The component directories of one part: what its `components` setting
 * writes - a path, a list, `{ dirs }`, each with its `prefix`, `pathPrefix`
 * and `island` - else Nuxt's own three under its `srcDir`; `false`, none.
 * A path written with `~` is the application's, in a layer too, as every
 * alias is. The longest first, so a file of a nested one is named by it.
 */
const componentDirsOf = (repoDir: string, application: NuxtApplication, layer: NuxtLayer, rows: Unresolved[]): ComponentsDir[] => {
  const [first] = application.layers;
  const app = (first ?? layer).layout;
  const src = layer.layout.srcDir;
  const defaults: ComponentsDir[] = [
    { dir: under(src, 'components/islands'), pathPrefix: true, island: true },
    { dir: under(src, 'components/global'), pathPrefix: true, island: false },
    { dir: under(src, 'components'), pathPrefix: true, island: false },
  ];
  const written = configValueAt(layer.layout.config?.value, 'components');
  if (written instanceof NotLiteral) {
    rows.push(settingRow(layer.layout.configFile, NUXT_ADAPTER, 'Nuxt', 'components', 'its own components/ directories'));
    return defaults;
  }
  if (written === undefined || written === true) return defaults;
  if (written === false) return [];
  const listed: unknown[] = Array.isArray(written) ? written : isPlainObject(written) ? (Array.isArray(written.dirs) ? written.dirs : [written]) : [written];
  const dirs = listed.flatMap((entry): ComponentsDir[] => {
    const object = isPlainObject(entry) ? entry : undefined;
    const path = object === undefined ? entry : object.path;
    const placed =
      path instanceof ConfigPath
        ? fromRepo(repoDir, path.path)
        : typeof path === 'string'
          ? (throughNuxtAlias(app, path) ?? under(src, path.replace(/^\.\//, '')))
          : undefined;
    const prefix = object?.prefix;
    if (placed === undefined || (prefix !== undefined && typeof prefix !== 'string') || entry instanceof NotLiteral) {
      rows.push(settingRow(layer.layout.configFile, NUXT_ADAPTER, 'Nuxt', 'components', 'only the directories written as literals'));
      return [];
    }
    return [{ dir: placed === '.' ? '' : placed, ...(prefix === undefined || prefix === '' ? {} : { prefix }), pathPrefix: object?.pathPrefix !== false, island: object?.island === true }];
  });
  return dirs.sort((a, b) => b.dir.length - a.dir.length);
};

// ---------------------------------------------------------------------------
// The answer

/** A component one name stands for. */
export interface NuxtComponent {
  readonly name: string;
  /** Repo-relative file. */
  readonly file: string;
  readonly mode: NuxtComponentMode;
}

/** A route middleware, by the name a page writes. */
export interface NuxtRouteMiddleware {
  readonly name: string;
  /** Repo-relative file whose default export it is. */
  readonly file: string;
  /** In front of every page (`.global`, or `global: true` from a module). */
  readonly global: boolean;
  /** Where it was added: a file of a part's `middleware/`, or a module's `addRouteMiddleware` at a line. */
  readonly from: { readonly file: string; readonly line: number };
}

/** A plugin of the application (P258): a file of a part's `plugins/`, or one a module adds. */
export interface NuxtPlugin {
  /** Repo-relative. */
  readonly file: string;
  /** Where it was added: the file itself, or a module's `addPlugin` at a line. */
  readonly from: { readonly file: string; readonly line: number };
}

/** What a Nuxt application registers by name. */
export interface NuxtNames {
  /** The components each name stands for: one per mode; more than one of one mode is {@link ambiguous}. */
  readonly components: ReadonlyMap<string, readonly NuxtComponent[]>;
  /** Names two files of one part give, each with its files: Nuxt warns and takes one, and the reader takes none. */
  readonly ambiguous: ReadonlyMap<string, readonly string[]>;
  /** Names a module installed as a package registers (`<NuxtImg>`): its package's, not the repository's. */
  readonly packaged: ReadonlySet<string>;
  /** Each layout by its name: repo-relative file. */
  readonly layouts: ReadonlyMap<string, string>;
  /** Every route middleware, in the order Nuxt runs the ones in front of every page. */
  readonly middleware: readonly NuxtRouteMiddleware[];
  /** The application's root component (`app.vue` of the first part that has one), repo-relative; none where Nuxt gives its own. */
  readonly root?: string;
  /**
   * Every plugin of the application, in the order Nuxt runs them (P258):
   * those modules add, the last added first, then each part's `plugins/`,
   * the lowest part first, each in the order of its files.
   */
  readonly plugins: readonly NuxtPlugin[];
  /** A layer's file left out for a higher one's, and settings written as code. */
  readonly rows: readonly Unresolved[];
}

type NameClaim = LayerClaim & { readonly name: string; readonly mode: NuxtComponentMode };

/**
 * What a Nuxt application registers by name (P255): every part's component
 * directories and every directory and component a module of the
 * repository adds; every part's layouts; every part's route middleware and
 * every one a module adds. Where two parts give one name, the higher part's
 * (P243 `keptByLayer`); a module's component directory ranks below every
 * part's, as Nuxt scans it after theirs; the application's own wins over
 * all of them, as Nuxt gives its directories the higher priority.
 */
export const nuxtNamesOf = (repoDir: string, pkg: PackageJson = {}, application: NuxtApplication = nuxtApplicationOf(repoDir, pkg)): NuxtNames => {
  const rows: Unresolved[] = [];
  const { layers, modules } = application;

  // Components.
  const claims: NameClaim[] = [];
  const claim = (name: string, mode: NuxtComponentMode, file: string, layer: NuxtLayer | undefined, rank: number, part?: string): void => {
    claims.push({ key: `${name}\u0000${mode}`, label: `<${name}>`, file, layer, rank, name, mode, ...(part === undefined ? {} : { part }) });
  };
  layers.forEach((layer, rank) => {
    const seen = new Set<string>();
    for (const dir of componentDirsOf(repoDir, application, layer, rows)) {
      for (const path of filesIn(repoDir, dir.dir, true, COMPONENT_FILE)) {
        const file = fromRepo(repoDir, path);
        if (seen.has(file)) continue;
        seen.add(file);
        const { name, mode } = nuxtComponentNameOf(file, dir);
        if (name !== '') claim(name, mode, file, layer, rank);
      }
    }
  });
  modules.modules.forEach((module, index) => {
    const rank = layers.length + index;
    const part = `the module ${module.file}`;
    for (const dir of module.additions.componentDirs) {
      for (const path of filesIn(repoDir, dir.dir, true, COMPONENT_FILE)) {
        const file = fromRepo(repoDir, path);
        const { name, mode } = nuxtComponentNameOf(file, { ...dir, island: false });
        if (name !== '') claim(name, mode, file, module.layer, rank, part);
      }
    }
    for (const component of module.additions.components) claim(pascalCase(splitByCase(component.name)), 'all', component.file, module.layer, rank, part);
  });
  const kept = keptByLayer(claims, 'names');
  rows.push(...kept.rows);
  const byKey = new Map<string, NameClaim[]>();
  for (const each of kept.kept) byKey.set(each.key, [...(byKey.get(each.key) ?? []), each]);
  const components = new Map<string, NuxtComponent[]>();
  const ambiguous = new Map<string, string[]>();
  for (const group of byKey.values()) {
    const [one] = group as [NameClaim, ...NameClaim[]];
    if (group.length > 1) ambiguous.set(one.name, group.map((each) => each.file));
    else components.set(one.name, [...(components.get(one.name) ?? []), { name: one.name, file: one.file, mode: one.mode }]);
  }
  const packaged = new Set(modules.installed.flatMap((module) => NUXT_MODULE_COMPONENTS.get(module.name) ?? []));

  // Layouts.
  const layoutClaims: Array<LayerClaim & { name: string }> = [];
  layers.forEach((layer, rank) => {
    const dir = layer.layout.dirs.layouts;
    for (const path of filesIn(repoDir, dir, true, COMPONENT_FILE)) {
      const file = fromRepo(repoDir, path);
      const name = nuxtNameFromPath(file, dir);
      if (name !== '') layoutClaims.push({ key: name, label: `the layout ${name}`, file, layer, rank, name });
    }
  });
  const keptLayouts = keptByLayer(layoutClaims, 'names');
  rows.push(...keptLayouts.rows);
  const layouts = new Map<string, string>();
  // Nuxt keeps the first file of a name a part gives.
  for (const each of keptLayouts.kept) if (!layouts.has(each.name)) layouts.set(each.name, each.file);

  // Route middleware: the parts' files, the higher part's where two give a
  // name, in the order Nuxt runs them - the lowest part first, each in the
  // order of its files - and then each a module adds.
  const middlewareClaims: Array<LayerClaim & { name: string; global: boolean }> = [];
  layers.forEach((layer, rank) => {
    const dir = layer.layout.dirs.middleware;
    for (const path of filesIn(repoDir, dir, false, /\.[cm]?[jt]s$/)) {
      const file = fromRepo(repoDir, path);
      const name = nuxtNameFromPath(file, dir);
      if (name !== '') middlewareClaims.push({ key: name, label: `the middleware ${name}`, file, layer, rank, name, global: /\.global\.[cm]?[jt]s$/.test(file) });
    }
  });
  const keptMiddleware = keptByLayer(middlewareClaims, 'names');
  rows.push(...keptMiddleware.rows);
  const middleware: NuxtRouteMiddleware[] = [];
  for (const rank of [...layers.keys()].reverse()) {
    for (const each of keptMiddleware.kept) {
      if (each.rank === rank && !middleware.some((known) => known.name === each.name)) {
        middleware.push({ name: each.name, file: each.file, global: each.global, from: { file: each.file, line: 1 } });
      }
    }
  }
  for (const module of modules.modules) {
    for (const added of module.additions.routeMiddleware) {
      const found = middleware.findIndex((known) => known.name === added.name);
      const entry: NuxtRouteMiddleware = { name: added.name, file: added.file, global: added.global, from: { file: module.file, line: added.line } };
      // A file of the application's keeps its name unless the module says to take its place.
      if (found === -1) middleware.push(entry);
      else if (added.override) middleware[found] = entry;
    }
  }

  // Plugins: what modules add, each `addPlugin` put in front of the ones
  // before it, then every part's own, the lowest part first (P258).
  const plugins: NuxtPlugin[] = [];
  for (const module of modules.modules) {
    for (const added of module.additions.plugins) plugins.unshift({ file: added.file, from: { file: module.file, line: added.line } });
  }
  for (const layer of [...layers].reverse()) {
    for (const path of filesIn(repoDir, layer.layout.dirs.plugins, false, /\.[cm]?[jt]s$/)) {
      const file = fromRepo(repoDir, path);
      if (!plugins.some((known) => known.file === file)) plugins.push({ file, from: { file, line: 1 } });
    }
  }

  // The root component: `app.vue` of the first part that has one.
  const root = layers
    .flatMap((layer) => ['app.vue', 'App.vue'].map((name) => under(layer.layout.srcDir, name)))
    .find((file) => {
      try {
        return statSync(join(repoDir, file)).isFile();
      } catch {
        return false;
      }
    });

  return { components, ambiguous, packaged, layouts, middleware, ...(root === undefined ? {} : { root }), plugins, rows };
};
