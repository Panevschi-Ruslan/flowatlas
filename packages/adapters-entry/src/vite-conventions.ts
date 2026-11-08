import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  ConfigPath,
  NotLiteral,
  configValueAt,
  readConfigLiteral,
  toPosixPath,
  type ConventionsOf,
  type ProjectConventions,
  type Unresolved,
} from '@flowatlas/core';

/**
 * The aliases a Vite configuration resolves (P240): `resolve.alias`, as an
 * object or as a list of `{ find, replacement }`.
 *
 * A Vite application's scaffold names its `@` twice, once in
 * `vite.config.ts` for the bundler and once in a tsconfig for the editor,
 * and the tsconfig that names it is often not the one at the root: a
 * solution tsconfig refers to `tsconfig.app.json`, whose aliases the core
 * reads itself. Where no tsconfig names an alias at all, the bundler's is
 * still how the repository resolves, so it is read from here.
 *
 * Kept with the entry adapters (P256) because a server Vite builds resolves
 * through the same aliases: the procedure adapters state them as the browser
 * adapters do, one function asked once whoever states it.
 */

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cts', 'vite.config.cjs'];

const ADAPTER = 'vite';

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Where a replacement points, repo-relative: a path the configuration builds,
 * `./src`, or `/src` - which Vite reads from the project's root unless it is
 * a path that is there. A bare name is a package, and no alias of the
 * repository's own.
 */
const targetOf = (repoDir: string, replacement: unknown): string | undefined => {
  const absolute =
    replacement instanceof ConfigPath
      ? replacement.path
      : typeof replacement !== 'string'
        ? undefined
        : replacement.startsWith('./') || replacement === '.'
          ? resolve(repoDir, replacement)
          : replacement.startsWith('/')
            ? isAbsolute(replacement) && existsSync(replacement)
              ? replacement
              : join(repoDir, replacement)
            : undefined;
  if (absolute === undefined) return undefined;
  const rel = toPosixPath(relative(repoDir, absolute));
  return rel.startsWith('..') ? undefined : rel || '.';
};

/** An alias as `paths`: the name itself, and the name's `/` paths where it names a directory. */
const entriesOf = (repoDir: string, find: string, target: string): Array<[string, string[]]> => {
  const key = find.replace(/\/+$/, '');
  const directory = isDirectory(join(repoDir, target)) || (!existsSync(join(repoDir, target)) && extname(target) === '');
  return directory ? [[key, [target]], [`${key}/*`, [`${target}/*`]]] : [[key, [target]]];
};

const dynamicRow = (file: string, key: string): Unresolved => ({
  file,
  line: 1,
  reason: 'framework-setting-dynamic',
  symbol: key,
  message: `${key} in ${file} is not written as a literal, so Vite's aliases are not read from it`,
  hint: `Write ${key} as a literal, or name its aliases in the tsconfig's paths.`,
  adapter: ADAPTER,
  meta: { cause: 'framework-setting-dynamic', key },
});

/** Vite's aliases for one repository, or none where it has no configuration that names any. */
export const viteConventions: ConventionsOf = (repoDir): ProjectConventions | undefined => {
  const config = readConfigLiteral(repoDir, VITE_CONFIGS);
  if (config === undefined) return undefined;
  const file = toPosixPath(relative(repoDir, config.file));
  const alias = configValueAt(config.value, 'resolve.alias');
  const rows: Unresolved[] = [];
  const paths: Record<string, string[]> = {};
  const add = (find: unknown, replacement: unknown, key: string): void => {
    if (typeof find !== 'string') {
      // A pattern is matched as Vite matches it, which `paths` cannot say.
      rows.push(dynamicRow(file, key));
      return;
    }
    const target = targetOf(repoDir, replacement);
    if (target === undefined) {
      if (replacement instanceof NotLiteral) rows.push(dynamicRow(file, key));
      return;
    }
    for (const [name, targets] of entriesOf(repoDir, find, target)) paths[name] = targets;
  };
  if (alias instanceof NotLiteral) rows.push(dynamicRow(file, 'resolve.alias'));
  else if (Array.isArray(alias)) {
    alias.forEach((entry, index) => add(configValueAt(entry, 'find'), configValueAt(entry, 'replacement'), `resolve.alias[${index}]`));
  } else if (typeof alias === 'object' && alias !== null) {
    for (const [find, replacement] of Object.entries(alias as Record<string, unknown>)) add(find, replacement, `resolve.alias['${find}']`);
  }
  if (Object.keys(paths).length === 0 && rows.length === 0) return undefined;
  return { by: file, adapter: ADAPTER, file, paths, rows, files: [file] };
};
