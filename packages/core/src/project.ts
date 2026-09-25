import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Project } from 'ts-morph';

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
    ...(tsConfigFilePath === undefined
      ? { compilerOptions: { allowJs: false, strict: false } }
      : {}),
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
