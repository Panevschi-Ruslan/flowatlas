import { ts } from 'ts-morph';

/**
 * A pattern, parsed (P121).
 *
 * A pattern is one TypeScript expression, read by the TypeScript parser the
 * readers use: `$BUS.emit({ topic: $CHANNEL, data: $PAYLOAD })`. `$NAME` is a
 * hole that names one node, `$$$NAME` a run of arguments, `_` anything. `$` is
 * a letter of an identifier in the language, so a pattern is ordinary syntax
 * and needs no grammar of its own; this turns the parser's tree into the few
 * shapes a pattern can hold, and keeps the text of anything else so that the
 * compiler can refuse it by name.
 */
export type PatternNode =
  | { readonly kind: 'hole'; readonly name: string }
  | { readonly kind: 'run'; readonly name: string }
  | { readonly kind: 'any' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
  | { readonly kind: 'name'; readonly text: string }
  | { readonly kind: 'object'; readonly entries: readonly PatternEntry[] }
  | { readonly kind: 'array'; readonly elements: readonly PatternNode[] }
  | { readonly kind: 'new'; readonly className: string | undefined; readonly args: readonly PatternNode[]; readonly text: string }
  | PatternCall
  | { readonly kind: 'member'; readonly object: PatternNode; readonly name: string; readonly text: string }
  | { readonly kind: 'function'; readonly text: string; readonly holes: readonly string[] }
  | { readonly kind: 'spread'; readonly text: string; readonly holes: readonly string[] }
  | { readonly kind: 'other'; readonly text: string; readonly holes: readonly string[] };

/** One key of an object in a pattern, and what is written under it. */
export interface PatternEntry {
  readonly key: string;
  readonly value: PatternNode;
}

/** A call in a pattern: what is called, and what it is handed. */
export interface PatternCall {
  readonly kind: 'call';
  readonly callee: PatternNode;
  readonly args: readonly PatternNode[];
  readonly text: string;
}

/** A whole pattern: the call it describes, or a decorator. */
export interface ParsedPattern {
  /** The call, or the decorator's call (`OnEvent({ name: $C })` for `@OnEvent({ name: $C })`). */
  readonly root: PatternNode;
  /** Whether the pattern was written as a decorator. */
  readonly decorator: boolean;
}

/** A pattern the parser could not read, and where. */
export interface PatternSyntaxError {
  readonly error: string;
}

/** Whether an identifier is a hole, a run, or the wildcard. */
const identifierNode = (text: string): PatternNode => {
  if (text === '_') return { kind: 'any' };
  if (/^\$\$\$[A-Za-z_]\w*$/.test(text)) return { kind: 'run', name: text };
  if (/^\$[A-Za-z_]\w*$/.test(text)) return { kind: 'hole', name: text };
  return { kind: 'name', text };
};

/** Every hole written anywhere inside a node of the parser's tree. */
const holesIn = (node: ts.Node): string[] => {
  const found: string[] = [];
  const visit = (at: ts.Node): void => {
    if (ts.isIdentifier(at) && /^\$/.test(at.text)) found.push(at.text);
    ts.forEachChild(at, visit);
  };
  visit(node);
  return found;
};

const keyOf = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;

const toNode = (node: ts.Expression, source: ts.SourceFile): PatternNode => {
  const text = node.getText(source);
  if (ts.isParenthesizedExpression(node)) return toNode(node.expression, source);
  if (ts.isIdentifier(node)) return identifierNode(node.text);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { kind: 'literal', value: node.text };
  if (ts.isNumericLiteral(node)) return { kind: 'literal', value: Number(node.text) };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return { kind: 'literal', value: -Number(node.operand.text) };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null };
  if (ts.isObjectLiteralExpression(node)) {
    const entries: PatternEntry[] = [];
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const key = keyOf(property.name);
        if (key === undefined) return { kind: 'other', text, holes: holesIn(node) };
        entries.push({ key, value: toNode(property.initializer, source) });
      } else if (ts.isShorthandPropertyAssignment(property)) {
        // `{ data }` says a key is written and nothing about its value.
        entries.push({ key: property.name.text, value: { kind: 'any' } });
      } else if (ts.isSpreadAssignment(property)) {
        return { kind: 'spread', text: property.getText(source), holes: holesIn(property) };
      } else {
        return { kind: 'other', text, holes: holesIn(node) };
      }
    }
    return { kind: 'object', entries };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const spread = node.elements.find(ts.isSpreadElement);
    if (spread !== undefined) return { kind: 'spread', text: spread.getText(source), holes: holesIn(spread) };
    return { kind: 'array', elements: node.elements.map((element) => toNode(element, source)) };
  }
  if (ts.isNewExpression(node)) {
    const className = ts.isIdentifier(node.expression) ? node.expression.text : undefined;
    return { kind: 'new', className, args: (node.arguments ?? []).map((arg) => argumentNode(arg, source)), text };
  }
  if (ts.isCallExpression(node)) {
    return { kind: 'call', callee: toNode(node.expression, source), args: node.arguments.map((arg) => argumentNode(arg, source)), text };
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    return { kind: 'member', object: toNode(node.expression, source), name: node.name.text, text };
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { kind: 'function', text, holes: holesIn(node) };
  return { kind: 'other', text, holes: holesIn(node) };
};

const argumentNode = (arg: ts.Expression, source: ts.SourceFile): PatternNode =>
  ts.isSpreadElement(arg) ? { kind: 'spread', text: arg.getText(source), holes: holesIn(arg) } : toNode(arg, source);

/**
 * Reads a pattern's text. A decorator is written with its `@`; anything else
 * is one expression. Text the parser does not read as one expression is an
 * error naming what it stopped at.
 */
export const parsePattern = (text: string): ParsedPattern | PatternSyntaxError => {
  const trimmed = text.trim();
  const decorator = trimmed.startsWith('@');
  const body = decorator ? trimmed.slice(1) : trimmed;
  const source = ts.createSourceFile('pattern.ts', `(${body}\n);`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (source as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const first = diagnostics[0];
  if (first !== undefined) {
    return { error: `it does not parse as one expression: ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}` };
  }
  const [statement] = source.statements;
  if (statement === undefined || source.statements.length !== 1 || !ts.isExpressionStatement(statement)) {
    return { error: 'it is not one expression' };
  }
  const root = toNode(statement.expression, source);
  // A bare decorator, `@Handler`, is a call with nothing in it.
  if (decorator && root.kind === 'name') return { root: { kind: 'call', callee: root, args: [], text: body }, decorator };
  return { root, decorator };
};

/** Whether a parse gave a pattern. */
export const isParsed = (parsed: ParsedPattern | PatternSyntaxError): parsed is ParsedPattern => 'root' in parsed;
