import { posix } from 'node:path';
import type { FileSystemHost, Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { tryParse, type Document } from './parse.js';
import { fragmentsOf, type HandedFragment, type Written } from './operations.js';

/**
 * The GraphQL document an expression in TypeScript is (P232).
 *
 * Read wherever a client writes one: a `gql` or `graphql` tagged template, a
 * `graphql(...)` call (the codegen client preset, gql.tada), a constant
 * holding either, in this file or imported, an imported `.graphql` file, and
 * a `…Document` constant codegen generated, whose AST is printed back into the
 * language. A fragment interpolated into a template is a fragment of the
 * document; one that cannot be read is said. Anything built at run time is a
 * reason, never a guess.
 */
export type DocumentReading =
  | {
      readonly kind: 'read';
      readonly document: Document;
      /** The document's text, and the file it is written in. */
      readonly text: string;
      readonly written: Written;
      /** The fragments of other documents it spreads, each with where it is written. */
      readonly fragments: readonly HandedFragment[];
      /** Fragments interpolated that could not be read. */
      readonly unread: number;
    }
  | { readonly kind: 'dynamic'; readonly why: string }
  | { readonly kind: 'invalid'; readonly why: string; readonly written: Written };

const TAGS = new Set(['gql', 'graphql']);
const MAX_DEPTH = 6;

/** Text written in a TypeScript file from an offset on: each line is the file's. */
const writtenIn = (sourceFile: SourceFile, offset: number): Written => ({
  path: sourceFile.getFilePath(),
  lineAt: (at) => sourceFile.getLineAndColumnAtPos(Math.min(offset + at, sourceFile.getEnd())).line,
});

/** A file that is the document, read whole: a `.graphql` file. */
const writtenAlone = (path: string, text: string): Written => {
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  return {
    path,
    lineAt: (offset) => {
      // The last line starting at or before the offset.
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((starts[middle] as number) <= offset) low = middle;
        else high = middle - 1;
      }
      return low + 1;
    },
  };
};

/**
 * The text of a template, each `${…}` turned to spaces so every offset is the
 * file's; and what was interpolated. A hole runs from the `${` that ends the
 * literal before it to the `}` that starts the one after, whatever space is
 * written inside it.
 */
const templateText = (template: TsNode): { text: string; offset: number; holes: TsNode[] } | undefined => {
  if (Node.isNoSubstitutionTemplateLiteral(template)) return { text: template.getLiteralText(), offset: template.getStart() + 1, holes: [] };
  if (Node.isStringLiteral(template)) return { text: template.getLiteralText(), offset: template.getStart() + 1, holes: [] };
  if (!Node.isTemplateExpression(template)) return undefined;
  const raw = template.getText().slice(1, -1);
  let text = '';
  let at = 0;
  const holes: TsNode[] = [];
  const start = template.getStart() + 1;
  let before: TsNode = template.getHead();
  for (const span of template.getTemplateSpans()) {
    const after = span.getLiteral();
    const holeStart = before.getEnd() - 2 - start;
    const holeEnd = after.getStart() + 1 - start;
    text += raw.slice(at, holeStart) + ' '.repeat(holeEnd - holeStart);
    at = holeEnd;
    holes.push(span.getExpression());
    before = after;
  }
  text += raw.slice(at);
  return { text, offset: start, holes };
};

/** An object literal, past a cast. */
const objectOf = (node: TsNode | undefined): ObjectLiteralExpression | undefined => {
  let value = node;
  while (value !== undefined && (Node.isAsExpression(value) || Node.isSatisfiesExpression(value))) value = value.getExpression();
  return value !== undefined && Node.isObjectLiteralExpression(value) ? value : undefined;
};

/** A key of an object literal, written quoted (`"kind"`, as codegen writes it) or bare. */
const valueAt = (object: ObjectLiteralExpression | undefined, key: string): TsNode | undefined => {
  const property = object?.getProperty(key) ?? object?.getProperty(JSON.stringify(key));
  return property !== undefined && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
};

const stringAt = (object: ObjectLiteralExpression | undefined, key: string): string => {
  const value = valueAt(object, key);
  return value !== undefined && (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) ? value.getLiteralValue() : '';
};

/** `{ kind: 'Name', value: 'orders' }`, as its value. */
const nameAt = (object: ObjectLiteralExpression | undefined, key: string): string => stringAt(objectOf(valueAt(object, key)), 'value');

/**
 * A graphql-js AST object, printed as the language: what codegen writes as a
 * `…Document`. Only what a selection needs is printed - operations,
 * fragments, fields, aliases, spreads - which is what is read of it after.
 */
const printAst = (node: TsNode | undefined, depth = 0): string => {
  const object = objectOf(node);
  if (object === undefined || depth > 64) return '';
  const items = (key: string, of: ObjectLiteralExpression | undefined = object): TsNode[] => {
    const value = valueAt(of, key);
    return value !== undefined && Node.isArrayLiteralExpression(value) ? value.getElements() : [];
  };
  const selections = (): string => {
    const set = items('selections', objectOf(valueAt(object, 'selectionSet')));
    return set.length === 0 ? '' : ` { ${set.map((item) => printAst(item, depth + 1)).join(' ')} }`;
  };
  const condition = (): string => nameAt(objectOf(valueAt(object, 'typeCondition')), 'name');
  switch (stringAt(object, 'kind')) {
    case 'Document':
      return items('definitions').map((definition) => printAst(definition, depth + 1)).join('\n');
    case 'OperationDefinition':
      return `${stringAt(object, 'operation')} ${nameAt(object, 'name')}${selections()}`;
    case 'FragmentDefinition':
      return `fragment ${nameAt(object, 'name')} on ${condition()}${selections()}`;
    case 'Field': {
      const alias = nameAt(object, 'alias');
      // The arguments' names are what is compared; their values are not read.
      const args = items('arguments').map((argument) => `${nameAt(objectOf(argument), 'name')}: null`);
      return `${alias === '' ? '' : `${alias}: `}${nameAt(object, 'name')}${args.length === 0 ? '' : `(${args.join(', ')})`}${selections()}`;
    }
    case 'FragmentSpread':
      return `...${nameAt(object, 'name')}`;
    case 'InlineFragment': {
      const on = condition();
      return `...${on === '' ? '' : ` on ${on}`}${selections()}`;
    }
    default:
      return '';
  }
};

/** The fragments a document read defines and was handed, each with where it is written. */
const fragmentsHanded = (inner: Extract<DocumentReading, { kind: 'read' }>): HandedFragment[] => [
  ...fragmentsOf(inner.document).map((fragment) => ({ ...fragment, written: inner.written })),
  ...inner.fragments,
];

/** `#import "./fields.graphql"`, as graphql-tag's loader reads it: the fragments of another file. */
const IMPORT_LINE = /^#import\s+["']([^"']+)["']/gm;

/**
 * A `.graphql` file, read through the project's file system, with the
 * fragments of every file it `#import`s. Its offsets are its own, from 0.
 */
const graphqlFile = (files: FileSystemHost, path: string, depth: number): DocumentReading | undefined => {
  let text: string;
  try {
    text = files.readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
  const written = writtenAlone(path, text);
  const fragments: HandedFragment[] = [];
  let unread = 0;
  for (const [, specifier] of text.matchAll(IMPORT_LINE)) {
    const inner = depth > MAX_DEPTH || !specifier?.startsWith('.') ? undefined : graphqlFile(files, posix.join(posix.dirname(path), specifier), depth + 1);
    if (inner?.kind === 'read') fragments.push(...fragmentsHanded(inner));
    else unread += 1;
  }
  const document = tryParse(text);
  if (document === undefined) return { kind: 'invalid', why: 'the document does not parse as GraphQL', written };
  return { kind: 'read', document, text, written, fragments, unread };
};

/**
 * What a name imported from a `.graphql` file is: the whole document for the
 * default import, and for a named one the operation of that name, as
 * graphql-tag's loader exports each - with the fragments beside it.
 */
const importedDocument = (document: Document, exported: string): Document => {
  if (exported === 'default') return document;
  const named = document.definitions.filter((definition) => definition.kind !== 'operation' || definition.name === exported);
  return named.some((definition) => definition.kind === 'operation') ? { definitions: named } : document;
};

const read = (text: string, written: Written, holes: readonly TsNode[], depth: number): DocumentReading => {
  const fragments: HandedFragment[] = [];
  let unread = 0;
  for (const hole of holes) {
    const inner = documentOf(hole, depth + 1);
    if (inner.kind === 'read') {
      // A fragment keeps the file it is written in, so its fields keep their own lines.
      fragments.push(...fragmentsHanded(inner));
      continue;
    }
    // A name is a fragment this could not read; anything else in the hole -
    // a call, a join of strings - is the document being built at run time.
    if (!Node.isIdentifier(hole) && !Node.isPropertyAccessExpression(hole)) return { kind: 'dynamic', why: 'the document is assembled from parts at run time' };
    unread += 1;
  }
  const document = tryParse(text);
  if (document === undefined) return { kind: 'invalid', why: 'the document does not parse as GraphQL', written };
  return { kind: 'read', document, text, written, fragments, unread };
};

/** The document an expression is, or why it could not be read. */
export const documentOf = (expression: TsNode | undefined, depth = 0): DocumentReading => {
  if (expression === undefined) return { kind: 'dynamic', why: 'no document is handed to the call' };
  if (depth > MAX_DEPTH) return { kind: 'dynamic', why: 'the document is built through too many steps to follow' };
  let value: TsNode = expression;
  // `{…} as unknown as DocumentNode`, as codegen writes it: every cast, not only the outer one.
  while (Node.isAsExpression(value) || Node.isParenthesizedExpression(value) || Node.isSatisfiesExpression(value) || Node.isNonNullExpression(value)) value = value.getExpression();
  if (Node.isTaggedTemplateExpression(value) && TAGS.has(value.getTag().getText().replace(/^.*\./, ''))) {
    const template = templateText(value.getTemplate());
    if (template === undefined) return { kind: 'dynamic', why: 'the template is not a literal' };
    return read(template.text, writtenIn(value.getSourceFile(), template.offset), template.holes, depth);
  }
  if (Node.isCallExpression(value) && TAGS.has(value.getExpression().getText().replace(/^.*\./, ''))) {
    const [first, second] = value.getArguments();
    const template = first === undefined ? undefined : templateText(first);
    if (template === undefined) return { kind: 'dynamic', why: 'the document handed to graphql() is not a literal' };
    // gql.tada hands the fragments a document uses as a second argument.
    const handed = second !== undefined && Node.isArrayLiteralExpression(second) ? second.getElements() : [];
    return read(template.text, writtenIn(value.getSourceFile(), template.offset), [...template.holes, ...handed], depth);
  }
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) || Node.isTemplateExpression(value)) {
    const template = templateText(value);
    if (template === undefined || template.holes.length > 0) return { kind: 'dynamic', why: 'the document is assembled from parts at run time' };
    return read(template.text, writtenIn(value.getSourceFile(), template.offset), [], depth);
  }
  if (Node.isObjectLiteralExpression(value)) {
    const printed = printAst(value);
    // Printed text has no offsets of the file's: every field is at the object's line.
    if (printed !== '') return read(printed, { path: value.getSourceFile().getFilePath(), lineAt: () => value.getStartLineNumber() }, [], depth);
    return { kind: 'dynamic', why: 'the object is not a document' };
  }
  if (Node.isBinaryExpression(value) || Node.isCallExpression(value)) return { kind: 'dynamic', why: 'the document is assembled from parts at run time' };
  if (Node.isIdentifier(value) || Node.isPropertyAccessExpression(value)) {
    const symbol = value.getSymbol();
    // What an import names, then the import itself: a module TypeScript does
    // not resolve - a `.graphql` file - aliases a symbol with no declarations,
    // and one an ambient `declare module '*.graphql'` resolves has no value.
    const aliased = symbol?.getAliasedSymbol();
    for (const declaration of [...(aliased?.getDeclarations() ?? []), ...(symbol?.getDeclarations() ?? [])]) {
      if (Node.isVariableDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer !== undefined) {
          const found = documentOf(initializer, depth + 1);
          // A generated constant reads as its own position, not codegen's.
          return found;
        }
      }
      if (Node.isImportClause(declaration) || Node.isImportSpecifier(declaration)) {
        // A `.graphql` file beside the importing one, as the loaders hand it to the code.
        const holder = Node.isImportClause(declaration) ? declaration.getParent() : declaration.getImportDeclaration();
        const specifier = Node.isImportDeclaration(holder) ? holder.getModuleSpecifierValue() : '';
        if (!/\.(graphql|gql)$/.test(specifier) || !specifier.startsWith('.')) continue;
        const file = graphqlFile(value.getProject().getFileSystem(), posix.join(value.getSourceFile().getDirectoryPath(), specifier), depth + 1);
        if (file?.kind === 'read') return { ...file, document: importedDocument(file.document, Node.isImportClause(declaration) ? 'default' : declaration.getName()) };
        if (file !== undefined) return file;
      }
    }
    return { kind: 'dynamic', why: `${value.getText()} is not a document this could read` };
  }
  return { kind: 'dynamic', why: 'the document is not written where it is used' };
};

/** 1-based line of an offset into a document, in the file it is written in. */
export const lineInFile = (reading: Extract<DocumentReading, { kind: 'read' }>, offset: number): number => reading.written.lineAt(offset);
