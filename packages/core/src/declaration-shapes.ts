import { join } from 'node:path';
import { ts, type Project } from 'ts-morph';
import { WORK_COUNTS } from './work-counts.js';

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
  /**
   * The shape file of the project's own this was read from (P78), as an
   * absolute path; absent for a shape a reader ships.
   */
  readonly origin?: string;
}

/**
 * Where a package's types come from when an import names it, strongest first
 * (P78, D3): what is installed is what runs; the source of a repository read
 * here is the real surface; a shape file the project wrote knows the project's
 * own use; a reader's built-in shape knows the framework's.
 */
export const RESOLUTION_ORDER = ['installed', 'package-from-repo', 'shape-file', 'built-in'] as const;

export type ResolutionSource = (typeof RESOLUTION_ORDER)[number];

/** The first source that has the package, in {@link RESOLUTION_ORDER}; undefined when none does. */
export const resolutionOrder = (
  has: Readonly<Partial<Record<ResolutionSource, boolean>>>,
): ResolutionSource | undefined => RESOLUTION_ORDER.find((source) => has[source] === true);

/** A shape file read, or why it could not be. */
export interface ShapeFileReading {
  readonly path: string;
  readonly shapes: readonly DeclarationShape[];
  /** Why nothing of it is used: it is not there, does not parse, or declares no module. */
  readonly problem?: string;
}

const isImporting = (statement: ts.Statement): boolean =>
  ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement);

const isExporting = (statement: ts.Statement): boolean =>
  ts.isExportDeclaration(statement) ||
  ts.isExportAssignment(statement) ||
  (ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));

/**
 * The `declare module '<package>' { ... }` blocks of a shape file, each as the
 * declarations of that package (P78).
 *
 * Only parsed, never run. The block's body is the text a package's
 * `index.d.ts` would hold, so a block is installed exactly as a built-in shape
 * is, at the path an installed copy would have; the first block for a package
 * wins, the way the first shape always has.
 */
export const readShapeFile = (path: string, text: string | undefined): ShapeFileReading => {
  if (text === undefined) return { path, shapes: [], problem: 'the file is not there' };
  WORK_COUNTS.shapeFilesRead += 1;
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (file as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const first = diagnostics[0];
  if (first !== undefined) {
    const line = first.start === undefined ? 1 : file.getLineAndCharacterOfPosition(first.start).line + 1;
    return {
      path,
      shapes: [],
      problem: `it does not parse: line ${line}, ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`,
    };
  }
  const shapes: DeclarationShape[] = [];
  for (const statement of file.statements) {
    if (!ts.isModuleDeclaration(statement) || !ts.isStringLiteral(statement.name)) continue;
    const body = statement.body;
    if (body === undefined || !ts.isModuleBlock(body)) continue;
    const name = statement.name.text;
    if (name === '' || shapes.some((shape) => shape.package === name)) continue;
    // A block with no export of its own exports everything it declares; the
    // same text as a file would export nothing and be no module at all, so
    // each declaration is exported in so many words.
    const exportsSome = body.statements.some(isExporting);
    const declarations = body.statements
      .map((each) => (exportsSome || isImporting(each) ? each.getFullText(file) : `\nexport ${each.getText(file)}`))
      .join('')
      .trim();
    shapes.push({ package: name, declarations: `${declarations}\n`, origin: path });
  }
  return shapes.length === 0
    ? { path, shapes, problem: "it declares no module: write `declare module '<package>' { ... }`" }
    : { path, shapes };
};

const SHAPES_OF = new WeakMap<Project, ReadonlyMap<string, string>>();

/** The shape files of the project's own a project installed, by package, to the file each came from. */
const ORIGINS_OF = new WeakMap<Project, ReadonlyMap<string, { readonly path: string; readonly origin: string }>>();

/** The paths the shapes of a project are held at, for asking of a file without a scan (P82). */
const PATHS_OF = new WeakMap<Project, ReadonlySet<string>>();

/** The shape files of the project's own a project installed, by the path each is held at. */
const BY_PATH_OF = new WeakMap<Project, ReadonlyMap<string, { readonly package: string; readonly origin: string }>>();

/** The probe a package is resolved from: a file at the root, which need not exist. */
const PROBE = '__flowatlas_shape_probe__.ts';

/**
 * Whether the compiler resolves a package from the root, as the project is set
 * up: one question per shape, asked through one resolution cache for all of
 * them (P82), because a project that keeps many shape files asks many names of
 * the same directories.
 */
const resolverAt = (project: Project, rootDir: string): ((name: string) => boolean) => {
  const options = project.getCompilerOptions();
  const host = project.getModuleResolutionHost();
  const probe = join(rootDir, PROBE);
  const cache = ts.createModuleResolutionCache(
    host.getCurrentDirectory?.() ?? rootDir,
    (path) => (ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase()),
    options,
  );
  return (name) => ts.resolveModuleName(name, probe, options, host, cache).resolvedModule !== undefined;
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
  const origins = new Map<string, { path: string; origin: string }>();
  const resolves = resolverAt(project, rootDir);
  for (const shape of shapes) {
    if (installed.has(shape.package) || resolves(shape.package)) continue;
    const path = join(rootDir, 'node_modules', shape.package, 'index.d.ts');
    if (project.getSourceFile(path) !== undefined) continue;
    project.createSourceFile(path, shape.declarations, { overwrite: false });
    installed.set(shape.package, path);
    if (shape.origin !== undefined) origins.set(shape.package, { path, origin: shape.origin });
  }
  SHAPES_OF.set(project, installed);
  PATHS_OF.set(project, new Set(installed.values()));
  ORIGINS_OF.set(project, origins);
  BY_PATH_OF.set(project, new Map([...origins].map(([pkg, { path, origin }]) => [path, { package: pkg, origin }])));
  return [...installed.keys()].sort();
};

/** The packages a shape stands in for in this project, by name. */
export const declarationShapesOf = (project: Project): string[] =>
  [...(SHAPES_OF.get(project)?.keys() ?? [])].sort();

/** Whether a file is a shape held in memory rather than a file of the repository. */
export const isDeclarationShape = (project: Project, filePath: string): boolean =>
  PATHS_OF.get(project)?.has(filePath) === true;

/**
 * The shape file of the project's own that a file held in memory was read
 * from, with the package it stands in for; undefined for any other file, a
 * reader's built-in shape included.
 */
export const shapeFileOf = (
  project: Project,
  filePath: string,
): { readonly package: string; readonly origin: string } | undefined => BY_PATH_OF.get(project)?.get(filePath);

/** The packages a shape file of the project's own stands in for in this project, to the file. */
export const shapeFilesOf = (project: Project): ReadonlyMap<string, string> =>
  new Map([...(ORIGINS_OF.get(project) ?? [])].map(([pkg, { origin }]) => [pkg, origin]));
