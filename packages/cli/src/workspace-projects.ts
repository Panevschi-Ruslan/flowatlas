import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { isWithinDir, workspaceApplicationOf, type WorkspaceApplication } from '@flowatlas/core';

/**
 * What a workspace's build tool says its projects are, for `init` and `link` (R180).
 *
 * A workspace that keeps one manifest for everything describes its applications
 * and libraries in a file of its build tool's instead: the Nest command line's
 * `nest-cli.json` and Angular's `angular.json` list every project under
 * `projects` with its `root`, the older Nx `workspace.json` does the same, and Nx
 * puts a `project.json` in each project's own directory. None of them is needed
 * to read an application - the core decides that from the application's own
 * tsconfig (`workspaceApplicationOf`) - but they are what says which directories
 * are applications rather than libraries, and what each is called, which is
 * what `init` offers and `link` names.
 *
 * A table of readers rather than a chain of tests: one row per file a tool keeps
 * its projects in, so a fourth tool is a row.
 */
export interface DescribedProject {
  /** Absolute directory of the project. */
  readonly dir: string;
  /** What the description calls it. */
  readonly name: string;
  readonly application: boolean;
  /** The file that says so, relative to the workspace root. */
  readonly from: string;
}

const readJson = (path: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** `projects` keyed by name, each an object with a `root` and a word saying what it is, or a bare root. */
const projectsMap =
  (file: string, kindKey: string) =>
  (root: string): DescribedProject[] => {
    const description = readJson(join(root, file));
    if (description === undefined) return [];
    return Object.entries(record(description['projects'])).flatMap(([name, value]) => {
      const project = typeof value === 'string' ? { root: value } : record(value);
      const at = text(project['root']);
      if (at === undefined) return [];
      return [{ dir: resolve(root, at), name, application: project[kindKey] !== 'library', from: file }];
    });
  };

/**
 * The project `nest-cli.json` describes at its top level, when it is a monorepo:
 * the default application, which `projects` does not list again.
 */
const nestDefaultProject = (root: string): DescribedProject[] => {
  const description = readJson(join(root, 'nest-cli.json'));
  const at = text(description?.['root']);
  if (description?.['monorepo'] !== true || at === undefined) return [];
  return [{ dir: resolve(root, at), name: basename(at), application: true, from: 'nest-cli.json' }];
};

/** Descriptions kept at the workspace root, each listing every project. */
const AT_ROOT: ReadonlyArray<(root: string) => DescribedProject[]> = [
  projectsMap('nest-cli.json', 'type'),
  nestDefaultProject,
  projectsMap('angular.json', 'projectType'),
  projectsMap('workspace.json', 'projectType'),
];

/** The description a project keeps in its own directory. */
const IN_PROJECT = 'project.json';

const inProject = (dir: string, root: string): DescribedProject | undefined => {
  const description = readJson(join(dir, IN_PROJECT));
  if (description === undefined) return undefined;
  return {
    dir,
    name: text(description['name']) ?? basename(dir),
    application: description['projectType'] !== 'library',
    from: relative(root, join(dir, IN_PROJECT)).split('\\').join('/'),
  };
};

/** Directories a walk for per-project descriptions never enters. */
const NEVER_A_PROJECT = new Set(['node_modules', 'dist', 'build', 'coverage', 'tmp']);

/** How deep under the root a per-project description is looked for: `apps/<name>`, `packages/group/<name>`. */
const DEEPEST = 3;

/** Every project the workspace at `root` describes, applications and libraries, by directory. */
export const describedProjects = (root: string): DescribedProject[] => {
  const found = new Map<string, DescribedProject>();
  for (const read of AT_ROOT) for (const project of read(root)) if (!found.has(project.dir)) found.set(project.dir, project);
  const visit = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || NEVER_A_PROJECT.has(entry.name)) continue;
      const child = join(dir, entry.name);
      const project = inProject(child, root);
      if (project !== undefined && !found.has(child)) found.set(child, project);
      if (depth < DEEPEST) visit(child, depth + 1);
    }
  };
  visit(root, 1);
  return [...found.values()].filter((project) => project.dir !== resolve(root) && isWithinDir(project.dir, root));
};

/** What a workspace's description says of one directory, when it says anything. */
export const describedProject = (application: WorkspaceApplication): DescribedProject | undefined =>
  inProject(application.dir, application.root) ??
  AT_ROOT.flatMap((read) => read(application.root)).find((project) => project.dir === application.dir);

/**
 * The applications of the workspace rooted at `root` that this tool can read as
 * services: described as applications, and applications of the workspace by the
 * core's own rule, so `init` never offers a directory `build` would read without
 * a manifest.
 */
export const workspaceApplicationsIn = (root: string): Array<WorkspaceApplication & { name: string }> =>
  describedProjects(root).flatMap((project) => {
    if (!project.application) return [];
    const application = workspaceApplicationOf(project.dir);
    return application === undefined || application.root !== resolve(root) ? [] : [{ ...application, name: project.name }];
  });
