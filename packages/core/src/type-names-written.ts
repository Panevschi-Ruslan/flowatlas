import { ts } from 'ts-morph';
import { isDiscriminatorField } from './message-types.js';

/**
 * Where a message type's name is written in the code (P404).
 *
 * "No code selects ROW_CLAIMED" was unsure wherever one consumer of the
 * channel takes every type and hands it on: what takes the types past it was
 * not read, so any code might choose it. An agent then read every such
 * consumer's file. But a type is chosen by its name: a `case`, a comparison, a
 * key of a record of handlers, a set of names. Where the name is written
 * nowhere but where it is sent, and where it is defined (an enum member, a
 * constant) that only the sends use, nothing can choose it by name. What the
 * name cannot rule out is said apart: a prefix or pattern test, a name
 * assembled when the code runs.
 *
 * This reads one file's text for that, with the compiler's parser alone (no
 * project, no types): every place a word is written, each said as a send, a
 * definition, a type, an import or anything else; and every test of a string
 * the name cannot rule out. The linker asks it of every file the build read,
 * once every type's name is known.
 */

/** What a place a name is written in does with it. */
export type NameSiteKind =
  /** `type: 'ROW_CLAIMED'`, `msg.type = Events.ROW_CLAIMED`: a message built. */
  | 'write'
  /** An enum member, a constant, a member of an object of constants: the name defined. */
  | 'definition'
  /** A type: `type: 'ROW_CLAIMED'` in an interface, a union of literals. Nothing runs it. */
  | 'type'
  /** An import or an export of the name: nothing runs it. */
  | 'import'
  /** `Events.ROW_CLAIMED`'s `Events`, a member of another name: what the member is, is said of the member. */
  | 'member'
  /** Anything else: a `case`, a comparison, a key of a record of handlers, a set or list of names. */
  | 'other';

/** One place a word is written. */
export interface NameSite {
  /** The word. */
  readonly word: string;
  readonly line: number;
  readonly kind: NameSiteKind;
  /** The code around it, short. */
  readonly text: string;
  /**
   * A definition that holds the word under another name (`Claimed =
   * 'ROW_CLAIMED'`, `const ROW = 'ROW_CLAIMED'`): that name, and the enum or
   * object holding it where one does. Its uses are where the name goes on.
   */
  readonly alias?: string;
  readonly container?: string;
  /** Where the word is a member's name (`Events.ROW_CLAIMED`), what it is a member of, as written (`Events`). */
  readonly of?: string;
}

/** A test of a string the name cannot rule out, as written. */
export type NameTestShape =
  | { readonly kind: 'prefix' | 'suffix' | 'contains'; readonly text: string }
  | {
      readonly kind: 'pattern';
      readonly source: string;
      readonly flags: string;
    }
  | {
      readonly kind: 'assembled';
      readonly parts: readonly string[];
      readonly head: boolean;
      readonly tail: boolean;
    };

/** A test that may take a type by something other than its whole name. */
export interface NameTest {
  readonly line: number;
  readonly text: string;
  readonly shape: NameTestShape;
}

/** What one file says. */
export interface NamesInFile {
  readonly sites: readonly NameSite[];
  readonly tests: readonly NameTest[];
}

/** Short text of a node for a row. */
const short = (node: ts.Node, source: ts.SourceFile): string => node.getText(source).replace(/\s+/g, ' ').slice(0, 80);

/** Past the wrappers that change nothing about a value. */
const outward = (node: ts.Node): ts.Node => {
  let current = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent)
  ) {
    current = current.parent;
  }
  return current;
};

/** Whether a node is written in a type: an interface, a type alias, an annotation. */
const inType = (node: ts.Node): boolean => {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isInterfaceDeclaration(at) || ts.isTypeAliasDeclaration(at) || ts.isLiteralTypeNode(at) || ts.isTypeReferenceNode(at) || ts.isTypeQueryNode(at))
      return true;
    if (ts.isTypeNode(at) && !ts.isExpressionWithTypeArguments(at)) return true;
    if (ts.isStatement(at) || ts.isSourceFile(at) || ts.isBlock(at)) return false;
  }
  return false;
};

/** The name a declaration holding an object literal is known by: a constant, a class's field, an export. */
const holderOf = (object: ts.ObjectLiteralExpression): string | undefined => {
  let at: ts.Node = outward(object);
  // `Object.freeze({ … })`
  if (ts.isCallExpression(at.parent) && at.parent.expression.getText() === 'Object.freeze') at = outward(at.parent);
  const parent = at.parent;
  if ((ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.initializer === at && ts.isIdentifier(parent.name))
    return parent.name.text;
  if (ts.isExportAssignment(parent)) return 'default';
  return undefined;
};

/** Whether a value written in an object is a name (a string, or a member of another), not code. */
const isNameValue = (node: ts.Node | undefined): boolean =>
  node !== undefined && (ts.isStringLiteralLike(node) || ts.isPropertyAccessExpression(node) || ts.isIdentifier(node) || ts.isNumericLiteral(node));

/** The text of a property's name, written as an identifier or a string. */
const keyText = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;

/**
 * What an expression that is the name does with it: builds a message
 * (`type: …`, `x.type = …`), defines it (a constant's value), or anything
 * else. `site` is the expression past its wrappers.
 */
const expressionUse = (expression: ts.Node): { kind: NameSiteKind; alias?: string; container?: string } => {
  const site = outward(expression);
  const parent = site.parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === site) {
    const key = keyText(parent.name);
    if (key !== undefined && isDiscriminatorField(key)) return { kind: 'write' };
    const holder = ts.isObjectLiteralExpression(parent.parent) ? holderOf(parent.parent) : undefined;
    if (holder !== undefined && key !== undefined) return { kind: 'definition', alias: key, container: holder };
    return { kind: 'other' };
  }
  if (ts.isBinaryExpression(parent) && parent.right === site && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = parent.left;
    const field = ts.isPropertyAccessExpression(left)
      ? left.name.text
      : ts.isElementAccessExpression(left) && ts.isStringLiteralLike(left.argumentExpression)
        ? left.argumentExpression.text
        : undefined;
    if (field !== undefined && isDiscriminatorField(field)) return { kind: 'write' };
    return { kind: 'other' };
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === site && ts.isIdentifier(parent.name)) return { kind: 'definition', alias: parent.name.text };
  if (ts.isPropertyDeclaration(parent) && parent.initializer === site && ts.isIdentifier(parent.name)) return { kind: 'definition', alias: parent.name.text };
  if (ts.isEnumMember(parent) && parent.initializer === site) {
    const key = keyText(parent.name);
    return {
      kind: 'definition',
      ...(key === undefined ? {} : { alias: key }),
      container: parent.parent.name.text,
    };
  }
  return { kind: 'other' };
};

/** What a place an identifier is written does with the word, by what it is in the code. */
const identifierUse = (node: ts.Identifier): { kind: NameSiteKind; alias?: string; container?: string } => {
  const parent = node.parent;
  if (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportEqualsDeclaration(parent)
  ) {
    return { kind: 'import' };
  }
  if (inType(node)) return { kind: 'type' };
  if (ts.isEnumMember(parent) && parent.name === node) return { kind: 'definition', container: parent.parent.name.text };
  if (ts.isEnumDeclaration(parent) && parent.name === node) return { kind: 'definition' };
  if ((ts.isVariableDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node)
    return { kind: 'definition' };
  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    // A key: of an object of constants, a definition; of a record of handlers, a choice by the name.
    const holder = ts.isObjectLiteralExpression(parent.parent) ? holderOf(parent.parent) : undefined;
    return holder !== undefined && isNameValue(parent.initializer) ? { kind: 'definition', container: holder } : { kind: 'other' };
  }
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return isDiscriminatorField(node.text) ? { kind: 'write' } : { kind: 'other' };
  if (ts.isPropertyAccessExpression(parent)) {
    if (parent.expression === node) return { kind: 'member' };
    if (parent.name === node) return expressionUse(parent);
  }
  if (ts.isQualifiedName(parent)) return { kind: 'type' };
  return expressionUse(node);
};

/** The script a file holds, with the line it starts on: the whole of a script file, else the `<script>` blocks of a file that is not one (a single-file component), else none. */
const scriptsOf = (fileName: string, text: string): Array<{ code: string; line: number; kind: ts.ScriptKind }> => {
  const lower = fileName.toLowerCase();
  if (!/\.(m|c)?(t|j)sx?$/.test(lower)) {
    const out: Array<{ code: string; line: number; kind: ts.ScriptKind }> = [];
    for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const start = (match.index ?? 0) + match[0].indexOf('>') + 1;
      const line = text.slice(0, start).split('\n').length;
      out.push({
        code: match[2] ?? '',
        line,
        kind: /lang=["']tsx?["']/.test(match[1] ?? '') ? ts.ScriptKind.TS : ts.ScriptKind.JS,
      });
    }
    return out;
  }
  const kind = lower.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : lower.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : /\.(m|c)?ts$/.test(lower)
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  return [{ code: text, line: 1, kind }];
};

/** A word's places written outside a script (a template, markup): each anything else, nothing parsed. */
const markupSites = (text: string, words: ReadonlySet<string>, scripts: ReadonlyArray<{ code: string; line: number }>): NameSite[] => {
  const scriptLines = new Set<number>();
  for (const script of scripts) {
    const lines = script.code.split('\n').length;
    for (let at = 0; at < lines; at += 1) scriptLines.add(script.line + at);
  }
  const out: NameSite[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (scriptLines.has(index + 1)) continue;
    const line = lines[index] as string;
    for (const word of words) {
      if (wordAt(line, word) < 0) continue;
      out.push({
        word,
        line: index + 1,
        kind: 'other',
        text: line.trim().slice(0, 80),
      });
    }
  }
  return out;
};

/** Where a word is written in a line as a whole word, or -1. */
const wordAt = (line: string, word: string): number => {
  let from = 0;
  for (;;) {
    const at = line.indexOf(word, from);
    if (at < 0) return -1;
    const before = at === 0 ? '' : (line[at - 1] as string);
    const after = line[at + word.length] ?? '';
    if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) return at;
    from = at + 1;
  }
};

/** The methods that test a string by part of it. */
const PART_TESTS: Readonly<Record<string, 'prefix' | 'suffix' | 'contains'>> = {
  startsWith: 'prefix',
  endsWith: 'suffix',
  includes: 'contains',
};

/** Whether an expression reads a message's type: `evt.type`, `evt['kind']`, a local named so. */
const readsTypeField = (node: ts.Node): boolean => {
  const at = ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) ? node.expression : node;
  if (ts.isPropertyAccessExpression(at)) return isDiscriminatorField(at.name.text);
  if (ts.isElementAccessExpression(at)) return ts.isStringLiteralLike(at.argumentExpression) && isDiscriminatorField(at.argumentExpression.text);
  if (ts.isIdentifier(at)) return isDiscriminatorField(at.text) || /type$/i.test(at.text);
  return false;
};

/** Text a name may hold: no spaces, no path. */
const NAMELIKE = /^[\w.:-]+$/;

/** The parts of a string assembled from text and values (`ROW_${x}`, `'ROW_' + x`), where its text may be a name's. */
const assembledOf = (node: ts.Node): { parts: string[]; head: boolean; tail: boolean } | undefined => {
  if (ts.isTemplateExpression(node)) {
    const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
    const head = node.head.text !== '';
    const tail = (node.templateSpans.at(-1)?.literal.text ?? '') !== '';
    return { parts: parts.filter((part) => part !== ''), head, tail };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    // The whole chain, once, from its top.
    if (ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken) return undefined;
    const operands: ts.Node[] = [];
    const flatten = (each: ts.Node): void => {
      if (ts.isBinaryExpression(each) && each.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        flatten(each.left);
        flatten(each.right);
      } else operands.push(each);
    };
    flatten(node);
    if (!operands.some((each) => ts.isStringLiteralLike(each))) return undefined;
    const parts = operands.filter((each) => ts.isStringLiteralLike(each)).map((each) => (each as ts.StringLiteralLike).text);
    return {
      parts: parts.filter((part) => part !== ''),
      head: ts.isStringLiteralLike(operands[0]!),
      tail: ts.isStringLiteralLike(operands.at(-1)!),
    };
  }
  return undefined;
};

/** The tests a node makes that the name cannot rule out, where it makes one. */
const testOf = (node: ts.Node, source: ts.SourceFile): NameTest | undefined => {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    const [argument] = node.arguments;
    const part = PART_TESTS[method];
    if (part !== undefined && argument !== undefined && ts.isStringLiteralLike(argument) && argument.text.length >= 2 && NAMELIKE.test(argument.text)) {
      // `includes` of an array is a list of names, whose names are each written: only a type's own text is a test.
      if (part === 'contains' && !readsTypeField(node.expression.expression)) return undefined;
      return {
        line,
        text: short(node, source),
        shape: { kind: part, text: argument.text },
      };
    }
    // `/^ROW_/.test(evt.type)`, `evt.type.match(/^ROW_/)`
    const regex = method === 'test' ? node.expression.expression : ['match', 'search', 'matchAll'].includes(method) ? argument : undefined;
    if (regex !== undefined && ts.isRegularExpressionLiteral(regex)) {
      const at = regex.text.lastIndexOf('/');
      return {
        line,
        text: short(node, source),
        shape: {
          kind: 'pattern',
          source: regex.text.slice(1, at),
          flags: regex.text.slice(at + 1),
        },
      };
    }
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'RegExp') {
    const [argument] = node.arguments ?? [];
    if (argument !== undefined && ts.isStringLiteralLike(argument))
      return {
        line,
        text: short(node, source),
        shape: { kind: 'pattern', source: argument.text, flags: '' },
      };
  }
  const assembled = assembledOf(node);
  if (assembled !== undefined && assembled.parts.length > 0 && assembled.parts.every((part) => NAMELIKE.test(part)) && assembled.parts.join('').length >= 3) {
    return {
      line,
      text: short(node, source),
      shape: { kind: 'assembled', ...assembled },
    };
  }
  return undefined;
};

/** The words worth parsing a file for: any of them written in it as a whole word. */
const mentions = (text: string, words: ReadonlySet<string>): boolean => {
  for (const word of words) if (text.includes(word)) return true;
  return false;
};

/** Text that may hold a test the name cannot rule out. */
const MAY_TEST = /startsWith|endsWith|includes|\.test\(|\.match|\.search|RegExp|`[^`]*\$\{|['"]\s*\+|\+\s*['"]/;

/**
 * Every place one file writes one of `words`, and every test of a string in
 * it the name cannot rule out. A file whose text holds neither is not parsed.
 * A file that is not a script file is read in its `<script>` blocks, its markup as
 * text; a file with no `<script>` block (a template) as text alone.
 */
export const typeNamesIn = (fileName: string, text: string, words: ReadonlySet<string>, options: { tests?: boolean } = {}): NamesInFile => {
  const wanted = mentions(text, words);
  const testing = options.tests !== false && MAY_TEST.test(text);
  if (!wanted && !testing) return { sites: [], tests: [] };
  const scripts = scriptsOf(fileName, text);
  const sites: NameSite[] = wanted ? markupSites(text, words, scripts) : [];
  const tests: NameTest[] = [];
  for (const script of scripts) {
    const source = ts.createSourceFile(fileName, script.code, ts.ScriptTarget.Latest, true, script.kind);
    const offset = script.line - 1;
    const visit = (node: ts.Node): void => {
      if (testing) {
        const test = testOf(node, source);
        if (test !== undefined) tests.push({ ...test, line: test.line + offset });
      }
      if (wanted && (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) && words.has(node.text)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 + offset;
        const use = ts.isIdentifier(node) ? identifierUse(node) : inType(node) ? { kind: 'type' as const } : stringUse(node);
        const around = statementOf(node);
        const of =
          ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node ? node.parent.expression.getText(source) : undefined;
        sites.push({
          word: node.text,
          line,
          kind: use.kind,
          text: short(around, source),
          ...(use.alias === undefined || use.alias === node.text ? {} : { alias: use.alias }),
          ...(use.container === undefined ? {} : { container: use.container }),
          ...(of === undefined ? {} : { of }),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { sites, tests };
};

/** What a string that is the name does with it: as a key of an object, as an expression. */
const stringUse = (node: ts.StringLiteralLike): { kind: NameSiteKind; alias?: string; container?: string } => {
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    const holder = ts.isObjectLiteralExpression(parent.parent) ? holderOf(parent.parent) : undefined;
    return holder !== undefined && isNameValue(parent.initializer) ? { kind: 'definition', container: holder } : { kind: 'other' };
  }
  if (ts.isEnumMember(parent) && parent.name === node) return { kind: 'definition', container: parent.parent.name.text };
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return { kind: 'import' };
  return expressionUse(node);
};

/** The code a node is written in, for a row: its statement, or the member it is part of. */
const statementOf = (node: ts.Node): ts.Node => {
  for (let at: ts.Node = node; at.parent !== undefined; at = at.parent) {
    if (ts.isStatement(at) || ts.isClassElement(at) || ts.isEnumMember(at) || ts.isCaseClause(at) || ts.isPropertyAssignment(at) || ts.isTypeElement(at)) {
      // A case is said by its label, not its whole body.
      if (ts.isCaseClause(at)) return at.expression;
      if (ts.isIfStatement(at)) return at.expression;
      return at;
    }
  }
  return node;
};

/** The most characters a regular expression read from the code is tried on. */
const MOST_PATTERN = 200;

/**
 * Whether a test the code makes may take the value: its prefix, suffix or
 * part is the value's; its pattern matches the value and names part of it
 * (a pattern of letters alone, `/^[A-Z_]+$/`, checks a shape, not a type); an
 * assembled name's text fits the value, in order.
 */
export const testMayTake = (shape: NameTestShape, value: string): boolean => {
  switch (shape.kind) {
    case 'prefix':
      return value.startsWith(shape.text) && value !== shape.text;
    case 'suffix':
      return value.endsWith(shape.text) && value !== shape.text;
    case 'contains':
      return value.includes(shape.text) && value !== shape.text;
    case 'pattern': {
      if (shape.source.length > MOST_PATTERN) return true;
      const runs = shape.source.replace(/\\./g, ' ').match(/[A-Za-z0-9_]{3,}/g) ?? [];
      if (!runs.some((run) => value.includes(run))) return false;
      try {
        return new RegExp(shape.source, shape.flags.replace(/[gy]/g, '')).test(value);
      } catch {
        return true;
      }
    }
    case 'assembled': {
      const { parts, head, tail } = shape;
      let from = 0;
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] as string;
        const at = value.indexOf(part, from);
        if (at < 0) return false;
        if (index === 0 && head && at !== 0) return false;
        from = at + part.length;
      }
      return !tail || value.endsWith(parts.at(-1) as string);
    }
  }
};

/** On a message type's node (P404): where its name is written, as `nameWrittenOf` reads it. */
export const NAME_WRITTEN_META = 'nameWritten';

/** A place a type's name is written: the service, `file:line`, and the code there. */
export interface WrittenPlace {
  readonly service: string;
  readonly loc: string;
  readonly text: string;
}

/** A place a type may still be chosen, and why. */
export interface OpenPlace extends WrittenPlace {
  readonly why: string;
}

/**
 * Where a type's name is written in the code the build read (P404): where it
 * is sent (or built into a message), how many places define it, and every
 * other place, each one a choice the graph did not read (a comparison, a key,
 * a set of names, a use of the whole enum) or a test that may take it (a
 * prefix, a pattern, a name assembled when the code runs). Choices the graph
 * read are not counted here: they are its selections.
 */
export interface NameWritten {
  /** The first places it is built into a message, a publish's first. */
  readonly sent: readonly WrittenPlace[];
  readonly sentCount: number;
  /** Whether every place it is built is a publish of it: not a helper in another file. */
  readonly onlyAtSends: boolean;
  /** How many places define it: an enum member, a constant, a type. */
  readonly defined: number;
  /** The first places a choice may still be made, at most `MOST_OPEN`. */
  readonly open: readonly OpenPlace[];
  readonly openCount: number;
  /** Services whose code was not read for its name: a choice there is not ruled out. */
  readonly unread?: readonly string[];
}

/** The most places a type's node lists of each kind; the rest are counted. */
export const MOST_WRITTEN = 3;
export const MOST_OPEN = 5;

const isPlace = (value: unknown): value is WrittenPlace =>
  typeof value === 'object' && value !== null && typeof (value as WrittenPlace).loc === 'string' && typeof (value as WrittenPlace).service === 'string';

/** Where a type node says its name is written, where the build read it; undefined where it did not. */
export const nameWrittenOf = (node: { meta?: Record<string, unknown> } | undefined): NameWritten | undefined => {
  const raw = node?.meta?.[NAME_WRITTEN_META];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const said = raw as Partial<NameWritten>;
  const sent = Array.isArray(said.sent) ? said.sent.filter(isPlace) : [];
  const open = Array.isArray(said.open) ? said.open.filter((each): each is OpenPlace => isPlace(each) && typeof (each as OpenPlace).why === 'string') : [];
  return {
    sent,
    sentCount: typeof said.sentCount === 'number' ? said.sentCount : sent.length,
    onlyAtSends: said.onlyAtSends !== false,
    defined: typeof said.defined === 'number' ? said.defined : 0,
    open,
    openCount: typeof said.openCount === 'number' ? said.openCount : open.length,
    ...(Array.isArray(said.unread) && said.unread.length > 0
      ? {
          unread: said.unread.filter((each): each is string => typeof each === 'string'),
        }
      : {}),
  };
};
