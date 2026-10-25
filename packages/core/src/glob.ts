import { readdirSync, type Dirent } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * The one glob grammar every pattern over files is read with (P80).
 *
 * Two readers used to have two: an accepted `file` rule read `?` as itself and
 * compiled `src/**\/x` so that it did not match `src/x`, while `shapes` read `?`
 * as one character and let `**` match no segment at all. A person who wrote the
 * same glob in both places got two answers. This is the shell's grammar, written
 * once:
 *
 * - separators are normalised to `/`, in the pattern and in the path tested;
 * - `*` is any run of characters within one segment;
 * - `?` is one character within one segment;
 * - `**`, as a whole segment, is zero or more segments, so `src/**\/x` matches
 *   `src/x` and `src/a/b/x`, and `src/**` matches everything under `src`;
 * - `**` inside a segment (`a**b`) is two `*`, and stays within the segment;
 * - everything else is literal: a dot, a bracket, a brace.
 *
 * A route pattern is not a path on disk and keeps its own grammar, where `*` is
 * any run including `/` (`GET /api/*` covers `/api/a/b`); see
 * `compileRoutePattern` beside the accepted rules.
 */
export interface Glob {
  /** The pattern as written. */
  readonly pattern: string;
  test(path: string): boolean;
}

const slashed = (text: string): string => text.replace(/\\/g, '/');

const literal = (char: string): string => char.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** One segment, which never holds a `/`, as regular-expression source. */
const segmentSource = (segment: string): string =>
  [...segment].map((char) => (char === '*' ? '[^/]*' : char === '?' ? '[^/]' : literal(char))).join('');

/** Whether a path pattern names more than one path: it holds `*` or `?`. */
export const isGlob = (pattern: string): boolean => /[*?]/.test(pattern);

/**
 * A glob compiled once, to be tested against many paths.
 *
 * A `**` segment takes the separator beside it with it, which is what lets it
 * match nothing: `a/**\/b` is `a`, then any number of `/segment`, then `/b`.
 */
export const compileGlob = (pattern: string): Glob => {
  // `**/**` says no more than `**`.
  const segments = slashed(pattern)
    .split('/')
    .filter((segment, index, all) => !(segment === '**' && all[index - 1] === '**'));
  const last = segments.length - 1;
  let source = '';
  segments.forEach((segment, index) => {
    if (segment === '**') {
      if (index === 0) source += last === 0 ? '.*' : '(?:[^/]+/)*';
      else source += index === last ? '(?:/.*)?' : '(?:/[^/]+)*';
      return;
    }
    // A leading `**` took the separator after it.
    const separator = index === 0 || (index === 1 && segments[0] === '**') ? '' : '/';
    source += `${separator}${segmentSource(segment)}`;
  });
  const expression = new RegExp(`^${source}$`);
  return { pattern, test: (path) => expression.test(slashed(path)) };
};

/** Directories a glob never walks into. */
export const NEVER_WALKED: ReadonlySet<string> = new Set(['node_modules', '.git']);

/**
 * The files a path or glob names under a base, absolute and sorted.
 *
 * A plain path is returned whether or not it is there, so a file named and
 * missing can be said to be missing. A glob is walked from its longest fixed
 * prefix, a segment at a time, each tested with the grammar above; a `**`
 * segment walks every directory below except `node_modules` and `.git`.
 */
export const expandGlob = (base: string, pattern: string): string[] => {
  const written = slashed(pattern);
  if (!isGlob(written)) return [isAbsolute(written) ? written : resolve(base, written)];
  const absolute = isAbsolute(written) ? written : slashed(resolve(base, written));
  const segments = absolute.split('/');
  const fixed = segments.findIndex((segment) => isGlob(segment));
  const start = segments.slice(0, fixed).join('/') || '/';
  const rest = segments.slice(fixed);
  const tests = rest.map((segment) => (segment === '**' ? undefined : compileGlob(segment)));
  const found: string[] = [];
  const walk = (dir: string, at: number): void => {
    const segment = rest[at];
    if (segment === undefined) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const final = at === rest.length - 1;
    const test = tests[at];
    if (test === undefined) {
      walk(dir, at + 1);
      for (const entry of entries) {
        if (entry.isDirectory() && !NEVER_WALKED.has(entry.name)) walk(join(dir, entry.name), at);
      }
      return;
    }
    for (const entry of entries) {
      if (!test.test(entry.name)) continue;
      const path = join(dir, entry.name);
      if (final) {
        if (entry.isFile()) found.push(path);
      } else if (entry.isDirectory() && !NEVER_WALKED.has(entry.name)) {
        walk(path, at + 1);
      }
    }
  };
  walk(start, 0);
  return [...new Set(found)].sort();
};
