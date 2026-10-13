import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Directories that never hold configuration somebody wrote for this repository.
 *
 * `.terraform` is where an initialised working directory keeps the modules and
 * providers it downloaded; reading it would read somebody else's modules as this
 * repository's, and only exists where `terraform init` has run, which this
 * reader never asks for.
 */
const SKIPPED = new Set(['node_modules', '.terraform', '.git', 'dist', 'build', 'cdk.out', '.serverless', 'coverage']);

/** Files a deployment is read from: configuration, variable files and templates. */
const READ = /\.(?:tf|tf\.json|tfvars|tfvars\.json|tftpl)$/;

/** Every configuration file under a directory, repo-relative and sorted. */
export const infrastructureFiles = (repoDir: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel, depth + 1);
      else if (READ.test(entry.name)) out.push(rel);
    }
  };
  walk(repoDir, '', 0);
  return out.sort();
};

/** The directory part of a repo-relative path, `""` for the repository itself. */
export const dirOf = (file: string): string => {
  const cut = file.lastIndexOf('/');
  return cut === -1 ? '' : file.slice(0, cut);
};

/** Whether `dir` is `ancestor` or below it, both repo-relative. */
export const isWithin = (dir: string, ancestor: string): boolean =>
  ancestor === '' || dir === ancestor || dir.startsWith(`${ancestor}/`);
