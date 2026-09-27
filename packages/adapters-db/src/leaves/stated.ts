import { declarationOf, type TypeOrigin } from '@flowatlas/core';
import { Node, SyntaxKind, type Node as TsNode } from 'ts-morph';

/**
 * What the source says a receiver's type is, when the checker will not say.
 *
 * A fresh clone has no `node_modules`, so the checker resolves nothing that
 * comes out of a package, and the reader used to stop there: measured over all
 * eight coverage targets, an uninstalled repository had no data layer at all -
 * immich's 579 query sites read as 0 - and what stood in their place was rows.
 * Most of that is honest, because a table name is usually a fact about a type
 * that a package declares. Part of it is not, and this is the part: the two
 * facts this reading needs are written in the repository being read, in plain
 * sight, whether or not anything is installed.
 *
 *     import { Kysely } from 'kysely';
 *     constructor(@InjectKysely() private db: Kysely<DB>) {}
 *
 * The annotation names the type and the import names the package, and together
 * they say which library declares the receiver - the one thing the descriptor
 * was missing. The table was never missing: it is the first argument of the
 * call, a string the author wrote.
 *
 * This is the reading the entries side already does with a decorator, for the
 * same reason and almost in the same words: read off the import statement
 * rather than resolved through the checker, because the statement is there in
 * every state of the repository, including a fixture and a fresh clone where no
 * package resolves (R84). What is new is only that a data layer's receiver is
 * an annotated value rather than a decorator's name.
 *
 * It is the checker's fallback and never its rival. The caller asks this only
 * where a resolved type produced no descriptor, so an installed repository
 * reads exactly as it did before. And an answer from here is never `static`:
 * the source states what the author meant rather than what a compiler checked,
 * and `heuristic` is where this tool puts a reading of shape.
 */

/**
 * The package a module specifier names, or undefined when it names a file.
 *
 * The same rule `@flowatlas/adapters-entry` states for the entries side - a
 * subpath import of a package is an import of that package - and deliberately
 * not imported from there. One reader of specifiers belongs in
 * `@flowatlas/core`, where neither side owns it; moving it is a change to a
 * package two other tickets have open this batch, so it is written twice for
 * one batch and recorded here as the debt that is.
 */
const packageOfSpecifier = (specifier: string): string | undefined => {
  if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/')) return undefined;
  const [first, second] = specifier.split('/');
  if (first === undefined || first === '') return undefined;
  if (!first.startsWith('@')) return first;
  return second === undefined || second === '' ? undefined : `${first}/${second}`;
};

/**
 * Where a declaration states the type of what it holds, by the kind it is.
 *
 * A lookup rather than a run of conditions, so a fourth place a type can be
 * written is a row here. Two kinds of statement, and each is a reading the
 * checker performs when it can: an annotation naming the type, and a class of
 * one's own whose base comes out of a package, because `class VideoModel
 * extends Model<Video>` is a data layer as surely as an injected connection is
 * and is how most of a real repository's models are declared.
 *
 * An initialiser is deliberately not among them. `const db = makeDb()` states
 * nothing about a type; following it is the checker's work, and guessing at it
 * would be a third answer to a question that already has two.
 */
const STATED_TYPE: Partial<Record<SyntaxKind, (node: TsNode) => TsNode | undefined>> = {
  [SyntaxKind.Parameter]: (node) =>
    Node.isParameterDeclaration(node) ? node.getTypeNode() : undefined,
  [SyntaxKind.PropertyDeclaration]: (node) =>
    Node.isPropertyDeclaration(node) ? node.getTypeNode() : undefined,
  [SyntaxKind.VariableDeclaration]: (node) =>
    Node.isVariableDeclaration(node) ? node.getTypeNode() : undefined,
  [SyntaxKind.ClassDeclaration]: (node) =>
    Node.isClassDeclaration(node) ? node.getExtends()?.getExpression() : undefined,
};

/**
 * The name a written type is known by.
 *
 * The first identifier of it, which is the head: `Kysely<DB>` is `Kysely` and
 * `Model<AttributesOnly<Video>>` is `Model`, because the arguments are what the
 * type was given rather than what it is. A namespace access reads through to
 * the namespace, since `kysely.Kysely` and `Kysely` are one import written two
 * ways.
 */
const nameNodeOf = (written: TsNode | undefined): TsNode | undefined => {
  if (written === undefined) return undefined;
  if (Node.isIdentifier(written)) return written;
  return written.getFirstDescendantByKind(SyntaxKind.Identifier);
};

/** The package a name was imported from in the file that uses it, if it was. */
const importedFrom = (name: TsNode): string | undefined => {
  const spelling = name.getText();
  for (const statement of name.getSourceFile().getImportDeclarations()) {
    const bound =
      statement.getDefaultImport()?.getText() === spelling ||
      statement.getNamespaceImport()?.getText() === spelling ||
      statement
        .getNamedImports()
        .some((specifier) => (specifier.getAliasNode() ?? specifier.getNameNode()).getText() === spelling);
    if (bound) return packageOfSpecifier(statement.getModuleSpecifierValue());
  }
  return undefined;
};

/**
 * The class a name stands for, when it stands for one of this repository's.
 *
 * A relative import resolves with no `node_modules` at all, so the walk up a
 * project's own bases costs nothing and is the difference between reading a
 * repository that declares its models directly and one that factors what every
 * model shares into a base of its own - which is what a real repository does.
 */
const localClassNamed = (name: TsNode): TsNode | undefined => {
  const declaration = declarationOf(name);
  return declaration !== undefined && Node.isClassDeclaration(declaration) ? declaration : undefined;
};

/**
 * The origin the source states for a receiver, or null when it states none.
 *
 * Shaped exactly like the origin the checker returns for the same two cases, so
 * that everything downstream - the descriptor lookup, the locators, the table
 * reading - stays the one mechanism it always was. `declaration` is carried
 * only for a class of this repository, because that is the one case where the
 * declaration a locator would read is here to be read; a type declared in a
 * package nobody installed has no declaration to offer, and saying so rather
 * than pointing at something else is the difference between this and a guess.
 */
export const statedOrigin = (receiver: TsNode): TypeOrigin | null => {
  let declaration = declarationOf(receiver);
  for (let depth = 0; declaration !== undefined && depth < 8; depth += 1) {
    const name = nameNodeOf(STATED_TYPE[declaration.getKind()]?.(declaration));
    if (name === undefined) return null;
    const pkg = importedFrom(name);
    if (pkg !== undefined) {
      return {
        package: pkg,
        typeName: name.getText(),
        typeArgs: [],
        isLocal: false,
        ...(Node.isClassDeclaration(declaration) ? { declaration } : {}),
      };
    }
    declaration = localClassNamed(name);
  }
  return null;
};
