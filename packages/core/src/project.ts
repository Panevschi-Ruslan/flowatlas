import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Project, ts } from 'ts-morph';

export interface CreateProjectOptions {
  /** Absolute path to the repository root. */
  rootDir: string;
  /** Path to a tsconfig, absolute or relative to the root. */
  tsconfig?: string;
  /** Extra globs to add, relative to the root. */
  include?: string[];
}

/** Directories that never hold sources worth reading. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);

/**
 * The extensions a TypeScript repository keeps its code in.
 *
 * Both of them, and not because every reader wants both. A reader that wants
 * fewer says so through `include`, which is what makes the set of files a
 * property of the reader rather than of this module. What this constant fixes
 * is the default, and the default has to be every kind of source a repository
 * has, because the alternative was read for a long time as a statement about
 * the repository: globbing `.ts` alone meant a directory that is a browser and
 * a server at once could only ever be half read, and the half that was missing
 * was decided here rather than by anyone who could see the consequence.
 *
 * The suffix carries no meaning beyond "this file may hold markup". A route
 * handler that answers with an image is written in `.tsx` for that reason
 * alone, and it is a route handler.
 */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

/**
 * Files that are compiled but say nothing about the shape of the system.
 *
 * Written as stems crossed with {@link SOURCE_EXTENSIONS} rather than as a
 * literal list, so that adding an extension cannot silently start reading
 * everyone's tests in it.
 */
const SKIPPED_STEMS = ['.spec', '.test', '.e2e-spec'] as const;

const SKIPPED_SUFFIXES = [
  ...SKIPPED_STEMS.flatMap((stem) => SOURCE_EXTENSIONS.map((ext) => `${stem}${ext}`)),
  '.d.ts',
];

/** Tried in order when the caller does not name one. */
export const TSCONFIG_CANDIDATES = [
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.app.json',
] as const;

/**
 * What the compiler is told when the repository tells it nothing.
 *
 * A repository with no tsconfig is not an exotic case: it is what `extract`
 * meets whenever it is pointed at a bare directory, and since
 * {@link SOURCE_EXTENSIONS} names both kinds of source, every reader meets it
 * with `.tsx` files in hand.
 *
 * `jsx` is here because without it the compiler answers `Cannot use JSX unless
 * the '--jsx' flag is provided` on every file of markup in such a repository.
 * Measured, that is a semantic complaint and not a parse failure — the file is
 * still parsed as markup, because the extension is what decides that, and the
 * two readers recognise a component from the syntax rather than from its type,
 * so the graph of the fixture beside this comment is the same either way. What
 * the setting fixes is the claim: a project configured to reject the only kind
 * of file half its globs match is describing a repository nobody has, and
 * anything that ever asks the checker about markup — a component's own return
 * type, a prop's shape — would be asking an error type. `Preserve` is the one
 * setting that asks for parsing and nothing else; the others each name a
 * runtime whose types would then have to resolve.
 *
 * `strict` is off because this reads other people's code and a shape that does
 * not typecheck is still a shape worth reading; `allowJs` is off because a
 * repository's compiled output is not its source.
 */
const FALLBACK_COMPILER_OPTIONS = {
  allowJs: false,
  strict: false,
  jsx: ts.JsxEmit.Preserve,
} as const;

export const findTsconfig = (rootDir: string, tsconfig?: string): string | undefined => {
  if (tsconfig !== undefined) {
    const path = tsconfig.startsWith('/') ? tsconfig : join(rootDir, tsconfig);
    return existsSync(path) ? path : undefined;
  }
  for (const candidate of TSCONFIG_CANDIDATES) {
    const path = join(rootDir, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
};

/**
 * Loads a repository for analysis.
 *
 * Files are added by glob rather than from the tsconfig, because a repository
 * usually compiles its tests and build output too and reading those doubles the
 * work for nothing. The tsconfig is still honoured for compiler options and
 * path mappings, which is what type resolution depends on.
 */
export const createProject = (options: CreateProjectOptions): Project => {
  const { rootDir, tsconfig, include } = options;
  const tsConfigFilePath = findTsconfig(rootDir, tsconfig);

  const project = new Project({
    ...(tsConfigFilePath === undefined ? {} : { tsConfigFilePath }),
    skipAddingFilesFromTsConfig: true,
    ...(tsConfigFilePath === undefined ? { compilerOptions: FALLBACK_COMPILER_OPTIONS } : {}),
  });

  const sourceRoot = existsSync(join(rootDir, 'src')) ? 'src' : '.';
  const globs = include ?? SOURCE_EXTENSIONS.map((ext) => `${sourceRoot}/**/*${ext}`);
  project.addSourceFilesAtPaths([
    ...globs.map((glob) => join(rootDir, glob)),
    ...[...SKIPPED_DIRECTORIES].map((dir) => `!${join(rootDir, `**/${dir}/**`)}`),
    ...SKIPPED_SUFFIXES.map((suffix) => `!${join(rootDir, `**/*${suffix}`)}`),
  ]);
  return project;
};

/**
 * The files {@link createProject} would add, listed without parsing any of them.
 *
 * What a build needs to answer "did anything change here" before deciding to
 * read a repository at all. The two must agree, which `sources.test.ts` checks
 * against a fixture rather than trusting the two lists to stay in step.
 */
export const listRepoSources = (rootDir: string): string[] => {
  const sourceRoot = existsSync(join(rootDir, 'src')) ? 'src' : '.';
  const out: string[] = [];

  const walk = (relative: string): void => {
    let entries;
    try {
      entries = readdirSync(join(rootDir, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path);
        continue;
      }
      if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      if (SKIPPED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
      out.push(path);
    }
  };

  walk(sourceRoot === '.' ? '' : sourceRoot);
  return out.sort();
};
