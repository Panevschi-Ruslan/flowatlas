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

/** Files that are compiled but say nothing about the shape of the system. */
const SKIPPED_SUFFIXES = ['.spec.ts', '.test.ts', '.e2e-spec.ts', '.d.ts'];

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
  const globs = include ?? [`${sourceRoot}/**/*.ts`];
  project.addSourceFilesAtPaths([
    ...globs.map((glob) => join(rootDir, glob)),
    `!${join(rootDir, '**/node_modules/**')}`,
    `!${join(rootDir, '**/dist/**')}`,
    `!${join(rootDir, '**/build/**')}`,
    `!${join(rootDir, '**/*.spec.ts')}`,
    `!${join(rootDir, '**/*.test.ts')}`,
    `!${join(rootDir, '**/*.e2e-spec.ts')}`,
    `!${join(rootDir, '**/*.d.ts')}`,
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
      if (!entry.name.endsWith('.ts')) continue;
      if (SKIPPED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
      out.push(path);
    }
  };

  walk(sourceRoot === '.' ? '' : sourceRoot);
  return out.sort();
};
