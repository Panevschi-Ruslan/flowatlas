import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import {
  ConfigPath,
  NotLiteral,
  configValueAt,
  hasDependency,
  implicitSourcesOf,
  readConfigLiteral,
  scriptFilesIn,
  toPosixPath,
  type ConfigLiteral,
  type ConventionsOf,
  type ImplicitImports,
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
 * read in its place; a layer (`extends`) is a row, and is not read.
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

// ---------------------------------------------------------------------------
// Nuxt

/** Where a Nuxt application keeps its code, as its version and configuration say. */
export interface NuxtLayout {
  /** The application's code, repo-relative; `''` is the root. */
  readonly srcDir: string;
  /** The server's code, repo-relative. */
  readonly serverDir: string;
  /** 4 for the `app/` layout, 3 for the one before it. */
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

/** A directory a setting names, repo-relative, or undefined when it names none the reader can place. */
const settingDir = (repoDir: string, value: unknown): string | undefined => {
  if (value instanceof ConfigPath) return repoRelative(repoDir, value.path);
  if (typeof value === 'string') return repoRelative(repoDir, value)?.replace(/\/+$/, '');
  return undefined;
};

/**
 * Where a Nuxt application's code is (P240): `srcDir` when the configuration
 * writes one, else `app/` from version 4 on (or with
 * `future.compatibilityVersion: 4`) when that directory is there, else the
 * root. The server is beside `app/` from version 4, inside `srcDir` before.
 */
export const nuxtLayoutOf = (repoDir: string, pkg: PackageJson = {}): NuxtLayout => {
  const config = readConfigLiteral(repoDir, NUXT_CONFIGS);
  const configFile = config === undefined ? 'package.json' : (repoRelative(repoDir, config.file) ?? 'package.json');
  const value = config?.value;
  const rows: Unresolved[] = [];
  const compatibility = configValueAt(value, 'future.compatibilityVersion');
  const version = (typeof compatibility === 'number' && compatibility >= 4) || (majorOf(rangeOf(pkg, 'nuxt')) ?? 3) >= 4 ? 4 : 3;
  const fallbackSrc = version === 4 && isDirectory(join(repoDir, 'app')) ? 'app' : '';
  const writtenSrc = configValueAt(value, 'srcDir');
  if (writtenSrc instanceof NotLiteral) rows.push(settingRow(configFile, NUXT_ADAPTER, 'Nuxt', 'srcDir', `${fallbackSrc || 'the root'}`));
  const srcDir = settingDir(repoDir, writtenSrc) ?? fallbackSrc;
  const fallbackServer = version === 4 ? 'server' : under(srcDir, 'server');
  const writtenServer = configValueAt(value, 'serverDir');
  if (writtenServer instanceof NotLiteral) rows.push(settingRow(configFile, NUXT_ADAPTER, 'Nuxt', 'serverDir', fallbackServer));
  const serverDir = settingDir(repoDir, writtenServer) ?? fallbackServer;
  return { srcDir: srcDir === '.' ? '' : srcDir, serverDir, version, config, configFile, rows };
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

/** The aliases `alias` adds in the configuration, as `paths`, and a row for each written as code. */
const nuxtWrittenAliases = (repoDir: string, layout: NuxtLayout, rows: Unresolved[]): Record<string, string[]> => {
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
        ? repoRelative(repoDir, value.path)
        : typeof value === 'string'
          ? (throughNuxtAlias(layout, value) ?? repoRelative(repoDir, value.replace(/^\.\//, '')))
          : undefined;
    if (target === undefined) {
      if (value instanceof NotLiteral) rows.push(settingRow(layout.configFile, NUXT_ADAPTER, 'Nuxt', `alias['${key}']`, 'nothing for it'));
      continue;
    }
    for (const [name, targets] of aliasEntries(repoDir, key, target || '.')) paths[name] = targets;
  }
  return paths;
};

/** Whether the configuration's `modules` names a module, alone or with its options. */
const hasModule = (value: unknown, name: string): boolean => {
  const modules = configValueAt(value, 'modules');
  return Array.isArray(modules) && modules.some((entry) => entry === name || (Array.isArray(entry) && entry[0] === name));
};

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
    if (entry instanceof ConfigPath) {
      const dir = repoRelative(repoDir, entry.path);
      return dir === undefined ? [] : [{ dir, nested: false }];
    }
    if (typeof entry !== 'string') {
      if (entry instanceof NotLiteral) rows.push(settingRow(layout.configFile, NUXT_ADAPTER, 'Nuxt', key, 'only the directories it scans by default'));
      return [];
    }
    const { dir, nested } = scannedDir(entry);
    const placed = throughNuxtAlias(layout, dir) ?? under(base, dir.replace(/^\.\//, ''));
    return [{ dir: placed === '.' ? '' : placed, nested }];
  });
};

/** One group of names used unimported, from the script files of its directories. */
const groupOf = (
  repoDir: string,
  label: string,
  within: string[],
  except: string[],
  dirs: ReadonlyArray<{ dir: string; nested: boolean }>,
): ImplicitImports => {
  const files = [...new Set(dirs.flatMap(({ dir, nested }) => scriptFilesIn(repoDir, dir, nested)))];
  return {
    label,
    within,
    except,
    // Only the directories that are there, for the row that names them.
    from: dirs.filter(({ dir }) => isDirectory(join(repoDir, dir))).map(({ dir }) => `${dir}/`),
    sources: implicitSourcesOf(repoDir, files, defaultNameOf),
  };
};

/** A row for each layer the configuration extends, or `layers/` holds, none of which is read. */
const layerRows = (repoDir: string, layout: NuxtLayout): Unresolved[] => {
  const written = configValueAt(layout.config?.value, 'extends');
  const listed = written === undefined ? [] : Array.isArray(written) ? written : [written];
  const named = listed.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
  let local: string[] = [];
  try {
    local = readdirSync(join(repoDir, 'layers'))
      .filter((entry) => isDirectory(join(repoDir, 'layers', entry)))
      .sort()
      .map((entry) => `layers/${entry}`);
  } catch {
    local = [];
  }
  return [...named, ...local].map((layer) => {
    const text =
      layer instanceof NotLiteral
        ? layer.text
        : layer instanceof ConfigPath
          ? (repoRelative(repoDir, layer.path) ?? toPosixPath(layer.path))
          : typeof layer === 'string'
            ? layer
            : JSON.stringify(layer);
    return {
      file: layout.configFile,
      line: 1,
      reason: 'framework-layer-unread',
      symbol: text,
      message: `${text} is a Nuxt layer of this application, and nothing of it is read: its pages, routes, composables and aliases are not in the graph`,
      hint: 'Read the layer as a service of its own, or import what the application uses from it with an import line.',
      adapter: NUXT_ADAPTER,
      meta: { cause: 'framework-layer-unread', layer: text },
    };
  });
};

/** Nuxt's conventions for one repository (P240), or none where Nuxt is not declared. */
export const nuxtConventions: ConventionsOf = (repoDir, pkg): ProjectConventions | undefined => {
  if (!hasDependency(pkg, 'nuxt')) return undefined;
  const layout = nuxtLayoutOf(repoDir, pkg);
  const rows: Unresolved[] = [...layout.rows];
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
    ...nuxtWrittenAliases(repoDir, layout, rows),
  };

  const imports = configValueAt(layout.config?.value, 'imports');
  const autoImport = configValueAt(imports, 'autoImport') !== false;
  const scan = configValueAt(imports, 'scan') !== false;
  const shared = layout.version === 4 ? [{ dir: 'shared/utils', nested: false }, { dir: 'shared/types', nested: false }] : [];
  // `@pinia/nuxt` scans `stores/` of the application unless `storesDirs` names others, from the root.
  const stores = !hasModule(layout.config?.value, '@pinia/nuxt')
    ? []
    : configValueAt(layout.config?.value, 'pinia.storesDirs') === undefined
      ? [{ dir: under(layout.srcDir, 'stores'), nested: false }]
      : listedDirs(repoDir, layout, 'pinia.storesDirs', '', rows);
  const implicit: ImplicitImports[] =
    !autoImport || !scan
      ? []
      : [
          groupOf(repoDir, 'the application', [''], [layout.serverDir, 'node_modules', '.nuxt', '.output'], [
            { dir: under(layout.srcDir, 'composables'), nested: false },
            { dir: under(layout.srcDir, 'utils'), nested: false },
            ...stores,
            ...listedDirs(repoDir, layout, 'imports.dirs', layout.srcDir, rows),
            ...shared,
          ]),
          groupOf(repoDir, 'the server', [layout.serverDir], [], [{ dir: under(layout.serverDir, 'utils'), nested: false }, ...shared]),
        ];
  if (imports instanceof NotLiteral) rows.push(settingRow(layout.configFile, NUXT_ADAPTER, 'Nuxt', 'imports', 'only the directories it scans by default'));
  rows.push(...layerRows(repoDir, layout));

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
    files: layout.config === undefined ? [] : [layout.configFile],
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
  const lib = settingDir(repoDir, writtenLib) ?? 'src/lib';
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
