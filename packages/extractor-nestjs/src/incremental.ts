import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileOf, hasDecorator, normalizeFilePath, type RepoGraph } from '@flowatlas/core';
import type { Project, SourceFile } from 'ts-morph';
import { findBootstrapFile } from './bootstrap.js';
import { createRepoProject, extractRepo, type ExtractRepoOptions } from './extract-repo.js';
import { NEST_COMMON } from './index-classes.js';

/**
 * A repository held open between rebuilds.
 *
 * Everything a rebuild needs is here: what the repository was opened with, and
 * the project that parsing it produced. Keeping the project alive is the whole
 * point, because on a repository the size of a real service parsing costs more
 * than every analysis pass put together.
 */
export interface WarmRepo {
  readonly options: ExtractRepoOptions;
  project: Project;
}

/** What a scoped extraction produced, and how much of the repository it covers. */
export interface ScopedExtract {
  graph: RepoGraph;
  /**
   * Always `repository` here. This extractor re-derives the whole repository
   * from the project it already has, because its passes reach across files:
   * a channel name, a table, an address traced back through a shared client
   * and the count of calls into installed packages are all repository-wide
   * facts that a file-scoped sweep would get wrong. See P14 §9 D10.
   */
  covers: 'repository' | readonly string[];
}

export const openRepo = (options: ExtractRepoOptions): WarmRepo => ({
  options,
  project: options.project ?? createRepoProject(options),
});

/** Throws the parsed project away and parses again, for a full rebuild. */
export const reopenRepo = (repo: WarmRepo): void => {
  repo.project = createRepoProject(repo.options);
};

/** Source files of the repository itself, repo-relative and sorted. */
export const repoFiles = (repo: WarmRepo): string[] =>
  sourceFilesOf(repo)
    .map((sourceFile) => fileOf(sourceFile, repo.options.rootDir))
    .sort();

const sourceFilesOf = (repo: WarmRepo): SourceFile[] =>
  repo.project
    .getSourceFiles()
    .filter((sourceFile) => !sourceFile.getFilePath().includes('/node_modules/'));

/**
 * What each file of the repository imports, one level, repo-relative.
 *
 * Recorded in the build cache so that a watch can answer "who depends on this"
 * without walking the imports of the whole repository on every save.
 */
export const importsOf = (repo: WarmRepo): Record<string, string[]> => {
  const { rootDir } = repo.options;
  const out: Record<string, string[]> = {};
  for (const sourceFile of sourceFilesOf(repo)) {
    const targets = new Set<string>();
    for (const declaration of [
      ...sourceFile.getImportDeclarations(),
      ...sourceFile.getExportDeclarations(),
    ]) {
      const target = declaration.getModuleSpecifierSourceFile();
      if (target === undefined) continue;
      if (target.getFilePath().includes('/node_modules/')) continue;
      targets.add(fileOf(target, rootDir));
    }
    out[fileOf(sourceFile, rootDir)] = [...targets].sort();
  }
  return out;
};

/**
 * Files that import any of these, one level.
 *
 * One level is enough for the edges this extractor draws: a call edge lives in
 * the file holding the call site, and that file imports the class it calls,
 * directly or through the file declaring the token it is injected under. A
 * transitive closure would turn a one-file edit into most of the repository.
 */
export const dependentsOf = (repo: WarmRepo, files: readonly string[]): string[] => {
  const wanted = new Set(files);
  const imports = importsOf(repo);
  return Object.entries(imports)
    .filter(([file, deps]) => !wanted.has(file) && deps.some((dep) => wanted.has(dep)))
    .map(([file]) => file)
    .sort();
};

/**
 * Files whose change is felt everywhere in the repository.
 *
 * The entry file installs the global guards, interceptors and pipes, and a file
 * declaring a module decides which classes the container knows about and which
 * module every one of them belongs to. Neither can be re-read on its own, so a
 * change to either is answered with a full re-read rather than with cleverness.
 */
export const globalFiles = (repo: WarmRepo): string[] => {
  const { rootDir, service } = repo.options;
  const out = new Set<string>();

  const bootstrap = findBootstrapFile(rootDir, repo.options.bootstrap ?? service?.bootstrap);
  if (bootstrap !== undefined) out.add(normalizeFilePath(bootstrap, rootDir));

  for (const sourceFile of sourceFilesOf(repo)) {
    const declaresModule = sourceFile
      .getClasses()
      .some((declaration) => hasDecorator(declaration, 'Module', NEST_COMMON));
    if (declaresModule) out.add(fileOf(sourceFile, rootDir));
  }
  return [...out].sort();
};

/** Brings the parsed project back in line with the files named, then reads. */
export const extractRepoIncremental = async (
  repo: WarmRepo,
  options: { files: readonly string[] },
): Promise<ScopedExtract> => {
  refreshFiles(repo, options.files);
  const graph = await extractRepo({ ...repo.options, project: repo.project });
  return { graph, covers: 'repository' };
};

/** Reads the repository from scratch, parsing it again first. */
export const extractRepoFull = async (repo: WarmRepo): Promise<RepoGraph> => {
  reopenRepo(repo);
  return extractRepo({ ...repo.options, project: repo.project });
};

const refreshFiles = (repo: WarmRepo, files: readonly string[]): void => {
  for (const file of files) {
    const path = join(repo.options.rootDir, file);
    const existing = repo.project.getSourceFile(path);
    if (!existsSync(path)) {
      if (existing !== undefined) repo.project.removeSourceFile(existing);
      continue;
    }
    if (existing === undefined) repo.project.addSourceFileAtPath(path);
    else existing.refreshFromFileSystemSync();
  }
};
