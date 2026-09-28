import type { ExportSpecifier, Node as TsNode, SourceFile } from 'ts-morph';
import { fileOf, lineOf } from './nodes.js';

/**
 * A position in a file, as an editor counts.
 *
 * The two halves are one value on purpose. Every consumer of this graph — the
 * command line, the server, an editor jumping to a location — treats `file:line`
 * as one fact, and a pair assembled from two different places is worse than a
 * missing one: it names a position, so nothing downstream has any reason to
 * doubt it. Carrying the pair as a value is what makes the mixed pair
 * unspellable rather than merely discouraged.
 */
export interface Location {
  /** Repo-relative POSIX path. */
  readonly file: string;
  /** 1-based line, as the editor counts. */
  readonly line: number;
}

export const sameLocation = (a: Location, b: Location): boolean =>
  a.file === b.file && a.line === b.line;

/**
 * The two facts a re-export splits apart.
 *
 * `declared` is where the thing was written. `reached` is where the reader
 * arrived at it — the file it came through and the line in *that* file that
 * carried it. For everything written where it is used the two are equal, which
 * is why the difference went unnoticed: a one-line route file that forwards a
 * verb declared at line 20 of another package reported line 20 against itself,
 * and a reader who followed the pair landed past the end of a seven-line file
 * (R99).
 *
 * Which of the two a node records is decided once, where the node is made, and
 * both are then available through {@link declaredAt} and {@link reachedAt} — so
 * no caller has to know which of them it was handed.
 */
export interface Reach {
  readonly declared: Location;
  /** Equal to `declared` whenever the thing was written where it was found. */
  readonly reached: Location;
}

/** The name a specifier exports under: its alias when it was renamed. */
const exportedAs = (specifier: ExportSpecifier): string =>
  specifier.getAliasNode()?.getText() ?? specifier.getNameNode().getText();

/**
 * One way of reading where a name leaves a file, answering with the line.
 *
 * A reader rather than one long branch, so that a spelling nobody has met yet is
 * a reader added to the list below instead of another case inside a parser.
 */
type ExportSiteReader = (through: SourceFile, name: string) => number | undefined;

/** `export { name } from …`, `export { local as name }`, `export default value`. */
const namedExportSite: ExportSiteReader = (through, name) => {
  for (const declaration of through.getExportDeclarations()) {
    for (const specifier of declaration.getNamedExports()) {
      if (exportedAs(specifier) === name) return specifier.getStartLineNumber();
    }
    const namespace = declaration.getNamespaceExport();
    if (namespace !== undefined && namespace.getName() === name) {
      return namespace.getStartLineNumber();
    }
  }
  if (name !== 'default') return undefined;
  const [assignment] = through.getExportAssignments();
  return assignment?.getStartLineNumber();
};

/**
 * `export * from './other'`, which carries every name the other module has.
 *
 * Last, because it says nothing about the one name being asked after: where a
 * file both forwards a star and names the same export, the name is the better
 * answer and the order here is what prefers it.
 */
const starExportSite: ExportSiteReader = (through) => {
  for (const declaration of through.getExportDeclarations()) {
    if (declaration.getNamedExports().length > 0) continue;
    if (declaration.getNamespaceExport() !== undefined) continue;
    return declaration.getStartLineNumber();
  }
  return undefined;
};

/** How a name may leave a file, most telling first. */
const EXPORT_SITE_READERS: readonly ExportSiteReader[] = [namedExportSite, starExportSite];

/**
 * The line of the file that carries a name out of it, when one does.
 *
 * Undefined when nothing in the file says so, which is a fact about the file and
 * not a failure worth a row: the compiler resolved the name through this module,
 * so something carried it, and whatever that was is a spelling no reader knows.
 */
export const exportSiteIn = (through: SourceFile, name: string): number | undefined => {
  for (const read of EXPORT_SITE_READERS) {
    const line = read(through, name);
    if (line !== undefined) return line;
  }
  return undefined;
};

/**
 * Both positions of a declaration a module was asked for by name.
 *
 * `through` is the file the question was asked of — the one whose path is about
 * to become a node's `file` — and `declaration` is whatever the compiler handed
 * back for `name`, which may live anywhere: the same file, a sibling, another
 * member of the workspace, an installed package.
 *
 * When the two files differ, the reached line is read out of `through` rather
 * than taken from the declaration. Failing that it is the top of the file, which
 * is a position that exists; the whole of this defect was a position that did
 * not.
 */
export const reachOf = (
  declaration: TsNode,
  through: SourceFile,
  name: string,
  rootDir: string,
): Reach => {
  const declared: Location = { file: fileOf(declaration, rootDir), line: lineOf(declaration) };
  if (declaration.getSourceFile() === through) return { declared, reached: declared };
  const reached: Location = {
    file: fileOf(through, rootDir),
    line: exportSiteIn(through, name) ?? 1,
  };
  return { declared, reached };
};

/** A position that is both answers, for a thing written where it was found. */
export const reachHere = (file: string, line: number): Reach => {
  const at: Location = { file, line };
  return { declared: at, reached: at };
};

/** The keys a node carries to say where the thing it stands for was written. */
export const DECLARED_IN = 'declaredIn';
export const DECLARED_LINE = 'declaredLine';

/**
 * What a node adds to its metadata when it was reached somewhere else.
 *
 * Nothing at all when the two positions agree, so the common node is unchanged
 * and a reader who meets these two keys knows they mean something. They are
 * worth recording even though the declaration usually has a node of its own:
 * that node exists only when the declaration could be followed into a file this
 * tool reads, and a thing reached through another module is exactly the case
 * where it sometimes cannot.
 */
export const reachMeta = (reach: Reach): Record<string, unknown> =>
  sameLocation(reach.declared, reach.reached)
    ? {}
    : { [DECLARED_IN]: reach.declared.file, [DECLARED_LINE]: reach.declared.line };

/** What a node records: the position the thing was reached at. */
export const reachedAt = (node: {
  file?: string;
  line?: number;
}): Location | undefined =>
  node.file === undefined || node.line === undefined
    ? undefined
    : { file: node.file, line: node.line };

/**
 * Where the thing a node stands for was written.
 *
 * The far position when the node was reached through another file, and the
 * node's own otherwise — so a caller asking this question never has to know
 * which of the two it is being handed.
 */
export const declaredAt = (node: {
  file?: string;
  line?: number;
  meta?: Record<string, unknown>;
}): Location | undefined => {
  const file = node.meta?.[DECLARED_IN];
  const line = node.meta?.[DECLARED_LINE];
  if (typeof file === 'string' && typeof line === 'number') return { file, line };
  return reachedAt(node);
};
