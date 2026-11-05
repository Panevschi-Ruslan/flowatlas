import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Node as TsNode, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { tryParse, type Document, type FragmentDefinition } from './parse.js';
import { fragmentsOf } from './operations.js';

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
      /** The document's text, and where it starts in the file it is written in. */
      readonly text: string;
      readonly sourceFile: SourceFile;
      readonly offset: number;
      readonly fragments: readonly FragmentDefinition[];
      /** Fragments interpolated that could not be read. */
      readonly unread: number;
    }
  | { readonly kind: 'dynamic'; readonly why: string }
  | { readonly kind: 'invalid'; readonly why: string; readonly sourceFile: SourceFile; readonly offset: number };

const TAGS = new Set(['gql', 'graphql']);
const MAX_DEPTH = 6;

/** The text of a template, each `${…}` turned to spaces so every offset is the file's; and what was interpolated. */
const templateText = (template: TsNode): { text: string; offset: number; holes: TsNode[] } | undefined => {
  if (Node.isNoSubstitutionTemplateLiteral(template)) return { text: template.getLiteralText(), offset: template.getStart() + 1, holes: [] };
  if (Node.isStringLiteral(template)) return { text: template.getLiteralText(), offset: template.getStart() + 1, holes: [] };
  if (!Node.isTemplateExpression(template)) return undefined;
  const raw = template.getText().slice(1, -1);
  let text = '';
  let at = 0;
  const holes: TsNode[] = [];
  const start = template.getStart() + 1;
  for (const span of template.getTemplateSpans()) {
    const hole = span.getExpression();
    const holeStart = hole.getStart() - 2 - start;
    const holeEnd = hole.getEnd() + 1 - start;
    text += raw.slice(at, holeStart) + ' '.repeat(holeEnd - holeStart);
    at = holeEnd;
    holes.push(hole);
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

/** A `.graphql` file an import names, read from disk. */
const importedFile = (from: SourceFile, specifier: string): { text: string; sourceFile: SourceFile } | undefined => {
  if (!/\.(graphql|gql)$/.test(specifier) || !specifier.startsWith('.')) return undefined;
  try {
    return { text: readFileSync(resolve(dirname(from.getFilePath()), specifier), 'utf8'), sourceFile: from };
  } catch {
    return undefined;
  }
};

const read = (text: string, sourceFile: SourceFile, offset: number, holes: readonly TsNode[], extra: readonly FragmentDefinition[], depth: number): DocumentReading => {
  const fragments: FragmentDefinition[] = [...extra];
  let unread = 0;
  for (const hole of holes) {
    const inner = documentOf(hole, depth + 1);
    if (inner.kind === 'read') {
      fragments.push(...fragmentsOf(inner.document), ...inner.fragments);
      continue;
    }
    // A name is a fragment this could not read; anything else in the hole -
    // a call, a join of strings - is the document being built at run time.
    if (!Node.isIdentifier(hole) && !Node.isPropertyAccessExpression(hole)) return { kind: 'dynamic', why: 'the document is assembled from parts at run time' };
    unread += 1;
  }
  const document = tryParse(text);
  if (document === undefined) return { kind: 'invalid', why: 'the document does not parse as GraphQL', sourceFile, offset };
  return { kind: 'read', document, text, sourceFile, offset, fragments, unread };
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
    return read(template.text, value.getSourceFile(), template.offset, template.holes, [], depth);
  }
  if (Node.isCallExpression(value) && TAGS.has(value.getExpression().getText().replace(/^.*\./, ''))) {
    const [first, second] = value.getArguments();
    const template = first === undefined ? undefined : templateText(first);
    if (template === undefined) return { kind: 'dynamic', why: 'the document handed to graphql() is not a literal' };
    // gql.tada hands the fragments a document uses as a second argument.
    const handed = second !== undefined && Node.isArrayLiteralExpression(second) ? second.getElements() : [];
    return read(template.text, value.getSourceFile(), template.offset, [...template.holes, ...handed], [], depth);
  }
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) || Node.isTemplateExpression(value)) {
    const template = templateText(value);
    if (template === undefined || template.holes.length > 0) return { kind: 'dynamic', why: 'the document is assembled from parts at run time' };
    return read(template.text, value.getSourceFile(), template.offset, [], [], depth);
  }
  if (Node.isObjectLiteralExpression(value)) {
    const printed = printAst(value);
    if (printed !== '') return read(printed, value.getSourceFile(), value.getStart(), [], [], depth);
    return { kind: 'dynamic', why: 'the object is not a document' };
  }
  if (Node.isBinaryExpression(value) || Node.isCallExpression(value)) return { kind: 'dynamic', why: 'the document is assembled from parts at run time' };
  if (Node.isIdentifier(value) || Node.isPropertyAccessExpression(value)) {
    const symbol = value.getSymbol();
    for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
      if (Node.isVariableDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer !== undefined) {
          const found = documentOf(initializer, depth + 1);
          // A generated constant reads as its own position, not codegen's.
          return found;
        }
      }
      if (Node.isImportClause(declaration) || Node.isImportSpecifier(declaration)) {
        const holder = Node.isImportClause(declaration) ? declaration.getParent() : declaration.getImportDeclaration();
        const file = Node.isImportDeclaration(holder) ? importedFile(value.getSourceFile(), holder.getModuleSpecifierValue()) : undefined;
        if (file !== undefined) return read(file.text, file.sourceFile, value.getStart(), [], [], depth);
      }
    }
    return { kind: 'dynamic', why: `${value.getText()} is not a document this could read` };
  }
  return { kind: 'dynamic', why: 'the document is not written where it is used' };
};

/** 1-based line of an offset into a document, in the file it is written in. */
export const lineInFile = (reading: Extract<DocumentReading, { kind: 'read' }>, offset: number): number =>
  reading.sourceFile.getLineAndColumnAtPos(Math.min(reading.offset + offset, reading.sourceFile.getEnd())).line;
