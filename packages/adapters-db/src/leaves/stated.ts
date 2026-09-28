import { dirname, join, resolve } from 'node:path';
import {
  declarationOf,
  readPackageJson,
  workspacePackages,
  workspaceRootOf,
  type TypeOrigin,
} from '@flowatlas/core';
import { Node, SyntaxKind, type Node as TsNode, type Project, type SourceFile } from 'ts-morph';
import { generatedModules } from '../descriptors/index.js';

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
 *
 * A name is followed through the import that binds it rather than through the
 * checker, for the same reason (R146). cal.com imports its Prisma client from
 * its own workspace package, `import prisma from '@calcom/prisma'`, and nothing
 * links that package on a clone nobody installed - so the checker has no
 * declaration for `prisma` at all, although the file that declares it is in the
 * project. The workspace's manifests say which directory the package is, the
 * package's manifest says which file it is entered through, and there it is:
 * `export const prisma: PrismaClient`, with `PrismaClient` imported from
 * `./generated/prisma/client`. That module does not exist either, and the
 * repository's schema says why - it is where `prisma generate` writes the
 * client. Every step is a statement of the repository being read; none of them
 * is a name that merely looks like a client.
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
 * The expression an initialiser states a type with, when it states one.
 *
 * `new PrismaClient()` names its class as plainly as an annotation does, and
 * `x as PrismaClient` is an annotation written after the value. A call states
 * nothing: `const db = makeDb()` says what function ran, not what came back,
 * and following it is the checker's work. A fallback - `cached ?? new Client()`,
 * the ordinary way a client is kept across reloads - states its type on the
 * side that constructs, since the other side is the same value remembered.
 */
const constructedBy = (initializer: TsNode | undefined): TsNode | undefined => {
  if (initializer === undefined) return undefined;
  if (Node.isParenthesizedExpression(initializer)) return constructedBy(initializer.getExpression());
  if (Node.isAsExpression(initializer)) return initializer.getTypeNode();
  if (Node.isNewExpression(initializer)) return initializer.getExpression();
  if (Node.isBinaryExpression(initializer)) {
    const operator = initializer.getOperatorToken().getKind();
    if (operator === SyntaxKind.QuestionQuestionToken || operator === SyntaxKind.BarBarToken) {
      return constructedBy(initializer.getRight());
    }
  }
  return undefined;
};

/**
 * Where a declaration states the type of what it holds, by the kind it is.
 *
 * A lookup rather than a run of conditions, so another place a type can be
 * written is a row here. Two kinds of statement, and each is a reading the
 * checker performs when it can: an annotation naming the type, and a class of
 * one's own whose base comes out of a package, because `class VideoModel
 * extends Model<Video>` is a data layer as surely as an injected connection is
 * and is how most of a real repository's models are declared.
 *
 * An initialiser is read only where it constructs, for the reason
 * `constructedBy` gives. A property of an object type is a row because a
 * context object is how a client is handed to a handler - tRPC's
 * `ctx: { prisma: PrismaClient }` - and the annotation there is the same
 * annotation as on a parameter.
 */
const STATED_TYPE: Partial<Record<SyntaxKind, (node: TsNode) => TsNode | undefined>> = {
  [SyntaxKind.Parameter]: (node) =>
    Node.isParameterDeclaration(node) ? node.getTypeNode() : undefined,
  [SyntaxKind.PropertyDeclaration]: (node) =>
    Node.isPropertyDeclaration(node)
      ? (node.getTypeNode() ?? constructedBy(node.getInitializer()))
      : undefined,
  [SyntaxKind.PropertySignature]: (node) =>
    Node.isPropertySignature(node) ? node.getTypeNode() : undefined,
  [SyntaxKind.VariableDeclaration]: (node) =>
    Node.isVariableDeclaration(node)
      ? (node.getTypeNode() ?? constructedBy(node.getInitializer()))
      : undefined,
  [SyntaxKind.ClassDeclaration]: (node) =>
    Node.isClassDeclaration(node) ? node.getExtends()?.getExpression() : undefined,
  [SyntaxKind.TypeAliasDeclaration]: (node) =>
    Node.isTypeAliasDeclaration(node) ? node.getTypeNode() : undefined,
};

/**
 * Declarations that state nothing themselves and say where the statement is.
 *
 * `const { prisma } = ctx` holds whatever `ctx.prisma` holds, and the property
 * it was taken from is declared in an object type of this repository, which the
 * checker reads with nothing installed. What the property's type is, is then
 * the question `STATED_TYPE` answers.
 */
const STATED_THROUGH: Partial<Record<SyntaxKind, (node: TsNode) => TsNode | undefined>> = {
  [SyntaxKind.VariableDeclaration]: (node) =>
    Node.isVariableDeclaration(node) ? dynamicallyImported(node) : undefined,
  [SyntaxKind.BindingElement]: (node) => {
    if (!Node.isBindingElement(node)) return undefined;
    const holder = node.getParent().getParent();
    // A pattern's own type is what it was destructured *from* only where nothing
    // was assigned to it: a parameter is typed by its annotation, and a variable
    // by its initialiser, which is the value whose property this is.
    const source = Node.isVariableDeclaration(holder) ? holder.getInitializer() : holder;
    const key = (node.getPropertyNameNode() ?? node.getNameNode()).getText();
    return source?.getType().getProperty(key)?.getDeclarations()[0];
  },
};

/**
 * Types the language's own library derives from another without renaming it.
 *
 * `Pick<PrismaClient, 'booking'>` is the client with less of it visible, and a
 * call through it is a call through the client; its head is `Pick`, which says
 * how the type was narrowed rather than what it is. The first argument is the
 * type, so that is what is read. A `Set` of the library's own names, since these
 * are the only derivations whose meaning is fixed by the language rather than by
 * whoever wrote them.
 */
const NARROWING_TYPES: ReadonlySet<string> = new Set([
  'Pick',
  'Omit',
  'Partial',
  'Required',
  'Readonly',
  'NonNullable',
]);

/**
 * The name a written type is known by.
 *
 * The first identifier of it, which is the head: `Kysely<DB>` is `Kysely` and
 * `Model<AttributesOnly<Video>>` is `Model`, because the arguments are what the
 * type was given rather than what it is. A namespace access reads through to
 * the namespace, since `kysely.Kysely` and `Kysely` are one import written two
 * ways. `typeof prisma` is the value it names, which is followed like any
 * other name.
 */
const nameNodeOf = (written: TsNode | undefined): TsNode | undefined => {
  if (written === undefined) return undefined;
  if (Node.isIdentifier(written)) return written;
  if (Node.isTypeReference(written) && NARROWING_TYPES.has(written.getTypeName().getText())) {
    const [narrowed] = written.getTypeArguments();
    if (narrowed !== undefined) return nameNodeOf(narrowed);
  }
  return written.getFirstDescendantByKind(SyntaxKind.Identifier);
};

/**
 * The module a name was imported from in the file that uses it, as written.
 *
 * Whole, rather than cut down to its package, for a reader that needs to tell
 * two modules of one package apart: a framework that re-exports an ORM under
 * `framework/orm` and its own helpers under `framework/utils` is one package
 * and two different answers (R149).
 */
export const moduleImportedFrom = (name: TsNode): string | undefined => {
  const spelling = name.getText();
  for (const statement of name.getSourceFile().getImportDeclarations()) {
    const bound =
      statement.getDefaultImport()?.getText() === spelling ||
      statement.getNamespaceImport()?.getText() === spelling ||
      statement
        .getNamedImports()
        .some((specifier) => (specifier.getAliasNode() ?? specifier.getNameNode()).getText() === spelling);
    if (bound) return statement.getModuleSpecifierValue();
  }
  return undefined;
};

/**
 * What a name stands for: a package it came out of, or a declaration to read.
 *
 * `null` where it stands for nothing this reading can see.
 */
type Step = { package: string; site: SourceFile } | { declaration: TsNode } | null;

/** How many modules one name may be followed through, which no real re-export chain approaches. */
const MAX_HOPS = 8;

/** A module an import or a re-export names, and the name it takes from it. */
interface ModuleReference {
  readonly from: SourceFile;
  readonly specifier: string;
  readonly resolved: SourceFile | undefined;
  readonly name: string;
}

/** Package directories by name, per workspace root, read once per root. */
const packageDirs = new Map<string, ReadonlyMap<string, string>>();
const rootsOf = new Map<string, string | undefined>();

/** The workspace a directory is inside: the root that lists its nearest member ancestor. */
const workspaceRootAbove = (dir: string): string | undefined => {
  if (rootsOf.has(dir)) return rootsOf.get(dir);
  const parent = dirname(dir);
  const root = workspaceRootOf(dir) ?? (parent === dir ? undefined : workspaceRootAbove(parent));
  rootsOf.set(dir, root);
  return root;
};

/**
 * The file a workspace package's module is, when the checker could not find it.
 *
 * A workspace reaches its own packages through links the package manager makes,
 * and a clone nobody installed has none: `import prisma from '@calcom/prisma'`
 * resolves to nothing although `packages/prisma/index.ts` is in the project. The
 * workspace root's globs say which directory is `@calcom/prisma`, and its
 * manifest says which file is its entry; both are statements of the repository,
 * read the way the extent already reads them. Only a file already in the project
 * is answered, so this opens nothing the reading had not opened.
 */
const workspaceEntry = (specifier: string, from: SourceFile): SourceFile | undefined => {
  const pkg = packageOfSpecifier(specifier);
  if (pkg === undefined) return undefined;
  const root = workspaceRootAbove(dirname(from.getFilePath()));
  if (root === undefined) return undefined;
  let byName = packageDirs.get(root);
  if (byName === undefined) {
    const dirs = new Map<string, string>();
    for (const { name, dir } of workspacePackages(root)) dirs.set(name, dir);
    byName = dirs;
    packageDirs.set(root, byName);
  }
  const dir = byName.get(pkg);
  if (dir === undefined) return undefined;
  // A subpath names a module inside the package - `@calcom/prisma/client` is
  // `packages/prisma/client` - and never the package's entry, which is a
  // different module exporting different names.
  const subpath = specifier.slice(pkg.length + 1);
  const project = from.getProject();
  if (subpath !== '') return moduleAt(project, join(dir, subpath));
  const manifest = readPackageJson(dir);
  const declared = [manifest?.['types'], manifest?.['main']].filter(
    (value): value is string => typeof value === 'string',
  );
  const candidates = [
    ...declared.flatMap((entry) => [entry, entry.replace(/\.(d\.ts|js|mjs|cjs)$/, '.ts')]),
    'index.ts',
    join('src', 'index.ts'),
  ];
  for (const candidate of candidates) {
    const file = project.getSourceFile(join(dir, candidate));
    if (file !== undefined) return file;
  }
  return undefined;
};

/**
 * The name a declaration states its type by, when it states one.
 *
 * `STATED_TYPE` read for one declaration, for a reader that asks the same
 * question of a value `statedOrigin` is not handed.
 */
export const statedTypeName = (declaration: TsNode): TsNode | undefined =>
  nameNodeOf(STATED_TYPE[declaration.getKind()]?.(declaration));

/**
 * What a module reference hands over, followed to where it is stated.
 *
 * A module of this repository is entered and the name looked up in it - the
 * checker's file if it found one outside `node_modules`, the workspace's entry if
 * it did not. A package is the answer as it always was. A relative path that is
 * not there is asked of the generators: a client `prisma generate` would have
 * written is the generating library's client, on the schema's word.
 */
const referenced = (reference: ModuleReference, hops: number): Step => {
  const { from, specifier, resolved, name } = reference;
  const pkg = packageOfSpecifier(specifier);
  const local =
    resolved !== undefined && !resolved.getFilePath().includes('/node_modules/')
      ? resolved
      : pkg === undefined
        ? undefined
        : workspaceEntry(specifier, from);
  if (local !== undefined) return exported(local, name, hops + 1);
  if (pkg !== undefined) return { package: pkg, site: from };
  const target = resolve(dirname(from.getFilePath()), specifier);
  const generator = generatedModules.find((entry) => entry.generates(from, target));
  return generator === undefined ? null : { package: generator.package, site: from };
};

/**
 * What a module exports under a name: a declaration in it, or whatever a
 * re-export of that name hands on.
 *
 * `export type { PrismaClient }` beside `import { PrismaClient } from
 * './generated/prisma/client'` is how a wrapper hands on the library's type,
 * and there is no declaration of it in the wrapper to find - only the import
 * it passes on, which is followed like any other.
 */
const exported = (file: SourceFile, name: string, hops: number): Step => {
  if (hops > MAX_HOPS) return null;
  const declaration = file.getExportedDeclarations().get(name)?.[0];
  if (declaration !== undefined) return { declaration };
  for (const statement of file.getExportDeclarations()) {
    for (const specifier of statement.getNamedExports()) {
      if ((specifier.getAliasNode() ?? specifier.getNameNode()).getText() !== name) continue;
      const source = statement.getModuleSpecifierValue();
      if (source === undefined) return followName(specifier.getNameNode(), hops + 1);
      return referenced(
        {
          from: file,
          specifier: source,
          resolved: statement.getModuleSpecifierSourceFile(),
          name: specifier.getNameNode().getText(),
        },
        hops,
      );
    }
  }
  // `export * from '../generated/prisma/client'` passes on every name the module
  // has, so the name is asked of each such module in turn. A module of this
  // repository that declares it is the answer; a package or a generated client
  // answers for any name at all, so it is the answer only where no module of
  // this repository had one.
  let passedOn: Step = null;
  for (const statement of file.getExportDeclarations()) {
    const source = statement.getModuleSpecifierValue();
    if (source === undefined || statement.hasNamedExports() || statement.getNamespaceExport() !== undefined) {
      continue;
    }
    const step = referenced(
      { from: file, specifier: source, resolved: statement.getModuleSpecifierSourceFile(), name },
      hops,
    );
    if (step !== null && 'declaration' in step) return step;
    passedOn ??= step;
  }
  return passedOn;
};

/**
 * What a name stands for, read off the file it is written in.
 *
 * An imported name is followed through the import rather than through the
 * checker, because the import is there in every state of the repository and
 * the module it names is not. A name no import binds is the checker's, and a
 * declaration of this repository is found with nothing installed.
 */
const followName = (name: TsNode, hops = 0): Step => {
  if (hops > MAX_HOPS) return null;
  const spelling = name.getText();
  const file = name.getSourceFile();
  for (const statement of file.getImportDeclarations()) {
    const taken = importedName(statement, spelling);
    if (taken === undefined) continue;
    return referenced(
      {
        from: file,
        specifier: statement.getModuleSpecifierValue(),
        resolved: statement.getModuleSpecifierSourceFile(),
        name: taken,
      },
      hops,
    );
  }
  const declaration = declarationOf(name);
  return declaration === undefined ? null : { declaration };
};

/**
 * The declaration a dynamically imported value is, when a variable holds one.
 *
 * `const prisma = (await import('@calcom/prisma')).default` is an import written
 * as an expression - cal.com defers loading its client this way in the handlers
 * that need it cold - and it names a module and an export exactly as the
 * statement form does. It is followed the same way, and to a declaration only:
 * a value is never read by the package it came from.
 */
const unwrapped = (node: TsNode | undefined): TsNode | undefined => {
  let at = node;
  while (at !== undefined && (Node.isParenthesizedExpression(at) || Node.isAwaitExpression(at))) {
    at = at.getExpression();
  }
  return at;
};

/**
 * The module and the export an expression takes from a dynamic import.
 *
 * Two spellings of one statement: `(await import(m)).name`, and
 * `import(m).then((mod) => mod.name)`, where the callback's body is the same
 * property of the parameter the module is handed in as.
 */
const importTaken = (value: TsNode | undefined): { call: TsNode; name: string } | undefined => {
  const taken = unwrapped(value);
  if (taken === undefined) return undefined;
  if (Node.isPropertyAccessExpression(taken)) {
    const call = unwrapped(taken.getExpression());
    return call === undefined ? undefined : { call, name: taken.getName() };
  }
  if (!Node.isCallExpression(taken)) return undefined;
  const callee = taken.getExpression();
  const [callback] = taken.getArguments();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'then') return undefined;
  if (callback === undefined || !Node.isArrowFunction(callback)) return undefined;
  const [parameter] = callback.getParameters();
  const body = unwrapped(callback.getBody());
  if (parameter === undefined || body === undefined || !Node.isPropertyAccessExpression(body)) return undefined;
  if (body.getExpression().getText() !== parameter.getName()) return undefined;
  return { call: callee.getExpression(), name: body.getName() };
};

const dynamicallyImported = (holder: TsNode): TsNode | undefined => {
  if (!Node.isVariableDeclaration(holder)) return undefined;
  const taken = importTaken(holder.getInitializer());
  const loaded = taken?.call;
  if (taken === undefined || loaded === undefined) return undefined;
  if (!Node.isCallExpression(loaded) || loaded.getExpression().getKind() !== SyntaxKind.ImportKeyword) {
    return undefined;
  }
  const [argument] = loaded.getArguments();
  if (argument === undefined || !Node.isStringLiteral(argument)) return undefined;
  const from = holder.getSourceFile();
  const specifier = argument.getLiteralValue();
  const step = referenced(
    {
      from,
      specifier,
      resolved:
        packageOfSpecifier(specifier) === undefined
          ? moduleAt(from.getProject(), resolve(dirname(from.getFilePath()), specifier))
          : undefined,
      name: taken.name,
    },
    0,
  );
  return step !== null && 'declaration' in step ? step.declaration : undefined;
};

/** The source file a module path names, among the files the project holds. */
const moduleAt = (project: Project, target: string): SourceFile | undefined => {
  const bare = target.replace(/\.(js|mjs|cjs)$/, '');
  for (const candidate of [bare, `${bare}.ts`, `${bare}.tsx`, join(bare, 'index.ts'), join(bare, 'index.tsx')]) {
    const file = project.getSourceFile(candidate);
    if (file !== undefined) return file;
  }
  return undefined;
};

/**
 * The name an import statement takes a local binding from, if it binds it.
 *
 * `default` for a default import. A namespace import binds the module rather
 * than anything in it, which is a package when the module is one and nothing
 * this reading follows when it is not.
 */
const importedName = (
  statement: ReturnType<SourceFile['getImportDeclarations']>[number],
  spelling: string,
): string | undefined => {
  if (statement.getDefaultImport()?.getText() === spelling) return 'default';
  if (statement.getNamespaceImport()?.getText() === spelling) return '*';
  for (const specifier of statement.getNamedImports()) {
    if ((specifier.getAliasNode() ?? specifier.getNameNode()).getText() === spelling) {
      return specifier.getNameNode().getText();
    }
  }
  return undefined;
};

/**
 * The origin the source states for a receiver, and the file it was stated in.
 *
 * `statedIn` is the file whose import named the package - the wrapper, for a
 * client a wrapper declares - because that is the file a schema governs, and a
 * table a schema renames is renamed by the schema beside the client rather than
 * by anything near the call.
 */
export interface StatedOrigin extends TypeOrigin {
  readonly statedIn: SourceFile;
}

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
 *
 * The receiver itself must reach a declaration: a value is read by what its
 * declaration states, never by the module it came from, since a package exports
 * values of every type and not only its own. Only a *type* name is answered by
 * the package it was imported from.
 */
export const statedOrigin = (receiver: TsNode): StatedOrigin | null => {
  const start = Node.isIdentifier(receiver) ? followName(receiver) : null;
  let declaration =
    start !== null && 'declaration' in start ? start.declaration : declarationOf(receiver);
  for (let depth = 0; declaration !== undefined && depth < MAX_HOPS; depth += 1) {
    const through = STATED_THROUGH[declaration.getKind()]?.(declaration);
    if (through !== undefined) {
      declaration = through;
      continue;
    }
    const name = nameNodeOf(STATED_TYPE[declaration.getKind()]?.(declaration));
    if (name === undefined) return null;
    const step = followName(name);
    if (step === null) return null;
    if ('package' in step) {
      return {
        package: step.package,
        typeName: name.getText(),
        typeArgs: [],
        isLocal: false,
        statedIn: step.site,
        ...(Node.isClassDeclaration(declaration) ? { declaration } : {}),
      };
    }
    declaration = step.declaration;
  }
  return null;
};
