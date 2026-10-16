import { join } from 'node:path';
import { ts, type Project } from 'ts-morph';

/**
 * A small declaration of a package's public surface, read in its place when the
 * package is not installed.
 *
 * A repository cloned without its dependencies still names the classes it
 * injects and the types it returns, and every one of those names that points
 * into a missing package is a type nothing can see into: an injected client
 * whose calls go nowhere, a return type written as a row instead of a shape.
 * A shape is the few declarations a reader needs from that package, written
 * by hand in the package's own spelling, so the checker resolves the import as
 * it would against the real thing.
 *
 * The core holds the mechanism and, of shapes, only the stream library's, which
 * belongs to no framework and more than one reader needs (`rxjs-shape.ts`):
 * which other packages are worth one, and what they declare, is the business
 * of the reader that understands them.
 */
export interface DeclarationShape {
  /** The package name an import is written with, e.g. `@scope/name`. */
  readonly package: string;
  /** The declarations, as the text of the package's `index.d.ts`. */
  readonly declarations: string;
}

const SHAPES_OF = new WeakMap<Project, ReadonlyMap<string, string>>();

/** The probe a package is resolved from: a file at the root, which need not exist. */
const PROBE = '__flowatlas_shape_probe__.ts';

/** Whether the compiler resolves the package from the root, as the project is set up. */
const resolves = (project: Project, rootDir: string, name: string): boolean => {
  const { resolvedModule } = ts.resolveModuleName(
    name,
    join(rootDir, PROBE),
    project.getCompilerOptions(),
    project.getModuleResolutionHost(),
  );
  return resolvedModule !== undefined;
};

/**
 * Stands each shape in for its package where the package does not resolve.
 *
 * The shape is held in memory at the path an installed copy would have, under
 * the root's `node_modules`, so a file is told to be a package's by the same
 * path every reader already asks, and nothing on disk is written. A package
 * that resolves is left alone: an installed package always says more than its
 * shape, and a shape is never read beside the real thing.
 *
 * Called before the program is first built, which is when imports resolve.
 */
export const installDeclarationShapes = (
  project: Project,
  rootDir: string,
  shapes: readonly DeclarationShape[],
): string[] => {
  const installed = new Map<string, string>();
  for (const shape of shapes) {
    if (installed.has(shape.package) || resolves(project, rootDir, shape.package)) continue;
    const path = join(rootDir, 'node_modules', shape.package, 'index.d.ts');
    if (project.getSourceFile(path) !== undefined) continue;
    project.createSourceFile(path, shape.declarations, { overwrite: false });
    installed.set(shape.package, path);
  }
  SHAPES_OF.set(project, installed);
  return [...installed.keys()].sort();
};

/** The packages a shape stands in for in this project, by name. */
export const declarationShapesOf = (project: Project): string[] =>
  [...(SHAPES_OF.get(project)?.keys() ?? [])].sort();

/** Whether a file is a shape held in memory rather than a file of the repository. */
export const isDeclarationShape = (project: Project, filePath: string): boolean => {
  const installed = SHAPES_OF.get(project);
  if (installed === undefined) return false;
  for (const path of installed.values()) if (path === filePath) return true;
  return false;
};
