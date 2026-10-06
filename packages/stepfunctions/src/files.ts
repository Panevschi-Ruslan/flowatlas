import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DefinitionFormat } from '@flowatlas/core';

/**
 * Definition files a repository keeps standing on their own, beside whatever
 * deploys them: `loan-approval.asl.json`, `returns.asl.yaml`.
 *
 * The `.asl` infix is the convention the public tooling uses for exactly this
 * - the editors that draw a state machine and the samples that ship one - and
 * it is what lets a reader find a definition without opening every JSON file
 * in a repository to ask whether it is one.
 */
const DEFINITION_FILE = /\.asl\.(json|ya?ml)$/;

/** Directories that never hold a definition somebody wrote for this repository. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'coverage', 'cdk.out']);

/** How deep the walk goes; a definition is never further down than this. */
const MAX_DEPTH = 12;

/** Every definition file under a repository, repo-relative, POSIX and sorted. */
export const definitionFiles = (repoDir: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path, depth + 1);
      else if (DEFINITION_FILE.test(entry.name)) out.push(path);
    }
  };
  walk(repoDir, '', 0);
  return out.sort();
};

/** The format a definition file is written in, by its name. */
export const formatOfDefinition = (file: string): DefinitionFormat =>
  DEFINITION_FILE.exec(file)?.[1] === 'json' ? 'json' : 'yaml';

/** The name a definition's file gives it: `statemachine/loan-approval.asl.json` is `loan-approval`. */
export const nameOfDefinition = (file: string): string =>
  (file.split('/').pop() ?? file).replace(DEFINITION_FILE, '');
