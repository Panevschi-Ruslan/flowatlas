import { ts } from 'ts-morph';
import { toPosixPath } from './ids.js';
import { boundedConfigHost } from './installs-above.js';
import { mayClimbTo, pathsOf } from './upward-walk.js';

/**
 * What a service's tsconfig names above the directory its reading is bounded
 * by (P357), so that nothing it names there is read, or left unread, without
 * a word.
 *
 * A tsconfig names other files in four places: `extends` (a path, or a
 * package's configuration), `include` and `files` (where the code is), and
 * `references` (other projects). A path is bounded at the directory the run
 * was asked to read, inside a checkout no higher than its top
 * (`readingCeilingOf`); a package at the highest directory whose install the
 * compiler reads (`installCeilingOf`). Above them:
 *
 * - a relative `extends` is read, as the compiler reads it: its compiler
 *   options are the service's, and a row says where they came from;
 * - a project `references` names is read for its aliases (P240), and said
 *   the same way;
 * - a directory `include` or `files` names is no code of the service's, and a
 *   row says it was not read;
 * - an `extends` naming a package resolves as the compiler resolves it, from
 *   an install inside its bound alone; one installed only above it is not
 *   read, and a row names it.
 */
export interface TsconfigReach {
  /** The tsconfig that names it, absolute. */
  readonly tsconfig: string;
  /** The line it is named on, 1-based. */
  readonly line: number;
  readonly key: 'extends' | 'include' | 'files' | 'references';
  /** As the tsconfig writes it. */
  readonly written: string;
  /** Where it leads, absolute. */
  readonly path: string;
  /** Whether it is read all the same: a relative `extends` or a reference is, the rest is not. */
  readonly read: boolean;
  /** Above the bound by its path, or a package installed only above it. */
  readonly why: 'above' | 'installed-above';
}

/** How many tsconfigs one chain is followed through at most. */
const CHAIN = 8;

/** Where a pattern stops being a path: the first segment with a wildcard in it. */
const WILDCARD = /[*?[{]/;

/** A package name and the path after it: `@scope/name/sub` is `@scope/name` and `sub`. */
const packageOf = (specifier: string): { name: string; subpath: string } => {
  const parts = specifier.split('/');
  const count = specifier.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, count).join('/'), subpath: parts.slice(count).join('/') };
};

/**
 * The tsconfig an `extends` naming a package leads to from a directory, as the
 * compiler finds it: `node_modules/<name>` there or in any directory above,
 * then the subpath (as written, with `.json`, or its `tsconfig.json`), or the
 * manifest's `tsconfig`, else the package's `tsconfig.json`. Asked of `host`,
 * so a bounded host finds an install inside the bound alone.
 */
export const extendedPackageConfig = (specifier: string, fromDir: string, host: ts.ParseConfigHost): string | undefined => {
  const paths = pathsOf(fromDir);
  const { name, subpath } = packageOf(specifier);
  for (let at = paths.resolve(fromDir); ; at = paths.dirname(at)) {
    const dir = paths.join(at, 'node_modules', name);
    let candidates: string[];
    if (subpath === '') {
      let field: string | undefined;
      try {
        const manifest = host.readFile(paths.join(dir, 'package.json'));
        const parsed: unknown = manifest === undefined ? undefined : JSON.parse(manifest);
        const value = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>)['tsconfig'] : undefined;
        field = typeof value === 'string' ? value : undefined;
      } catch {
        field = undefined;
      }
      candidates = [...(field === undefined ? [] : [paths.join(dir, field), paths.join(dir, `${field}.json`)]), paths.join(dir, 'tsconfig.json')];
    } else {
      const target = paths.join(dir, subpath);
      candidates = [target, `${target}.json`, paths.join(target, 'tsconfig.json')];
    }
    const found = candidates.find((candidate) => candidate.endsWith('.json') && host.fileExists(candidate));
    if (found !== undefined) return found;
    if (paths.dirname(at) === at) return undefined;
  }
};

/** The 1-based line a string is first written on in a tsconfig's text, the first line where it is not found. */
const lineOf = (text: string, written: string): number => {
  const at = text.indexOf(JSON.stringify(written));
  return at < 0 ? 1 : text.slice(0, at).split('\n').length;
};

/** The strings a value of a tsconfig names: one, or a list of them. */
const stringsOf = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];

/** Whether a path is spelled as one from the tsconfig's directory, or absolute, rather than a package's name. */
const isPath = (written: string): boolean => written.startsWith('.') || pathsOf(written).isAbsolute(written) || /^[A-Za-z]:[\\/]/.test(written);

/**
 * What the tsconfig at `configPath` names above `ceiling` by a path, or by a
 * package installed only above `installs` (P357), following its `extends`
 * while they stay inside: the `extends` of every tsconfig of the chain, the
 * `include` and `files` of the nearest that writes either, the `references`
 * of the service's own. Nothing where it names nothing above.
 */
export const tsconfigReachOf = (configPath: string | undefined, ceiling: string, installs: string = ceiling): TsconfigReach[] => {
  if (configPath === undefined) return [];
  const bounded = boundedConfigHost(installs);
  const found: TsconfigReach[] = [];
  const seen = new Set<string>();
  let rootsSaid = false;
  const visit = (path: string, own: boolean, depth: number): void => {
    const key = toPosixPath(path);
    if (depth > CHAIN || seen.has(key)) return;
    seen.add(key);
    const text = ts.sys.readFile(key);
    if (text === undefined) return;
    const read = ts.parseConfigFileTextToJson(key, text);
    const config = read.error === undefined && read.config !== null && typeof read.config === 'object' ? (read.config as Record<string, unknown>) : undefined;
    if (config === undefined) return;
    const paths = pathsOf(path);
    const dir = paths.dirname(path);
    const above = (target: string): boolean => !mayClimbTo(target, ceiling);
    const say = (each: Omit<TsconfigReach, 'tsconfig' | 'line'>): void => {
      found.push({ tsconfig: path, line: lineOf(text, each.written), ...each });
    };
    const inside: string[] = [];
    for (const written of stringsOf(config['extends'])) {
      if (isPath(written)) {
        // As the compiler finds it: as written, else with `.json`. One that is not there is read by nobody.
        const target = paths.resolve(dir, written);
        const file = [target, `${target}.json`].find((each) => ts.sys.fileExists(toPosixPath(each)));
        if (file === undefined) continue;
        if (above(paths.dirname(file))) say({ key: 'extends', written, path: file, read: true, why: 'above' });
        else inside.push(file);
        continue;
      }
      const within = extendedPackageConfig(written, dir, bounded);
      if (within !== undefined) {
        inside.push(within);
        continue;
      }
      const anywhere = extendedPackageConfig(written, dir, ts.sys);
      if (anywhere !== undefined) say({ key: 'extends', written, path: anywhere, read: false, why: 'installed-above' });
    }
    // Where the code is: said by the nearest tsconfig of the chain that says it.
    if (!rootsSaid && (config['include'] !== undefined || config['files'] !== undefined)) {
      rootsSaid = true;
      for (const entryKey of ['include', 'files'] as const) {
        for (const written of stringsOf(config[entryKey])) {
          const segments = written.replace(/\\/g, '/').split('/');
          const cut = segments.findIndex((segment) => WILDCARD.test(segment));
          const target = paths.resolve(dir, ...(cut === -1 ? segments : segments.slice(0, cut)));
          if (above(target)) say({ key: entryKey, written, path: target, read: false, why: 'above' });
        }
      }
    }
    if (own) {
      const references = Array.isArray(config['references']) ? (config['references'] as unknown[]) : [];
      for (const reference of references) {
        const written = reference !== null && typeof reference === 'object' ? (reference as { path?: unknown }).path : undefined;
        if (typeof written !== 'string') continue;
        // A project the compiler would find: the directory's tsconfig, or the file named.
        const target = paths.resolve(dir, written);
        if (!ts.sys.fileExists(toPosixPath(target)) && !ts.sys.fileExists(toPosixPath(paths.join(target, 'tsconfig.json')))) continue;
        if (above(target)) say({ key: 'references', written, path: target, read: true, why: 'above' });
      }
    }
    // Installed configurations are the package's business: their own paths are not followed.
    for (const next of inside) if (!/[\\/]node_modules[\\/]/.test(next)) visit(next, false, depth + 1);
  };
  visit(configPath, true, 0);
  return found;
};
