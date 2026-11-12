import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadedConfig, ProjectGraph, RepoGraph } from '@flowatlas/core';
import type { DiffSource, LinkReport } from '@flowatlas/linker';
import type { BuildAtRefResult } from '../git/build-at-ref.js';
import { PULLED_DIR, pulledServiceGraphPath, pulledSource } from './bundle.js';

/**
 * The team's pulled graph as one side of `diff` (P236): what main is, as CI
 * built it, so a branch of one repository is compared with it and no base is
 * built at all. Each service says the commit CI read it at.
 */
export const pulledSide = (loaded: LoadedConfig): BuildAtRefResult => {
  const dir = join(loaded.outputDir, PULLED_DIR);
  const source = pulledSource(loaded.outputDir);
  if (source === undefined || !existsSync(join(dir, 'project-graph.json'))) {
    throw new Error("nothing is pulled: run flowatlas pull first");
  }
  const graph = JSON.parse(readFileSync(join(dir, 'project-graph.json'), 'utf8')) as ProjectGraph;
  const report = JSON.parse(readFileSync(join(dir, 'link-report.json'), 'utf8')) as LinkReport;
  const repoGraphs: Record<string, RepoGraph> = {};
  const sources: Record<string, DiffSource> = {};
  for (const service of loaded.config.services) {
    const path = pulledServiceGraphPath(loaded.outputDir, service.name);
    if (existsSync(path)) repoGraphs[service.name] = JSON.parse(readFileSync(path, 'utf8')) as RepoGraph;
    const commit = source.manifest.services.find((item) => item.name === service.name)?.commit ?? null;
    sources[service.name] = { sha: commit, ref: 'pulled', cached: true, nodeModules: 'present' };
  }
  return { graph, report, repoGraphs, dbPath: join(dir, 'graph.db'), sources, warnings: [], worktrees: [], ms: 0 };
};
